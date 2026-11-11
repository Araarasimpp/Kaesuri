-- ============================================================================
--  Kaesuri · Deudas con proveedores y cuentas por cobrar (como en Jasta). YA APLICADO en Supabase.
--   · Deudas: de una compra de Inventario (mercancía fiada), con sus propios productos (compras
--     viejas que no pasaron por Inventario) o sin productos (préstamo, servicio). Se calcula cuánto
--     de esa mercancía ya se vendió para saber cuánto apartar y abonarle al proveedor.
--   · Cuentas por cobrar: mercancía entregada al costo a personas de confianza (con un aumento
--     opcional) y sus abonos, aparte de las ventas.
--   · Eliminar compras y ajustes de inventario subidos por error.
--  El recordatorio diario de deudas por vencer (cron) está en PENDIENTE_correr_en_supabase.sql.
-- ============================================================================

create or replace function public.mi_nombre() returns text language sql stable security definer set search_path to 'public' as $$
  select nombre from profiles where id = auth.uid()
$$;

create or replace function public.solo_admin(p_que text default 'eso') returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin maneja %', p_que; end if;
end $$;
revoke all on function public.solo_admin(text) from public, anon;

-- ---------------------------------------------------------------- Tablas
create table if not exists public.deudas (
  id bigint generated always as identity primary key,
  proveedor text not null check (length(trim(proveedor)) between 2 and 120),
  concepto text,
  total numeric not null check (total > 0),
  fecha date not null default ((now() at time zone 'America/Bogota')::date),
  vence date,
  compra_id bigint unique references public.compras(id),
  contar_desde date,
  comprobantes text[] not null default '{}',
  estado text not null default 'abierta' check (estado in ('abierta', 'pagada', 'anulada')),
  creado_por uuid references public.profiles(id) on delete set null,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create table if not exists public.deuda_items (
  id bigint generated always as identity primary key,
  deuda_id bigint not null references public.deudas(id) on delete cascade,
  producto_id uuid not null references public.productos(id),
  nombre text not null,
  cantidad int not null check (cantidad > 0),
  costo numeric not null check (costo >= 0)
);
create table if not exists public.deuda_abonos (
  id bigint generated always as identity primary key,
  deuda_id bigint not null references public.deudas(id),
  fecha date not null default ((now() at time zone 'America/Bogota')::date),
  valor numeric not null check (valor > 0),
  metodo text not null default 'transferencia' check (metodo in ('efectivo', 'transferencia', 'otro')),
  comprobantes text[] not null default '{}',
  nota text,
  anulado boolean not null default false,
  creado_por uuid references public.profiles(id) on delete set null,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists deuda_items_deuda_idx on public.deuda_items (deuda_id);
create index if not exists deuda_abonos_deuda_idx on public.deuda_abonos (deuda_id);

create table if not exists public.cuentas_cobrar (
  id bigint generated always as identity primary key,
  nombre text not null,
  telefono text,
  aumento numeric not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.cuenta_entregas (
  id bigint generated always as identity primary key,
  cuenta_id bigint not null references public.cuentas_cobrar(id),
  fecha date not null,
  total numeric not null default 0,
  nota text,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create table if not exists public.cuenta_entrega_items (
  id bigint generated always as identity primary key,
  entrega_id bigint not null references public.cuenta_entregas(id) on delete cascade,
  producto_id uuid not null references public.productos(id),
  nombre text not null,
  cantidad int not null check (cantidad > 0),
  costo numeric not null check (costo >= 0),
  costo_real numeric not null default 0
);
create table if not exists public.cuenta_abonos (
  id bigint generated always as identity primary key,
  cuenta_id bigint not null references public.cuentas_cobrar(id),
  fecha date not null,
  valor numeric not null check (valor > 0),
  metodo text not null default 'efectivo' check (metodo in ('efectivo', 'transferencia', 'otro')),
  comprobantes text[] not null default '{}',
  nota text,
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists cuenta_entregas_cuenta_idx on public.cuenta_entregas (cuenta_id);
create index if not exists cuenta_entrega_items_entrega_idx on public.cuenta_entrega_items (entrega_id);
create index if not exists cuenta_abonos_cuenta_idx on public.cuenta_abonos (cuenta_id);

alter table public.deudas enable row level security;
alter table public.deuda_items enable row level security;
alter table public.deuda_abonos enable row level security;
alter table public.cuentas_cobrar enable row level security;
alter table public.cuenta_entregas enable row level security;
alter table public.cuenta_entrega_items enable row level security;
alter table public.cuenta_abonos enable row level security;
revoke all on public.deudas, public.deuda_items, public.deuda_abonos, public.cuentas_cobrar, public.cuenta_entregas,
  public.cuenta_entrega_items, public.cuenta_abonos from anon, authenticated;

-- ---------------------------------------------------------------- Lo vendido de la mercancía de una deuda
-- Compra registrada en Inventario: lo entregado (y lo dado al costo) después de registrarla,
-- menos el stock que ya había antes (se vende primero lo viejo).
create or replace function public.vendido_de_compra(p_compra bigint)
returns table(producto_id uuid, nombre text, cantidad int, costo numeric, vendidas int)
language sql stable security definer set search_path to 'public' as $$
  select i.producto_id, i.nombre, i.cantidad, i.costo,
    least(i.cantidad, greatest(coalesce((
      select sum(pi.cantidad) from pedido_items pi join pedidos p on p.id = pi.pedido_id
      where pi.producto_id = i.producto_id and p.estado = 'entregado' and p.entregado_at >= c.created_at), 0)
      + coalesce((select sum(ci.cantidad) from cuenta_entrega_items ci join cuenta_entregas ce on ce.id = ci.entrega_id
                  where ci.producto_id = i.producto_id and ce.created_at >= c.created_at), 0)
      - greatest(coalesce((select m.stock_antes from movimientos_inventario m
                           where m.compra_id = c.id and m.producto_id = i.producto_id and m.tipo = 'compra' order by m.created_at limit 1), 0), 0), 0))::int
  from compra_items i join compras c on c.id = i.compra_id
  where i.compra_id = p_compra
$$;

-- Con productos propios o una fecha desde la que se cuenta: todo lo vendido desde ese día
create or replace function public.vendido_de_deuda(p_deuda bigint)
returns table(producto_id uuid, nombre text, cantidad int, costo numeric, vendidas int)
language plpgsql stable security definer set search_path to 'public' as $function$
declare d deudas; v_desde date;
begin
  select * into d from deudas where id = p_deuda;
  if not found then return; end if;
  v_desde := coalesce(d.contar_desde, case when d.compra_id is null then d.fecha end);
  if v_desde is null then
    return query select * from public.vendido_de_compra(d.compra_id);
    return;
  end if;
  return query
    with it as (
      select i.producto_id, i.nombre, i.cantidad, i.costo from compra_items i where d.compra_id is not null and i.compra_id = d.compra_id
      union all
      select i.producto_id, i.nombre, i.cantidad, i.costo from deuda_items i where d.compra_id is null and i.deuda_id = d.id
    )
    select it.producto_id, it.nombre, it.cantidad, it.costo,
      least(it.cantidad, coalesce((
        select sum(pi.cantidad) from pedido_items pi join pedidos p on p.id = pi.pedido_id
        where pi.producto_id = it.producto_id and p.estado = 'entregado'
          and coalesce(p.entregado_at, p.created_at) >= (v_desde::timestamp at time zone 'America/Bogota')), 0)
      + coalesce((select sum(ci.cantidad) from cuenta_entrega_items ci join cuenta_entregas ce on ce.id = ci.entrega_id
                  where ci.producto_id = it.producto_id and ce.fecha >= v_desde), 0))::int
    from it;
end $function$;
revoke all on function public.vendido_de_compra(bigint), public.vendido_de_deuda(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- Deudas
create or replace function public.deudas_lista(p_estado text default 'abiertas')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las deudas');
  return coalesce((select jsonb_agg(x order by (x->>'estado') = 'abierta' desc, x->>'vence' nulls last, (x->>'id')::bigint desc) from (
    select jsonb_build_object(
      'id', d.id, 'proveedor', d.proveedor, 'concepto', d.concepto, 'total', d.total, 'fecha', d.fecha, 'vence', d.vence,
      'estado', d.estado, 'compra_id', d.compra_id, 'contar_desde', d.contar_desde, 'creado_por', d.creado_por_nombre,
      'abonado', ab.abonado, 'saldo', greatest(d.total - ab.abonado, 0),
      'costo_vendido', v.costo_vendido, 'unidades', v.unidades, 'vendidas', v.vendidas,
      'por_apartar', least(greatest(coalesce(v.costo_vendido, 0) - ab.abonado, 0), greatest(d.total - ab.abonado, 0)),
      'items', v.items,
      'comprobantes', coalesce((select c.comprobantes from compras c where c.id = d.compra_id), '{}') || d.comprobantes,
      'abonos', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'fecha', a.fecha, 'valor', a.valor, 'metodo', a.metodo,
                   'comprobantes', a.comprobantes, 'nota', a.nota, 'anulado', a.anulado, 'quien', a.creado_por_nombre) order by a.fecha desc, a.id desc), '[]')
                 from deuda_abonos a where a.deuda_id = d.id)) x
    from deudas d
    cross join lateral (select coalesce(sum(valor), 0) abonado from deuda_abonos a where a.deuda_id = d.id and not a.anulado) ab
    left join lateral (
      select sum(s.vendidas * s.costo) costo_vendido, sum(s.cantidad) unidades, sum(s.vendidas) vendidas,
        jsonb_agg(jsonb_build_object('producto_id', s.producto_id, 'nombre', s.nombre, 'cantidad', s.cantidad, 'costo', s.costo,
          'vendidas', s.vendidas, 'quedan', s.cantidad - s.vendidas) order by s.nombre) items
      from public.vendido_de_deuda(d.id) s) v on true
    where case coalesce(p_estado, 'abiertas') when 'abiertas' then d.estado = 'abierta' when 'pagadas' then d.estado = 'pagada' else d.estado <> 'anulada' end
  ) s), '[]');
end $function$;

-- Compras de Inventario que todavía no son deuda (para convertirlas)
create or replace function public.compras_sin_deuda()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las deudas');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'fecha', c.fecha, 'proveedor', c.proveedor, 'total', c.total,
      'productos', (select string_agg(i.cantidad || ' × ' || i.nombre, ', ' order by i.id) from compra_items i where i.compra_id = c.id))
      order by c.fecha desc, c.id desc)
    from compras c
    where not c.anulada and c.fecha > (now() at time zone 'America/Bogota')::date - 120
      and not exists (select 1 from deudas d where d.compra_id = c.id and d.estado <> 'anulada')), '[]');
