-- ============================================================================
--  Kaesuri · Productos quietos (como en Jasta). YA APLICADO en Supabase.
--  Los activos (sin los agotados) que llevan X días sin venderse (pedidos entregados y entregas
--  de cuentas por cobrar). Si nunca se han vendido, cuenta desde que se crearon. Con la plata
--  que hay ahí parada (unidades × costo).
-- ============================================================================
create or replace function public.productos_quietos(p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_hoy timestamptz := now();
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'plata')::numeric desc, (x->>'dias')::int desc) from (
    select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'imagen_url', p.imagen_url, 'categoria', public.categoria_normal(p.categoria),
      'stock', p.stock, 'costo', p.costo, 'precio', p.precio_sugerido,
      'plata', case when p.stock > 0 then p.stock * coalesce(p.costo, 0) else 0 end,
      'ultima_venta', u.ultima, 'nunca', u.ultima is null,
      'dias', floor(extract(epoch from v_hoy - coalesce(u.ultima, p.created_at)) / 86400)::int,
      'vendidas_90', coalesce(n.n, 0)) x
    from productos p
    cross join lateral (select greatest(
        (select max(coalesce(pe.entregado_at, pe.created_at)) from pedido_items i join pedidos pe on pe.id = i.pedido_id
          where i.producto_id = p.id and pe.estado = 'entregado'),
        (select max(ce.fecha::timestamp at time zone 'America/Bogota') from cuenta_entrega_items i join cuenta_entregas ce on ce.id = i.entrega_id
          where i.producto_id = p.id)) ultima) u
    cross join lateral (select sum(i.cantidad) n from pedido_items i join pedidos pe on pe.id = i.pedido_id
          where i.producto_id = p.id and pe.estado = 'entregado' and coalesce(pe.entregado_at, pe.created_at) > v_hoy - interval '90 days') n
    where p.activo and p.stock > 0
      and coalesce(u.ultima, p.created_at) < v_hoy - make_interval(days => greatest(coalesce(p_dias, 30), 1))) s), '[]');
end $function$;
revoke all on function public.productos_quietos(int) from public, anon;
grant execute on function public.productos_quietos(int) to authenticated;
