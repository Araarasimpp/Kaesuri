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



-- ============================================================ 2. El vendedor ve el comprobante de su pago (liquidación)
drop policy if exists "comprobantes: vendedor ve su liquidación" on storage.objects;
create policy "comprobantes: vendedor ve su liquidación" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and exists (select 1 from public.liquidaciones l
    where objects.name = any (l.comprobantes) and l.vendedor_id = (select auth.uid())));

-- ============================================================ 3. Aviso de inventario bajo o agotado
-- Cuando un producto baja a su mínimo o se agota, les llega un aviso a los admins
-- (campana + push), una vez cada vez que cruza.
create or replace function public.alerta_stock()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_titulo text;
begin
  if not coalesce(new.activo, true) or new.stock >= old.stock then return new; end if;
  if new.stock <= 0 and old.stock > 0 then
    v_titulo := 'Se agotó: ' || new.nombre;
  elsif new.stock <= new.stock_minimo and old.stock > new.stock_minimo then
    v_titulo := 'Por acabarse: ' || new.nombre;
  else
    return new;
  end if;
  perform public.notificar_roles(array['admin']::user_role[], case when new.stock <= 0 then 'agotado' else 'stock_bajo' end,
    left(v_titulo, 120), case when new.stock <= 0 then 'No quedan unidades' else 'Quedan ' || new.stock || ' (mínimo ' || new.stock_minimo || ')' end,
    'inventario');
  return new;
end $function$;
revoke all on function public.alerta_stock() from public, anon, authenticated;
drop trigger if exists productos_alerta_stock on public.productos;
create trigger productos_alerta_stock after update of stock on public.productos
  for each row execute function public.alerta_stock();

-- ============================================================ 4. Revisar pedidos quietos cada hora
-- Pedidos con más de 24 horas sin moverse (por alistar, alistado sin salir o en ruta):
-- aviso una vez a quien le toca y un resumen al admin. De 8 a. m. a 6 p. m. (Colombia).
select cron.unschedule('pedidos-quietos') where exists (select 1 from cron.job where jobname = 'pedidos-quietos');
select cron.schedule('pedidos-quietos', '20 13-23 * * *', 'select public.revisar_quietos()');

-- ============================================================ 5. Pedidos de la tienda sin confirmar (cada 5 min)
-- Recordatorio al vendedor a los 15 min y aviso al admin a la hora. La función ya está creada
-- (recordatorio_pedidos_web.sql); de noche no avisa.
select cron.unschedule('pedidos-web-sin-confirmar') where exists (select 1 from cron.job where jobname = 'pedidos-web-sin-confirmar');
select cron.schedule('pedidos-web-sin-confirmar', '*/5 * * * *', 'select public.revisar_pedidos_web()');

-- ============================================================ 6. Avisos de metas (cada 10 min)
-- Al pasar el 50 %, 80 % y 100 % de la meta del mes (y el 100 % de la semana). La función ya está creada.
select cron.unschedule('avisos-metas') where exists (select 1 from cron.job where jobname = 'avisos-metas');
select cron.schedule('avisos-metas', '*/10 * * * *', 'select public.revisar_metas()');

-- ============================================================ 7. Cierre del día por Telegram (9 p. m.)
-- Resumen del día (entregas, ganancia, gastos, pendientes, comisiones y caja del local) a los admins
-- que vincularon su Telegram, y aviso en la app del cierre del local.
create or replace function public.enviar_cierre_dia(p_dia date default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_token text; v_texto text; r record; n int := 0; v_dia date := coalesce(p_dia, (now() at time zone 'America/Bogota')::date);
  l jsonb := public.cierre_local(v_dia);
begin
  if (l->>'ventas')::int > 0 then
    perform public.notificar_roles(array['admin', 'venta_local']::user_role[], 'cierre_local',
      'Cierre del local · ' || (l->>'ventas') || case when (l->>'ventas')::int = 1 then ' venta · ' else ' ventas · ' end || public.fmt_pesos((l->>'total')::numeric),
      'Efectivo que debe haber en caja: ' || public.fmt_pesos((l->>'efectivo')::numeric) || ' · Transferencias: ' || public.fmt_pesos((l->>'transferencia')::numeric),
      'ventas-local');
  end if;
  select token into v_token from privado.telegram_config limit 1;
  if v_token is null then return 0; end if;
  v_texto := public.cierre_dia_texto(v_dia);
  for r in select distinct t.telegram_id from telegram_usuarios t join profiles u on u.id = t.usuario_id
           where coalesce(u.activo, true) and 'admin' = any (u.roles) loop
    perform net.http_post(url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
                          body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_texto),
                          headers := '{"Content-Type": "application/json"}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.enviar_cierre_dia(date) from public, anon, authenticated;
select cron.unschedule('cierre-del-dia') where exists (select 1 from cron.job where jobname = 'cierre-del-dia');
select cron.schedule('cierre-del-dia', '0 2 * * *', 'select public.enviar_cierre_dia(((now() at time zone ''America/Bogota'') - interval ''3 hours'')::date)');

-- ============================================================ 8. Lista de compras de la semana (lunes 7:40 a. m.)
-- Qué pedirle al proveedor según lo que se vende: aviso en la app (admin y despachador) y por Telegram a los admins.
create or replace function public.enviar_lista_compras()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_token text; v_texto text; v_n int; v_total numeric; v_top text; r record; n int := 0;
begin
  select count(*), coalesce(sum(sugerido * coalesce(costo, 0)), 0) into v_n, v_total from public.compras_sugeridas_base(21);
  if v_n = 0 then return 0; end if;
  select string_agg(nombre, ', ') into v_top from (select nombre from public.compras_sugeridas_base(21) limit 3) t;
  perform public.notificar_roles(array['admin', 'despachador']::user_role[], 'compras',
    'Lista de compras de la semana: ' || v_n || case when v_n = 1 then ' producto' else ' productos' end || ' por pedir',
    'Lo más urgente: ' || v_top, 'inventario');
  select token into v_token from privado.telegram_config limit 1;
  if v_token is null then return 0; end if;
  select '🛒 Lista de compras · ' || to_char((now() at time zone 'America/Bogota')::date, 'DD/MM/YYYY') || E'\n'
      || 'Para tener inventario de 3 semanas según lo que se vende:' || E'\n\n'
      || string_agg('• ' || nombre || ' — pedir ' || sugerido || ' (quedan ' || greatest(stock, 0)
           || case when dias is not null then ', ~' || dias || ' días' else '' end || ')', E'\n')
      || case when v_n > 40 then E'\n… y ' || (v_n - 40) || ' más en Inventario → Qué comprar' else '' end
      || E'\n\n💰 Costo aproximado: ' || public.fmt_pesos(v_total)
    into v_texto
  from (select * from public.compras_sugeridas_base(21) limit 40) c;
  for r in select distinct t.telegram_id from telegram_usuarios t join profiles u on u.id = t.usuario_id
           where coalesce(u.activo, true) and 'admin' = any (u.roles) loop
    perform net.http_post(url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
                          body := jsonb_build_object('chat_id', r.telegram_id, 'text', v_texto),
                          headers := '{"Content-Type": "application/json"}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.enviar_lista_compras() from public, anon, authenticated;
select cron.unschedule('lista-compras') where exists (select 1 from cron.job where jobname = 'lista-compras');
select cron.schedule('lista-compras', '40 12 * * 1', 'select public.enviar_lista_compras()');