end $function$;

create or replace function public.crear_deuda(p_proveedor text, p_concepto text, p_total numeric, p_fecha date, p_vence date,
  p_compra bigint default null, p_items jsonb default null, p_contar_desde date default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare c compras; v_id bigint; v_total numeric := round(coalesce(p_total, 0)); v_prov text := public.texto_limpio(p_proveedor, 120);
  it jsonb; pr productos; v_cant int; v_costo numeric; v_sum numeric := 0; v_hay_items boolean := jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0;
begin
  perform public.solo_admin('las deudas');
  if p_compra is not null and v_hay_items then raise exception 'Una deuda lleva una compra o sus productos, no ambos'; end if;
  if p_contar_desde > (now() at time zone 'America/Bogota')::date then raise exception 'La fecha para contar lo vendido no puede ser después de hoy'; end if;
  if p_compra is not null then
    select * into c from compras where id = p_compra and not anulada;
    if not found then raise exception 'Esa compra no existe o está anulada'; end if;
    if exists (select 1 from deudas where compra_id = p_compra and estado <> 'anulada') then raise exception 'Esa compra ya está registrada como deuda'; end if;
    -- Una deuda anulada de la misma compra se libera para poder registrarla otra vez
    update deudas set compra_id = null where compra_id = p_compra and estado = 'anulada';
    v_prov := coalesce(v_prov, c.proveedor);
    if v_total <= 0 then v_total := c.total; end if;
  end if;
  if v_hay_items then
    if jsonb_array_length(p_items) > 80 then raise exception 'Son demasiados productos para una factura'; end if;
    for it in select x from jsonb_array_elements(p_items) x loop
      v_cant := coalesce((it->>'cantidad')::int, 0); v_costo := round(coalesce((it->>'costo')::numeric, 0));
      if v_cant <= 0 then raise exception 'Revisa las cantidades'; end if;
      if v_costo <= 0 then raise exception 'Revisa los costos'; end if;
      v_sum := v_sum + v_cant * v_costo;
    end loop;
    v_total := v_sum;
  end if;
  if v_prov is null or length(v_prov) < 2 then raise exception 'Escribe a quién se le debe'; end if;
  if v_total <= 0 then raise exception 'Escribe el valor de la deuda'; end if;
  insert into deudas (proveedor, concepto, total, fecha, vence, compra_id, contar_desde, creado_por, creado_por_nombre)
  values (v_prov, public.texto_limpio(p_concepto, 300), v_total, coalesce(p_fecha, c.fecha, (now() at time zone 'America/Bogota')::date), p_vence, p_compra,
          p_contar_desde, auth.uid(), public.mi_nombre())
  returning id into v_id;
  if v_hay_items then
    for it in select x from jsonb_array_elements(p_items) x loop
      select * into pr from productos where id = (it->>'producto_id')::uuid;
      if not found then raise exception 'Uno de los productos ya no existe'; end if;
      insert into deuda_items (deuda_id, producto_id, nombre, cantidad, costo)
      values (v_id, pr.id, pr.nombre, (it->>'cantidad')::int, round((it->>'costo')::numeric));
    end loop;
  end if;
  return v_id;
end $function$;

-- Editar: total no menos de lo abonado; la fecha para contar lo vendido vacía = automático
create or replace function public.editar_deuda(p_deuda bigint, p_proveedor text, p_concepto text, p_total numeric, p_fecha date, p_vence date,
  p_contar_desde date default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare d deudas; v_abonado numeric; v_total numeric := round(coalesce(p_total, 0)); v_prov text := public.texto_limpio(p_proveedor, 120);
begin
  perform public.solo_admin('las deudas');
  select * into d from deudas where id = p_deuda for update;
  if not found then raise exception 'Esa deuda no existe'; end if;
  if d.estado = 'anulada' then raise exception 'Esa deuda está anulada'; end if;
  if v_prov is null or length(v_prov) < 2 then raise exception 'Escribe a quién se le debe'; end if;
  if v_total <= 0 then raise exception 'Escribe el valor de la deuda'; end if;
  if p_fecha is null then raise exception 'Escribe la fecha'; end if;
  if p_fecha > (now() at time zone 'America/Bogota')::date or p_contar_desde > (now() at time zone 'America/Bogota')::date then
    raise exception 'Las fechas no pueden ser después de hoy';
  end if;
  select coalesce(sum(valor), 0) into v_abonado from deuda_abonos where deuda_id = d.id and not anulado;
  if v_total < v_abonado then raise exception 'Ya le has abonado %: el total no puede ser menor', public.fmt_pesos(v_abonado); end if;
  update deudas set proveedor = v_prov, concepto = public.texto_limpio(p_concepto, 300), total = v_total, fecha = p_fecha, vence = p_vence,
    contar_desde = p_contar_desde, estado = case when v_abonado >= v_total then 'pagada' else 'abierta' end
   where id = d.id;
end $function$;

-- Foto de la factura: las deudas de una compra usan las fotos de la compra
create or replace function public.deuda_factura(p_deuda bigint, p_comprobantes text[])
returns void language plpgsql security definer set search_path to 'public' as $function$
declare d deudas; v text[] := public.comprobantes_validos(p_comprobantes);
begin
  perform public.solo_admin('las deudas');
  select * into d from deudas where id = p_deuda for update;
  if not found then raise exception 'Esa deuda no existe'; end if;
  if coalesce(array_length(v, 1), 0) > 8 then raise exception 'Máximo 8 fotos por factura'; end if;
  if d.compra_id is not null then
    update compras set comprobantes = v where id = d.compra_id;
    update deudas set comprobantes = '{}' where id = d.id;
  else
    update deudas set comprobantes = v where id = d.id;
  end if;
end $function$;

create or replace function public.abonar_deuda(p_deuda bigint, p_valor numeric, p_metodo text, p_comprobantes text[], p_nota text, p_fecha date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare d deudas; v_abonado numeric; v_valor numeric := round(coalesce(p_valor, 0)); v_saldo numeric;
begin
  perform public.solo_admin('las deudas');
  select * into d from deudas where id = p_deuda for update;
  if not found then raise exception 'Esa deuda no existe'; end if;
  if d.estado <> 'abierta' then raise exception 'Esa deuda ya está %', d.estado; end if;
  if coalesce(p_metodo, '') not in ('efectivo', 'transferencia', 'otro') then raise exception 'Forma de pago inválida'; end if;
  select coalesce(sum(valor), 0) into v_abonado from deuda_abonos where deuda_id = d.id and not anulado;
  if v_valor <= 0 then raise exception 'Escribe el valor del abono'; end if;
  if v_valor > d.total - v_abonado then raise exception 'El abono es más de lo que se debe (saldo %)', public.fmt_pesos(d.total - v_abonado); end if;
  insert into deuda_abonos (deuda_id, fecha, valor, metodo, comprobantes, nota, creado_por, creado_por_nombre)
  values (d.id, coalesce(p_fecha, (now() at time zone 'America/Bogota')::date), v_valor, p_metodo, public.comprobantes_validos(p_comprobantes),
          public.texto_limpio(p_nota, 300), auth.uid(), public.mi_nombre());
  v_saldo := d.total - v_abonado - v_valor;
  if v_saldo <= 0 then update deudas set estado = 'pagada' where id = d.id; end if;
  return jsonb_build_object('saldo', v_saldo, 'pagada', v_saldo <= 0);
end $function$;

create or replace function public.anular_abono(p_abono bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_deuda bigint;
begin
  perform public.solo_admin('las deudas');
  update deuda_abonos set anulado = true where id = p_abono and not anulado returning deuda_id into v_deuda;
  if v_deuda is null then raise exception 'Ese abono no existe o ya está anulado'; end if;
  update deudas set estado = 'abierta' where id = v_deuda and estado = 'pagada';
end $function$;

create or replace function public.anular_deuda(p_deuda bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las deudas');
  update deudas set estado = 'anulada' where id = p_deuda and estado <> 'anulada';
  if not found then raise exception 'Esa deuda no existe o ya está anulada'; end if;
end $function$;

-- Subida por error: se borra con sus abonos y productos
create or replace function public.eliminar_deuda(p_deuda bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las deudas');
  delete from deuda_abonos where deuda_id = p_deuda;
  delete from deudas where id = p_deuda;
  if not found then raise exception 'Esa deuda no existe'; end if;
end $function$;

-- Compra subida por error: se restan las unidades que sumó (si no estaba anulada) y se borra con su historial y su deuda
create or replace function public.eliminar_compra(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare c compras; v_deudas int;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede eliminar compras'; end if;
  select * into c from compras where id = p_id for update;
  if not found then raise exception 'Esa compra no existe'; end if;
  if not c.anulada then
    update productos pr set stock = pr.stock - i.cantidad, updated_at = now()
      from compra_items i where i.compra_id = p_id and i.producto_id = pr.id;
  end if;
  delete from deuda_abonos where deuda_id in (select id from deudas where compra_id = p_id);
  delete from deudas where compra_id = p_id;
  get diagnostics v_deudas = row_count;
  delete from movimientos_inventario where compra_id = p_id;
  delete from compra_items where compra_id = p_id;
  delete from compras where id = p_id;
  return jsonb_build_object('deudas', v_deudas);
end $function$;

-- Ajuste de conteo subido por error: se deshace la diferencia y se borra del historial
create or replace function public.eliminar_ajuste(p_mov uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare m movimientos_inventario;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede eliminar ajustes'; end if;
  select * into m from movimientos_inventario where id = p_mov for update;
  if not found then raise exception 'Ese ajuste no existe'; end if;
  if m.tipo <> 'ajuste' then raise exception 'Solo se pueden eliminar ajustes de conteo (las compras se eliminan desde Compras)'; end if;
  update productos set stock = greatest(stock - m.cantidad, 0), updated_at = now() where id = m.producto_id;
  delete from movimientos_inventario where id = p_mov;
end $function$;

revoke all on function public.deudas_lista(text), public.compras_sin_deuda(),
  public.crear_deuda(text, text, numeric, date, date, bigint, jsonb, date), public.editar_deuda(bigint, text, text, numeric, date, date, date),
  public.deuda_factura(bigint, text[]), public.abonar_deuda(bigint, numeric, text, text[], text, date), public.anular_abono(bigint),
  public.anular_deuda(bigint), public.eliminar_deuda(bigint), public.eliminar_compra(bigint), public.eliminar_ajuste(uuid) from public, anon;
grant execute on function public.deudas_lista(text), public.compras_sin_deuda(),
  public.crear_deuda(text, text, numeric, date, date, bigint, jsonb, date), public.editar_deuda(bigint, text, text, numeric, date, date, date),
  public.deuda_factura(bigint, text[]), public.abonar_deuda(bigint, numeric, text, text[], text, date), public.anular_abono(bigint),
  public.anular_deuda(bigint), public.eliminar_deuda(bigint), public.eliminar_compra(bigint), public.eliminar_ajuste(uuid) to authenticated;

-- Aviso al admin: deudas que vencen en 3 días o ya vencieron
create or replace function public.recordar_deudas()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_hoy date := (now() at time zone 'America/Bogota')::date; v_n int; v_saldo numeric; v_lista text;
begin
  select count(*), sum(greatest(d.total - coalesce(a.abonado, 0), 0)),
         string_agg(d.proveedor || case when d.vence < v_hoy then ' (vencida)' when d.vence = v_hoy then ' (hoy)' else ' (' || to_char(d.vence, 'DD/MM') || ')' end, ', ' order by d.vence)
    into v_n, v_saldo, v_lista
  from deudas d
  left join lateral (select sum(valor) abonado from deuda_abonos x where x.deuda_id = d.id and not x.anulado) a on true
  where d.estado = 'abierta' and d.vence is not null and d.vence <= v_hoy + 3;
  if v_n > 0 then
    perform public.notificar_roles(array['admin']::user_role[], 'deuda',
      case when v_n = 1 then 'Una deuda vence pronto' else v_n || ' deudas vencen pronto' end,
      v_lista || ' · Saldo ' || public.fmt_pesos(v_saldo), 'deudas');
  end if;
end $function$;
revoke all on function public.recordar_deudas() from public, anon, authenticated;

-- ---------------------------------------------------------------- Cuentas por cobrar
create or replace function public.cuentas_lista()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las cuentas por cobrar');
  return coalesce((select jsonb_agg(x order by (x->>'saldo')::numeric desc, x->>'nombre') from (
    select jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono, 'aumento', c.aumento, 'ganancia', g.total,
      'entregado', e.total, 'abonado', a.total, 'saldo', e.total - a.total,
      'ultima_entrega', e.ultima, 'ultimo_abono', a.ultima) x
    from cuentas_cobrar c
    cross join lateral (select coalesce(sum(total), 0) total, max(fecha) ultima from cuenta_entregas where cuenta_id = c.id) e
    cross join lateral (select coalesce(sum(valor), 0) total, max(fecha) ultima from cuenta_abonos where cuenta_id = c.id) a
    cross join lateral (select coalesce(sum(i.cantidad * (i.costo - i.costo_real)), 0) total from cuenta_entrega_items i
                        join cuenta_entregas ce on ce.id = i.entrega_id where ce.cuenta_id = c.id) g
    where c.activa) s), '[]');
end $function$;

create or replace function public.cuenta_detalle(p_cuenta bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las cuentas por cobrar');
  return (select jsonb_build_object('id', c.id, 'nombre', c.nombre, 'telefono', c.telefono, 'aumento', c.aumento,
    'entregas', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'fecha', e.fecha, 'total', e.total, 'nota', e.nota, 'quien', e.creado_por_nombre,
        'ganancia', (select coalesce(sum(i.cantidad * (i.costo - i.costo_real)), 0) from cuenta_entrega_items i where i.entrega_id = e.id),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'nombre', i.nombre, 'cantidad', i.cantidad, 'costo', i.costo, 'costo_real', i.costo_real) order by i.id), '[]')
                  from cuenta_entrega_items i where i.entrega_id = e.id)) order by e.fecha desc, e.id desc)
      from cuenta_entregas e where e.cuenta_id = c.id), '[]'),
    'abonos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'fecha', a.fecha, 'valor', a.valor, 'metodo', a.metodo,
        'comprobantes', a.comprobantes, 'nota', a.nota, 'quien', a.creado_por_nombre) order by a.fecha desc, a.id desc)
      from cuenta_abonos a where a.cuenta_id = c.id), '[]'))
    from cuentas_cobrar c where c.id = p_cuenta);
