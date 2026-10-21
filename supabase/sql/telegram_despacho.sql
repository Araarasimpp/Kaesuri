-- ============================================================================
--  Kaesuri · Despacho por Telegram (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Cada domiciliario tiene un grupo de Telegram (él, quien despacha y el bot).
--  Quien despacha (admin o despachador) manda la foto del rótulo al grupo; el
--  bot lee el QR del rótulo ("KAESURI-<número>") y le asigna el pedido al
--  domiciliario de ese grupo (queda En ruta), en el orden en que llegan las fotos.
--  Funciones del bot: supabase/functions/telegram-bot y telegram-config.
-- ============================================================================

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

-- Configuración del bot (solo la ve el servidor)
create table if not exists privado.telegram_config (
  id boolean primary key default true check (id),
  token text not null,
  secreto text not null,
  bot_usuario text,
  actualizado timestamptz not null default now()
);

-- Grupo de Telegram ↔ domiciliario
create table if not exists public.telegram_grupos (
  chat_id bigint primary key,
  domiciliario_id uuid not null references public.profiles(id) on delete cascade,
  titulo text,
  vinculado_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.telegram_grupos enable row level security;
create policy "telegram_grupos: ver" on public.telegram_grupos for select to authenticated
  using ((select public.tiene_rol('admin', 'despachador')));

-- Cuenta de Telegram ↔ usuario de Kaesuri (quién despacha)
create table if not exists public.telegram_usuarios (
  telegram_id bigint primary key,
  usuario_id uuid not null unique references public.profiles(id) on delete cascade,
  nombre_tg text,
  created_at timestamptz not null default now()
);
alter table public.telegram_usuarios enable row level security;
create policy "telegram_usuarios: ver" on public.telegram_usuarios for select to authenticated
  using (usuario_id = (select auth.uid()) or (select public.tiene_rol('admin')));

-- Códigos de un solo uso para vincular (vencen en 30 minutos)
create table if not exists privado.telegram_codigos (
  codigo text primary key,
  tipo text not null check (tipo in ('usuario', 'grupo')),
  usuario_id uuid references public.profiles(id) on delete cascade,
  domiciliario_id uuid references public.profiles(id) on delete cascade,
  creado_por uuid references public.profiles(id) on delete set null,
  expira_at timestamptz not null default now() + interval '30 minutes',
  usado_at timestamptz
);

-- Cada foto se procesa una sola vez (Telegram reintenta si tardamos)
create table if not exists privado.telegram_mensajes (
  chat_id bigint not null,
  message_id bigint not null,
  numero bigint,
  resultado text,
  created_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

-- ---------- Para la app ----------
create or replace function public.telegram_estado()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'conectado', exists (select 1 from privado.telegram_config),
    'bot', (select bot_usuario from privado.telegram_config),
    'vinculado', exists (select 1 from public.telegram_usuarios where usuario_id = auth.uid()),
    'grupos', case when public.tiene_rol('admin', 'despachador') then coalesce((
      select jsonb_agg(jsonb_build_object('chat_id', g.chat_id, 'titulo', g.titulo, 'mensajero_id', g.domiciliario_id, 'mensajero', u.nombre) order by u.nombre)
      from public.telegram_grupos g join public.profiles u on u.id = g.domiciliario_id), '[]'::jsonb) else '[]'::jsonb end,
    'despachadores', case when public.tiene_rol('admin') then coalesce((
      select jsonb_agg(jsonb_build_object('usuario', u.nombre, 'telegram', t.nombre_tg) order by u.nombre)
      from public.telegram_usuarios t join public.profiles u on u.id = t.usuario_id), '[]'::jsonb) else '[]'::jsonb end,
    'mensajeros', case when public.tiene_rol('admin', 'despachador') then coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre)
      from public.profiles where coalesce(activo, true) and 'domiciliario' = any (roles)), '[]'::jsonb) else '[]'::jsonb end
  )
$function$;

create or replace function public.telegram_codigo(p_tipo text, p_mensajero uuid default null)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare v_yo uuid := auth.uid(); v_codigo text;
begin
  if v_yo is null then raise exception 'Sin sesión'; end if;
  if not public.tiene_rol('admin', 'despachador') then raise exception 'Solo quien despacha usa Telegram'; end if;
  if p_tipo = 'grupo' then
    if not exists (select 1 from public.profiles where id = p_mensajero and 'domiciliario' = any (roles)) then raise exception 'Elige un domiciliario'; end if;
  elsif p_tipo <> 'usuario' then
    raise exception 'Tipo inválido';
  end if;
  v_codigo := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into privado.telegram_codigos (codigo, tipo, usuario_id, domiciliario_id, creado_por)
  values (v_codigo, p_tipo, case when p_tipo = 'usuario' then v_yo end, case when p_tipo = 'grupo' then p_mensajero end, v_yo);
  return v_codigo;
