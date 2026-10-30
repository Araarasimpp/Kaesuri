-- ============================================================================
--  Kaesuri · Tienda web: catálogo público por vendedor con pedido directo,
--  pedidos web por confirmar, estadísticas del catálogo y clientes para recontactar
--  (como en Jasta). YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Cada vendedor comparte su enlace (/tienda/<nombre>-<código>, el código son los
--  primeros 8 caracteres de su id); el general es /tienda. El cliente ve los productos
--  activos al precio sugerido (no se puede cambiar), los agotados con su etiqueta, arma el
--  carrito y deja sus datos. El pedido queda en pedidos_web "por confirmar": al vendedor le
--  llega el aviso, llama al cliente y lo confirma (ahí se crea el pedido normal, a su
--  nombre) o lo cancela.
-- ============================================================================

create table if not exists public.pedidos_web (
  id bigint generated always as identity primary key,
  vendedor_id uuid references public.profiles (id),
  estado text not null default 'por_confirmar' check (estado in ('por_confirmar', 'confirmado', 'cancelado')),
  cliente_nombre text not null,
  cliente_telefono text not null,
  direccion text not null,
  barrio text not null,
  observaciones text,
  valor_domicilio numeric not null default 0,
  domicilio_por_confirmar boolean not null default false,
  items jsonb not null,
  subtotal numeric not null,
  ip text,
  pedido_id uuid references public.pedidos (id),
  motivo text,
  atendido_por text,
  atendido_at timestamptz,
  recordado_at timestamptz,
  escalado_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pedidos_web_estado_idx on public.pedidos_web (estado, created_at desc);
create index if not exists pedidos_web_tel_idx on public.pedidos_web (cliente_telefono, created_at desc);
alter table public.pedidos_web enable row level security;
revoke all on public.pedidos_web from anon, authenticated;

-- Vendedor del enlace por su código (primeros 8 caracteres del id). null = tienda general.
create or replace function public.vendedor_tienda(p_codigo text)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from profiles
   where p_codigo ~ '^[0-9a-f]{8}$' and id::text like p_codigo || '%'
     and coalesce(activo, true) and 'vendedor' = any (roles)
   limit 1
$$;
revoke all on function public.vendedor_tienda(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Catálogo (público)
create or replace function public.tienda(p_vendedor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_vend profiles; v_vid uuid;
begin
  v_vid := public.vendedor_tienda(p_vendedor);
  if p_vendedor is not null and v_vid is null then return null; end if;
  select * into v_vend from profiles where id = v_vid;
  return jsonb_build_object(
    'negocio', (select nombre_negocio from configuracion limit 1),
    'telefonos', (select telefonos from configuracion limit 1),
    'vendedora', case when v_vid is null then null
                 else jsonb_build_object('id', left(v_vend.id::text, 8), 'nombre', v_vend.nombre, 'telefono', v_vend.telefono) end,
    'barrios', (select coalesce(jsonb_agg(jsonb_build_object('barrio', nombre, 'domicilio', valor) order by nombre), '[]') from zonas_domicilio),
    'productos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'precio', p.precio_sugerido, 'categoria', coalesce(nullif(trim(p.categoria), ''), 'Otros'),
        'imagen_url', p.imagen_url, 'tallas', coalesce(p.tallas, '{}'),
        'colores', (select coalesce(jsonb_agg(jsonb_build_object('nombre', c.nombre, 'hex', c.hex, 'imagen_url', c.imagen_url) order by c.orden, c.created_at), '[]')
                    from producto_colores c where c.producto_id = p.id),
        'agotado', p.stock <= 0,
        'disponibles', greatest(p.stock, 0))
      order by (p.stock <= 0), coalesce(v.n, 0) desc, p.nombre), '[]')
      from productos p
      left join (select i.producto_id, sum(i.cantidad) n from pedido_items i join pedidos x on x.id = i.pedido_id
                 where x.created_at > now() - interval '30 days' and x.estado <> 'cancelado' group by 1) v on v.producto_id = p.id
      where p.activo and coalesce(p.precio_sugerido, 0) > 0));
end;
$function$;

