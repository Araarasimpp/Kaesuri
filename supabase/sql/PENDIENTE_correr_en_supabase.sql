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

-- ============================================================ 9. Respaldo semanal en Excel por Telegram
-- Los domingos a las 9:15 p. m. la base le pide a la Edge Function respaldo-semanal (ya publicada)
-- el Excel de los últimos 7 días para cada admin con su Telegram vinculado. También se pide desde
-- Configuración → Telegram ("Mandar respaldo ahora"), igual que el cierre del día.
create or replace function public.enviar_respaldo(p_hasta date default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_secreto text;
begin
  select secreto into v_secreto from privado.telegram_config limit 1;
  if v_secreto is null then return; end if;
  perform net.http_post(
    url := 'https://mswqdzpsynvdanxdfidf.supabase.co/functions/v1/respaldo-semanal',
    body := jsonb_build_object('hasta', coalesce(p_hasta, (now() at time zone 'America/Bogota')::date)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-respaldo-secreto', v_secreto),
    timeout_milliseconds := 60000);
end $function$;
revoke all on function public.enviar_respaldo(date) from public, anon, authenticated;

-- Cuántos admins lo van a recibir (0 = nadie tiene el bot vinculado)
create or replace function public.pedir_respaldo()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede pedir el respaldo'; end if;
  if not exists (select 1 from privado.telegram_config where token is not null) then raise exception 'Primero conecta el bot de Telegram'; end if;
  select count(distinct t.telegram_id) into n from telegram_usuarios t join profiles u on u.id = t.usuario_id
   where coalesce(u.activo, true) and 'admin' = any (u.roles);
  if n = 0 then raise exception 'Ningún admin tiene su Telegram vinculado (Mi perfil → Telegram)'; end if;
  perform public.enviar_respaldo(null);
  return n;
end $function$;
revoke all on function public.pedir_respaldo() from public, anon;
grant execute on function public.pedir_respaldo() to authenticated;

-- El cierre de hoy, cuando el admin lo pide: lo manda por Telegram y devuelve el texto para verlo en la app
create or replace function public.enviar_cierre_dia_ahora()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_dia date := (now() at time zone 'America/Bogota')::date;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede mandar el cierre'; end if;
  return jsonb_build_object('enviados', public.enviar_cierre_dia(v_dia), 'texto', public.cierre_dia_texto(v_dia));
end $function$;
revoke all on function public.enviar_cierre_dia_ahora() from public, anon;
grant execute on function public.enviar_cierre_dia_ahora() to authenticated;

-- Domingo 9:15 p. m. Colombia = lunes 02:15 UTC (la semana termina el domingo)
select cron.unschedule('respaldo-semanal') where exists (select 1 from cron.job where jobname = 'respaldo-semanal');
select cron.schedule('respaldo-semanal', '15 2 * * 1', $$select public.enviar_respaldo(((now() at time zone 'America/Bogota')::date))$$);

-- ============================================================ 10. Quitar el puente de la página de Pedidos de Jasta
-- Jasta ya no muestra, alista ni imprime los pedidos de Variedades JYB (jasta-puente ya no
-- tiene esas acciones). Se borran las funciones que solo servían para eso. El puente de
-- entregas del domiciliario (jasta_resumen, jasta_entregar, …) no se toca.
drop function if exists public.jasta_pedidos_datos();
drop function if exists public.jasta_alistar(text, uuid[], boolean);
drop function if exists public.jasta_rotulos(text);
drop function if exists public.jasta_rotulos_alistador();
drop function if exists public.jasta_rotulos_datos();
drop function if exists public.jasta_marcar_rotulos(text, uuid[]);
drop function if exists public.jasta_marcar_rotulos_alistador(uuid[]);
drop function if exists public.jasta_despachador(text);

-- ============================================================ 11. Aviso de deudas por vencer (8:25 a. m.)
-- Al admin: deudas con proveedores que vencen en 3 días o ya vencieron. La función ya está creada.
select cron.unschedule('recordar-deudas') where exists (select 1 from cron.job where jobname = 'recordar-deudas');
select cron.schedule('recordar-deudas', '25 13 * * *', 'select public.recordar_deudas()');

-- ============================================================ 12. Transferencias por revisar (triggers y recordatorio)
-- Al entregar un pedido (o registrar una venta del local) pagado por transferencia, queda "por revisar"
-- y se avisa al admin; recordatorio cada 30 minutos (7 a. m. a 10 p. m.) mientras quede alguna.
-- Las funciones ya están creadas (transferencias_por_revisar.sql).
drop trigger if exists pedidos_transferencia_por_revisar on public.pedidos;
create trigger pedidos_transferencia_por_revisar
  after insert or update of estado, metodo_pago, monto_transferencia on public.pedidos
  for each row execute function public.marcar_transferencia();
drop trigger if exists pedidos_transferencia_desmarcar on public.pedidos;
create trigger pedidos_transferencia_desmarcar
  before update of estado, metodo_pago, monto_transferencia on public.pedidos
  for each row execute function public.desmarcar_transferencia();
select cron.unschedule('recordar-transferencias') where exists (select 1 from cron.job where jobname = 'recordar-transferencias');
select cron.schedule('recordar-transferencias', '*/30 * * * *', 'select public.recordar_transferencias()');

-- ============================================================ 13. Recordatorios del calendario (cada 5 minutos)
-- Avisa al celular los recordatorios de hoy (a la hora puesta, o a las 7 a. m.). La función ya está creada.
select cron.unschedule('recordatorios') where exists (select 1 from cron.job where jobname = 'recordatorios');
select cron.schedule('recordatorios', '*/5 * * * *', 'select public.avisar_recordatorios()');

-- ============================================================ 14. Unificar categorías de productos
-- Como en Jasta: las categorías repetidas o mal escritas ("Hogar ", "HOGAR", "Higar", "Jugeteria"…)
-- quedan con el nombre que ya se ve en la app (categoria_normal), y lo que se escriba de aquí en
-- adelante en Categoría se guarda igual. OJO: cambia la categoría guardada de los productos.
create or replace function public.producto_categoria() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if nullif(trim(new.categoria), '') is not null then new.categoria := public.categoria_normal(new.categoria); end if;
  return new;
end $$;
drop trigger if exists productos_categoria on public.productos;
create trigger productos_categoria before insert or update of categoria on public.productos
  for each row execute function public.producto_categoria();
update public.productos set categoria = public.categoria_normal(categoria)
 where categoria is not null and categoria is distinct from public.categoria_normal(categoria);

-- ============================================================ 15. Recolector: compras con costo, cada día cuadra solo, el admin recibe
-- (recolector_dias_y_costo.sql completo; pidió confirmación al aplicarlo). Después de correrlo, avísale
-- a Claude para cambiar la pantalla del Recolector.
alter table public.recoleccion_compras
  add column if not exists producto_id uuid references public.productos(id),
  add column if not exists cantidad int,
  add column if not exists costo_unitario numeric,
  add column if not exists costo_anterior numeric;

create table if not exists public.recoleccion_entregas (
  id bigint generated always as identity primary key,
  recolector_id uuid not null references public.profiles(id),
  valor numeric not null check (valor > 0 and valor <= 100000000),
  nota text,
  recibida_por uuid references public.profiles(id) on delete set null,
  recibida_por_nombre text,
  dia date not null,
  created_at timestamptz not null default now()
);
create index if not exists recoleccion_entregas_dia_idx on public.recoleccion_entregas (recolector_id, dia);
alter table public.recoleccion_entregas enable row level security;
revoke all on public.recoleccion_entregas from anon, authenticated;

-- Productos para elegir (el recolector no tiene acceso directo a la tabla de productos)
create or replace function public.recolector_productos()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('recolector', 'admin') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'imagen_url', p.imagen_url, 'costo', p.costo) order by p.nombre)
    from productos p where p.activo), '[]');
