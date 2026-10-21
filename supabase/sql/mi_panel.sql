-- ============================================================================
--  Kaesuri · Mi panel del vendedor (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Siempre sobre el vendedor que llama:
--  · mi_panel(desde, hasta): su comisión (pedidos.comision) de lo entregado,
--    lo que tiene por ganar en curso, lo vendido y la comisión por día.
--  · mis_conversaciones(): sus pedidos con mensajes del chat y los que están en ruta.
--  · mis_pedidos(desde, hasta, estado, limite, desde_fila): sus pedidos con productos,
--    domiciliario y comisión.
-- ============================================================================

create or replace function public.mi_panel(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_yo uuid := auth.uid();
  r jsonb;
begin
  if v_yo is null or not public.tiene_rol('vendedor', 'admin') then raise exception 'Sin permiso'; end if;
  if p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'Rango de fechas inválido (máximo 400 días)'; end if;
  with mios as (
    select * from pedidos where vendedor_id = v_yo and created_at >= d and created_at < h
  ), it as (
    select i.*, m.estado, m.created_at as pedido_at from pedido_items i join mios m on m.id = i.pedido_id
  ), dias as (
    select g::date as dia from generate_series(p_desde, p_hasta, interval '1 day') g
  )
  select jsonb_build_object(
    'ganancia', (select coalesce(sum(comision), 0) from mios where estado = 'entregado'),
    'ventas', (select coalesce(sum(precio_unitario * cantidad), 0) from it where estado = 'entregado'),
    'entregados', (select count(*) from mios where estado = 'entregado'),
    'unidades', (select coalesce(sum(cantidad), 0) from it where estado = 'entregado'),
    'en_curso', (select count(*) from mios where estado in ('pendiente', 'en_ruta')),
    'ganancia_en_curso', (select coalesce(sum(comision), 0) from mios where estado in ('pendiente', 'en_ruta')),
    'cancelados', (select count(*) from mios where estado = 'cancelado'),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', dias.dia, 'ganancia', coalesce(x.g, 0)) order by dias.dia), '[]')
                  from dias left join (
                    select (created_at at time zone 'America/Bogota')::date as dia, sum(comision) as g
                      from mios where estado = 'entregado' group by 1) x on x.dia = dias.dia)
  ) into r;
  return r;
end;
$function$;

create or replace function public.mis_conversaciones()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_yo uuid := auth.uid();
begin
  if v_yo is null or not public.tiene_rol('vendedor', 'admin') then raise exception 'Sin permiso'; end if;
  return coalesce((
    select jsonb_agg(c order by c.orden desc) from (
      select p.id as pedido_id, p.numero, p.cliente_nombre, p.estado, p.total, u.nombre as domiciliario, u.avatar_url as domiciliario_foto,
             um.texto as ultimo_texto, um.autor_nombre as ultimo_autor, (um.autor_id = v_yo) as ultimo_mio, um.created_at as ultimo_at,
             coalesce(um.created_at, p.asignado_at, p.created_at) as orden
        from pedidos p
        left join profiles u on u.id = p.domiciliario_id
        left join lateral (select * from pedido_mensajes m where m.pedido_id = p.id order by m.created_at desc limit 1) um on true
       where p.vendedor_id = v_yo
         and (um.id is not null or p.estado = 'en_ruta')
         and coalesce(um.created_at, p.created_at) > now() - interval '45 days'
       order by coalesce(um.created_at, p.asignado_at, p.created_at) desc
       limit 30
    ) c), '[]');
end;
$function$;

create or replace function public.mis_pedidos(p_desde date, p_hasta date, p_estado text default 'todos', p_limite integer default 20, p_desde_fila integer default 0)
returns table(id uuid, numero bigint, created_at timestamptz, estado text, cliente_nombre text, barrio text, domiciliario text,
              productos text, total numeric, ganancia_vendedor numeric, total_filas bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.numero, p.created_at, p.estado::text, p.cliente_nombre, p.barrio, u.nombre,
         (select string_agg(coalesce(pr.nombre, 'Producto') || ' x' || i.cantidad, ', ' order by i.id)
            from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id),
         p.total, p.comision, count(*) over ()
    from pedidos p left join profiles u on u.id = p.domiciliario_id
   where p.vendedor_id = auth.uid()
     and p.created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz
     and p.created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz
     and (p_estado = 'todos'
          or (p_estado = 'en_curso' and p.estado in ('pendiente', 'en_ruta'))
          or p.estado::text = p_estado)
   order by p.created_at desc
   limit least(p_limite, 100) offset p_desde_fila
$function$;

revoke all on function public.mi_panel(date, date) from public, anon;
revoke all on function public.mis_conversaciones() from public, anon;
revoke all on function public.mis_pedidos(date, date, text, integer, integer) from public, anon;
grant execute on function public.mi_panel(date, date) to authenticated;
grant execute on function public.mis_conversaciones() to authenticated;
grant execute on function public.mis_pedidos(date, date, text, integer, integer) to authenticated;
