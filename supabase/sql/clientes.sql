-- ============================================================================
--  Kaesuri · Clientes (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Clientes armados a partir de los pedidos entregados, agrupados por teléfono.
--  Solo el admin. compras_cliente() trae lo que ha comprado cada uno.
-- ============================================================================

create or replace function public.clientes(p_buscar text default null, p_limite integer default 50, p_desde integer default 0)
returns table(telefono text, nombre text, barrio text, direccion text, pedidos bigint, entregados bigint, total numeric, ultimo timestamptz, total_filas bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select regexp_replace(cliente_telefono, '\D', '', 'g') tel, cliente_nombre, barrio, direccion, total, created_at
      from pedidos where cliente_telefono is not null and estado = 'entregado' and public.tiene_rol('admin')
  ), g as (
    select tel,
           (array_agg(cliente_nombre order by created_at desc))[1] nombre,
           (array_agg(barrio order by created_at desc))[1] barrio,
           (array_agg(direccion order by created_at desc))[1] direccion,
           count(*) pedidos, count(*) entregados,
           coalesce(sum(total), 0) total, max(created_at) ultimo
      from base where length(tel) >= 7 group by tel
  ), b as (select trim(coalesce(p_buscar, '')) t, regexp_replace(coalesce(p_buscar, ''), '\D', '', 'g') d),
  f as (
    select g.* from g, b
     where b.t = '' or g.nombre ilike '%' || b.t || '%' or g.barrio ilike '%' || b.t || '%' or (b.d <> '' and g.tel like '%' || b.d || '%')
  )
  select tel, nombre, barrio, direccion, pedidos, entregados, total, ultimo, count(*) over ()
    from f order by ultimo desc limit p_limite offset p_desde
$function$;
revoke all on function public.clientes(text, integer, integer) from public, anon;
grant execute on function public.clientes(text, integer, integer) to authenticated;

create or replace function public.compras_cliente(p_telefono text)
returns table(id uuid, numero bigint, created_at timestamptz, total numeric, vendedor text, productos text[])
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.numero, p.created_at, p.total, u.nombre,
         coalesce((select array_agg(coalesce(pr.nombre, 'Producto') order by i.id)
                     from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id), '{}')
    from pedidos p left join profiles u on u.id = p.vendedor_id
   where public.tiene_rol('admin')
     and p.estado = 'entregado'
     and length(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) >= 7
     and regexp_replace(p.cliente_telefono, '\D', '', 'g') = regexp_replace(p_telefono, '\D', '', 'g')
   order by p.created_at desc
   limit 100
$function$;
revoke all on function public.compras_cliente(text) from public, anon;
grant execute on function public.compras_cliente(text) to authenticated;
