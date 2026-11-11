-- ============================================================================
--  Kaesuri · Comisiones por semana (sábado a viernes), comprobante de egreso y datos de pago
--  (como en Jasta). YA APLICADO en Supabase.
--   1. Un pedido cuenta por el día en que se creó (sigue teniendo que estar entregado).
--   2. Comisiones de un rango (Desde/Hasta) y pago de exactamente ese rango.
--   3. Comprobante de egreso de cada pago (NIT, cédula, detalle) y soporte agregado después.
--   4. Datos de pago privados de cada persona (cédula y cuenta).
--   5. Semana de las metas de sábado a viernes, como el pago.
-- ============================================================================

-- ---------------------------------------------------------------- 1. Por fecha de creación
create or replace function public.por_liquidar(p_vendedor uuid)
returns table(id uuid, numero bigint, vendedor_id uuid, dia date, comision numeric, cliente_nombre text, total numeric)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.numero, p.vendedor_id, (p.created_at at time zone 'America/Bogota')::date, coalesce(p.comision, 0), p.cliente_nombre, p.total
  from pedidos p
  where p.estado = 'entregado' and p.liquidacion_id is null and p.vendedor_id is not null and coalesce(p.comision, 0) <> 0
    and (p_vendedor is null or p.vendedor_id = p_vendedor)
    and (p.created_at at time zone 'America/Bogota')::date >= coalesce((select liquidar_desde from configuracion limit 1), '2000-01-01')
$$;
revoke all on function public.por_liquidar(uuid) from public, anon, authenticated;

