-- ============================================================================
--  Kaesuri · Rol "recolector" (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Recibe bases de dinero y registra compras durante el día.
--  · Base: el admin la envía (queda pendiente hasta que el recolector la acepta)
--    o el recolector la agrega él mismo (queda aceptada y se les avisa a los admin).
--    Siempre lleva nombre (de dónde viene). Varias al día: se van sumando.
--  · Compra: valor, proveedor, producto y foto de la factura (obligatoria,
--    bucket privado "comprobantes", en la carpeta del recolector).
--  · Cuadre = bases aceptadas − compras.
--  Solo lo ven el recolector (lo suyo) y el admin (todo).
-- ============================================================================

-- 1) El rol (va solo: un valor nuevo de enum se usa después de confirmarse)
alter type public.user_role add value if not exists 'recolector';

-- 2) Lo demás
create or replace function public.rol_principal(p_roles user_role[])
returns user_role
language sql
immutable
set search_path to 'public'
as $function$
  select r from unnest(array['admin', 'despachador', 'vendedor', 'domiciliario', 'venta_local', 'recolector']::public.user_role[]) with ordinality as o(r, i)
   where r = any (p_roles) order by i limit 1;
$function$;

create table if not exists public.recoleccion_bases (
  id bigint generated always as identity primary key,
  recolector_id uuid not null references public.profiles(id),
  monto numeric not null check (monto > 0 and monto <= 100000000),
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  creada_por uuid references public.profiles(id),
  creada_por_nombre text,
  respondida_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists recoleccion_bases_rec_idx on public.recoleccion_bases (recolector_id, created_at desc);

create table if not exists public.recoleccion_compras (
  id bigint generated always as identity primary key,
  recolector_id uuid not null references public.profiles(id),
  valor numeric not null check (valor > 0 and valor <= 100000000),
  proveedor text not null check (length(trim(proveedor)) between 1 and 120),
  producto text not null check (length(trim(producto)) between 1 and 200),
  facturas text[] not null default '{}',
  creada_por_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists recoleccion_compras_rec_idx on public.recoleccion_compras (recolector_id, created_at desc);

alter table public.recoleccion_bases enable row level security;
alter table public.recoleccion_compras enable row level security;
create policy "recoleccion_bases: ver" on public.recoleccion_bases for select to authenticated
  using ((select public.tiene_rol('admin')) or recolector_id = (select auth.uid()));
create policy "recoleccion_compras: ver" on public.recoleccion_compras for select to authenticated
  using ((select public.tiene_rol('admin')) or recolector_id = (select auth.uid()));
alter publication supabase_realtime add table public.recoleccion_bases, public.recoleccion_compras;

-- El recolector sube y ve las fotos de sus facturas, en su carpeta del bucket de comprobantes
create policy "comprobantes: recolector sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.tiene_rol('recolector')));
create policy "comprobantes: recolector ve las suyas" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.tiene_rol('recolector')));

