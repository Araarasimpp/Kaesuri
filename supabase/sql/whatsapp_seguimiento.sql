-- ============================================================================
--  Kaesuri · Enlace de seguimiento por WhatsApp (API oficial de Meta), como en Jasta
--  PENDIENTE: córrelo en Supabase → SQL Editor (proyecto Kaesuri) y dale "Run".
--  No envía nada hasta que el admin lo active en Configuración → WhatsApp.
-- ============================================================================

-- ---------------------------------------------------------------- Enlace por WhatsApp (Meta)
-- Cuando un pedido a domicilio sale en ruta por primera vez, se le manda al cliente la
-- plantilla aprobada de WhatsApp con su nombre, el número del pedido y el enlace de
-- seguimiento. Una sola vez por pedido. Envío con pg_net (no frena el despacho).
--   Plantilla (Utilidad, español), 3 variables: Hola {{1}}, tu pedido #{{2}} de
--   Variedades JYB va en camino 🛵 Míralo aquí: {{3}}
create table if not exists privado.whatsapp_config (
  id boolean primary key default true check (id),
  phone_number_id text,
  token text,
  plantilla text not null default 'seguimiento_pedido',
  idioma text not null default 'es',
  app_url text,
  activo boolean not null default false,
  actualizado timestamptz not null default now()
);
insert into privado.whatsapp_config (id) values (true) on conflict (id) do nothing;

create table if not exists public.whatsapp_envios (
  id bigint generated always as identity primary key,
  pedido_id uuid references public.pedidos(id) on delete cascade,
  telefono text not null,
  tipo text not null default 'seguimiento',
  request_id bigint,
  created_at timestamptz not null default now()
);
create unique index if not exists whatsapp_envios_pedido_tipo on public.whatsapp_envios (pedido_id, tipo) where pedido_id is not null;
alter table public.whatsapp_envios enable row level security;
revoke all on public.whatsapp_envios from anon, authenticated;

-- 3001234567 / +57 300 123 4567 → 573001234567 (celulares colombianos); otro formato → null
create or replace function privado.celular_co(p text) returns text language sql immutable set search_path to '' as $$
  select case when d ~ '^3\d{9}$' then '57' || d when d ~ '^573\d{9}$' then d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x
$$;

create or replace function privado.whatsapp_plantilla(p_telefono text, p_vars text[])
returns bigint language plpgsql security definer set search_path to '' as $function$
declare c privado.whatsapp_config; v_tel text := privado.celular_co(p_telefono);
begin
  select * into c from privado.whatsapp_config limit 1;
  if c.phone_number_id is null or c.token is null or v_tel is null then return null; end if;
  return net.http_post(
    url := 'https://graph.facebook.com/v21.0/' || c.phone_number_id || '/messages',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.token),
    body := jsonb_build_object(
      'messaging_product', 'whatsapp', 'to', v_tel, 'type', 'template',
      'template', jsonb_build_object('name', c.plantilla, 'language', jsonb_build_object('code', c.idioma),
        'components', jsonb_build_array(jsonb_build_object('type', 'body',
          'parameters', (select jsonb_agg(jsonb_build_object('type', 'text', 'text', v)) from unnest(p_vars) v))))));
end $function$;