create or replace function public.liquidacion_pedidos(p_vendedor uuid, p_liquidacion bigint)
returns table(id uuid, numero bigint, dia date, cliente_nombre text, total numeric, comision numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid();
begin
  if v_yo is null or not (public.tiene_rol('admin') or p_vendedor = v_yo) then raise exception 'Sin permiso'; end if;
  if p_liquidacion is null then
    return query
      select x.id, x.numero, x.dia, x.cliente_nombre, x.total, x.comision from (
        select l.id, l.numero, l.dia, l.cliente_nombre, l.total, l.comision from public.por_liquidar(p_vendedor) l
        union all
        select dl.pedido_id, dl.numero, dl.dia, dl.nombre, 0::numeric, dl.comision from public.descuentos_por_liquidar(p_vendedor) dl) x
      order by 3, 2;
  else
    return query
      select x.id, x.numero, x.dia, x.cliente_nombre, x.total, x.comision from (
        select p.id, p.numero, (p.created_at at time zone 'America/Bogota')::date dia, p.cliente_nombre, p.total, coalesce(p.comision, 0) comision
          from pedidos p where p.liquidacion_id = p_liquidacion and p.vendedor_id = p_vendedor
        union all
        select d.pedido_id, p.numero, (d.created_at at time zone 'America/Bogota')::date, 'Devolución', 0::numeric, -d.comision_descuento
          from devoluciones d join pedidos p on p.id = d.pedido_id where d.liquidacion_id = p_liquidacion) x
      order by 3, 2;
  end if;
end $function$;

-- ---------------------------------------------------------------- 2. Comisiones de un rango
-- Lo que se le debe a cada vendedor en el rango (sin pagar) y lo pendiente de antes del rango
create or replace function public.comisiones_periodo(p_desde date, p_hasta date)
returns table(vendedor_id uuid, nombre text, pedidos bigint, total numeric, desde date, hasta date, anteriores numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid(); v_v uuid;
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  v_v := case when public.tiene_rol('admin') then null else v_yo end;
  return query
    with x as (
      select l.vendedor_id, l.dia, l.comision, true es_pedido from public.por_liquidar(v_v) l
      union all
      select dl.vendedor_id, dl.dia, dl.comision, false from public.descuentos_por_liquidar(v_v) dl
    )
    select x.vendedor_id, u.nombre,
      count(*) filter (where x.es_pedido and x.dia between p_desde and p_hasta),
      coalesce(sum(x.comision) filter (where x.dia between p_desde and p_hasta), 0),
      min(x.dia) filter (where x.dia between p_desde and p_hasta),
      max(x.dia) filter (where x.dia between p_desde and p_hasta),
      coalesce(sum(x.comision) filter (where x.dia < p_desde), 0)
    from x join profiles u on u.id = x.vendedor_id
    group by 1, 2
    having coalesce(sum(x.comision) filter (where x.dia between p_desde and p_hasta), 0) <> 0
        or coalesce(sum(x.comision) filter (where x.dia < p_desde), 0) <> 0
    order by 4 desc;
end $function$;

-- Paga exactamente un rango (desde–hasta); sin desde, todo lo pendiente hasta ese día
create or replace function public.pagar_comisiones(p_vendedor uuid, p_desde date, p_hasta date, p_metodo text, p_comprobantes text[], p_nota text)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint; v_n int; v_total numeric; v_desc numeric; v_desde date; v_hasta date; v_ini date := coalesce(p_desde, '2000-01-01');
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin registra pagos a vendedores'; end if;
  if p_metodo not in ('efectivo', 'transferencia', 'otro') then raise exception 'Forma de pago inválida'; end if;
  if p_hasta is null or p_hasta < v_ini then raise exception 'La fecha hasta debe ser después de la fecha desde'; end if;
  select count(*), coalesce(sum(comision), 0), min(dia), max(dia) into v_n, v_total, v_desde, v_hasta
    from public.por_liquidar(p_vendedor) where dia between v_ini and p_hasta;
  select coalesce(sum(comision), 0) into v_desc from public.descuentos_por_liquidar(p_vendedor) where dia between v_ini and p_hasta;
  if v_n = 0 and v_desc = 0 then raise exception 'No hay comisiones pendientes en esas fechas'; end if;
  insert into liquidaciones (vendedor_id, desde, hasta, cantidad_pedidos, total, metodo, comprobantes, nota, pagado_por, pagado_por_nombre)
  values (p_vendedor, coalesce(p_desde, v_desde), p_hasta, v_n, v_total + v_desc, p_metodo, public.comprobantes_validos(p_comprobantes),
          nullif(trim(coalesce(p_nota, '')), ''), auth.uid(), (select nombre from profiles where id = auth.uid()))
  returning id into v_id;
  update pedidos set liquidacion_id = v_id where id in (select id from public.por_liquidar(p_vendedor) where dia between v_ini and p_hasta);
  update devoluciones set liquidacion_id = v_id where id in (select devolucion_id from public.descuentos_por_liquidar(p_vendedor) where dia between v_ini and p_hasta);
  perform public.notificar(p_vendedor, 'liquidacion', 'Te pagaron tus comisiones',
    public.fmt_pesos(v_total + v_desc) || ' · ' || v_n || ' pedidos · ' || p_metodo, 'comisiones?pago=' || v_id);
  return v_id;
end $function$;

-- Supabase no deja UPDATE sin WHERE desde la app: la configuración es una sola fila (id = true)
create or replace function public.guardar_liquidar_desde(p_dia date)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  if p_dia is null then raise exception 'Elige un día'; end if;
  update configuracion set liquidar_desde = p_dia where id = true;
end $function$;

revoke all on function public.comisiones_periodo(date, date), public.pagar_comisiones(uuid, date, date, text, text[], text) from public, anon;
grant execute on function public.comisiones_periodo(date, date), public.pagar_comisiones(uuid, date, date, text, text[], text) to authenticated;

-- ---------------------------------------------------------------- 3 y 4. Datos de pago y comprobante de egreso
alter table public.configuracion add column if not exists nit text, add column if not exists direccion text;

-- Privados: los ve y cambia la propia persona; el admin los ve para pagar
create table if not exists public.datos_pago (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  documento text,
  banco text,
  tipo_cuenta text check (tipo_cuenta is null or tipo_cuenta in ('ahorros', 'corriente', 'nequi', 'daviplata', 'otro')),
  numero_cuenta text,
  titular text,
  updated_at timestamptz not null default now()
);
alter table public.datos_pago enable row level security;
revoke all on public.datos_pago from anon, authenticated;

create or replace function public.texto_limpio(p text, n int) returns text language sql immutable set search_path to '' as $$
  select nullif(left(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'), n), '')
$$;

create or replace function public.mis_datos_pago()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce((select to_jsonb(d) - 'usuario_id' from datos_pago d where d.usuario_id = auth.uid()), '{}'::jsonb)
$$;

create or replace function public.guardar_mis_datos_pago(p_documento text, p_banco text, p_tipo text, p_numero text, p_titular text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid();
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  if p_tipo is not null and p_tipo <> '' and p_tipo not in ('ahorros', 'corriente', 'nequi', 'daviplata', 'otro') then raise exception 'Tipo de cuenta inválido'; end if;
  insert into datos_pago (usuario_id, documento, banco, tipo_cuenta, numero_cuenta, titular, updated_at)
  values (v_yo, public.texto_limpio(p_documento, 30), public.texto_limpio(p_banco, 60), nullif(p_tipo, ''), public.texto_limpio(p_numero, 40), public.texto_limpio(p_titular, 100), now())
  on conflict (usuario_id) do update set documento = excluded.documento, banco = excluded.banco, tipo_cuenta = excluded.tipo_cuenta,
    numero_cuenta = excluded.numero_cuenta, titular = excluded.titular, updated_at = now();
end $function$;

create or replace function public.datos_pago_de(p_usuario uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not (public.tiene_rol('admin') or p_usuario = auth.uid()) then raise exception 'Sin permiso'; end if;
  return coalesce((select to_jsonb(d) - 'usuario_id' from datos_pago d where d.usuario_id = p_usuario), '{}'::jsonb);
end $function$;

-- El admin pone la cédula (desde el comprobante de egreso)
create or replace function public.guardar_documento(p_usuario uuid, p_documento text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  insert into datos_pago (usuario_id, documento) values (p_usuario, public.texto_limpio(p_documento, 30))
  on conflict (usuario_id) do update set documento = excluded.documento, updated_at = now();
end $function$;

-- NIT y dirección del negocio
create or replace function public.guardar_datos_fiscales(p_nit text, p_direccion text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  update configuracion set nit = public.texto_limpio(p_nit, 30), direccion = public.texto_limpio(p_direccion, 160) where id = true;
end $function$;

-- Todo lo del comprobante de un pago: el admin o el vendedor al que se le pagó
create or replace function public.comprobante_liquidacion(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare l liquidaciones;
begin
  select * into l from liquidaciones where id = p_id;
  if not found then raise exception 'Ese pago no existe'; end if;
  if not (public.tiene_rol('admin') or l.vendedor_id = auth.uid()) then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'id', l.id, 'desde', l.desde, 'hasta', l.hasta, 'pedidos', l.cantidad_pedidos, 'total', l.total, 'metodo', l.metodo,
    'comprobantes', l.comprobantes, 'nota', l.nota, 'pagado_at', l.pagado_at, 'pagado_por', l.pagado_por_nombre, 'anulada', l.anulada,
    'vendedor', (select jsonb_build_object('id', u.id, 'nombre', u.nombre, 'telefono', u.telefono, 'email', u.email,
                   'documento', (select dp.documento from datos_pago dp where dp.usuario_id = u.id))
                 from profiles u where u.id = l.vendedor_id),
    'negocio', (select jsonb_build_object('nombre', c.nombre_negocio, 'nit', c.nit, 'direccion', c.direccion, 'telefonos', c.telefonos)
                from configuracion c limit 1),
    'detalle', (select coalesce(jsonb_agg(jsonb_build_object('numero', x.numero, 'dia', x.dia, 'cliente', x.cliente_nombre, 'total', x.total, 'comision', x.comision) order by x.dia, x.numero), '[]')
                from public.liquidacion_pedidos(l.vendedor_id, l.id) x));
end $function$;

-- Agregar el soporte a un pago ya registrado; al vendedor le llega el aviso
create or replace function public.agregar_soporte_liquidacion(p_id bigint, p_comprobantes text[])
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_ev text[]; l liquidaciones;
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  v_ev := public.comprobantes_validos(p_comprobantes);
  if cardinality(v_ev) = 0 then raise exception 'Sube al menos una foto del soporte'; end if;
  update liquidaciones set comprobantes = coalesce(comprobantes, '{}') || v_ev where id = p_id returning * into l;
  if not found then raise exception 'Ese pago no existe'; end if;
  if not l.anulada then
    perform public.notificar(l.vendedor_id, 'liquidacion', 'Ya está el comprobante de tu pago',
      public.fmt_pesos(l.total) || ' · toca para verlo', 'comisiones?pago=' || l.id);
  end if;
end $function$;

revoke all on function public.mis_datos_pago(), public.guardar_mis_datos_pago(text, text, text, text, text), public.datos_pago_de(uuid),
  public.guardar_documento(uuid, text), public.guardar_datos_fiscales(text, text), public.comprobante_liquidacion(bigint),
  public.agregar_soporte_liquidacion(bigint, text[]) from public, anon;
grant execute on function public.mis_datos_pago(), public.guardar_mis_datos_pago(text, text, text, text, text), public.datos_pago_de(uuid),
  public.guardar_documento(uuid, text), public.guardar_datos_fiscales(text, text), public.comprobante_liquidacion(bigint),
  public.agregar_soporte_liquidacion(bigint, text[]) to authenticated;

-- ---------------------------------------------------------------- 5. Semana de sábado a viernes en las metas
do $$
declare v text; fn text;
begin
  foreach fn in array array['public.mi_meta()', 'public.revisar_metas(boolean)'] loop
    v := pg_get_functiondef(fn::regprocedure);
    if position('date_trunc(''week'', v_hoy)::date' in v) > 0 then
      execute replace(v, 'date_trunc(''week'', v_hoy)::date', 'v_hoy - ((extract(dow from v_hoy)::int + 1) % 7)');
    end if;
  end loop;
end $$;