-- Descripción y fotos de un producto (al abrirlo, para no cargar todo el catálogo de una vez)
create or replace function public.tienda_producto(p_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('descripcion', descripcion, 'imagenes', coalesce(imagenes, '{}'), 'videos', coalesce(videos, '{}'))
  from productos where id = p_id and activo
$$;

-- ---------------------------------------------------------------- Pedir (público)
create or replace function public.tienda_pedir(p_vendedor text, p_nombre text, p_telefono text, p_direccion text,
  p_barrio text, p_observaciones text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vid uuid := public.vendedor_tienda(p_vendedor);
  v_ip text := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  v_tel text := trim(coalesce(p_telefono, ''));
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s{2,}', ' ', 'g');
  it jsonb; pr productos; v_cant int; v_color text; v_talla text;
  v_items jsonb := '[]'; v_sub numeric := 0; v_dom numeric; v_id bigint;
begin
  if p_vendedor is not null and v_vid is null then raise exception 'Este enlace ya no está activo'; end if;
  if v_nombre !~ '\w' or v_nombre ~ '[0-9]' or length(v_nombre) > 80 then raise exception 'Escribe tu nombre (solo letras)'; end if;
  if v_tel !~ '^(3[0-9]{9}|60[0-9]{8}|\+[0-9]{1,4} [0-9]{6,14})$' then raise exception 'Revisa tu número de celular'; end if;
  if length(trim(coalesce(p_direccion, ''))) < 5 then raise exception 'Escribe tu dirección completa'; end if;
  if length(trim(coalesce(p_barrio, ''))) < 2 then raise exception 'Escribe tu barrio'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Tu pedido está vacío'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Son demasiados productos para un solo pedido'; end if;

  -- Freno a pedidos repetidos o de robots
  if (select count(*) from pedidos_web where cliente_telefono = v_tel and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Ya recibimos varios pedidos de este número hoy. Escríbenos por WhatsApp para ayudarte.';
  end if;
  if v_ip <> '' and (select count(*) from pedidos_web where ip = v_ip and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Se enviaron muchos pedidos desde esta conexión. Intenta más tarde.';
  end if;
  if (select count(*) from pedidos_web where created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'Estamos recibiendo muchos pedidos. Intenta en unos minutos.';
  end if;

  for it in select x from jsonb_array_elements(p_items) x loop
    select * into pr from productos where id = (it->>'producto_id')::uuid and activo;
    if not found then raise exception 'Uno de los productos ya no está disponible. Revisa tu pedido.'; end if;
    v_cant := coalesce((it->>'cantidad')::int, 0);
    if v_cant < 1 or v_cant > 20 then raise exception 'Revisa la cantidad de %', pr.nombre; end if;
    if pr.stock <= 0 then raise exception '% está agotado', pr.nombre; end if;
    if v_cant > pr.stock then raise exception 'De % solo quedan %', pr.nombre, pr.stock; end if;
    v_color := nullif(left(trim(coalesce(it->>'color', '')), 40), '');
    v_talla := nullif(left(trim(coalesce(it->>'talla', '')), 40), '');
    if exists (select 1 from producto_colores c where c.producto_id = pr.id)
       and not exists (select 1 from producto_colores c where c.producto_id = pr.id and c.nombre = v_color) then
      raise exception 'Elige el color de %', pr.nombre;
    end if;
    if cardinality(coalesce(pr.tallas, '{}')) > 0 and not (v_talla = any (pr.tallas)) then
      raise exception 'Elige la talla de %', pr.nombre;
    end if;
    -- Siempre al precio sugerido del producto
    v_items := v_items || jsonb_build_object('producto_id', pr.id, 'nombre', pr.nombre, 'cantidad', v_cant,
      'precio', pr.precio_sugerido, 'color', v_color, 'talla', v_talla);
    v_sub := v_sub + pr.precio_sugerido * v_cant;
  end loop;

  select valor into v_dom from zonas_domicilio where public.barrio_normal(nombre) = public.barrio_normal(p_barrio) limit 1;

  insert into pedidos_web (vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones,
    valor_domicilio, domicilio_por_confirmar, items, subtotal, ip)
  values (v_vid, v_nombre, v_tel, left(trim(p_direccion), 200), left(trim(p_barrio), 120), nullif(left(trim(coalesce(p_observaciones, '')), 300), ''),
    coalesce(v_dom, 0), v_dom is null, v_items, v_sub, nullif(v_ip, ''))
  returning id into v_id;

  if v_vid is null then
    perform public.notificar_roles(array['admin']::user_role[], 'pedido_web',
      'Pedido de la tienda: ' || split_part(v_nombre, ' ', 1) || ' · ' || public.fmt_pesos(v_sub + coalesce(v_dom, 0)),
      'Llama al cliente y confírmalo · ' || trim(p_barrio), 'pedidos-web');
  else
    perform public.notificar(v_vid, 'pedido_web',
      'Pedido de tu tienda: ' || split_part(v_nombre, ' ', 1) || ' · ' || public.fmt_pesos(v_sub + coalesce(v_dom, 0)),
      'Llama al cliente y confírmalo · ' || trim(p_barrio), 'pedidos-web');
  end if;
  return jsonb_build_object('id', v_id, 'subtotal', v_sub, 'domicilio', coalesce(v_dom, 0), 'domicilio_por_confirmar', v_dom is null);
end;
$function$;

-- ---------------------------------------------------------------- Atender (equipo)
create or replace function public.pedidos_web_lista()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_yo uuid := auth.uid(); v_admin boolean := public.tiene_rol('admin');
begin
  if v_yo is null or not public.tiene_rol('admin', 'vendedor') then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'estado', w.estado, 'vendedora', u.nombre, 'cliente_nombre', w.cliente_nombre, 'cliente_telefono', w.cliente_telefono,
      'direccion', w.direccion, 'barrio', w.barrio, 'observaciones', w.observaciones, 'valor_domicilio', w.valor_domicilio,
      'domicilio_por_confirmar', w.domicilio_por_confirmar, 'items', w.items, 'subtotal', w.subtotal,
      'pedido_id', w.pedido_id, 'numero', p.numero,
      'motivo', w.motivo, 'atendido_por', w.atendido_por, 'atendido_at', w.atendido_at, 'created_at', w.created_at,
      'riesgo', case when w.estado = 'por_confirmar' then public.riesgo_cliente(w.cliente_telefono) end)
    order by (w.estado = 'por_confirmar') desc, w.created_at desc), '[]')
    from pedidos_web w left join profiles u on u.id = w.vendedor_id left join pedidos p on p.id = w.pedido_id
    where (v_admin or w.vendedor_id = v_yo)
      and (w.estado = 'por_confirmar' or w.created_at > now() - interval '30 days'));
end;
$function$;

-- Confirmado con el cliente: se crea el pedido normal (a nombre del vendedor del enlace).
-- Si el barrio no estaba en la tabla de domicilios, se puede guardar con lo que se cobró.
create or replace function public.confirmar_pedido_web(p_id bigint, p_domicilio numeric default null, p_nota text default null, p_guardar_barrio boolean default false)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  w pedidos_web; v_yo uuid := auth.uid(); v_pid uuid; v_num bigint; it jsonb; pr productos; v_dom numeric;
  v_sub numeric := 0; v_com numeric := 0; v_yo_nombre text := (select nombre from profiles where id = auth.uid());
begin
  select * into w from pedidos_web where id = p_id for update;
  if not found then raise exception 'El pedido no existe'; end if;
  if not (public.tiene_rol('admin') or (w.vendedor_id = v_yo and public.tiene_rol('vendedor'))) then raise exception 'Sin permiso'; end if;
  if w.estado <> 'por_confirmar' then raise exception 'Este pedido ya fue atendido'; end if;
  v_dom := coalesce(p_domicilio, w.valor_domicilio);
  if v_dom < 0 or v_dom > 1000000 then raise exception 'Revisa el valor del domicilio'; end if;

  insert into pedidos (vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones, valor_domicilio, total)
  values (coalesce(w.vendedor_id, v_yo), w.cliente_nombre, w.cliente_telefono, w.direccion, w.barrio,
          nullif(concat_ws(' · ', 'Pedido de la tienda web', w.observaciones, nullif(trim(coalesce(p_nota, '')), '')), ''), v_dom, v_dom)
  returning id, numero into v_pid, v_num;
  for it in select x from jsonb_array_elements(w.items) x loop
    select * into pr from productos where id = (it->>'producto_id')::uuid;
    if not found then raise exception 'El producto % ya no existe', it->>'nombre'; end if;
    -- El inventario se descuenta al insertar la línea (si no alcanza, avisa y no se confirma)
    insert into pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_base, color, talla)
    values (v_pid, pr.id, (it->>'cantidad')::int, (it->>'precio')::numeric, pr.precio_base, it->>'color', it->>'talla');
    v_sub := v_sub + (it->>'precio')::numeric * (it->>'cantidad')::int;
    v_com := v_com + ((it->>'precio')::numeric - coalesce(pr.precio_base, 0)) * (it->>'cantidad')::int;
  end loop;
  update pedidos set total = v_sub + v_dom, comision = v_com where id = v_pid;
  update pedidos_web set estado = 'confirmado', pedido_id = v_pid, valor_domicilio = v_dom, atendido_por = v_yo_nombre, atendido_at = now()
   where id = p_id;

  if p_guardar_barrio and w.domicilio_por_confirmar and v_dom > 0 and length(trim(coalesce(w.barrio, ''))) >= 2
     and not exists (select 1 from zonas_domicilio z where public.barrio_normal(z.nombre) = public.barrio_normal(w.barrio)) then
    if public.tiene_rol('admin') then
      insert into zonas_domicilio (nombre, valor) values (initcap(trim(w.barrio)), v_dom) on conflict do nothing;
    else
      perform public.notificar_roles(array['admin']::user_role[], 'barrio_nuevo',
        'Barrio nuevo para la tabla: ' || initcap(trim(w.barrio)),
        coalesce(v_yo_nombre, 'Un vendedor') || ' cobró ' || public.fmt_pesos(v_dom) || ' de domicilio en un pedido de la tienda. Agrégalo en Barrios.', 'barrios');
    end if;
  end if;
  return v_num;
