-- Kaesuri · Inicio del admin: ventas del local en un periodo (como en Jasta). YA APLICADO.
create or replace function public.resumen_local(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return (
    with v as (select * from pedidos where canal = 'local' and estado = 'entregado' and created_at >= d and created_at < h)
    select jsonb_build_object(
      'ventas', (select count(*) from v),
      'total', (select coalesce(sum(total), 0) from v),
      'efectivo', (select coalesce(sum(case metodo_pago when 'efectivo' then total when 'mixto' then coalesce(monto_efectivo, 0) else 0 end), 0) from v),
      'transferencia', (select coalesce(sum(case metodo_pago when 'transferencia' then coalesce(monto_transferencia, total) when 'mixto' then coalesce(monto_transferencia, 0) else 0 end), 0) from v),
      'ganancia_tienda', (select coalesce(sum((coalesce(i.precio_base, 0) - coalesce(pr.costo, 0)) * i.cantidad), 0)
                          from v join pedido_items i on i.pedido_id = v.id left join productos pr on pr.id = i.producto_id),
      'unidades', (select coalesce(sum(i.cantidad), 0) from v join pedido_items i on i.pedido_id = v.id))
  );
end $function$;
revoke all on function public.resumen_local(date, date) from public, anon;
grant execute on function public.resumen_local(date, date) to authenticated;
