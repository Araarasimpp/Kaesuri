-- ============================================================================
--  Kaesuri · Varios roles por persona (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  1. profiles.roles: todos los roles de la persona (por ejemplo vendedor y
--     domiciliario). profiles.role queda como rol principal (el de más permisos),
--     lo calcula la base sola y lo siguen usando current_role() y las pantallas viejas.
--  2. tiene_rol(...): ¿la persona tiene alguno de estos roles? Reemplaza a
--     current_role() en las políticas RLS y en las funciones.
--  3. Avisos (notificar_roles, cuadres atrasados) y el puente con Jasta miran todos
--     los roles.
-- ============================================================================

-- ---------- 1. Columna y sincronización con el rol principal ----------
alter table public.profiles add column if not exists roles public.user_role[] not null default '{}';
update public.profiles set roles = array[role] where roles = '{}' and role is not null;

create or replace function public.rol_principal(p_roles public.user_role[])
returns public.user_role
language sql
immutable
set search_path to 'public'
as $function$
  select r from unnest(array['admin', 'despachador', 'vendedor', 'domiciliario']::public.user_role[]) with ordinality as o(r, i)
   where r = any (p_roles) order by i limit 1;
$function$;

-- roles es la fuente de verdad; si solo llega role (registro o versión anterior de la app), roles = [role]
create or replace function public.sincronizar_roles()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.roles is not distinct from old.roles and new.role is distinct from old.role then
    new.roles := array[new.role];
  end if;
  new.roles := array(select distinct unnest(coalesce(new.roles, '{}')));
  if cardinality(new.roles) = 0 then
    new.roles := array[coalesce(new.role, 'vendedor'::public.user_role)];
  end if;
  new.role := public.rol_principal(new.roles);
  return new;
end;
$function$;

create trigger trg_sincronizar_roles before insert or update on public.profiles
  for each row execute function public.sincronizar_roles();

-- ---------- 2. tiene_rol ----------
create or replace function public.tiene_rol(variadic p_roles public.user_role[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.profiles where id = auth.uid() and roles && p_roles);
$function$;

-- Políticas RLS
alter policy "auditoria: solo admin" on public.auditoria using (public.tiene_rol('admin'));
alter policy "configuracion: admin actualiza" on public.configuracion using (public.tiene_rol('admin'));
alter policy "cuadres: admin actualiza (confirmar)" on public.cuadres using (public.tiene_rol('admin', 'despachador'));
alter policy "cuadres: admin select todos" on public.cuadres using (public.tiene_rol('admin', 'despachador'));
alter policy "movimientos: admin insert" on public.movimientos_inventario with check (public.tiene_rol('admin'));
alter policy "movimientos: admin select" on public.movimientos_inventario using (public.tiene_rol('admin'));
alter policy "pedido_items: select segun pedido visible" on public.pedido_items using (
  exists (select 1 from public.pedidos p
           where p.id = pedido_items.pedido_id
             and (p.vendedor_id = auth.uid() or p.domiciliario_id = auth.uid() or public.tiene_rol('admin', 'despachador'))));
alter policy "pedidos: admin select todos" on public.pedidos using (public.tiene_rol('admin', 'despachador'));
alter policy "pedidos: admin update todo" on public.pedidos using (public.tiene_rol('admin', 'despachador'));
alter policy "pedidos: vendedor/admin insert" on public.pedidos
  with check (public.tiene_rol('vendedor', 'admin', 'despachador') and vendedor_id = auth.uid());
alter policy "productos: admin delete" on public.productos using (public.tiene_rol('admin'));
alter policy "productos: admin insert" on public.productos with check (public.tiene_rol('admin'));
alter policy "productos: admin update" on public.productos using (public.tiene_rol('admin'));
alter policy "profiles: admin actualiza todo" on public.profiles using (public.tiene_rol('admin'));
alter policy "zonas: admin delete" on public.zonas_domicilio using (public.tiene_rol('admin'));
alter policy "zonas: admin insert" on public.zonas_domicilio with check (public.tiene_rol('admin'));
alter policy "zonas: admin update" on public.zonas_domicilio using (public.tiene_rol('admin'));
alter policy "comprobantes: insert staff" on storage.objects
  with check (bucket_id = 'comprobantes' and public.tiene_rol('admin', 'domiciliario'));
alter policy "comprobantes: select staff" on storage.objects
  using (bucket_id = 'comprobantes' and public.tiene_rol('admin', 'domiciliario'));
alter policy "productos imagenes: admin delete" on storage.objects using (bucket_id = 'productos' and public.tiene_rol('admin'));
alter policy "productos imagenes: admin insert" on storage.objects with check (bucket_id = 'productos' and public.tiene_rol('admin'));
alter policy "productos imagenes: admin update" on storage.objects using (bucket_id = 'productos' and public.tiene_rol('admin'));

-- ---------- Funciones que revisaban un solo rol ----------
create or replace function public.cancelar_pedido(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_estado public.estado_pedido;
begin
  if not public.tiene_rol('admin', 'despachador') then
    raise exception 'No tienes permiso para cancelar pedidos';
  end if;

  select estado into v_estado from public.pedidos where id = p_pedido_id;

  if v_estado is null then
    raise exception 'El pedido no existe';
  end if;

  if v_estado = 'entregado' then
    raise exception 'No se puede cancelar un pedido ya entregado';
  end if;

  if v_estado = 'cancelado' then
    raise exception 'Este pedido ya está cancelado';
  end if;

  update public.productos prod
  set stock = prod.stock + pi.cantidad
  from public.pedido_items pi
  where pi.pedido_id = p_pedido_id
    and pi.producto_id = prod.id;

  update public.pedidos set estado = 'cancelado' where id = p_pedido_id;
end;
$function$;

-- eliminar_pedido sigue con current_role() in ('admin', 'despachador'): el rol principal es el
-- de más permisos, así que da lo mismo que tiene_rol('admin', 'despachador').

create or replace function public.ganancias_hoy()
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    sum(pi.cantidad * (pi.precio_base - coalesce(prod.costo, pi.precio_base))),
    0
  )
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.pedido_id
  join public.productos prod on prod.id = pi.producto_id
  where p.created_at >= date_trunc('day', now())
    and p.estado in ('en_ruta', 'entregado')
    and public.tiene_rol('admin');
$function$;

create or replace function public.ganancias_rango(p_desde date, p_hasta date)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    sum(pi.cantidad * (pi.precio_base - coalesce(prod.costo, pi.precio_base))),
    0
  )
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.pedido_id
  join public.productos prod on prod.id = pi.producto_id
  where p.created_at >= (p_desde::text || ' 00:00:00-05:00')::timestamptz
    and p.created_at <= (p_hasta::text || ' 23:59:59.999-05:00')::timestamptz
    and p.estado in ('en_ruta', 'entregado')
    and public.tiene_rol('admin');
$function$;

create or replace function public.notificar_roles(p_roles public.user_role[], p_tipo text, p_titulo text, p_mensaje text, p_enlace text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, enlace)
  select id, p_tipo, p_titulo, p_mensaje, p_enlace
    from public.profiles
   where roles && p_roles and coalesce(activo, true) and id is distinct from auth.uid();
end;
$function$;

create or replace function public.avisar_cuadres_atrasados()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record;
begin
  for r in
    select p.domiciliario_id, pr.nombre, count(*) n, min(p.entregado_at) desde
      from public.pedidos p join public.profiles pr on pr.id = p.domiciliario_id
     where p.estado = 'entregado' and p.cuadre_id is null
       and p.entregado_at < ((now() at time zone 'America/Bogota')::date::text || ' 00:00:00-05:00')::timestamptz
     group by p.domiciliario_id, pr.nombre
  loop
    insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, enlace)
    values (r.domiciliario_id, 'cuadre_atrasado', 'Tienes ' || r.n || ' pedido(s) sin cuadrar',
            'Entregados desde el ' || to_char(r.desde at time zone 'America/Bogota', 'DD/MM') || '. Cierra tu cuadre.', 'cuadres');
    insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, enlace)
    select id, 'cuadre_atrasado', r.nombre || ' tiene ' || r.n || ' pedido(s) sin cuadrar',
           'Entregados desde el ' || to_char(r.desde at time zone 'America/Bogota', 'DD/MM'), 'cuadres'
      from public.profiles
     where roles && array['admin', 'despachador']::public.user_role[] and coalesce(activo, true)
       and id <> r.domiciliario_id;
  end loop;
