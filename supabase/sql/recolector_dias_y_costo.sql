-- ============================================================================
--  Kaesuri · Recolector como en Jasta. YA APLICADO (sección 15 de PENDIENTE, corrida por el usuario).
--   · Compra de un producto del inventario con lo que costó cada uno: el costo del producto se
--     actualiza solo (y se le avisa al admin). Se puede quitar una compra (el recolector, solo las
--     suyas de hoy; si era la última que cambió el costo, el costo vuelve al de antes).
--   · El admin recibe la plata de cada recolector, a nombre del DÍA al que pertenece.
--   · Cada día cuadra solo: base − compras − lo entregado de ese día. Una tarjeta por recolector
--     y los días anteriores que quedaron sin entregar.
--  recoleccion_compra(...) reemplaza a recoleccion_registrar_compra (que ya no se usa).
-- ============================================================================

alter table public.recoleccion_compras
  add column if not exists producto_id uuid references public.productos(id),
  add column if not exists cantidad int,
  add column if not exists costo_unitario numeric,
  add column if not exists costo_anterior numeric;

create table if not exists public.recoleccion_entregas (
  id bigint generated always as identity primary key,
  recolector_id uuid not null references public.profiles(id),
  valor numeric not null check (valor > 0 and valor <= 100000000),
  nota text,
  recibida_por uuid references public.profiles(id) on delete set null,
  recibida_por_nombre text,
  dia date not null,
  created_at timestamptz not null default now()
);
create index if not exists recoleccion_entregas_dia_idx on public.recoleccion_entregas (recolector_id, dia);
alter table public.recoleccion_entregas enable row level security;
revoke all on public.recoleccion_entregas from anon, authenticated;

-- Productos para elegir (el recolector no tiene acceso directo a la tabla de productos)
create or replace function public.recolector_productos()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('recolector', 'admin') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'imagen_url', p.imagen_url, 'costo', p.costo) order by p.nombre)
    from productos p where p.activo), '[]');
end $function$;

