-- ============================================================================
--  Kaesuri · Chat del pedido como WhatsApp (como en Jasta): responder un mensaje, fotos y notas
--  de voz. Columnas y funciones YA APLICADAS. El bucket "chat", sus permisos y el cambio de la
--  regla del texto están en PENDIENTE_correr_en_supabase.sql (sección 18).
-- ============================================================================
alter table public.pedido_mensajes
  add column if not exists responde_a bigint,
  add column if not exists tipo text not null default 'texto',
  add column if not exists adjunto text,
  add column if not exists duracion int;

-- La carpeta de cada archivo es el id del pedido: solo quien participa en el pedido sube o ve
create or replace function public.chat_carpeta_ok(p_nombre text)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select case when split_part(p_nombre, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.participa_en_pedido(split_part(p_nombre, '/', 1)::uuid) else false end
$function$;
grant execute on function public.chat_carpeta_ok(text) to authenticated;

-- Nueva función (la anterior, enviar_mensaje, sigue sirviendo a las apps sin actualizar)
create or replace function public.enviar_mensaje2(p_pedido uuid, p_texto text default '', p_responde bigint default null,
  p_tipo text default 'texto', p_adjunto text default null, p_duracion int default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare
  v_yo uuid := auth.uid(); v_nombre text; p pedidos; v_id bigint;
  v_texto text := left(trim(coalesce(p_texto, '')), 1000);
  v_tipo text := coalesce(p_tipo, 'texto'); v_aviso text;
begin
  if v_yo is null then raise exception 'Inicia sesión para escribir'; end if;
  if not public.participa_en_pedido(p_pedido) then raise exception 'No participas en este pedido'; end if;
  if v_tipo not in ('texto', 'foto', 'audio') then raise exception 'Mensaje no válido'; end if;
  if v_tipo = 'texto' then
    if p_adjunto is not null then raise exception 'Mensaje no válido'; end if;
    if length(v_texto) = 0 then raise exception 'Escribe un mensaje'; end if;
  else
    if p_adjunto is null or length(p_adjunto) > 300 or p_adjunto not like 'sb://chat/' || p_pedido || '/%' then
      raise exception 'Archivo no válido';
    end if;
  end if;
  if p_responde is not null and not exists (select 1 from pedido_mensajes where id = p_responde and pedido_id = p_pedido) then
    p_responde := null;
  end if;
  select * into p from pedidos where id = p_pedido;
  select nombre into v_nombre from profiles where id = v_yo;
  insert into pedido_mensajes (pedido_id, autor_id, autor_nombre, texto, responde_a, tipo, adjunto, duracion)
  values (p_pedido, v_yo, coalesce(v_nombre, 'Alguien'), v_texto, p_responde, v_tipo, p_adjunto,
    case when v_tipo = 'audio' then least(greatest(coalesce(p_duracion, 0), 0), 3600) end)
  returning id into v_id;
  v_aviso := case v_tipo when 'foto' then '📷 Foto' || case when v_texto <> '' then ': ' || v_texto else '' end
    when 'audio' then '🎤 Nota de voz' else v_texto end;
  -- Le llega al vendedor y al domiciliario; mientras está pendiente, también a la oficina
  insert into notificaciones (usuario_id, tipo, titulo, mensaje, enlace, pedido_id)
  select distinct u, 'mensaje', coalesce(v_nombre, 'Mensaje') || ' · pedido #' || p.numero, left(v_aviso, 140), 'chat:' || p.id, p.id
    from unnest(array[p.vendedor_id, p.domiciliario_id] ||
                case when p.estado = 'pendiente'
                     then array(select id from profiles where roles && array['admin', 'despachador']::user_role[] and coalesce(activo, true))
                     else '{}'::uuid[] end) as u
   where u is not null and u <> v_yo;
  return v_id;
end $function$;
revoke all on function public.enviar_mensaje2(uuid, text, bigint, text, text, int) from public, anon;
grant execute on function public.enviar_mensaje2(uuid, text, bigint, text, text, int) to authenticated;
