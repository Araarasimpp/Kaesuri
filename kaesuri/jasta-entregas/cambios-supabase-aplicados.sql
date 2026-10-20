-- ============================================================================
--  Entregas desde la app de Jasta (aplicado en Supabase)
--
--  El domiciliario que también reparte para Jasta ve sus pedidos en ruta de
--  Variedades JYB dentro de "Mis entregas" de Jasta, los entrega desde allá y
--  entrega su cuadre de Variedades JYB (los cuadres siguen separados por negocio).
--
--  Lo usa la función jasta-puente (supabase/functions/jasta-puente), que valida
--  la sesión de Jasta y llama estas funciones con la llave de servicio. La misma
--  persona se reconoce por el correo con el que entra a las dos apps.
--
--  Las funciones solo las puede llamar service_role. Dentro de cada una se pone
--  al domiciliario como auth.uid(), para que auditoría, notificaciones y
--  cerrado_por queden a su nombre igual que si lo hiciera desde Kaesuri.
-- ============================================================================

-- Domiciliario activo con ese correo; lo deja como usuario de la transacción
create or replace function public.jasta_domiciliario(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  select id into v_id from public.profiles
   where lower(email) = lower(trim(p_email)) and role = 'domiciliario' and coalesce(activo, true);
  if v_id is not null then
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  end if;
  return v_id;
end;
$function$;

-- Pedidos en ruta, lo que lleva por cuadrar y los cuadres que esperan confirmación
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
    'en_ruta', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'cliente_nombre', p.cliente_nombre,
               'cliente_telefono', p.cliente_telefono, 'direccion', p.direccion, 'barrio', p.barrio,
               'valor_domicilio', p.valor_domicilio, 'total', p.total, 'observaciones', p.observaciones,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object('nombre', coalesce(pr.nombre, 'Producto'), 'cantidad', i.cantidad))
                   from public.pedido_items i left join public.productos pr on pr.id = i.producto_id
                  where i.pedido_id = p.id), '[]'::jsonb))
             order by p.created_at)
        from public.pedidos p
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

-- Igual que entregar_pedido, pero solo para un pedido en ruta de ese domiciliario
create or replace function public.jasta_entregar(p_email text, p_pedido_id uuid, p_metodo text,
                                                 p_comprobante text default null, p_efectivo numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dom uuid := public.jasta_domiciliario(p_email);
begin
  if v_dom is null then
    raise exception 'Tu correo de Jasta no está como domiciliario en Variedades JYB';
  end if;
  if p_metodo not in ('efectivo', 'transferencia', 'mixto') then
    raise exception 'Método de pago no válido';
  end if;
  if p_metodo in ('transferencia', 'mixto') and coalesce(p_comprobante, '') = '' then
    raise exception 'Falta la foto del comprobante de transferencia';
  end if;
  if p_metodo = 'mixto' and p_efectivo is null then
    raise exception 'Indica cuánto se recibió en efectivo';
  end if;

  perform set_config('kaesuri.pago_efectivo',
                     case when p_metodo = 'mixto' then p_efectivo::text else '' end, true);

  update public.pedidos
     set estado = 'entregado',
         entregado_at = now(),
         metodo_pago = p_metodo,
         comprobante_url = p_comprobante
   where id = p_pedido_id and domiciliario_id = v_dom and estado = 'en_ruta' and cuadre_id is null;

  if not found then
    raise exception 'Este pedido ya no está en ruta contigo';
  end if;

  perform set_config('kaesuri.pago_efectivo', '', true);
end;
$function$;

-- El domiciliario entrega su cuadre (queda pendiente hasta que la oficina confirme)
create or replace function public.jasta_cerrar_cuadre(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.jasta_domiciliario(p_email) is null then
    raise exception 'Tu correo de Jasta no está como domiciliario en Variedades JYB';
  end if;
  return public.cerrar_cuadre();
end;
$function$;

revoke all on function public.jasta_domiciliario(text) from public, anon, authenticated;
revoke all on function public.jasta_resumen(text) from public, anon, authenticated;
revoke all on function public.jasta_entregar(text, uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.jasta_cerrar_cuadre(text) from public, anon, authenticated;
grant execute on function public.jasta_resumen(text) to service_role;
grant execute on function public.jasta_entregar(text, uuid, text, text, numeric) to service_role;
grant execute on function public.jasta_cerrar_cuadre(text) to service_role;