end;
$function$;

create or replace function public.cerrar_cuadre(p_fecha date default ((now() at time zone 'America/Bogota'))::date, p_domiciliario uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dom uuid := coalesce(p_domiciliario, auth.uid());
  v_propio boolean := v_dom is not distinct from auth.uid();
  v_oficina boolean := public.tiene_rol('admin', 'despachador');
  v_id uuid; v_ult uuid; r record;
begin
  if not public.tiene_rol('domiciliario', 'admin', 'despachador') then
    raise exception 'No tienes permiso para cerrar un cuadre';
  end if;
  if not v_propio and not v_oficina then
    raise exception 'Solo puedes cerrar tu propio cuadre';
  end if;

  for r in
    select distinct (entregado_at at time zone 'America/Bogota')::date as dia
      from public.pedidos
     where domiciliario_id = v_dom and estado = 'entregado' and cuadre_id is null
       and (entregado_at at time zone 'America/Bogota')::date <= p_fecha
       and (v_propio or (entregado_at at time zone 'America/Bogota')::date = p_fecha)
     order by 1
  loop
    v_id := public.cuadre_cerrar_interno(v_dom, r.dia, auth.uid());
    if v_id is not null then v_ult := v_id; end if;
  end loop;

  if v_ult is null then
    raise exception 'No hay pedidos entregados sin cuadrar';
  end if;
  return v_ult;
end;
$function$;

create or replace function public.pedido_alistamiento()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.alistado_at is distinct from old.alistado_at then
    if current_user in ('authenticated', 'anon') and not public.tiene_rol('admin', 'despachador') then
      raise exception 'Solo el admin o el despachador pueden alistar pedidos';
    end if;
    if new.alistado_at is not null then
      if old.estado <> 'pendiente' then
        raise exception 'Solo se pueden alistar pedidos pendientes';
      end if;
      -- Hora del servidor: el orden de alistamiento no depende del reloj de cada celular
      new.alistado_at := clock_timestamp();
      new.alistado_por := auth.uid();
    else
      new.alistado_por := null;
    end if;
  end if;
  return new;
end;
$function$;

-- El domiciliario solo registra la entrega, salvo que también sea admin o despachador
create or replace function public.proteger_pedido_domiciliario()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated', 'anon')
     and public.tiene_rol('domiciliario') and not public.tiene_rol('admin', 'despachador') then
    if old.cuadre_id is not null then
      raise exception 'Este pedido ya está en un cuadre y no se puede modificar';
    end if;
    if (new.id, new.vendedor_id, new.domiciliario_id, new.cliente_nombre, new.cliente_telefono,
        new.direccion, new.total, new.created_at, new.numero, new.barrio, new.valor_domicilio,
        new.observaciones, new.rotulo_impreso_at, new.cuadre_id, new.comision)
       is distinct from
       (old.id, old.vendedor_id, old.domiciliario_id, old.cliente_nombre, old.cliente_telefono,
        old.direccion, old.total, old.created_at, old.numero, old.barrio, old.valor_domicilio,
        old.observaciones, old.rotulo_impreso_at, old.cuadre_id, old.comision) then
      raise exception 'Solo puedes registrar la entrega del pedido';
    end if;
    if new.estado::text not in ('en_ruta', 'entregado') then
      raise exception 'Estado no permitido para el domiciliario';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.proteger_perfil()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated', 'anon') and not public.tiene_rol('admin') then
    if new.role is distinct from old.role
       or new.roles is distinct from old.roles
       or new.activo is distinct from old.activo
       or new.id is distinct from old.id then
      raise exception 'Solo un administrador puede cambiar el rol o el estado de un usuario';
    end if;
  end if;
  return new;
end;
$function$;

-- Puente con Jasta: cualquiera que tenga el rol de domiciliario
create or replace function public.jasta_domiciliario(p_email text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  select id into v_id from public.profiles
   where lower(email) = lower(trim(p_email)) and 'domiciliario' = any (roles) and coalesce(activo, true);
  if v_id is not null then
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  end if;
  return v_id;
end;
$function$;

create or replace function public.crear_pedido(p_cliente_nombre text, p_cliente_telefono text, p_direccion text, p_barrio text,
                                               p_valor_domicilio numeric, p_observaciones text, p_items jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pedido_id uuid;
  v_numero bigint;
  v_item jsonb;
  v_subtotal numeric(12,2);
  v_comision numeric(12,2);
begin
  if not public.tiene_rol('vendedor', 'admin', 'despachador') then
    raise exception 'No tienes permiso para crear pedidos';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe tener al menos un producto';
  end if;

  select
    sum((item->>'cantidad')::int * (item->>'precio_unitario')::numeric),
    sum((item->>'cantidad')::int * ((item->>'precio_unitario')::numeric - (item->>'precio_base')::numeric))
  into v_subtotal, v_comision
  from jsonb_array_elements(p_items) as item;

  insert into public.pedidos (
    vendedor_id, cliente_nombre, cliente_telefono, direccion,
    barrio, valor_domicilio, comision, observaciones, total
  )
  values (
    auth.uid(), p_cliente_nombre, p_cliente_telefono, p_direccion,
    p_barrio, coalesce(p_valor_domicilio, 0), coalesce(v_comision, 0), p_observaciones,
    v_subtotal + coalesce(p_valor_domicilio, 0)
  )
  returning id, numero into v_pedido_id, v_numero;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_base)
    values (
      v_pedido_id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'cantidad')::int,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'precio_base')::numeric
    );
  end loop;

  return v_numero;
end;
$function$;
