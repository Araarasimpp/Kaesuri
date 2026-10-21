-- ============================================================================
--  Kaesuri · Chat: entregado y leído (como WhatsApp) + "visto por última vez"
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  · pedido_chat_lecturas: hasta cuándo le llegaron (entregado_at) y hasta
--    cuándo leyó (leido_at) cada persona los mensajes de un pedido.
--    Un mensaje está entregado / leído si alguien distinto del autor tiene
--    esa marca en o después de la hora del mensaje.
--  · conexiones: la última vez que cada persona tuvo la app abierta (para
--    "Desconectado · visto hace…"). El estado en vivo (activo / ausente) va
--    por Realtime Presence, no se guarda.
-- ============================================================================

create table if not exists public.pedido_chat_lecturas (
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  usuario_nombre text,
  entregado_at timestamptz,
  leido_at timestamptz,
  primary key (pedido_id, usuario_id)
);
alter table public.pedido_chat_lecturas enable row level security;
create policy "pedido_chat_lecturas: ver si participa" on public.pedido_chat_lecturas for select to authenticated
  using ((select public.participa_en_pedido(pedido_id)));
alter publication supabase_realtime add table public.pedido_chat_lecturas;

-- Marca entregado (y leído si p_leido) los mensajes de un pedido.
-- Solo escribe si hay un mensaje de otro más nuevo que la marca (así no se
-- reescribe la fila en cada recarga del chat).
create or replace function public.chat_marcar(p_pedido uuid, p_leido boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := auth.uid();
  v_ultimo timestamptz;
begin
  if v_yo is null or not public.participa_en_pedido(p_pedido) then return; end if;
  select max(created_at) into v_ultimo from pedido_mensajes where pedido_id = p_pedido and autor_id is distinct from v_yo;
  if v_ultimo is null then return; end if;
  insert into pedido_chat_lecturas as l (pedido_id, usuario_id, usuario_nombre, entregado_at, leido_at)
  values (p_pedido, v_yo, (select nombre from profiles where id = v_yo), now(), case when p_leido then now() end)
  on conflict (pedido_id, usuario_id) do update
     set entregado_at = case when l.entregado_at is null or l.entregado_at < v_ultimo then now() else l.entregado_at end,
         leido_at = case when p_leido and (l.leido_at is null or l.leido_at < v_ultimo) then now() else l.leido_at end,
         usuario_nombre = excluded.usuario_nombre
   where l.entregado_at is null or l.entregado_at < v_ultimo
      or (p_leido and (l.leido_at is null or l.leido_at < v_ultimo));
end;
$function$;

-- Los avisos de mensaje que le llegan a la app marcan esos chats como entregados
create or replace function public.chat_marcar_entregados(p_pedidos uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_p uuid;
begin
  foreach v_p in array coalesce(p_pedidos[1:50], '{}') loop
    perform public.chat_marcar(v_p, false);
  end loop;
end;
$function$;

create table if not exists public.conexiones (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  visto_at timestamptz not null default now()
);
alter table public.conexiones enable row level security;
create policy "conexiones: ver" on public.conexiones for select to authenticated using (true);

create or replace function public.marcar_conexion()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into conexiones (usuario_id, visto_at) select auth.uid(), now() where auth.uid() is not null
  on conflict (usuario_id) do update set visto_at = now();
$function$;

revoke all on function public.chat_marcar(uuid, boolean) from public, anon;
revoke all on function public.chat_marcar_entregados(uuid[]) from public, anon;
revoke all on function public.marcar_conexion() from public, anon;
grant execute on function public.chat_marcar(uuid, boolean) to authenticated;
grant execute on function public.chat_marcar_entregados(uuid[]) to authenticated;
grant execute on function public.marcar_conexion() to authenticated;
