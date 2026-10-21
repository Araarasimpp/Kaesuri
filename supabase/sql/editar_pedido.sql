-- ============================================================================
--  Kaesuri · Editar pedido (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Cambia los datos y productos de un pedido que todavía no se ha entregado.
--  Lo pueden hacer el admin y el despachador (los mismos que cancelan pedidos).
--  Devuelve el inventario de las líneas viejas y las vuelve a crear: el trigger de
--  pedido_items descuenta el stock de las nuevas (y avisa si no alcanza).
-- ============================================================================

create or replace function public.editar_pedido(
  p_pedido_id uuid, p_cliente_nombre text, p_cliente_telefono text, p_direccion text, p_barrio text,
  p_valor_domicilio numeric, p_observaciones text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p public.pedidos;
  v_item jsonb;
  v_subtotal numeric(12,2);
  v_comision numeric(12,2);
begin
  if not public.tiene_rol('admin', 'despachador') then
    raise exception 'No tienes permiso para editar pedidos';
  end if;

  select * into p from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  if p.estado not in ('pendiente', 'en_ruta') then
    raise exception 'Solo se pueden editar pedidos pendientes o en ruta';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe tener al menos un producto';
  end if;
  if coalesce(trim(p_cliente_nombre), '') = '' or coalesce(trim(p_direccion), '') = '' then
    raise exception 'Nombre del cliente y dirección son obligatorios';
  end if;

  -- Devuelve el inventario de lo que tenía el pedido
  update public.productos pr
     set stock = pr.stock + i.cantidad, updated_at = now()
    from public.pedido_items i
   where i.pedido_id = p.id and i.producto_id = pr.id;
  insert into public.movimientos_inventario (producto_id, usuario_id, cantidad, motivo)
  select producto_id, auth.uid(), cantidad, 'edición de pedido' from public.pedido_items where pedido_id = p.id;

  delete from public.pedido_items where pedido_id = p.id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_base, color, talla)
    values (
      p.id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'cantidad')::int,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'precio_base')::numeric,
      nullif(left(trim(v_item->>'color'), 40), ''),
      nullif(left(trim(v_item->>'talla'), 40), '')
    );
  end loop;

  select
    sum((item->>'cantidad')::int * (item->>'precio_unitario')::numeric),
    sum((item->>'cantidad')::int * ((item->>'precio_unitario')::numeric - (item->>'precio_base')::numeric))
  into v_subtotal, v_comision
  from jsonb_array_elements(p_items) as item;

  update public.pedidos
     set cliente_nombre = trim(p_cliente_nombre),
         cliente_telefono = nullif(trim(p_cliente_telefono), ''),
         direccion = trim(p_direccion),
         barrio = nullif(trim(p_barrio), ''),
         observaciones = nullif(trim(p_observaciones), ''),
         valor_domicilio = coalesce(p_valor_domicilio, 0),
         comision = coalesce(v_comision, 0),
         total = v_subtotal + coalesce(p_valor_domicilio, 0)
   where id = p.id;
end;
$function$;

revoke all on function public.editar_pedido(uuid, text, text, text, text, numeric, text, jsonb) from public, anon;
grant execute on function public.editar_pedido(uuid, text, text, text, text, numeric, text, jsonb) to authenticated;