end;
$function$;

-- ---------- Solo para el bot (service_role) ----------
create or replace function public.telegram_config_guardar(p_token text, p_secreto text, p_bot text)
returns void
language sql
volatile
security definer
set search_path to ''
as $function$
  insert into privado.telegram_config (id, token, secreto, bot_usuario, actualizado) values (true, p_token, p_secreto, p_bot, now())
  on conflict (id) do update set token = excluded.token, secreto = excluded.secreto, bot_usuario = excluded.bot_usuario, actualizado = now()
$function$;

create or replace function public.telegram_config_leer()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select to_jsonb(c) from privado.telegram_config c
$function$;

-- Quién despacha desde esta cuenta de Telegram (null si no es admin ni despachador)
create or replace function public.telegram_despachador(p_telegram_id bigint)
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select t.usuario_id from public.telegram_usuarios t join public.profiles u on u.id = t.usuario_id
   where t.telegram_id = p_telegram_id and coalesce(u.activo, true) and ('admin' = any (u.roles) or 'despachador' = any (u.roles))
$function$;

-- Usa un código: vincula la cuenta de Telegram (chat privado) o el grupo
create or replace function public.telegram_vincular(p_codigo text, p_telegram_id bigint, p_nombre text, p_chat_id bigint, p_titulo text, p_es_grupo boolean)
returns text
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare c privado.telegram_codigos; v_nombre text;
begin
  select * into c from privado.telegram_codigos where codigo = upper(trim(p_codigo)) for update;
  if not found or c.usado_at is not null or c.expira_at < now() then
    return '❌ Ese código no sirve o ya venció. Pide uno nuevo en la app.';
  end if;
  if c.tipo = 'usuario' then
    if p_es_grupo then return 'Este código es para tu cuenta: escríbemelo por chat privado, no en el grupo.'; end if;
    -- Una cuenta de Telegram por usuario de Kaesuri (si ya tenía otra, se cambia)
    update public.telegram_usuarios set telegram_id = p_telegram_id, nombre_tg = p_nombre where usuario_id = c.usuario_id;
    if not found then
      insert into public.telegram_usuarios (telegram_id, usuario_id, nombre_tg) values (p_telegram_id, c.usuario_id, p_nombre)
      on conflict (telegram_id) do update set usuario_id = excluded.usuario_id, nombre_tg = excluded.nombre_tg;
    end if;
    select nombre into v_nombre from public.profiles where id = c.usuario_id;
    update privado.telegram_codigos set usado_at = now() where codigo = c.codigo;
    return '✅ Listo, ' || v_nombre || '. Ya puedes despachar mandando la foto del rótulo al grupo de cada domiciliario.';
  end if;
  if not p_es_grupo then
    return 'Este código es para un grupo: escríbelo dentro del grupo del domiciliario.';
  end if;
  insert into public.telegram_grupos (chat_id, domiciliario_id, titulo, vinculado_por) values (p_chat_id, c.domiciliario_id, p_titulo, c.creado_por)
  on conflict (chat_id) do update set domiciliario_id = excluded.domiciliario_id, titulo = excluded.titulo, vinculado_por = excluded.vinculado_por;
  select nombre into v_nombre from public.profiles where id = c.domiciliario_id;
  update privado.telegram_codigos set usado_at = now() where codigo = c.codigo;
  return '✅ Este grupo quedó vinculado a ' || v_nombre || '. Cada foto de rótulo que manden aquí se le asigna, en el orden en que lleguen.';
end;
$function$;

