-- ============================================================================
--  Entregas desde la app de Jasta, segunda parte (aplicado en Supabase)
--
--  1. Aviso al instante: cuando cambia un pedido o un cuadre de un domiciliario se
--     manda un aviso (sin datos, solo "cambio") al canal 'jasta-entregas:<id>'. La app
--     de Jasta lo escucha y vuelve a pedir el resumen. El id llega en jasta_resumen.
--  2. Varias fotos de comprobante: pedidos.comprobantes guarda todas; comprobante_url
--     sigue con la primera para lo que ya existe.
--  3. Detalle del pedido: jasta_resumen trae precios, vendedor y fecha.
--  4. Historial: jasta_entregadas lista lo que entregó en un rango de fechas.
-- ============================================================================

alter table public.pedidos add column if not exists comprobantes text[];

-- ---------- 1. Aviso al instante ----------
create or replace function public.jasta_avisar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ids uuid[];
begin
  if tg_table_name = 'cuadres' then
    v_ids := array[coalesce(new.domiciliario_id, old.domiciliario_id)];
  else
    v_ids := array[case when tg_op <> 'INSERT' then old.domiciliario_id end,
                   case when tg_op <> 'DELETE' then new.domiciliario_id end];
  end if;
  for i in 1 .. array_length(v_ids, 1) loop
    if v_ids[i] is not null and (i = 1 or v_ids[i] is distinct from v_ids[1]) then
      perform realtime.send(jsonb_build_object('cambio', true), 'cambio', 'jasta-entregas:' || v_ids[i], false);
    end if;
  end loop;
  return null;
exception when others then
  return null; -- el aviso nunca debe impedir guardar el pedido
end;
$function$;

drop trigger if exists trg_jasta_avisar on public.pedidos;
create trigger trg_jasta_avisar after insert or update or delete on public.pedidos
  for each row execute function public.jasta_avisar();
drop trigger if exists trg_jasta_avisar on public.cuadres;
create trigger trg_jasta_avisar after insert or update or delete on public.cuadres
  for each row execute function public.jasta_avisar();

-- ---------- 2 y 3. Resumen con detalle y canal ----------
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
               'created_at', p.created_at, 'vendedor', v.nombre,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object('nombre', coalesce(pr.nombre, 'Producto'), 'cantidad', i.cantidad,
                                                     'precio', i.precio_unitario))
                   from public.pedido_items i left join public.productos pr on pr.id = i.producto_id
                  where i.pedido_id = p.id), '[]'::jsonb))
             order by p.created_at)
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

-- ---------- 2. Entregar con varias fotos ----------
create or replace function public.jasta_entregar(p_email text, p_pedido_id uuid, p_metodo text,
                                                 p_comprobantes text[], p_efectivo numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dom uuid := public.jasta_domiciliario(p_email);
  v_fotos text[] := nullif(array_remove(coalesce(p_comprobantes, '{}'), ''), '{}');
begin
  if v_dom is null then
    raise exception 'Tu correo de Jasta no está como domiciliario en Variedades JYB';
  end if;
  if p_metodo not in ('efectivo', 'transferencia', 'mixto') then
    raise exception 'Método de pago no válido';
  end if;
  if p_metodo in ('transferencia', 'mixto') and v_fotos is null then
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
         comprobante_url = v_fotos[1],
         comprobantes = v_fotos
   where id = p_pedido_id and domiciliario_id = v_dom and estado = 'en_ruta' and cuadre_id is null;

  if not found then
    raise exception 'Este pedido ya no está en ruta contigo';
  end if;

  perform set_config('kaesuri.pago_efectivo', '', true);
end;
$function$;

-- La versión anterior (una sola foto) queda y usa la de varias fotos
create or replace function public.jasta_entregar(p_email text, p_pedido_id uuid, p_metodo text, p_comprobante text default null, p_efectivo numeric default null)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  select public.jasta_entregar(p_email, p_pedido_id, p_metodo, array_remove(array[p_comprobante], null), p_efectivo);
$function$;

-- ---------- 4. Historial de entregas ----------
create or replace function public.jasta_entregadas(p_email text, p_desde timestamptz default null, p_hasta timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_dom uuid := public.jasta_domiciliario(p_email);
begin
  if v_dom is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'numero', p.numero, 'cliente_nombre', p.cliente_nombre, 'barrio', p.barrio,
             'total', p.total, 'valor_domicilio', p.valor_domicilio, 'metodo_pago', p.metodo_pago,
             'efectivo', case p.metodo_pago when 'efectivo' then p.total when 'mixto' then p.monto_efectivo else 0 end,
             'transferencia', case p.metodo_pago when 'transferencia' then p.total when 'mixto' then p.monto_transferencia else 0 end,
             'entregado_at', p.entregado_at,
             'cuadre', case when p.cuadre_id is null then 'por_cuadrar'
                            when c.estado = 'pendiente' then 'por_confirmar' else 'cuadrado' end)
           order by p.entregado_at desc)
      from public.pedidos p left join public.cuadres c on c.id = p.cuadre_id
     where p.domiciliario_id = v_dom and p.estado = 'entregado'
       and (p_desde is null or p.entregado_at >= p_desde)
       and (p_hasta is null or p.entregado_at <= p_hasta)), '[]'::jsonb);
end;
$function$;

revoke all on function public.jasta_avisar() from public, anon, authenticated;
revoke all on function public.jasta_resumen(text) from public, anon, authenticated;
revoke all on function public.jasta_entregar(text, uuid, text, text[], numeric) from public, anon, authenticated;
revoke all on function public.jasta_entregadas(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.jasta_resumen(text) to service_role;
grant execute on function public.jasta_entregar(text, uuid, text, text[], numeric) to service_role;
grant execute on function public.jasta_entregadas(text, timestamptz, timestamptz) to service_role;