create or replace function privado.whatsapp_seguimiento(p_pedido uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare c privado.whatsapp_config; p public.pedidos; v_req bigint;
begin
  select * into c from privado.whatsapp_config limit 1;
  if not coalesce(c.activo, false) or c.app_url is null then return; end if;
  select * into p from public.pedidos where id = p_pedido;
  if privado.celular_co(p.cliente_telefono) is null then return; end if;
  if exists (select 1 from public.whatsapp_envios where pedido_id = p.id and tipo = 'seguimiento') then return; end if;
  v_req := privado.whatsapp_plantilla(p.cliente_telefono, array[
    coalesce(nullif(split_part(trim(p.cliente_nombre), ' ', 1), ''), 'cliente'),
    p.numero::text,
    rtrim(c.app_url, '/') || '/seguimiento/' || p.seguimiento]);
  if v_req is not null then
    insert into public.whatsapp_envios (pedido_id, telefono, tipo, request_id) values (p.id, privado.celular_co(p.cliente_telefono), 'seguimiento', v_req)
    on conflict do nothing;
  end if;
end $function$;

-- Al salir en ruta por primera vez. Si algo falla, el despacho sigue igual.
create or replace function privado.trg_whatsapp_seguimiento()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.estado = 'en_ruta' and old.estado is distinct from 'en_ruta' and coalesce(new.canal, 'domicilio') = 'domicilio' then
    begin
      perform privado.whatsapp_seguimiento(new.id);
    exception when others then
      raise warning 'whatsapp_seguimiento %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $function$;

drop trigger if exists trg_whatsapp_seguimiento on public.pedidos;
create trigger trg_whatsapp_seguimiento after update of estado on public.pedidos
  for each row execute function privado.trg_whatsapp_seguimiento();

create or replace function public.whatsapp_config_leer()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare c privado.whatsapp_config;
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  select * into c from privado.whatsapp_config limit 1;
  return jsonb_build_object('phone_number_id', c.phone_number_id, 'token_guardado', c.token is not null,
    'plantilla', c.plantilla, 'idioma', c.idioma, 'app_url', c.app_url, 'activo', c.activo);
end $function$;

-- p_token null = deja el que estaba
create or replace function public.whatsapp_config_guardar(p_phone_number_id text, p_token text, p_plantilla text, p_idioma text, p_app_url text, p_activo boolean)
returns void language plpgsql security definer set search_path to '' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  if p_activo and (nullif(trim(coalesce(p_phone_number_id, '')), '') is null or nullif(trim(coalesce(p_app_url, '')), '') is null) then
    raise exception 'Para activarlo falta el Phone number ID y la dirección de la app';
  end if;
  update privado.whatsapp_config set
    phone_number_id = nullif(trim(coalesce(p_phone_number_id, '')), ''),
    token = coalesce(nullif(trim(coalesce(p_token, '')), ''), token),
    plantilla = coalesce(nullif(trim(coalesce(p_plantilla, '')), ''), 'seguimiento_pedido'),
    idioma = coalesce(nullif(trim(coalesce(p_idioma, '')), ''), 'es'),
    app_url = nullif(rtrim(trim(coalesce(p_app_url, '')), '/'), ''),
    activo = coalesce(p_activo, false), actualizado = now();
  if p_activo and (select token is null from privado.whatsapp_config limit 1) then raise exception 'Falta el token de acceso'; end if;
end $function$;

create or replace function public.whatsapp_probar(p_telefono text)
returns bigint language plpgsql security definer set search_path to '' as $function$
declare c privado.whatsapp_config; v_req bigint;
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  if privado.celular_co(p_telefono) is null then raise exception 'Escribe un celular colombiano de 10 dígitos'; end if;
  select * into c from privado.whatsapp_config limit 1;
  if c.phone_number_id is null or c.token is null then raise exception 'Primero guarda el Phone number ID y el token'; end if;
  v_req := privado.whatsapp_plantilla(p_telefono, array['Prueba', '123', coalesce(c.app_url, 'https://variedadesjyb.app') || '/seguimiento/ejemplo']);
  insert into public.whatsapp_envios (pedido_id, telefono, tipo, request_id) values (null, privado.celular_co(p_telefono), 'prueba', v_req);
  return v_req;
end $function$;

create or replace function public.whatsapp_envios_recientes()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]'::jsonb) from (
    select jsonb_build_object('fecha', e.created_at, 'numero', p.numero, 'tipo', e.tipo, 'telefono', e.telefono,
      'codigo', r.status_code,
      'error', case when r.status_code is not null and r.status_code >= 300 then left(coalesce(case when r.content ~ '^\s*\{' then r.content::jsonb #>> '{error,message}' end, r.content::text), 300)
                    when r.error_msg is not null then r.error_msg end) x
    from public.whatsapp_envios e left join public.pedidos p on p.id = e.pedido_id left join net._http_response r on r.id = e.request_id
    order by e.created_at desc limit 25) s);
end $function$;

revoke all on function public.whatsapp_config_leer(), public.whatsapp_config_guardar(text, text, text, text, text, boolean),
  public.whatsapp_probar(text), public.whatsapp_envios_recientes() from public, anon;
grant execute on function public.whatsapp_config_leer(), public.whatsapp_config_guardar(text, text, text, text, text, boolean),
  public.whatsapp_probar(text), public.whatsapp_envios_recientes() to authenticated;

