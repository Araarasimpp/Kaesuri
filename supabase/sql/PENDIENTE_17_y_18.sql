-- ============================================================================
--  Kaesuri · SOLO las secciones 17 y 18 (copia de PENDIENTE_correr_en_supabase.sql).
--  Córrelo completo en Supabase → SQL Editor. Las secciones 1 a 16 ya están aplicadas:
--  no vuelvas a correr el archivo grande, porque falla en lo que ya existe y deshace todo.
-- ============================================================================
-- ============================================================ 17. Cuentas de clientes de la tienda (registro y seguridad)
-- Antes de prender "Mi cuenta" en la tienda. Las tablas y funciones ya están aplicadas (clientes_cuentas.sql).
-- a) Un cliente que se registra desde la tienda (o con Google) NO queda como vendedor: queda solo como
--    cuenta de cliente, sin ningún permiso de adentro. El registro del equipo sigue igual que hoy.
-- b) Las lecturas que hoy cualquiera con sesión puede hacer (perfiles del equipo, productos con costo,
--    configuración, barrios, metas, colores, conexiones) quedan solo para el equipo. La tienda no se
--    afecta: lee todo por sus funciones.
-- c) Los pedidos de la tienda hechos con la cuenta iniciada quedan unidos a esa cuenta (Mis compras).
create or replace function public.es_equipo()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid() and coalesce(activo, true))
$$;
grant execute on function public.es_equipo() to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_foto text := coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture');
begin
  -- Registro desde la tienda (o con Google): cuenta de cliente, sin ningún permiso de adentro
  if coalesce(new.raw_user_meta_data->>'tipo', '') = 'cliente' or coalesce(new.raw_app_meta_data->>'provider', 'email') not in ('email', 'phone') then
    insert into public.clientes_cuentas (auth_id, nombre, email, prefijo, telefono, avatar_url)
    values (new.id,
      left(trim(coalesce(new.raw_user_meta_data->>'nombre', new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), 80),
      lower(new.email),
      coalesce(nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'prefijo', ''), '\D', '', 'g'), ''), '57'),
      nullif(left(regexp_replace(coalesce(new.raw_user_meta_data->>'telefono', ''), '\D', '', 'g'), 14), ''),
      case when v_foto like 'https://%' then left(v_foto, 500) end)
    on conflict (auth_id) do nothing;
    return new;
  end if;
  -- Equipo (como siempre)
  insert into public.profiles (id, nombre, email, telefono, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', new.email), new.email, new.raw_user_meta_data->>'telefono', 'vendedor');
  return new;
end $function$;

create or replace function public.pedido_web_cliente_cuenta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.cliente_cuenta_id is null and auth.uid() is not null then
    new.cliente_cuenta_id := (select id from clientes_cuentas where auth_id = auth.uid());
  end if;
  return new;
end $$;
create or replace trigger pedido_web_cliente_cuenta before insert on public.pedidos_web for each row execute function public.pedido_web_cliente_cuenta();

create or replace function public.pedido_web_confirmado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.pedido_id is not null and new.cliente_cuenta_id is not null and new.pedido_id is distinct from old.pedido_id then
    update pedidos set cliente_cuenta_id = new.cliente_cuenta_id where id = new.pedido_id and cliente_cuenta_id is null;
  end if;
  return null;
end $$;
create or replace trigger pedido_web_confirmado after update of pedido_id on public.pedidos_web for each row execute function public.pedido_web_confirmado();
revoke all on function public.pedido_web_cliente_cuenta(), public.pedido_web_confirmado() from public, anon, authenticated;

alter policy "profiles: select autenticados" on public.profiles using ((select public.es_equipo()));
alter policy "productos: select autenticados" on public.productos using ((select public.es_equipo()));
alter policy "configuracion: select autenticados" on public.configuracion using ((select public.es_equipo()));
alter policy "zonas: select autenticados" on public.zonas_domicilio using ((select public.es_equipo()));
alter policy "conexiones: ver" on public.conexiones using ((select public.es_equipo()));
alter policy "metas: ver" on public.metas using ((select public.es_equipo()));
alter policy "producto_colores_ver" on public.producto_colores using ((select public.es_equipo()));
-- Después de correr esta sección, avísale a Claude para prender "Mi cuenta" en la tienda.

-- ============================================================ 18. Chat del pedido como WhatsApp: fotos y notas de voz
-- Bucket privado "chat" (una carpeta por pedido) con permisos solo para quien participa en el pedido,
-- y la regla del texto: una foto o una nota de voz pueden ir sin texto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 10485760,
  array['image/jpeg','image/png','image/webp','audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/aac','audio/x-m4a'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'chat_subir') then
    create policy chat_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'chat' and (select public.chat_carpeta_ok(name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'chat_ver') then
    create policy chat_ver on storage.objects for select to authenticated
      using (bucket_id = 'chat' and (select public.chat_carpeta_ok(name)));
  end if;
end $$;
alter table public.pedido_mensajes drop constraint if exists pedido_mensajes_texto_check;
alter table public.pedido_mensajes add constraint pedido_mensajes_texto_check check (length(texto) <= 1000
  and (length(trim(texto)) >= 1 or (tipo in ('foto', 'audio') and adjunto is not null)));