create or replace function public.recoleccion_compra(p_valor numeric, p_proveedor text, p_producto text, p_facturas text[],
  p_producto_id uuid default null, p_cantidad integer default null, p_costo numeric default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid(); v_ev text[]; v_id bigint; pr productos; v_valor numeric := p_valor; v_texto text := trim(coalesce(p_producto, ''));
  v_costo numeric := round(coalesce(p_costo, 0));
begin
  if not public.tiene_rol('recolector') then raise exception 'Solo el recolector registra compras'; end if;
  if coalesce(trim(p_proveedor), '') = '' then raise exception 'Escribe el proveedor'; end if;
  if p_producto_id is not null then
    select * into pr from productos where id = p_producto_id for update;
    if not found then raise exception 'Ese producto no existe'; end if;
    if coalesce(p_cantidad, 0) <= 0 then raise exception 'Escribe cuántos compraste'; end if;
    if v_costo <= 0 then raise exception 'Escribe cuánto te costó cada uno'; end if;
    v_valor := v_costo * p_cantidad;
    v_texto := p_cantidad || ' × ' || pr.nombre;
  end if;
  if coalesce(v_valor, 0) <= 0 then raise exception 'Escribe el valor de la compra'; end if;
  if v_texto = '' then raise exception 'Escribe qué compraste'; end if;
  v_ev := public.comprobantes_validos(p_facturas);
  if cardinality(v_ev) = 0 then raise exception 'Sube la foto de la factura'; end if;
  insert into recoleccion_compras (recolector_id, valor, proveedor, producto, facturas, creada_por_nombre, producto_id, cantidad, costo_unitario, costo_anterior)
  values (v_yo, v_valor, left(trim(p_proveedor), 120), left(v_texto, 200), v_ev, public.mi_nombre(),
          pr.id, case when pr.id is not null then p_cantidad end, case when pr.id is not null then v_costo end, pr.costo)
  returning id into v_id;
  -- El costo del producto queda con lo que le costó al recolector
  if pr.id is not null and pr.costo is distinct from v_costo then
    update productos set costo = v_costo, updated_at = now() where id = pr.id;
    perform public.notificar_roles(array['admin']::user_role[], 'compras', '💲 Costo actualizado: ' || pr.nombre,
      'De ' || public.fmt_pesos(coalesce(pr.costo, 0)) || ' a ' || public.fmt_pesos(v_costo) || ' · compra de ' || coalesce(public.mi_nombre(), 'el recolector')
        || ' a ' || left(trim(p_proveedor), 60) || ' (' || p_cantidad || ' und)', 'recolector');
  end if;
  return v_id;
end $function$;

create or replace function public.recoleccion_borrar_compra(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare c recoleccion_compras; v_admin boolean := public.tiene_rol('admin'); v_ultima bigint;
begin
  select * into c from recoleccion_compras where id = p_id for update;
  if not found then raise exception 'Esa compra ya no existe'; end if;
  if not v_admin then
    if not public.tiene_rol('recolector') or c.recolector_id is distinct from auth.uid() then raise exception 'Sin permiso'; end if;
    if (c.created_at at time zone 'America/Bogota')::date <> (now() at time zone 'America/Bogota')::date then
      raise exception 'Solo puedes quitar compras de hoy. Pídele al admin que la quite.';
    end if;
  end if;
  if c.producto_id is not null and c.costo_anterior is not null then
    select id into v_ultima from recoleccion_compras
      where producto_id = c.producto_id and costo_unitario is not null order by created_at desc, id desc limit 1;
    if v_ultima = c.id then
      update productos set costo = c.costo_anterior, updated_at = now() where id = c.producto_id and costo = c.costo_unitario;
    end if;
  end if;
  delete from recoleccion_compras where id = c.id;
  if not v_admin then
    perform public.notificar_roles(array['admin']::user_role[], 'compras', '🗑️ Compra quitada: ' || c.producto,
      coalesce(public.mi_nombre(), 'El recolector') || ' quitó la compra de ' || public.fmt_pesos(c.valor) || ' a ' || coalesce(c.proveedor, '—'), 'recolector');
  end if;
end $function$;

-- Lo que falta por entregar de un recolector en unos días (cada día cuadra solo)
create or replace function public.recoleccion_pendiente(p_rec uuid, p_desde date, p_hasta date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce((select sum(monto) from recoleccion_bases where recolector_id = p_rec and estado = 'aceptada'
           and created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz and created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz), 0)
       - coalesce((select sum(valor) from recoleccion_compras where recolector_id = p_rec
           and created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz and created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz), 0)
       - coalesce((select sum(valor) from recoleccion_entregas where recolector_id = p_rec and dia between p_desde and p_hasta), 0)
$$;
revoke all on function public.recoleccion_pendiente(uuid, date, date) from public, anon, authenticated;

-- El admin recibe la plata del recolector, a nombre del día al que pertenece
create or replace function public.recoleccion_recibir(p_recolector uuid, p_valor numeric, p_nota text, p_dia date default null)
returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare v_valor numeric := round(coalesce(p_valor, 0)); v_dia date := coalesce(p_dia, (now() at time zone 'America/Bogota')::date); v_falta numeric;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin recibe la plata del recolector'; end if;
  if not exists (select 1 from profiles where id = p_recolector and 'recolector' = any(roles)) then raise exception 'Ese recolector no existe'; end if;
  if v_valor <= 0 then raise exception 'Escribe cuánto recibiste'; end if;
  if v_dia > (now() at time zone 'America/Bogota')::date then raise exception 'No puedes recibir plata de un día que no ha llegado'; end if;
  insert into recoleccion_entregas (recolector_id, valor, nota, recibida_por, recibida_por_nombre, dia)
  values (p_recolector, v_valor, nullif(left(trim(coalesce(p_nota, '')), 300), ''), auth.uid(), public.mi_nombre(), v_dia);
  v_falta := public.recoleccion_pendiente(p_recolector, v_dia, v_dia);
  perform public.notificar(p_recolector, 'base_recolector',
    coalesce(public.mi_nombre(), 'El admin') || ' recibió ' || public.fmt_pesos(v_valor) || ' del ' || to_char(v_dia, 'DD/MM'),
    case when v_falta = 0 then 'Ese día quedó en cero ✓' when v_falta > 0 then 'De ese día todavía faltan ' || public.fmt_pesos(v_falta)
         else 'De ese día quedó a tu favor ' || public.fmt_pesos(-v_falta) end, 'recolector');
  return v_falta;
end $function$;

create or replace function public.recoleccion_borrar_entrega(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  delete from recoleccion_entregas where id = p_id;
  if not found then raise exception 'Esa entrega ya no existe'; end if;
end $function$;

create or replace function public.recoleccion_resumen(p_desde date, p_hasta date, p_recolector uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_admin boolean := public.tiene_rol('admin');
  v_rec uuid;
  v_ini date := greatest(p_desde - 21, date '2026-11-11');
begin
  if v_admin then v_rec := p_recolector;
  elsif public.tiene_rol('recolector') then v_rec := auth.uid();
  else raise exception 'Sin permiso'; end if;
  if p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'Rango de fechas inválido (máximo 400 días)'; end if;
  return jsonb_build_object(
    'base', (select coalesce(sum(monto), 0) from recoleccion_bases where estado = 'aceptada'
             and (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'compras', (select coalesce(sum(valor), 0) from recoleccion_compras
             where (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'entregado', (select coalesce(sum(valor), 0) from recoleccion_entregas
             where (v_rec is null or recolector_id = v_rec) and dia between p_desde and p_hasta),
    'saldo', case when v_rec is not null then public.recoleccion_pendiente(v_rec, p_desde, p_hasta) end,
    'n_compras', (select count(*) from recoleccion_compras where (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'n_bases', (select count(*) from recoleccion_bases where estado = 'aceptada' and (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'pendientes', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'monto', b.monto, 'nombre', b.nombre, 'de', b.creada_por_nombre,
                     'recolector', u.nombre, 'fecha', b.created_at) order by b.created_at), '[]')
                   from recoleccion_bases b join profiles u on u.id = b.recolector_id
                   where b.estado = 'pendiente' and (v_rec is null or b.recolector_id = v_rec)),
    'movimientos', (select coalesce(jsonb_agg(m order by m.fecha desc), '[]') from (
        select 'base' tipo, b.id, b.created_at fecha, b.monto valor, b.nombre, b.estado, b.creada_por_nombre quien, u.nombre recolector,
               null::text proveedor, null::text producto, null::text[] facturas, null::date dia
        from recoleccion_bases b join profiles u on u.id = b.recolector_id
        where (v_rec is null or b.recolector_id = v_rec) and b.created_at >= d and b.created_at < h
        union all
        select 'compra', c.id, c.created_at, c.valor, null, null, c.creada_por_nombre, u.nombre, c.proveedor, c.producto, c.facturas, null
        from recoleccion_compras c join profiles u on u.id = c.recolector_id
        where (v_rec is null or c.recolector_id = v_rec) and c.created_at >= d and c.created_at < h
        union all
        select 'entrega', e.id, e.created_at, e.valor, e.nota, null, e.recibida_por_nombre, u.nombre, null, null, null, e.dia
        from recoleccion_entregas e join profiles u on u.id = e.recolector_id
        where (v_rec is null or e.recolector_id = v_rec) and e.dia between p_desde and p_hasta
        order by 3 desc limit 500) m),
    'recolectores', case when v_admin then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre), '[]')
                      from profiles where coalesce(activo, true) and 'recolector' = any(roles)) else '[]'::jsonb end,
    -- Una tarjeta por recolector con lo de estos días
    'por_recolector', case when v_admin and v_rec is null then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre,
        'base', (select coalesce(sum(monto), 0) from recoleccion_bases where recolector_id = u.id and estado = 'aceptada' and created_at >= d and created_at < h),
        'compras', (select coalesce(sum(valor), 0) from recoleccion_compras where recolector_id = u.id and created_at >= d and created_at < h),
        'entregado', (select coalesce(sum(valor), 0) from recoleccion_entregas where recolector_id = u.id and dia between p_desde and p_hasta),
        'pendientes', (select count(*) from recoleccion_bases where recolector_id = u.id and estado = 'pendiente'),
        'saldo', public.recoleccion_pendiente(u.id, p_desde, p_hasta)) order by u.nombre), '[]')
      from profiles u where coalesce(u.activo, true) and 'recolector' = any(u.roles)) else '[]'::jsonb end,
    -- Días anteriores (últimas 3 semanas) que quedaron sin entregar, para no perderlos de vista
    'dias_sin_entregar', (select coalesce(jsonb_agg(x order by x.dia desc, x.nombre), '[]') from (
        select u.id, u.nombre, dd.dia, public.recoleccion_pendiente(u.id, dd.dia, dd.dia) falta
        from profiles u
        cross join lateral (
          select (created_at at time zone 'America/Bogota')::date dia from recoleccion_bases where recolector_id = u.id and estado = 'aceptada' and created_at >= (v_ini::text || ' 00:00 America/Bogota')::timestamptz and created_at < d
          union select (created_at at time zone 'America/Bogota')::date from recoleccion_compras where recolector_id = u.id and created_at >= (v_ini::text || ' 00:00 America/Bogota')::timestamptz and created_at < d
        ) dd
        where 'recolector' = any(u.roles) and (v_rec is null or u.id = v_rec)
      ) x where x.falta > 0)
  );
end $function$;

revoke all on function public.recolector_productos(), public.recoleccion_compra(numeric, text, text, text[], uuid, integer, numeric),
  public.recoleccion_borrar_compra(bigint), public.recoleccion_recibir(uuid, numeric, text, date), public.recoleccion_borrar_entrega(bigint) from public, anon;
grant execute on function public.recolector_productos(), public.recoleccion_compra(numeric, text, text, text[], uuid, integer, numeric),
  public.recoleccion_borrar_compra(bigint), public.recoleccion_recibir(uuid, numeric, text, date), public.recoleccion_borrar_entrega(bigint) to authenticated;