-- ---------- Agregar base ----------
-- Admin: se la envía a un recolector (pendiente, le llega el aviso). Recolector: la suya, aceptada.
create or replace function public.recoleccion_agregar_base(p_monto numeric, p_nombre text, p_recolector uuid default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := auth.uid();
  v_rec uuid; v_id bigint;
  v_yo_nombre text := (select nombre from profiles where id = auth.uid());
begin
  if coalesce(p_monto, 0) <= 0 then raise exception 'Escribe el valor de la base'; end if;
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Ponle nombre a la base (de dónde viene)'; end if;
  if public.tiene_rol('recolector') and (p_recolector is null or p_recolector = v_yo) then
    v_rec := v_yo;
  elsif public.tiene_rol('admin') then
    v_rec := p_recolector;
    if v_rec is null or not exists (select 1 from profiles where id = v_rec and coalesce(activo, true) and 'recolector' = any (roles)) then
      raise exception 'Elige a qué recolector va la base';
    end if;
  else
    raise exception 'Sin permiso';
  end if;
  insert into recoleccion_bases (recolector_id, monto, nombre, estado, creada_por, creada_por_nombre, respondida_at)
  values (v_rec, p_monto, left(trim(p_nombre), 120), case when v_rec = v_yo then 'aceptada' else 'pendiente' end,
          v_yo, v_yo_nombre, case when v_rec = v_yo then now() end)
  returning id into v_id;
  if v_rec <> v_yo then
    perform public.notificar(v_rec, 'base_recolector', 'Te enviaron una base: ' || public.fmt_pesos(p_monto),
      left(trim(p_nombre), 120) || ' · de ' || coalesce(v_yo_nombre, 'admin') || '. Acéptala para sumarla.', 'recolector');
  else
    perform public.notificar_roles(array['admin']::user_role[], 'base_recolector',
      coalesce(v_yo_nombre, 'El recolector') || ' agregó una base: ' || public.fmt_pesos(p_monto), left(trim(p_nombre), 120), 'recolector');
  end if;
  return v_id;
end;
$function$;

-- ---------- Aceptar o rechazar una base enviada ----------
create or replace function public.recoleccion_responder_base(p_base bigint, p_aceptar boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare b recoleccion_bases; v_yo uuid := auth.uid();
begin
  select * into b from recoleccion_bases where id = p_base for update;
  if not found then raise exception 'Base no encontrada'; end if;
  if b.recolector_id <> v_yo then raise exception 'Esta base no es tuya'; end if;
  if b.estado <> 'pendiente' then raise exception 'Esta base ya fue %', b.estado; end if;
  update recoleccion_bases set estado = case when p_aceptar then 'aceptada' else 'rechazada' end, respondida_at = now() where id = p_base;
  perform public.notificar(b.creada_por, 'base_recolector',
    coalesce((select nombre from profiles where id = v_yo), 'El recolector')
      || case when p_aceptar then ' aceptó la base de ' else ' rechazó la base de ' end || public.fmt_pesos(b.monto),
    b.nombre, 'recolector');
end;
$function$;

-- ---------- Registrar compra ----------
create or replace function public.recoleccion_registrar_compra(p_valor numeric, p_proveedor text, p_producto text, p_facturas text[])
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_yo uuid := auth.uid(); v_ev text[]; v_id bigint;
begin
  if not public.tiene_rol('recolector') then raise exception 'Solo el recolector registra compras'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Escribe el valor de la compra'; end if;
  if coalesce(trim(p_proveedor), '') = '' then raise exception 'Escribe el proveedor'; end if;
  if coalesce(trim(p_producto), '') = '' then raise exception 'Escribe qué compraste'; end if;
  -- Solo fotos de su propia carpeta del bucket
  select coalesce(array_agg(f), '{}') into v_ev
    from unnest(coalesce(p_facturas, '{}')) f
   where f like v_yo::text || '/%' and f not like '%..%' and length(f) < 300;
  if cardinality(v_ev) = 0 then raise exception 'Sube la foto de la factura'; end if;
  insert into recoleccion_compras (recolector_id, valor, proveedor, producto, facturas, creada_por_nombre)
  values (v_yo, p_valor, left(trim(p_proveedor), 120), left(trim(p_producto), 200), v_ev[1:10],
          (select nombre from profiles where id = v_yo))
  returning id into v_id;
  return v_id;
end;
$function$;

-- ---------- Resumen ----------
create or replace function public.recoleccion_resumen(p_desde date, p_hasta date, p_recolector uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_admin boolean := public.tiene_rol('admin');
  v_rec uuid;
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
    'n_compras', (select count(*) from recoleccion_compras where (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'n_bases', (select count(*) from recoleccion_bases where estado = 'aceptada' and (v_rec is null or recolector_id = v_rec) and created_at >= d and created_at < h),
    'pendientes', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'monto', b.monto, 'nombre', b.nombre, 'de', b.creada_por_nombre,
                     'recolector', u.nombre, 'fecha', b.created_at) order by b.created_at), '[]')
                   from recoleccion_bases b join profiles u on u.id = b.recolector_id
                   where b.estado = 'pendiente' and (v_rec is null or b.recolector_id = v_rec)),
    'movimientos', (select coalesce(jsonb_agg(m order by m.fecha desc), '[]') from (
        select 'base' tipo, b.id, b.created_at fecha, b.monto valor, b.nombre, b.estado, b.creada_por_nombre quien, u.nombre recolector,
               null::text proveedor, null::text producto, null::text[] facturas
        from recoleccion_bases b join profiles u on u.id = b.recolector_id
        where (v_rec is null or b.recolector_id = v_rec) and b.created_at >= d and b.created_at < h
        union all
        select 'compra', c.id, c.created_at, c.valor, null, null, c.creada_por_nombre, u.nombre, c.proveedor, c.producto, c.facturas
        from recoleccion_compras c join profiles u on u.id = c.recolector_id
        where (v_rec is null or c.recolector_id = v_rec) and c.created_at >= d and c.created_at < h
        order by 3 desc limit 500) m),
    'recolectores', case when v_admin then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre), '[]')
                      from profiles where coalesce(activo, true) and 'recolector' = any (roles)) else '[]'::jsonb end
  );
end;
$function$;

revoke all on function public.recoleccion_agregar_base(numeric, text, uuid) from public, anon;
revoke all on function public.recoleccion_responder_base(bigint, boolean) from public, anon;
revoke all on function public.recoleccion_registrar_compra(numeric, text, text, text[]) from public, anon;
revoke all on function public.recoleccion_resumen(date, date, uuid) from public, anon;
grant execute on function public.recoleccion_agregar_base(numeric, text, uuid) to authenticated;
grant execute on function public.recoleccion_responder_base(bigint, boolean) to authenticated;
grant execute on function public.recoleccion_registrar_compra(numeric, text, text, text[]) to authenticated;
grant execute on function public.recoleccion_resumen(date, date, uuid) to authenticated;