-- Despacha un pedido (por número) al domiciliario del grupo. Devuelve el texto para responder en el grupo
create or replace function public.telegram_despachar(p_chat_id bigint, p_message_id bigint, p_telegram_id bigint, p_numero bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare g public.telegram_grupos; v_desp uuid; v_dom_nombre text; p public.pedidos; v_antes text; v_orden int; v_txt text;
begin
  -- Ya procesado (reintento de Telegram): no se repite
  if exists (select 1 from privado.telegram_mensajes where chat_id = p_chat_id and message_id = p_message_id) then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;
  select * into g from public.telegram_grupos where chat_id = p_chat_id;
  if not found then
    return jsonb_build_object('ok', false, 'texto', 'Este grupo no está vinculado a ningún domiciliario. Vincúlalo desde la app (Configuración → Telegram).');
  end if;
  -- Solo quien despacha (admin o despachador, con su Telegram vinculado)
  v_desp := public.telegram_despachador(p_telegram_id);
  if v_desp is null then return jsonb_build_object('ok', false, 'silencio', true); end if;
  -- Los cambios quedan a nombre de quien despacha (Actividad y avisos)
  perform set_config('request.jwt.claim.sub', v_desp::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_desp, 'role', 'authenticated')::text, true);
  select nombre into v_dom_nombre from public.profiles where id = g.domiciliario_id;

  select * into p from public.pedidos where numero = p_numero for update;
  if not found then v_txt := '❌ No encontré el pedido #' || coalesce(p_numero::text, '?') || '.';
  elsif p.canal = 'local' then v_txt := '❌ El #' || p.numero || ' es una venta del local.';
  elsif p.estado in ('entregado', 'cancelado') then v_txt := '❌ El pedido #' || p.numero || ' ya está ' || p.estado::text || '.';
  elsif p.cuadre_id is not null then v_txt := '❌ El pedido #' || p.numero || ' ya está en un cuadre.';
  elsif p.estado = 'en_ruta' and p.domiciliario_id = g.domiciliario_id then v_txt := 'ℹ️ El #' || p.numero || ' ya estaba en ruta con ' || v_dom_nombre || '.';
  else
    v_antes := case when p.domiciliario_id is not null and p.domiciliario_id <> g.domiciliario_id then (select nombre from public.profiles where id = p.domiciliario_id) end;
    update public.pedidos set estado = 'en_ruta', domiciliario_id = g.domiciliario_id where id = p.id;
    select count(*) into v_orden from public.pedidos where estado = 'en_ruta' and domiciliario_id = g.domiciliario_id;
    v_txt := '✅ #' || p.numero || ' → ' || v_dom_nombre || ' (' || v_orden || '.º en ruta) · ' || p.cliente_nombre || coalesce(', ' || p.barrio, '')
      || case when v_antes is not null then E'\n(se le quitó a ' || v_antes || ')' else '' end;
  end if;
  insert into privado.telegram_mensajes (chat_id, message_id, numero, resultado) values (p_chat_id, p_message_id, p_numero, v_txt);
  return jsonb_build_object('ok', v_txt like '✅%', 'texto', v_txt);
end;
$function$;

-- La ruta del domiciliario del grupo, en el orden en que se le asignaron
create or replace function public.telegram_ruta(p_chat_id bigint)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select max(r.domiciliario) || E' tiene en ruta:\n' || string_agg(r.n || '. #' || r.numero || ' · ' || r.cliente || coalesce(' (' || r.barrio || ')', ''), E'\n' order by r.n)
     from (select p.numero, p.cliente_nombre as cliente, p.barrio, u.nombre as domiciliario,
                  row_number() over (order by p.asignado_at nulls first, p.numero) as n
           from public.pedidos p
           join public.telegram_grupos g on g.domiciliario_id = p.domiciliario_id
           join public.profiles u on u.id = p.domiciliario_id
           where g.chat_id = p_chat_id and p.estado = 'en_ruta') r
     having count(*) > 0),
    'No tiene pedidos en ruta.')
$function$;

-- Un grupo normal que pasa a supergrupo cambia de número: se mantiene el vínculo
create or replace function public.telegram_migrar_grupo(p_de bigint, p_a bigint)
returns void
language sql
volatile
security definer
set search_path to ''
as $function$
  update public.telegram_grupos set chat_id = p_a where chat_id = p_de
$function$;

revoke all on function public.telegram_config_guardar(text, text, text) from public, anon, authenticated;
revoke all on function public.telegram_config_leer() from public, anon, authenticated;
revoke all on function public.telegram_despachador(bigint) from public, anon, authenticated;
revoke all on function public.telegram_vincular(text, bigint, text, bigint, text, boolean) from public, anon, authenticated;
revoke all on function public.telegram_despachar(bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.telegram_ruta(bigint) from public, anon, authenticated;
revoke all on function public.telegram_migrar_grupo(bigint, bigint) from public, anon, authenticated;
grant execute on function public.telegram_config_guardar(text, text, text) to service_role;
grant execute on function public.telegram_config_leer() to service_role;
grant execute on function public.telegram_despachador(bigint) to service_role;
grant execute on function public.telegram_vincular(text, bigint, text, bigint, text, boolean) to service_role;
grant execute on function public.telegram_despachar(bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.telegram_ruta(bigint) to service_role;
grant execute on function public.telegram_migrar_grupo(bigint, bigint) to service_role;
revoke all on function public.telegram_estado() from public, anon;
revoke all on function public.telegram_codigo(text, uuid) from public, anon;
grant execute on function public.telegram_estado() to authenticated;
grant execute on function public.telegram_codigo(text, uuid) to authenticated;
