-- ============================================================================
--  Kaesuri · Ruta en el orden de las fotos de Telegram
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  En el grupo del domiciliario pueden estar los dos bots (Jasta y Variedades JYB).
--  Cada uno tarda distinto en leer el QR, así que la hora en que se procesa no
--  sirve para ordenar. La hora de asignación queda como la hora en que se mandó la
--  foto en Telegram (+ el número del mensaje como desempate dentro del mismo
--  segundo: los dos bots ven los mismos números de mensaje del grupo).
--  Así la ruta de Jasta y la de Variedades JYB se ordenan igual en los dos paneles.
-- ============================================================================

create or replace function public.telegram_despachar_orden(p_chat_id bigint, p_message_id bigint, p_telegram_id bigint, p_numero bigint, p_fecha bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare r jsonb; v_cuando timestamptz;
begin
  r := public.telegram_despachar(p_chat_id, p_message_id, p_telegram_id, p_numero);
  if coalesce((r->>'ok')::boolean, false) and not coalesce((r->>'repetido')::boolean, false) and p_fecha is not null then
    v_cuando := least(to_timestamp(p_fecha) + (p_message_id % 1000000) * interval '1 microsecond', now());
    update public.pedidos set asignado_at = v_cuando where numero = p_numero and estado = 'en_ruta';
  end if;
  return r;
end;
$function$;
revoke all on function public.telegram_despachar_orden(bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.telegram_despachar_orden(bigint, bigint, bigint, bigint, bigint) to service_role;

-- Jasta recibe la hora de asignación para ordenar la ruta junto con la suya
create or replace function public.jasta_resumen(p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dom uuid := public.jasta_domiciliario(p_email);
begin
  if v_dom is null then
    return jsonb_build_object('vinculado', false);
  end if;
  return jsonb_build_object(
    'vinculado', true,
    'canal', 'jasta-entregas:' || v_dom,
    'en_ruta', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'cliente_nombre', p.cliente_nombre,
               'cliente_telefono', p.cliente_telefono, 'direccion', p.direccion, 'barrio', p.barrio,
               'valor_domicilio', p.valor_domicilio, 'total', p.total, 'observaciones', p.observaciones,
               'created_at', p.created_at, 'asignado_at', p.asignado_at, 'vendedor', v.nombre,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object('nombre', coalesce(pr.nombre, 'Producto'), 'cantidad', i.cantidad,
                                                     'precio', i.precio_unitario))
                   from public.pedido_items i left join public.productos pr on pr.id = i.producto_id
                  where i.pedido_id = p.id), '[]'::jsonb))
             order by p.asignado_at nulls first, p.created_at)
        from public.pedidos p left join public.profiles v on v.id = p.vendedor_id
       where p.domiciliario_id = v_dom and p.estado = 'en_ruta'), '[]'::jsonb),
    'por_cuadrar', (
      select jsonb_build_object(
               'pedidos', count(*),
               'efectivo', coalesce(sum(case metodo_pago when 'efectivo' then total when 'mixto' then monto_efectivo else 0 end), 0),
               'transferencia', coalesce(sum(case metodo_pago when 'transferencia' then total when 'mixto' then monto_transferencia else 0 end), 0),
               'domicilios', coalesce(sum(valor_domicilio), 0),
               'desde', min(entregado_at))
        from public.pedidos
       where domiciliario_id = v_dom and estado = 'entregado' and cuadre_id is null),
    'por_confirmar', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'fecha', c.fecha, 'cantidad_pedidos', c.cantidad_pedidos,
                                          'total_a_entregar', c.total_a_entregar) order by c.cerrado_at)
        from public.cuadres c
       where c.domiciliario_id = v_dom and c.estado = 'pendiente'), '[]'::jsonb));
end;
$function$;