end $function$;

create or replace function public.guardar_cuenta(p_cuenta bigint, p_nombre text, p_telefono text, p_aumento numeric default 0)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint; v_nombre text := public.texto_limpio(p_nombre, 80); v_aum numeric := round(coalesce(p_aumento, 0), 1);
begin
  perform public.solo_admin('las cuentas por cobrar');
  if v_nombre is null or length(v_nombre) < 2 then raise exception 'Escribe el nombre'; end if;
  if v_aum < 0 or v_aum > 300 then raise exception 'El aumento va de 0%% a 300%%'; end if;
  if p_cuenta is null then
    insert into cuentas_cobrar (nombre, telefono, aumento) values (v_nombre, public.texto_limpio(p_telefono, 20), v_aum) returning id into v_id;
  else
    update cuentas_cobrar set nombre = v_nombre, telefono = public.texto_limpio(p_telefono, 20), aumento = v_aum where id = p_cuenta returning id into v_id;
    if v_id is null then raise exception 'Esa cuenta no existe'; end if;
  end if;
  return v_id;
end $function$;

-- Mercancía entregada al costo (o con el aumento de la cuenta): sale del inventario
create or replace function public.entregar_al_costo(p_cuenta bigint, p_items jsonb, p_fecha date default null, p_nota text default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint; it jsonb; pr productos; v_cant int; v_costo numeric; v_real numeric; v_total numeric := 0;
begin
  perform public.solo_admin('las cuentas por cobrar');
  if not exists (select 1 from cuentas_cobrar where id = p_cuenta and activa) then raise exception 'Esa cuenta no existe'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un producto'; end if;
  if p_fecha > (now() at time zone 'America/Bogota')::date then raise exception 'La fecha no puede ser después de hoy'; end if;
  insert into cuenta_entregas (cuenta_id, fecha, total, nota, creado_por_nombre)
  values (p_cuenta, coalesce(p_fecha, (now() at time zone 'America/Bogota')::date), 0, public.texto_limpio(p_nota, 300), public.mi_nombre())
  returning id into v_id;
  for it in select x from jsonb_array_elements(p_items) x loop
    select * into pr from productos where id = (it->>'producto_id')::uuid for update;
    if not found then raise exception 'Uno de los productos ya no existe'; end if;
    v_cant := coalesce((it->>'cantidad')::int, 0);
    if v_cant <= 0 then raise exception 'Revisa la cantidad de %', pr.nombre; end if;
    v_costo := round(coalesce((it->>'costo')::numeric, pr.costo, 0));
    if v_costo < 0 then raise exception 'Revisa el costo de %', pr.nombre; end if;
    v_real := round(coalesce((it->>'costo_real')::numeric, pr.costo, v_costo, 0));
    if v_real < 0 then raise exception 'Revisa tu costo de %', pr.nombre; end if;
    insert into cuenta_entrega_items (entrega_id, producto_id, nombre, cantidad, costo, costo_real) values (v_id, pr.id, pr.nombre, v_cant, v_costo, v_real);
    update productos set stock = stock - v_cant, updated_at = now() where id = pr.id;
    v_total := v_total + v_cant * v_costo;
  end loop;
  update cuenta_entregas set total = v_total where id = v_id;
  return v_id;
end $function$;

-- Editar una entrega: lo de antes vuelve al inventario y se descuenta lo nuevo
create or replace function public.editar_entrega_costo(p_entrega bigint, p_items jsonb, p_fecha date, p_nota text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare e cuenta_entregas; it jsonb; pr productos; v_cant int; v_costo numeric; v_real numeric; v_total numeric := 0; v_saldo numeric;
begin
  perform public.solo_admin('las cuentas por cobrar');
  select * into e from cuenta_entregas where id = p_entrega for update;
  if not found then raise exception 'Esa entrega no existe'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La entrega debe tener al menos un producto'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Bogota')::date then raise exception 'Revisa la fecha'; end if;
  update productos px set stock = px.stock + i.cantidad, updated_at = now()
    from cuenta_entrega_items i where i.entrega_id = e.id and i.producto_id = px.id;
  delete from cuenta_entrega_items where entrega_id = e.id;
  for it in select x from jsonb_array_elements(p_items) x loop
    select * into pr from productos where id = (it->>'producto_id')::uuid for update;
    if not found then raise exception 'Uno de los productos ya no existe'; end if;
    v_cant := coalesce((it->>'cantidad')::int, 0);
    if v_cant <= 0 then raise exception 'Revisa la cantidad de %', pr.nombre; end if;
    v_costo := round(coalesce((it->>'costo')::numeric, pr.costo, 0));
    if v_costo < 0 then raise exception 'Revisa el costo de %', pr.nombre; end if;
    v_real := round(coalesce((it->>'costo_real')::numeric, pr.costo, v_costo, 0));
    if v_real < 0 then raise exception 'Revisa tu costo de %', pr.nombre; end if;
    insert into cuenta_entrega_items (entrega_id, producto_id, nombre, cantidad, costo, costo_real)
    values (e.id, pr.id, coalesce(nullif(trim(it->>'nombre'), ''), pr.nombre), v_cant, v_costo, v_real);
    update productos set stock = stock - v_cant, updated_at = now() where id = pr.id;
    v_total := v_total + v_cant * v_costo;
  end loop;
  update cuenta_entregas set total = v_total, fecha = p_fecha, nota = public.texto_limpio(p_nota, 300) where id = e.id;
  select coalesce((select sum(total) from cuenta_entregas where cuenta_id = e.cuenta_id), 0)
       - coalesce((select sum(valor) from cuenta_abonos where cuenta_id = e.cuenta_id), 0) into v_saldo;
  if v_saldo < 0 then raise exception 'Con ese cambio lo entregado queda por debajo de lo que ya te abonó (sobran %)', public.fmt_pesos(-v_saldo); end if;
end $function$;

create or replace function public.eliminar_entrega_costo(p_entrega bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las cuentas por cobrar');
  update productos pr set stock = pr.stock + i.cantidad, updated_at = now()
    from cuenta_entrega_items i where i.entrega_id = p_entrega and i.producto_id = pr.id;
  delete from cuenta_entregas where id = p_entrega;
  if not found then raise exception 'Esa entrega no existe'; end if;
end $function$;

create or replace function public.abonar_cuenta(p_cuenta bigint, p_valor numeric, p_metodo text, p_comprobantes text[], p_nota text, p_fecha date default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_saldo numeric; v_valor numeric := round(coalesce(p_valor, 0));
begin
  perform public.solo_admin('las cuentas por cobrar');
  if coalesce(p_metodo, '') not in ('efectivo', 'transferencia', 'otro') then raise exception 'Forma de pago inválida'; end if;
  if v_valor <= 0 then raise exception 'Escribe el valor del abono'; end if;
  if p_fecha > (now() at time zone 'America/Bogota')::date then raise exception 'La fecha no puede ser después de hoy'; end if;
  select coalesce((select sum(total) from cuenta_entregas where cuenta_id = p_cuenta), 0)
       - coalesce((select sum(valor) from cuenta_abonos where cuenta_id = p_cuenta), 0) into v_saldo;
  if v_valor > v_saldo then raise exception 'El abono es más de lo que debe (saldo %)', public.fmt_pesos(v_saldo); end if;
  insert into cuenta_abonos (cuenta_id, fecha, valor, metodo, comprobantes, nota, creado_por_nombre)
  values (p_cuenta, coalesce(p_fecha, (now() at time zone 'America/Bogota')::date), v_valor, p_metodo, public.comprobantes_validos(p_comprobantes),
          public.texto_limpio(p_nota, 300), public.mi_nombre());
end $function$;

create or replace function public.editar_abono_cuenta(p_abono bigint, p_valor numeric, p_metodo text, p_fecha date, p_nota text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare a cuenta_abonos; v_valor numeric := round(coalesce(p_valor, 0)); v_saldo numeric;
begin
  perform public.solo_admin('las cuentas por cobrar');
  select * into a from cuenta_abonos where id = p_abono for update;
  if not found then raise exception 'Ese abono no existe'; end if;
  if coalesce(p_metodo, '') not in ('efectivo', 'transferencia', 'otro') then raise exception 'Forma de pago inválida'; end if;
  if v_valor <= 0 then raise exception 'Escribe el valor del abono'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Bogota')::date then raise exception 'Revisa la fecha'; end if;
  update cuenta_abonos set valor = v_valor, metodo = p_metodo, fecha = p_fecha, nota = public.texto_limpio(p_nota, 300) where id = a.id;
  select coalesce((select sum(total) from cuenta_entregas where cuenta_id = a.cuenta_id), 0)
       - coalesce((select sum(valor) from cuenta_abonos where cuenta_id = a.cuenta_id), 0) into v_saldo;
  if v_saldo < 0 then raise exception 'Con ese valor los abonos pasan lo que debe (sobran %)', public.fmt_pesos(-v_saldo); end if;
end $function$;

create or replace function public.eliminar_abono_cuenta(p_abono bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public.solo_admin('las cuentas por cobrar');
  delete from cuenta_abonos where id = p_abono;
  if not found then raise exception 'Ese abono no existe'; end if;
end $function$;

revoke all on function public.cuentas_lista(), public.cuenta_detalle(bigint), public.guardar_cuenta(bigint, text, text, numeric),
  public.entregar_al_costo(bigint, jsonb, date, text), public.editar_entrega_costo(bigint, jsonb, date, text), public.eliminar_entrega_costo(bigint),
  public.abonar_cuenta(bigint, numeric, text, text[], text, date), public.editar_abono_cuenta(bigint, numeric, text, date, text),
  public.eliminar_abono_cuenta(bigint) from public, anon;
grant execute on function public.cuentas_lista(), public.cuenta_detalle(bigint), public.guardar_cuenta(bigint, text, text, numeric),
  public.entregar_al_costo(bigint, jsonb, date, text), public.editar_entrega_costo(bigint, jsonb, date, text), public.eliminar_entrega_costo(bigint),
  public.abonar_cuenta(bigint, numeric, text, text[], text, date), public.editar_abono_cuenta(bigint, numeric, text, date, text),
  public.eliminar_abono_cuenta(bigint) to authenticated;

-- El historial del producto trae el id del movimiento (para poder eliminar un ajuste)
do $$
declare v text := pg_get_functiondef('public.movimientos_producto(uuid)'::regprocedure);
begin
  if position('''id'', m.id' in v) = 0 then
    v := replace(v, 'jsonb_build_object(''fecha'', m.created_at,', 'jsonb_build_object(''id'', m.id, ''fecha'', m.created_at,');
    if position('''id'', m.id' in v) = 0 then raise exception 'No se pudo cambiar movimientos_producto'; end if;
    execute v;
  end if;
end $$;
