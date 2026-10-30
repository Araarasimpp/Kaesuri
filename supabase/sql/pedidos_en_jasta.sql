-- ============================================================================
--  Kaesuri · Los pedidos de Variedades JYB en la lista de Pedidos de Jasta
--  Quien alista en Jasta ve los pedidos activos de JYB junto a los de Jasta (con el mismo
--  diseño), los alista y les imprime el rótulo. Lo llama jasta-puente (solo service_role),
--  después de revisar que la persona sea admin/despachador aquí o admin/alistador en Jasta.
--  YA APLICADO en Supabase.
-- ============================================================================

-- Pedidos por alistar, alistados y en ruta (sin las ventas del local), con lo que muestra
-- la lista de Jasta: productos con foto, color y talla, domiciliario y novedades.
-- "items" es el texto de cada producto para el rótulo (igual que en jasta_rotulos_datos).
create or replace function public.jasta_pedidos_datos()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'vinculado', true,
    'negocio', (select jsonb_build_object('nombre_negocio', nombre_negocio, 'telefonos', telefonos, 'redes', redes,
                                          'texto_garantia', texto_garantia)
                  from public.configuracion where id),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero,
               'estado', case when p.estado = 'en_ruta' then 'despachado'
                              when p.alistado_at is not null then 'alistado' else 'por_alistar' end,
               'cliente_nombre', p.cliente_nombre, 'cliente_telefono', p.cliente_telefono,
               'direccion', p.direccion, 'barrio', p.barrio, 'observaciones', p.observaciones,
               'total', p.total, 'valor_domicilio', coalesce(p.valor_domicilio, 0),
               'created_at', p.created_at, 'alistado_at', p.alistado_at, 'asignado_at', p.asignado_at,
               'rotulo_impreso_at', p.rotulo_impreso_at,
               'vendedor', v.nombre, 'domiciliario', d.nombre,
               'novedades', coalesce(p.novedades, 0), 'ultima_novedad', p.ultima_novedad,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'nombre', coalesce(pr.nombre, 'Producto')
                                    || case when coalesce(i.color, '') <> '' or coalesce(i.talla, '') <> ''
                                            then ' (' || concat_ws(' · ', nullif(i.color, ''), 'Talla ' || nullif(i.talla, '')) || ')'
                                            else '' end,
                          'cantidad', i.cantidad) order by i.id)
                   from public.pedido_items i left join public.productos pr on pr.id = i.producto_id
                  where i.pedido_id = p.id), '[]'::jsonb),
               'productos', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'nombre', coalesce(pr.nombre, 'Producto'), 'cantidad', i.cantidad, 'precio', i.precio_unitario,
                          'color', nullif(i.color, ''), 'talla', nullif(i.talla, ''),
                          'imagen_url', coalesce(
                            (select c.imagen_url from public.producto_colores c
                              where c.producto_id = i.producto_id and c.nombre = i.color and c.imagen_url is not null limit 1),
                            pr.imagen_url)) order by i.id)
                   from public.pedido_items i left join public.productos pr on pr.id = i.producto_id
                  where i.pedido_id = p.id), '[]'::jsonb))
             order by p.created_at)
        from public.pedidos p
        left join public.profiles v on v.id = p.vendedor_id
        left join public.profiles d on d.id = p.domiciliario_id
       where p.estado in ('pendiente', 'en_ruta') and coalesce(p.canal, '') <> 'local'), '[]'::jsonb));
$function$;

-- Alista (p_alistar = true) o devuelve a por alistar (false) pedidos pendientes desde Jasta.
-- Uno por uno en el orden recibido, para que el orden de alistamiento sea el de Jasta.
-- Si la persona también es admin/despachador aquí, queda a su nombre.
create or replace function public.jasta_alistar(p_email text, p_ids uuid[], p_alistar boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_desp uuid := public.jasta_despachador(p_email); v_n int := 0; v_id uuid; v_uno int;
begin
  if v_desp is not null then
    perform set_config('request.jwt.claim.sub', v_desp::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_desp, 'role', 'authenticated')::text, true);
  end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    if p_alistar then
      update public.pedidos set alistado_at = now()
       where id = v_id and estado = 'pendiente' and alistado_at is null and coalesce(canal, '') <> 'local';
    else
      update public.pedidos set alistado_at = null
       where id = v_id and estado = 'pendiente' and alistado_at is not null;
    end if;
    get diagnostics v_uno = row_count;
    v_n := v_n + v_uno;
  end loop;
  return v_n;
end;
$function$;

revoke all on function public.jasta_pedidos_datos() from public, anon, authenticated;
revoke all on function public.jasta_alistar(text, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.jasta_pedidos_datos() to service_role;
grant execute on function public.jasta_alistar(text, uuid[], boolean) to service_role;