end;
$function$;

create or replace function public.cancelar_pedido_web(p_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare w pedidos_web; v_yo uuid := auth.uid();
begin
  select * into w from pedidos_web where id = p_id for update;
  if not found then raise exception 'El pedido no existe'; end if;
  if not (public.tiene_rol('admin') or (w.vendedor_id = v_yo and public.tiene_rol('vendedor'))) then raise exception 'Sin permiso'; end if;
  if w.estado <> 'por_confirmar' then raise exception 'Este pedido ya fue atendido'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Escribe por qué se cancela'; end if;
  update pedidos_web set estado = 'cancelado', motivo = left(trim(p_motivo), 200),
    atendido_por = (select nombre from profiles where id = v_yo), atendido_at = now()
   where id = p_id;
end;
$function$;

-- ---------------------------------------------------------------- Estadísticas del catálogo
-- La tienda pública anota lo que pasa en cada catálogo (sin datos personales): visita,
-- ver un producto y agregarlo. Cada dispositivo lleva un código al azar.
create table if not exists public.tienda_eventos (
  id bigint generated always as identity primary key,
  vendedor_id uuid references public.profiles (id),
  tipo text not null check (tipo in ('visita', 'ver', 'agregar')),
  producto_id uuid,
  sesion text not null,
  created_at timestamptz not null default now()
);
create index if not exists tienda_eventos_vend_idx on public.tienda_eventos (vendedor_id, created_at desc);
create index if not exists tienda_eventos_sesion_idx on public.tienda_eventos (sesion, created_at desc);
alter table public.tienda_eventos enable row level security;
revoke all on public.tienda_eventos from anon, authenticated;

create or replace function public.tienda_evento(p_vendedor text, p_tipo text, p_producto uuid, p_sesion text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_vid uuid := public.vendedor_tienda(p_vendedor);
begin
  if p_tipo not in ('visita', 'ver', 'agregar') or coalesce(p_sesion, '') !~ '^[a-z0-9]{12,40}$' then return; end if;
  if p_vendedor is not null and v_vid is null then return; end if;
  if exists (select 1 from tienda_eventos where sesion = p_sesion and tipo = p_tipo and producto_id is not distinct from p_producto
             and created_at > now() - interval '12 hours') then return; end if;
  if (select count(*) from tienda_eventos where sesion = p_sesion and created_at > now() - interval '1 day') >= 300 then return; end if;
  insert into tienda_eventos (vendedor_id, tipo, producto_id, sesion) values (v_vid, p_tipo, p_producto, p_sesion);
end;
$function$;

create or replace function public.tienda_estadisticas(p_dias integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := auth.uid();
  v_admin boolean := public.tiene_rol('admin');
  v_desde timestamptz;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if v_yo is null or not public.tiene_rol('admin', 'vendedor') then raise exception 'Sin permiso'; end if;
  v_desde := ((v_hoy - greatest(1, least(coalesce(p_dias, 30), 365)) + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  return (
    with ev as (
      select * from tienda_eventos e where e.created_at >= v_desde and (v_admin or e.vendedor_id = v_yo)
    ), pw as (
      select * from pedidos_web w where w.created_at >= v_desde and (v_admin or w.vendedor_id = v_yo)
    )
    select jsonb_build_object(
      'resumen', jsonb_build_object(
        'visitas', (select count(distinct sesion) from ev where tipo = 'visita'),
        'agregaron', (select count(distinct sesion) from ev where tipo = 'agregar'),
        'pedidos', (select count(*) from pw),
        'confirmados', (select count(*) from pw where estado = 'confirmado'),
        'ventas', (select coalesce(sum(subtotal + valor_domicilio), 0) from pw where estado = 'confirmado')),
      'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d::date, 'visitas', coalesce(v.n, 0), 'pedidos', coalesce(p.n, 0)) order by d), '[]')
        from generate_series(v_desde at time zone 'America/Bogota', v_hoy::timestamp, interval '1 day') d
        left join (select (created_at at time zone 'America/Bogota')::date dia, count(distinct sesion) n from ev where tipo = 'visita' group by 1) v on v.dia = d::date
        left join (select (created_at at time zone 'America/Bogota')::date dia, count(*) n from pw group by 1) p on p.dia = d::date),
      'productos', (select coalesce(jsonb_agg(x order by (x->>'agregados')::int desc, (x->>'vistos')::int desc), '[]') from (
        select jsonb_build_object('id', pr.id, 'nombre', pr.nombre, 'imagen_url', pr.imagen_url,
          'vistos', count(distinct e.sesion) filter (where e.tipo = 'ver'), 'agregados', count(distinct e.sesion) filter (where e.tipo = 'agregar')) x
        from ev e join productos pr on pr.id = e.producto_id
        where e.tipo in ('ver', 'agregar') group by pr.id order by count(distinct e.sesion) filter (where e.tipo = 'agregar') desc,
          count(distinct e.sesion) filter (where e.tipo = 'ver') desc limit 8) s),
      'vendedoras', case when v_admin then (select coalesce(jsonb_agg(x order by (x->>'visitas')::int desc, (x->>'pedidos')::int desc), '[]') from (
        select jsonb_build_object('nombre', coalesce(u.nombre, 'Catálogo general'),
          'visitas', (select count(distinct sesion) from ev where tipo = 'visita' and ev.vendedor_id is not distinct from k.vid),
          'pedidos', (select count(*) from pw where pw.vendedor_id is not distinct from k.vid),
          'confirmados', (select count(*) from pw where pw.vendedor_id is not distinct from k.vid and estado = 'confirmado'),
          'ventas', (select coalesce(sum(subtotal + valor_domicilio), 0) from pw where pw.vendedor_id is not distinct from k.vid and estado = 'confirmado')) x
        from (select distinct vendedor_id vid from ev union select distinct vendedor_id from pw) k
        left join profiles u on u.id = k.vid) s) end
    ));
end;
$function$;

-- ---------------------------------------------------------------- Recontactar
-- Clientes que ya compraron y llevan un tiempo sin volver, para escribirles con el enlace del
-- catálogo. El vendedor ve los suyos (su último pedido fue con él).
create table if not exists public.clientes_contactos (
  id bigint generated always as identity primary key,
  telefono text not null,
  usuario_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists clientes_contactos_tel_idx on public.clientes_contactos (telefono, created_at desc);
alter table public.clientes_contactos enable row level security;
revoke all on public.clientes_contactos from anon, authenticated;

create or replace function public.recontactar(p_desde integer, p_hasta integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_yo uuid := auth.uid(); v_admin boolean := public.tiene_rol('admin');
begin
  if v_yo is null or not public.tiene_rol('admin', 'vendedor') then raise exception 'Sin permiso'; end if;
  return (
    with base as (
      select regexp_replace(p.cliente_telefono, '\D', '', 'g') tel, p.*
      from pedidos p
      where p.estado = 'entregado' and p.cliente_telefono is not null and p.entregado_at is not null
    ), ult as (
      select distinct on (tel) tel, id, cliente_nombre, barrio, vendedor_id, entregado_at, cliente_telefono
      from base where length(tel) >= 7 order by tel, entregado_at desc
    ), agg as (
      select tel, count(*) compras, coalesce(sum(total), 0) total from base group by tel
    ), cli as (
      select u.*, ((now() at time zone 'America/Bogota')::date - (u.entregado_at at time zone 'America/Bogota')::date) dias, a.compras, a.total
      from ult u join agg a on a.tel = u.tel where v_admin or u.vendedor_id = v_yo
    ), conteos as (
      select jsonb_build_object(
        '30', count(*) filter (where dias between 30 and 59), '60', count(*) filter (where dias between 60 and 89),
        '90', count(*) filter (where dias between 90 and 179), '180', count(*) filter (where dias >= 180)) c
      from cli
    )
    select jsonb_build_object('conteos', (select c from conteos), 'lista', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'telefono', c.cliente_telefono, 'nombre', c.cliente_nombre, 'barrio', c.barrio, 'dias', c.dias, 'compras', c.compras, 'total', c.total,
          'ultima', c.entregado_at, 'vendedora', v.nombre,
          'productos', (select string_agg(coalesce(pr.nombre, 'Producto'), ', ' order by i.id) from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = c.id),
          'contactado', (select max(k.created_at) from clientes_contactos k where k.telefono = c.tel and k.created_at > now() - interval '30 days'),
          'marcado', exists (select 1 from clientes_alerta a where right(regexp_replace(a.telefono, '\D', '', 'g'), 10) = right(c.tel, 10))) x
        from cli c left join profiles v on v.id = c.vendedor_id
        where c.dias between p_desde and coalesce(p_hasta, 100000)
        order by c.compras desc, c.total desc, c.dias
        limit 150) s), '[]'::jsonb)));
end;
$function$;

create or replace function public.marcar_contactado(p_telefono text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or not public.tiene_rol('admin', 'vendedor') then raise exception 'Sin permiso'; end if;
  insert into clientes_contactos (telefono, usuario_id) values (regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), auth.uid());
end $function$;

-- Público: catálogo, producto, pedir y estadísticas anónimas
revoke all on function public.tienda(text), public.tienda_producto(uuid), public.tienda_pedir(text, text, text, text, text, text, jsonb),
  public.tienda_evento(text, text, uuid, text) from public;
grant execute on function public.tienda(text), public.tienda_producto(uuid), public.tienda_pedir(text, text, text, text, text, text, jsonb),
  public.tienda_evento(text, text, uuid, text) to anon, authenticated;
-- Equipo
revoke all on function public.pedidos_web_lista(), public.confirmar_pedido_web(bigint, numeric, text, boolean), public.cancelar_pedido_web(bigint, text),
  public.tienda_estadisticas(integer), public.recontactar(integer, integer), public.marcar_contactado(text) from public, anon;
grant execute on function public.pedidos_web_lista(), public.confirmar_pedido_web(bigint, numeric, text, boolean), public.cancelar_pedido_web(bigint, text),
  public.tienda_estadisticas(integer), public.recontactar(integer, integer), public.marcar_contactado(text) to authenticated;
