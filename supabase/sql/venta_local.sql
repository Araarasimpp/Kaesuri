-- ============================================================================
--  Kaesuri · Venta en el local (como en Jasta, sin alcancía)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  · Rol "venta_local": quien registra las ventas del punto físico.
--  · registrar_venta_local(): la venta queda entregada y cobrada de una vez
--    (canal = 'local', sin domicilio). Se elige a qué vendedor se le suma: la
--    comisión (precio de venta − precio base) queda a su nombre y le llega el aviso.
--    Sin vendedor, queda a nombre de quien la registra y sin comisión.
--  · Quien tiene el rol ve las ventas del local y la página de Clientes.
-- ============================================================================

-- 1) El rol (va solo: un valor nuevo de enum se usa después de confirmarse)
alter type public.user_role add value if not exists 'venta_local';

-- 2) Lo demás
create or replace function public.rol_principal(p_roles user_role[])
returns user_role
language sql
immutable
set search_path to 'public'
as $function$
  select r from unnest(array['admin', 'despachador', 'vendedor', 'domiciliario', 'venta_local']::public.user_role[]) with ordinality as o(r, i)
   where r = any (p_roles) order by i limit 1;
$function$;

alter table public.pedidos add column if not exists canal text not null default 'domicilio';
alter table public.pedidos add column if not exists registrado_por uuid references public.profiles(id);
do $$ begin
  alter table public.pedidos add constraint pedidos_canal_check check (canal in ('domicilio', 'local'));
exception when duplicate_object then null; end $$;
create index if not exists pedidos_local_idx on public.pedidos (created_at desc) where canal = 'local';

create or replace function public.registrar_venta_local(
  p_cliente_nombre text, p_cliente_telefono text, p_observaciones text, p_items jsonb,
  p_metodo text, p_efectivo numeric default null, p_vendedor uuid default null)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := auth.uid();
  v_admin boolean := public.tiene_rol('admin');
  v_id uuid; v_numero bigint;
  v_sub numeric := 0; v_com numeric := 0;
  it jsonb; pr record; v_precio numeric; v_cant int;
  v_vend uuid := v_yo;
begin
  if v_yo is null or not public.tiene_rol('admin', 'venta_local') then
    raise exception 'Solo el rol Venta local registra ventas en el local';
  end if;
  if p_metodo not in ('efectivo', 'transferencia', 'mixto') then raise exception 'Forma de pago inválida'; end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'La venta no tiene productos'; end if;
  if p_vendedor is not null then
    if not exists (select 1 from profiles where id = p_vendedor and coalesce(activo, true) and 'vendedor' = any (roles)) then
      raise exception 'Ese vendedor no existe o está inactivo';
    end if;
    v_vend := p_vendedor;
  end if;

  -- Totales con los precios base de la base (no los que mande el celular)
  for it in select * from jsonb_array_elements(p_items) loop
    select id, nombre, precio_base into pr from productos where id = (it->>'producto_id')::uuid and coalesce(activo, true);
    if not found then raise exception 'Producto no disponible'; end if;
    v_cant := (it->>'cantidad')::int;
    if v_cant is null or v_cant < 1 then raise exception 'Cantidad inválida'; end if;
    v_precio := (it->>'precio_unitario')::numeric;
    if v_precio is null or v_precio < 0 then raise exception 'Precio inválido para %', pr.nombre; end if;
    if v_precio < coalesce(pr.precio_base, 0) and not v_admin then
      raise exception 'El precio de % no puede ser menor al precio base (%)', pr.nombre, public.fmt_pesos(pr.precio_base);
    end if;
    v_sub := v_sub + v_precio * v_cant;
    v_com := v_com + (v_precio - coalesce(pr.precio_base, 0)) * v_cant;
  end loop;
  if p_vendedor is null then v_com := 0; end if;

  if p_metodo = 'mixto' and (p_efectivo is null or p_efectivo <= 0 or p_efectivo >= v_sub) then
    raise exception 'En el pago mixto, el efectivo debe ser mayor que 0 y menor que el total (%)', public.fmt_pesos(v_sub);
  end if;

  insert into pedidos (vendedor_id, registrado_por, canal, estado, cliente_nombre, cliente_telefono, direccion, observaciones,
                       valor_domicilio, total, comision, metodo_pago, monto_efectivo, entregado_at)
  values (v_vend, v_yo, 'local', 'entregado', coalesce(nullif(trim(p_cliente_nombre), ''), 'Cliente del local'),
          nullif(trim(p_cliente_telefono), ''), 'Venta en el local', nullif(trim(p_observaciones), ''),
          0, v_sub, greatest(v_com, 0), p_metodo, case when p_metodo = 'mixto' then p_efectivo end, now())
  returning id, numero into v_id, v_numero;

  -- El inventario se descuenta solo (trigger descontar_stock de pedido_items)
  for it in select * from jsonb_array_elements(p_items) loop
    insert into pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_base, color, talla)
    select v_id, p.id, (it->>'cantidad')::int, (it->>'precio_unitario')::numeric, coalesce(p.precio_base, 0),
           nullif(left(trim(it->>'color'), 40), ''), nullif(left(trim(it->>'talla'), 40), '')
      from productos p where p.id = (it->>'producto_id')::uuid;
  end loop;
  return v_numero;