end $function$;

create or replace function public.recoleccion_compra(p_valor numeric, p_proveedor text, p_producto text, p_facturas text[],
  p_producto_id uuid default null, p_cantidad integer default null, p_costo numeric default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid(); v_ev text[]; v_id bigint; pr productos; v_valor numeric := p_valor; v_texto text := trim(coalesce(p_producto, ''));
  v_costo numeric := round(coalesce(p_costo, 0));
begin
  if not public.tiene_rol('recolector') then raise exception 'Solo el recolector registra compras'; end if;
  if coalesce(trim(p_proveedor), '') = '' then raise exception 'Escribe el proveedor'; end if;
  if p_producto_id is not null then
    select * into pr from productos where id = p_producto_id for update;
    if not found then raise exception 'Ese producto no existe'; end if;
    if coalesce(p_cantidad, 0) <= 0 then raise exception 'Escribe cuántos compraste'; end if;
    if v_costo <= 0 then raise exception 'Escribe cuánto te costó cada uno'; end if;
    v_valor := v_costo * p_cantidad;
    v_texto := p_cantidad || ' × ' || pr.nombre;
  end if;
  if coalesce(v_valor, 0) <= 0 then raise exception 'Escribe el valor de la compra'; end if;
  if v_texto = '' then raise exception 'Escribe qué compraste'; end if;
  v_ev := public.comprobantes_validos(p_facturas);
  if cardinality(v_ev) = 0 then raise exception 'Sube la foto de la factura'; end if;
  insert into recoleccion_compras (recolector_id, valor, proveedor, producto, facturas, creada_por_nombre, producto_id, cantidad, costo_unitario, costo_anterior)
  values (v_yo, v_valor, left(trim(p_proveedor), 120), left(v_texto, 200), v_ev, public.mi_nombre(),
          pr.id, case when pr.id is not null then p_cantidad end, case when pr.id is not null then v_costo end, pr.costo)
  returning id into v_id;
  -- El costo del producto queda con lo que le costó al recolector
  if pr.id is not null and pr.costo is distinct from v_costo then
    update productos set costo = v_costo, updated_at = now() where id = pr.id;
    perform public.notificar_roles(array['admin']::user_role[], 'compras', '💲 Costo actualizado: ' || pr.nombre,
      'De ' || public.fmt_pesos(coalesce(pr.costo, 0)) || ' a ' || public.fmt_pesos(v_costo) || ' · compra de ' || coalesce(public.mi_nombre(), 'el recolector')
        || ' a ' || left(trim(p_proveedor), 60) || ' (' || p_cantidad || ' und)', 'recolector');
  end if;
  return v_id;
end $function$;

create or replace function public.recoleccion_borrar_compra(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare c recoleccion_compras; v_admin boolean := public.tiene_rol('admin'); v_ultima bigint;
begin
  select * into c from recoleccion_compras where id = p_id for update;
  if not found then raise exception 'Esa compra ya no existe'; end if;
  if not v_admin then
    if not public.tiene_rol('recolector') or c.recolector_id is distinct from auth.uid() then raise exception 'Sin permiso'; end if;
    if (c.created_at at time zone 'America/Bogota')::date <> (now() at time zone 'America/Bogota')::date then
      raise exception 'Solo puedes quitar compras de hoy. Pídele al admin que la quite.';
    end if;
  end if;
  if c.producto_id is not null and c.costo_anterior is not null then
    select id into v_ultima from recoleccion_compras
      where producto_id = c.producto_id and costo_unitario is not null order by created_at desc, id desc limit 1;
    if v_ultima = c.id then
      update productos set costo = c.costo_anterior, updated_at = now() where id = c.producto_id and costo = c.costo_unitario;
    end if;
  end if;
  delete from recoleccion_compras where id = c.id;
  if not v_admin then
    perform public.notificar_roles(array['admin']::user_role[], 'compras', '🗑️ Compra quitada: ' || c.producto,
      coalesce(public.mi_nombre(), 'El recolector') || ' quitó la compra de ' || public.fmt_pesos(c.valor) || ' a ' || coalesce(c.proveedor, '—'), 'recolector');
  end if;
end $function$;

-- Lo que falta por entregar de un recolector en unos días (cada día cuadra solo)
create or replace function public.recoleccion_pendiente(p_rec uuid, p_desde date, p_hasta date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce((select sum(monto) from recoleccion_bases where recolector_id = p_rec and estado = 'aceptada'
           and created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz and created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz), 0)
       - coalesce((select sum(valor) from recoleccion_compras where recolector_id = p_rec
           and created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz and created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz), 0)
       - coalesce((select sum(valor) from recoleccion_entregas where recolector_id = p_rec and dia between p_desde and p_hasta), 0)
$$;
revoke all on function public.recoleccion_pendiente(uuid, date, date) from public, anon, authenticated;

-- El admin recibe la plata del recolector, a nombre del día al que pertenece
create or replace function public.recoleccion_recibir(p_recolector uuid, p_valor numeric, p_nota text, p_dia date default null)
returns numeric language plpgsql security definer set search_path to 'public' as $function$
declare v_valor numeric := round(coalesce(p_valor, 0)); v_dia date := coalesce(p_dia, (now() at time zone 'America/Bogota')::date); v_falta numeric;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin recibe la plata del recolector'; end if;
  if not exists (select 1 from profiles where id = p_recolector and 'recolector' = any(roles)) then raise exception 'Ese recolector no existe'; end if;
  if v_valor <= 0 then raise exception 'Escribe cuánto recibiste'; end if;
  if v_dia > (now() at time zone 'America/Bogota')::date then raise exception 'No puedes recibir plata de un día que no ha llegado'; end if;
  insert into recoleccion_entregas (recolector_id, valor, nota, recibida_por, recibida_por_nombre, dia)
  values (p_recolector, v_valor, nullif(left(trim(coalesce(p_nota, '')), 300), ''), auth.uid(), public.mi_nombre(), v_dia);
  v_falta := public.recoleccion_pendiente(p_recolector, v_dia, v_dia);
  perform public.notificar(p_recolector, 'base_recolector',
    coalesce(public.mi_nombre(), 'El admin') || ' recibió ' || public.fmt_pesos(v_valor) || ' del ' || to_char(v_dia, 'DD/MM'),
    case when v_falta = 0 then 'Ese día quedó en cero ✓' when v_falta > 0 then 'De ese día todavía faltan ' || public.fmt_pesos(v_falta)
         else 'De ese día quedó a tu favor ' || public.fmt_pesos(-v_falta) end, 'recolector');
  return v_falta;
end $function$;

create or replace function public.recoleccion_borrar_entrega(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  delete from recoleccion_entregas where id = p_id;
  if not found then raise exception 'Esa entrega ya no existe'; end if;
end $function$;

create or replace function public.recoleccion_resumen(p_desde date, p_hasta date, p_recolector uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_admin boolean := public.tiene_rol('admin');
  v_rec uuid;
  v_ini date := greatest(p_desde - 21, date '2026-11-11');
begin
  if v_admin then v_rec := p_recolector;
  elsif public.tiene_rol('recolector') then v_rec := auth.uid();
  else raise exception 'Sin permiso'; end if;
  if p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'Rango de fechas inválido (máximo 400 días)'; end if;
  return jsonb_build_object(
    'base', (select coalesce(sum(monto), 0) from recoleccion_bases where estado = 'aceptada'
             and (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'compras', (select coalesce(sum(valor), 0) from recoleccion_compras
             where (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'entregado', (select coalesce(sum(valor), 0) from recoleccion_entregas
             where (v_rec is null or recolector_id = v_rec) and dia between p_desde and p_hasta),
    'saldo', case when v_rec is not null then public.recoleccion_pendiente(v_rec, p_desde, p_hasta) end,
    'n_compras', (select count(*) from recoleccion_compras where (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'n_bases', (select count(*) from recoleccion_bases where estado = 'aceptada' and (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'pendientes', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'monto', b.monto, 'nombre', b.nombre, 'de', b.creada_por_nombre,
                     'recolector', u.nombre, 'fecha', b.created_at) order by b.created_at), '[]')
                   from recoleccion_bases b join profiles u on u.id = b.recolector_id
                   where b.estado = 'pendiente' and (v_rec is null or b.recolector_id = v_rec)),
    'movimientos', (select coalesce(jsonb_agg(m order by m.fecha desc), '[]') from (
        select 'base' tipo, b.id, b.created_at fecha, b.monto valor, b.nombre, b.estado, b.creada_por_nombre quien, u.nombre recolector,
               null::text proveedor, null::text producto, null::text[] facturas, null::date dia
        from recoleccion_bases b join profiles u on u.id = b.recolector_id
        where (v_rec is null or b.recolector_id = v_rec) and b.created_at >= d and b.created_at < h
        union all
        select 'compra', c.id, c.created_at, c.valor, null, null, c.creada_por_nombre, u.nombre, c.proveedor, c.producto, c.facturas, null
        from recoleccion_compras c join profiles u on u.id = c.recolector_id
        where (v_rec is null or c.recolector_id = v_rec) and c.created_at >= d and c.created_at < h
        union all
        select 'entrega', e.id, e.created_at, e.valor, e.nota, null, e.recibida_por_nombre, u.nombre, null, null, null, e.dia
        from recoleccion_entregas e join profiles u on u.id = e.recolector_id
        where (v_rec is null or e.recolector_id = v_rec) and e.dia between p_desde and p_hasta
        order by 3 desc limit 500) m),
    'recolectores', case when v_admin then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre), '[]')
                      from profiles where coalesce(activo, true) and 'recolector' = any(roles)) else '[]'::jsonb end,
    -- Una tarjeta por recolector con lo de estos días
    'por_recolector', case when v_admin and v_rec is null then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nombre', u.nombre,
        'base', (select coalesce(sum(monto), 0) from recoleccion_bases where recolector_id = u.id and estado = 'aceptada' and created_at >= d and created_at < h),
        'compras', (select coalesce(sum(valor), 0) from recoleccion_compras where recolector_id = u.id and created_at >= d and created_at < h),
        'entregado', (select coalesce(sum(valor), 0) from recoleccion_entregas where recolector_id = u.id and dia between p_desde and p_hasta),
        'pendientes', (select count(*) from recoleccion_bases where recolector_id = u.id and estado = 'pendiente'),
        'saldo', public.recoleccion_pendiente(u.id, p_desde, p_hasta)) order by u.nombre), '[]')
      from profiles u where coalesce(u.activo, true) and 'recolector' = any(u.roles)) else '[]'::jsonb end,
    -- Días anteriores (últimas 3 semanas) que quedaron sin entregar, para no perderlos de vista
    'dias_sin_entregar', (select coalesce(jsonb_agg(x order by x.dia desc, x.nombre), '[]') from (
        select u.id, u.nombre, dd.dia, public.recoleccion_pendiente(u.id, dd.dia, dd.dia) falta
        from profiles u
        cross join lateral (
          select (created_at at time zone 'America/Bogota')::date dia from recoleccion_bases where recolector_id = u.id and estado = 'aceptada' and created_at >= (v_ini::text || ' 00:00 America/Bogota')::timestamptz and created_at < d
          union select (created_at at time zone 'America/Bogota')::date from recoleccion_compras where recolector_id = u.id and created_at >= (v_ini::text || ' 00:00 America/Bogota')::timestamptz and created_at < d
        ) dd
        where 'recolector' = any(u.roles) and (v_rec is null or u.id = v_rec)
      ) x where x.falta > 0)
  );
end $function$;

revoke all on function public.recolector_productos(), public.recoleccion_compra(numeric, text, text, text[], uuid, integer, numeric),
  public.recoleccion_borrar_compra(bigint), public.recoleccion_recibir(uuid, numeric, text, date), public.recoleccion_borrar_entrega(bigint) from public, anon;
grant execute on function public.recolector_productos(), public.recoleccion_compra(numeric, text, text, text[], uuid, integer, numeric),
  public.recoleccion_borrar_compra(bigint), public.recoleccion_recibir(uuid, numeric, text, date), public.recoleccion_borrar_entrega(bigint) to authenticated;

-- ============================================================ 16. Propinas por transferencia: lo que entrega el domiciliario
-- El "total a entregar" del cuadre también descuenta las propinas por transferencia (esa plata
-- quedó en la cuenta del negocio y es del domiciliario). Es una columna calculada, por eso hay
-- que borrarla y crearla otra vez (no se pierde nada: se recalcula sola).
alter table public.cuadres drop column if exists total_a_entregar;
alter table public.cuadres add column total_a_entregar numeric generated always as (total_efectivo - total_domicilios - total_propinas) stored;
