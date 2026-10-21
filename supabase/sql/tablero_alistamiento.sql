-- ============================================================================
--  Kaesuri · Tablero de alistamiento (como el Inicio de alistamiento de Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  · pedidos.asignado_at: cuándo salió a ruta (lo pone un trigger). Antes no se guardaba.
--  · resumen_operacion(dia): cantidades, tiempos y productos por alistar del día, sin plata.
--    Lo ven el admin y el despachador.
-- ============================================================================

alter table public.pedidos add column if not exists asignado_at timestamptz;

create or replace function public.pedido_asignado_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.estado = 'en_ruta' and (old.estado is distinct from 'en_ruta' or old.domiciliario_id is distinct from new.domiciliario_id) then
    new.asignado_at := now();
  end if;
  return new;
end;
$function$;

create trigger trg_asignado_at before update on public.pedidos
  for each row execute function public.pedido_asignado_at();

create or replace function public.resumen_operacion(p_dia date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  dia date := coalesce(p_dia, (now() at time zone 'America/Bogota')::date);
  d timestamptz := (dia::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((dia + 1)::text || ' 00:00 America/Bogota')::timestamptz;
begin
  if not public.tiene_rol('admin', 'despachador') then
    raise exception 'Sin permiso';
  end if;
  return jsonb_build_object(
    'creados', (select count(*) from pedidos where estado <> 'cancelado' and created_at >= d and created_at < h),
    'cancelados', (select count(*) from pedidos where estado = 'cancelado' and created_at >= d and created_at < h),
    'alistados', (select count(*) from pedidos where estado <> 'cancelado' and alistado_at >= d and alistado_at < h),
    'despachados', (select count(*) from pedidos where estado in ('en_ruta', 'entregado') and asignado_at >= d and asignado_at < h),
    'entregados', (select count(*) from pedidos where estado = 'entregado' and entregado_at >= d and entregado_at < h),
    'por_estado', jsonb_build_object(
      'por_alistar', (select count(*) from pedidos where estado = 'pendiente' and alistado_at is null),
      'alistado', (select count(*) from pedidos where estado = 'pendiente' and alistado_at is not null),
      'en_ruta', (select count(*) from pedidos where estado = 'en_ruta')),
    'sin_rotulo', (select count(*) from pedidos where estado = 'pendiente' and rotulo_impreso_at is null),
    -- Minutos desde que entra el pedido hasta que queda alistado (los alistados hoy)
    'min_alistar', (select round(extract(epoch from percentile_cont(0.5) within group (order by alistado_at - created_at)) / 60)
        from pedidos where alistado_at >= d and alistado_at < h and alistado_at > created_at),
    'mas_antiguo', (select min(created_at) from pedidos where estado = 'pendiente' and alistado_at is null),
    -- Lo que hay que sacar de bodega para los pedidos por alistar
    'por_alistar', (select coalesce(jsonb_agg(x order by x.cantidad desc, x.nombre), '[]') from (
        select coalesce(pr.nombre, 'Producto') nombre, i.color, i.talla, sum(i.cantidad)::int cantidad, count(distinct i.pedido_id)::int pedidos
          from pedido_items i join pedidos p on p.id = i.pedido_id left join productos pr on pr.id = i.producto_id
         where p.estado = 'pendiente' and p.alistado_at is null
         group by pr.nombre, i.color, i.talla order by sum(i.cantidad) desc, pr.nombre limit 20) x),
    'domiciliarios', (select coalesce(jsonb_agg(x order by x.en_ruta desc, x.entregados desc), '[]') from (
        select u.nombre,
               count(*) filter (where p.estado = 'en_ruta')::int en_ruta,
               count(*) filter (where p.estado = 'entregado' and p.entregado_at >= d and p.entregado_at < h)::int entregados
          from pedidos p join profiles u on u.id = p.domiciliario_id
         where p.estado = 'en_ruta' or (p.estado = 'entregado' and p.entregado_at >= d and p.entregado_at < h)
         group by u.nombre) x),
    -- Últimos 7 días: pedidos que entraron y que se entregaron (cantidades, sin plata)
    'por_dia', (select jsonb_agg(jsonb_build_object('dia', g.dia,
          'creados', (select count(*) from pedidos p where p.estado <> 'cancelado'
              and p.created_at >= (g.dia::text || ' 00:00 America/Bogota')::timestamptz and p.created_at < ((g.dia + 1)::text || ' 00:00 America/Bogota')::timestamptz),
          'entregados', (select count(*) from pedidos p where p.estado = 'entregado'
              and p.entregado_at >= (g.dia::text || ' 00:00 America/Bogota')::timestamptz and p.entregado_at < ((g.dia + 1)::text || ' 00:00 America/Bogota')::timestamptz)
        ) order by g.dia) from (select generate_series(dia - 6, dia, interval '1 day')::date dia) g)
  );
end;
$function$;
revoke execute on function public.resumen_operacion(date) from public, anon;
grant execute on function public.resumen_operacion(date) to authenticated;