end;
$function$;
revoke all on function public.registrar_venta_local(text, text, text, jsonb, text, numeric, uuid) from public, anon;
grant execute on function public.registrar_venta_local(text, text, text, jsonb, text, numeric, uuid) to authenticated;

-- Avisos: una venta del local no es un "pedido nuevo" para despacho; se le avisa al vendedor
create or replace function public.notif_pedidos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_vendedor text;
begin
  if tg_op = 'INSERT' then
    if new.canal = 'local' then
      if new.vendedor_id is distinct from new.registrado_por then
        perform public.notificar(new.vendedor_id, 'venta_local',
          'Venta en el local #' || new.numero || ' a tu nombre',
          new.cliente_nombre || ' · ' || public.fmt_pesos(new.total) || ' · tu comisión ' || public.fmt_pesos(new.comision), 'inicio');
      end if;
      return new;
    end if;
    select nombre into v_vendedor from public.profiles where id = new.vendedor_id;
    perform public.notificar_roles(array['admin','despachador']::user_role[], 'pedido_nuevo',
      'Nuevo pedido #' || new.numero,
      coalesce(v_vendedor, 'Alguien') || ' · ' || new.cliente_nombre || ' · ' || public.fmt_pesos(new.total), 'pedidos');
    return new;
  end if;

  if new.domiciliario_id is distinct from old.domiciliario_id and new.domiciliario_id is not null then
    perform public.notificar(new.domiciliario_id, 'pedido_asignado',
      'Te asignaron el pedido #' || new.numero,
      new.cliente_nombre || ' · ' || coalesce(new.barrio, new.direccion), 'inicio');
  end if;

  if new.estado = 'entregado' and old.estado is distinct from 'entregado' then
    perform public.notificar(new.vendedor_id, 'pedido_entregado',
      'Pedido #' || new.numero || ' entregado',
      new.cliente_nombre || ' ya recibió su pedido', 'pedidos');
  end if;

  if new.estado = 'cancelado' and old.estado is distinct from 'cancelado' then
    perform public.notificar(new.vendedor_id, 'pedido_cancelado',
      'Pedido #' || new.numero || ' cancelado', new.cliente_nombre, 'pedidos');
    perform public.notificar(new.domiciliario_id, 'pedido_cancelado',
      'Pedido #' || new.numero || ' cancelado', 'Ya no tienes que entregarlo', 'inicio');
  end if;
  return new;
end;
$function$;

-- Quien tiene el rol ve las ventas del local (y sus productos)
create policy "pedidos: venta local ve las del local" on public.pedidos for select to authenticated
  using (canal = 'local' and (select public.tiene_rol('venta_local')));
create policy "pedido_items: venta local ve las del local" on public.pedido_items for select to authenticated
  using ((select public.tiene_rol('venta_local')) and exists (select 1 from public.pedidos p where p.id = pedido_id and p.canal = 'local'));

-- Ranking: la venta del local sin vendedor (a nombre de quien la registró) no cuenta si esa persona no vende
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
  v as (select e.vendedor_id id, count(*)::int n, sum(e.total - e.valor_domicilio) pesos
          from ent e join profiles u on u.id = e.vendedor_id
         where e.canal <> 'local' or 'vendedor' = any (u.roles) group by 1),
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

-- Clientes también para el rol Venta local
create or replace function public.clientes(p_buscar text default null, p_limite integer default 50, p_desde integer default 0)
returns table(telefono text, nombre text, barrio text, direccion text, pedidos bigint, entregados bigint, total numeric, ultimo timestamptz, total_filas bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select regexp_replace(cliente_telefono, '\D', '', 'g') tel, cliente_nombre, barrio, direccion, total, created_at
      from pedidos where cliente_telefono is not null and estado = 'entregado' and public.tiene_rol('admin', 'venta_local')
  ), g as (
    select tel,
           (array_agg(cliente_nombre order by created_at desc))[1] nombre,
           (array_agg(barrio order by created_at desc))[1] barrio,
           (array_agg(direccion order by created_at desc))[1] direccion,
           count(*) pedidos, count(*) entregados,
           coalesce(sum(total), 0) total, max(created_at) ultimo
      from base where length(tel) >= 7 group by tel
  ), b as (select trim(coalesce(p_buscar, '')) t, regexp_replace(coalesce(p_buscar, ''), '\D', '', 'g') d),
  f as (
    select g.* from g, b
     where b.t = '' or g.nombre ilike '%' || b.t || '%' or g.barrio ilike '%' || b.t || '%' or (b.d <> '' and g.tel like '%' || b.d || '%')
  )
  select tel, nombre, barrio, direccion, pedidos, entregados, total, ultimo, count(*) over ()
    from f order by ultimo desc limit p_limite offset p_desde
$function$;

create or replace function public.compras_cliente(p_telefono text)
returns table(id uuid, numero bigint, created_at timestamptz, total numeric, vendedor text, productos text[])
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.numero, p.created_at, p.total, u.nombre,
         coalesce((select array_agg(coalesce(pr.nombre, 'Producto') order by i.id)
                     from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id), '{}')
    from pedidos p left join profiles u on u.id = p.vendedor_id
   where public.tiene_rol('admin', 'venta_local')
     and p.estado = 'entregado'
     and length(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) >= 7
     and regexp_replace(p.cliente_telefono, '\D', '', 'g') = regexp_replace(p_telefono, '\D', '', 'g')
   order by p.created_at desc
   limit 100
$function$;
