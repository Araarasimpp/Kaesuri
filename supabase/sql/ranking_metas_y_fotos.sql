-- ============================================================================
--  Kaesuri · Ranking con metas y fotos de perfil (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  · profiles.avatar_url y bucket público "avatars": cada uno sube su foto a su carpeta.
--  · metas: meta de ventas / entregas del mes y de la semana por persona (solo el admin).
--  · ranking(desde, hasta, periodo): vendedores por ventas entregadas y domiciliarios por
--    entregas, con su puesto y el avance hacia la meta. Los pesos solo los ve el admin.
--    (tipo 'vendedora' / 'mensajero' son las mismas claves que en Jasta.)
-- ============================================================================

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "avatars: subir propia" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: cambiar propia" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: ver propias" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table if not exists public.metas (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  meta_ventas integer check (meta_ventas is null or meta_ventas >= 0),
  meta_entregas integer check (meta_entregas is null or meta_entregas >= 0),
  meta_ventas_semana integer check (meta_ventas_semana is null or meta_ventas_semana >= 0),
  meta_entregas_semana integer check (meta_entregas_semana is null or meta_entregas_semana >= 0),
  updated_at timestamptz not null default now()
);
alter table public.metas enable row level security;
create policy "metas: ver" on public.metas for select to authenticated using (true);
create policy "metas: admin crea" on public.metas for insert to authenticated with check ((select public.tiene_rol('admin')));
create policy "metas: admin cambia" on public.metas for update to authenticated
  using ((select public.tiene_rol('admin'))) with check ((select public.tiene_rol('admin')));

create or replace function public.ranking(p_desde date, p_hasta date, p_periodo text)
returns table(usuario_id uuid, nombre text, avatar_url text, tipo text, cantidad integer, ventas numeric, meta integer, puesto integer, avance integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with yo as (select public.tiene_rol('admin') as ve_pesos),
  ent as (
    select * from pedidos
     where estado = 'entregado'
       and coalesce(entregado_at, created_at) >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz
       and coalesce(entregado_at, created_at) < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz
  ),
  v as (select vendedor_id id, count(*)::int n, sum(total - valor_domicilio) pesos from ent group by 1),
  m as (select domiciliario_id id, count(*)::int n from ent where domiciliario_id is not null group by 1),
  filas as (
    select u.id, u.nombre, u.avatar_url, 'vendedora'::text tipo, coalesce(v.n, 0) n, coalesce(v.pesos, 0) pesos,
           case when p_periodo = 'semana' then mt.meta_ventas_semana else mt.meta_ventas end meta
      from profiles u left join v on v.id = u.id left join metas mt on mt.usuario_id = u.id
     where (coalesce(u.activo, true) and 'vendedor' = any (u.roles)) or v.id is not null
    union all
    select u.id, u.nombre, u.avatar_url, 'mensajero', coalesce(m.n, 0), 0,
           case when p_periodo = 'semana' then mt.meta_entregas_semana else mt.meta_entregas end
      from profiles u left join m on m.id = u.id left join metas mt on mt.usuario_id = u.id
     where (coalesce(u.activo, true) and 'domiciliario' = any (u.roles)) or m.id is not null
  )
  select f.id, f.nombre, f.avatar_url, f.tipo, f.n, case when yo.ve_pesos then f.pesos end, f.meta,
         (row_number() over (partition by f.tipo order by f.n desc, f.pesos desc, f.nombre))::int,
         case when f.meta > 0 then least(100, round(f.n::numeric / f.meta * 100))::int end
    from filas f, yo
   where auth.uid() is not null
$function$;
revoke execute on function public.ranking(date, date, text) from public, anon;
grant execute on function public.ranking(date, date, text) to authenticated;
