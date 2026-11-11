-- ============================================================================
--  Kaesuri · Envíos nacionales por transportadora (como en Jasta). YA APLICADO.
--  Pedido para otra ciudad con cédula y departamento, pago siempre anticipado. Al despachar
--  se adjunta el comprobante del pago del cliente y el pedido queda entregado con la guía.
--  El cliente ve la transportadora y la guía en su seguimiento.
-- ============================================================================
alter table public.pedidos
  add column if not exists envio_nacional boolean not null default false,
  add column if not exists destino_ciudad text,
  add column if not exists destino_departamento text,
  add column if not exists destinatario_cedula text,
  add column if not exists transportadora text,
  add column if not exists guia text,
  add column if not exists costo_envio numeric,
  add column if not exists enviado_at timestamptz;

create or replace function public.marcar_envio_nacional(p_pedido uuid, p_ciudad text, p_departamento text, p_cedula text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare p pedidos; v_ciudad text := public.texto_limpio(p_ciudad, 80); v_dep text := public.texto_limpio(p_departamento, 60);
  v_cc text := regexp_replace(coalesce(p_cedula, ''), '[^0-9A-Za-z]', '', 'g');
begin
  select * into p from pedidos where id = p_pedido for update;
  if not found then raise exception 'Ese pedido no existe'; end if;
  if not (public.tiene_rol('admin', 'despachador') or p.vendedor_id = auth.uid()) then raise exception 'Sin permiso'; end if;
  if p.estado in ('entregado', 'cancelado') then raise exception 'Este pedido ya no se puede cambiar'; end if;
  if v_ciudad is null or length(v_ciudad) < 3 then raise exception 'Escribe la ciudad de destino'; end if;
  if v_dep is null or length(v_dep) < 3 then raise exception 'Escribe el departamento'; end if;
  if length(v_cc) < 5 or length(v_cc) > 15 then raise exception 'Revisa la cédula del destinatario (la pide la transportadora)'; end if;
  update pedidos set envio_nacional = true, destino_ciudad = initcap(v_ciudad), destino_departamento = initcap(v_dep),
    destinatario_cedula = v_cc, barrio = coalesce(nullif(barrio, ''), initcap(v_ciudad))
   where id = p.id;
end $function$;

create or replace function public.despachar_nacional(p_pedido uuid, p_transportadora text, p_guia text, p_costo_envio numeric, p_comprobantes text[])
returns void language plpgsql security definer set search_path to 'public' as $function$
declare p pedidos; v_ev text[]; v_guia text := upper(regexp_replace(coalesce(p_guia, ''), '\s', '', 'g'));
  v_trans text := public.texto_limpio(p_transportadora, 40);
begin
  if not public.tiene_rol('admin', 'despachador') then raise exception 'Solo el admin o el despachador despachan envíos'; end if;
  select * into p from pedidos where id = p_pedido for update;
  if not found then raise exception 'Ese pedido no existe'; end if;
  if not p.envio_nacional then raise exception 'Este pedido no es un envío nacional'; end if;
  if p.estado not in ('pendiente', 'en_ruta') then raise exception 'El pedido ya está %', p.estado; end if;
  if v_trans is null then raise exception 'Elige la transportadora'; end if;
  if length(v_guia) < 5 or length(v_guia) > 40 then raise exception 'Revisa el número de guía'; end if;
  v_ev := public.comprobantes_validos(p_comprobantes);
  if cardinality(v_ev) = 0 then raise exception 'Sube el comprobante del pago del cliente (el envío es con pago anticipado)'; end if;
  update pedidos set estado = 'entregado', entregado_at = now(), metodo_pago = 'transferencia',
    comprobante_url = v_ev[1], comprobantes = v_ev[1:5],
    transportadora = v_trans, guia = v_guia, costo_envio = case when p_costo_envio >= 0 then round(p_costo_envio) end, enviado_at = now()
  where id = p.id;
  if p.vendedor_id is not null then
    perform public.notificar(p.vendedor_id, 'pedido', '📦 Salió el pedido #' || p.numero || ' por ' || v_trans,
      'Guía ' || v_guia || ' · ' || coalesce(p.destino_ciudad, '') || '. Mándale al cliente el enlace de seguimiento.', 'pedidos');
  end if;
end $function$;

revoke all on function public.marcar_envio_nacional(uuid, text, text, text), public.despachar_nacional(uuid, text, text, numeric, text[]) from public, anon;
grant execute on function public.marcar_envio_nacional(uuid, text, text, text), public.despachar_nacional(uuid, text, text, numeric, text[]) to authenticated;

do $$
declare v text := replace(pg_get_functiondef('public.seguimiento(uuid)'::regprocedure), chr(13), '');
begin
  if position('''guia''' in v) = 0 then
    v := replace(v, '''total'', p.total, ''domicilio'', p.valor_domicilio,',
      '''total'', p.total, ''domicilio'', p.valor_domicilio, ''envio_nacional'', p.envio_nacional, ''transportadora'', p.transportadora, ''guia'', p.guia,
    ''destino'', nullif(concat_ws('', '', p.destino_ciudad, p.destino_departamento), ''''), ''enviado_at'', p.enviado_at,');
    if position('''guia''' in v) = 0 then raise exception 'No se pudo cambiar seguimiento'; end if;
    execute v;
  end if;
end $$;
