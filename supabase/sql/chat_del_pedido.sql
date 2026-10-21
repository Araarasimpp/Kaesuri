-- ============================================================================
--  Kaesuri · Chat del pedido (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Conversación de cada pedido entre el vendedor, el domiciliario y la oficina
--  (admin y despachador). Se escribe con enviar_mensaje(); cada mensaje avisa a los
--  demás (campana y aviso en el celular) con un enlace 'chat:<pedido>' que abre el chat.
--  notificaciones.pedido_id deja saber qué pedidos tienen mensajes sin leer ("!").
-- ============================================================================

create table if not exists public.pedido_mensajes (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  autor_id uuid references public.profiles(id) on delete set null,
  autor_nombre text not null,
  texto text not null check (length(trim(texto)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists pedido_mensajes_pedido_idx on public.pedido_mensajes (pedido_id, created_at);
alter table public.pedido_mensajes enable row level security;
revoke all on public.pedido_mensajes from anon, authenticated;
grant select on public.pedido_mensajes to authenticated;

alter table public.notificaciones add column if not exists pedido_id uuid references public.pedidos(id) on delete cascade;
create index if not exists notificaciones_pedido_idx on public.notificaciones (pedido_id) where pedido_id is not null;

-- Ven y escriben la conversación: la oficina, el vendedor y el domiciliario del pedido
create or replace function public.participa_en_pedido(p_pedido uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.tiene_rol('admin', 'despachador') or exists (
    select 1 from public.pedidos p
     where p.id = p_pedido and (p.vendedor_id = auth.uid() or p.domiciliario_id = auth.uid()));
$function$;
revoke all on function public.participa_en_pedido(uuid) from public, anon;
grant execute on function public.participa_en_pedido(uuid) to authenticated;

create policy "pedido_mensajes: ver si participa" on public.pedido_mensajes for select to authenticated
  using ((select public.participa_en_pedido(pedido_id)));

create or replace function public.enviar_mensaje(p_pedido uuid, p_texto text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := auth.uid();
  v_nombre text;
  p public.pedidos;
  v_id bigint;
  v_texto text := left(trim(coalesce(p_texto, '')), 1000);
begin
  if v_yo is null then raise exception 'Inicia sesión para escribir'; end if;
  if not public.participa_en_pedido(p_pedido) then raise exception 'No participas en este pedido'; end if;
  if v_texto = '' then raise exception 'Escribe un mensaje'; end if;
  select * into p from public.pedidos where id = p_pedido;
  select nombre into v_nombre from public.profiles where id = v_yo;

  insert into public.pedido_mensajes (pedido_id, autor_id, autor_nombre, texto)
  values (p_pedido, v_yo, coalesce(v_nombre, 'Alguien'), v_texto)
  returning id into v_id;

  -- Le llega al vendedor y al domiciliario; mientras no sale a ruta, también a la oficina
  insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, enlace, pedido_id)
  select distinct u, 'mensaje', coalesce(v_nombre, 'Mensaje') || ' · pedido #' || p.numero, left(v_texto, 140), 'chat:' || p.id, p.id
    from unnest(array[p.vendedor_id, p.domiciliario_id] ||
                case when p.estado = 'pendiente'
                     then array(select id from public.profiles
                                 where roles && array['admin', 'despachador']::public.user_role[] and coalesce(activo, true))
                     else '{}'::uuid[] end) as u
   where u is not null and u <> v_yo;
  return v_id;
end;
$function$;
revoke all on function public.enviar_mensaje(uuid, text) from public, anon;
grant execute on function public.enviar_mensaje(uuid, text) to authenticated;

alter publication supabase_realtime add table public.pedido_mensajes;
