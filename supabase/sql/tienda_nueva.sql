-- ============================================================================
--  Kaesuri · Tienda nueva (como en Jasta). YA APLICADO.
--  Cupones de descuento, lo más vendido, reseñas de productos, "Nuevo", tiempo estimado de
--  entrega, barrio obligatorio de la lista, catálogo de cada vendedor (foto, frase y
--  destacados) y página del pedido (/pago/<código>) para que el cliente lo siga.
--  El pago en línea (Wompi) queda apagado hasta tener las llaves de Kaesuri ('pagos_linea').
-- ============================================================================

-- ---------------------------------------------------------------- Pedidos de la tienda
alter table public.pedidos_web
  add column if not exists codigo uuid not null default gen_random_uuid(),
  add column if not exists pago text not null default 'contra_entrega',
  add column if not exists recargo numeric not null default 0,
  add column if not exists pago_estado text,
  add column if not exists pago_metodo text,
  add column if not exists cupon text,
  add column if not exists descuento numeric not null default 0;
create unique index if not exists pedidos_web_codigo_idx on public.pedidos_web (codigo);

-- ---------------------------------------------------------------- Cupones
create table if not exists public.cupones (
  id bigint generated always as identity primary key,
  codigo text not null unique check (codigo ~ '^[A-Z0-9_-]{3,30}$'),
  descripcion text,
  tipo text not null check (tipo in ('porcentaje', 'valor')),
  valor numeric not null check (valor > 0),
  minimo numeric not null default 0 check (minimo >= 0),
  usos_max int check (usos_max is null or usos_max > 0),
  usos int not null default 0,
  vence date,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.cupones enable row level security;
revoke all on public.cupones from anon, authenticated;

create or replace function public.descuento_cupon(p_codigo text, p_subtotal numeric)
returns numeric language plpgsql stable security definer set search_path to 'public' as $function$
declare c cupones; v numeric;
begin
  select * into c from cupones where codigo = upper(trim(coalesce(p_codigo, '')));
  if not found or not c.activo then raise exception 'Ese cupón no existe'; end if;
  if c.vence is not null and c.vence < (now() at time zone 'America/Bogota')::date then raise exception 'Ese cupón ya venció'; end if;
  if c.usos_max is not null and c.usos >= c.usos_max then raise exception 'Ese cupón ya se usó todas las veces'; end if;
  if coalesce(p_subtotal, 0) < c.minimo then raise exception 'Ese cupón es para compras desde %', public.fmt_pesos(c.minimo); end if;
  v := case when c.tipo = 'porcentaje' then round(p_subtotal * least(c.valor, 90) / 100) else least(c.valor, p_subtotal) end;
  return greatest(v, 0);
end $function$;
revoke all on function public.descuento_cupon(text, numeric) from public, anon, authenticated;

create or replace function public.tienda_cupon(p_codigo text, p_subtotal numeric)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare c cupones;
begin
  select * into c from cupones where codigo = upper(trim(coalesce(p_codigo, '')));
  return jsonb_build_object('codigo', c.codigo, 'tipo', c.tipo, 'valor', c.valor, 'minimo', c.minimo, 'descripcion', c.descripcion,
    'descuento', public.descuento_cupon(p_codigo, p_subtotal));
end $function$;
revoke all on function public.tienda_cupon(text, numeric) from public;
grant execute on function public.tienda_cupon(text, numeric) to anon, authenticated;

create or replace function public.cupones_lista()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'descontado', (select coalesce(sum(w.descuento), 0) from pedidos_web w where w.cupon = c.codigo and w.estado <> 'cancelado'),
      'pedidos', (select count(*) from pedidos_web w where w.cupon = c.codigo and w.estado <> 'cancelado'))
    order by c.activo desc, c.created_at desc) from cupones c), '[]');
end $function$;

create or replace function public.guardar_cupon(p_id bigint, p_codigo text, p_descripcion text, p_tipo text, p_valor numeric,
  p_minimo numeric, p_usos_max int, p_vence date, p_activo boolean)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint; v_cod text := upper(regexp_replace(trim(coalesce(p_codigo, '')), '\s+', '', 'g'));
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  if v_cod !~ '^[A-Z0-9_-]{3,30}$' then raise exception 'El código va de 3 a 30 letras o números, sin espacios'; end if;
  if p_tipo not in ('porcentaje', 'valor') then raise exception 'Elige si es porcentaje o valor'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Escribe el descuento'; end if;
  if p_tipo = 'porcentaje' and p_valor > 90 then raise exception 'El porcentaje máximo es 90%%'; end if;
  if p_id is null then
    insert into cupones (codigo, descripcion, tipo, valor, minimo, usos_max, vence, activo)
    values (v_cod, public.texto_limpio(p_descripcion, 120), p_tipo, round(p_valor), greatest(coalesce(p_minimo, 0), 0), p_usos_max, p_vence, coalesce(p_activo, true))
    returning id into v_id;
  else
    update cupones set codigo = v_cod, descripcion = public.texto_limpio(p_descripcion, 120), tipo = p_tipo, valor = round(p_valor),
      minimo = greatest(coalesce(p_minimo, 0), 0), usos_max = p_usos_max, vence = p_vence, activo = coalesce(p_activo, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Ese cupón no existe'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Ya hay un cupón con el código %', v_cod;
end $function$;

create or replace function public.eliminar_cupon(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  delete from cupones where id = p_id;
end $function$;
revoke all on function public.cupones_lista(), public.guardar_cupon(bigint, text, text, text, numeric, numeric, int, date, boolean), public.eliminar_cupon(bigint) from public, anon;
grant execute on function public.cupones_lista(), public.guardar_cupon(bigint, text, text, text, numeric, numeric, int, date, boolean), public.eliminar_cupon(bigint) to authenticated;

-- ---------------------------------------------------------------- Reseñas de productos
create table if not exists public.producto_resenas (
  id bigint generated always as identity primary key,
  producto_id uuid not null references public.productos(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  estrellas int not null check (estrellas between 1 and 5),
  comentario text,
  cliente text,
  created_at timestamptz not null default now(),
  unique (pedido_id, producto_id)
);
create index if not exists producto_resenas_producto_idx on public.producto_resenas (producto_id);
alter table public.producto_resenas enable row level security;
revoke all on public.producto_resenas from anon, authenticated;

create or replace function public.calificar_productos(p_codigo uuid, p_resenas jsonb)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare p pedidos; r jsonb; v_e int;
begin
  select * into p from pedidos where seguimiento = p_codigo;
  if not found then raise exception 'Ese pedido no existe'; end if;
  if p.estado <> 'entregado' then raise exception 'Puedes calificar cuando recibas tu pedido'; end if;
  if jsonb_typeof(p_resenas) <> 'array' then raise exception 'Calificación inválida'; end if;
  for r in select x from jsonb_array_elements(p_resenas) x loop
    v_e := (r->>'estrellas')::int;
    continue when v_e is null or v_e not between 1 and 5;
    continue when not exists (select 1 from pedido_items i where i.pedido_id = p.id and i.producto_id::text = r->>'producto_id');
    insert into producto_resenas (producto_id, pedido_id, estrellas, comentario, cliente)
    values ((r->>'producto_id')::uuid, p.id, v_e, public.texto_limpio(r->>'comentario', 400), split_part(trim(coalesce(p.cliente_nombre, '')), ' ', 1))
    on conflict (pedido_id, producto_id) do update set estrellas = excluded.estrellas, comentario = excluded.comentario, created_at = now();
  end loop;
end $function$;
revoke all on function public.calificar_productos(uuid, jsonb) from public;
grant execute on function public.calificar_productos(uuid, jsonb) to anon, authenticated;

create or replace function public.tienda_resenas(p_producto uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('estrellas', r.estrellas, 'comentario', r.comentario, 'cliente', r.cliente, 'fecha', r.created_at)
    order by (r.comentario is not null) desc, r.created_at desc), '[]')
  from (select * from producto_resenas where producto_id = p_producto order by (comentario is not null) desc, created_at desc limit 20) r
$$;
revoke all on function public.tienda_resenas(uuid) from public;
grant execute on function public.tienda_resenas(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- Catálogo de cada vendedor
create table if not exists public.vendedores_tienda (
  usuario_id uuid primary key references public.profiles(id) on delete cascade,
  foto_url text,
  bio text check (char_length(bio) <= 160),
  destacados uuid[] not null default '{}' check (cardinality(destacados) <= 8),
  updated_at timestamptz not null default now()
);
alter table public.vendedores_tienda enable row level security;
revoke all on public.vendedores_tienda from anon, authenticated;

create or replace function public.mi_tienda_perfil()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r vendedores_tienda;
begin
  if auth.uid() is null or not public.tiene_rol('vendedor') then raise exception 'Sin permiso'; end if;
  select * into r from vendedores_tienda where usuario_id = auth.uid();
  return jsonb_build_object('foto_url', r.foto_url, 'bio', r.bio, 'destacados', coalesce(to_jsonb(r.destacados), '[]'),
    'avatar_url', (select avatar_url from profiles where id = auth.uid()), 'codigo', left(auth.uid()::text, 8));
end $$;

create or replace function public.mi_tienda_guardar(p_foto_url text, p_bio text, p_destacados uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_dest uuid[];
begin
  if auth.uid() is null or not public.tiene_rol('vendedor') then raise exception 'Sin permiso'; end if;
  if p_foto_url is not null and p_foto_url !~ '^https://mswqdzpsynvdanxdfidf\.supabase\.co/storage/v1/object/public/avatars/' then
    raise exception 'Foto no válida';
  end if;
  select coalesce(array_agg(id order by o), '{}') into v_dest from (
    select d.id, min(d.o) o from unnest(coalesce(p_destacados, '{}')) with ordinality d(id, o)
    where exists (select 1 from productos p where p.id = d.id and p.activo) group by d.id order by 2 limit 8) x;
  insert into vendedores_tienda (usuario_id, foto_url, bio, destacados, updated_at)
  values (auth.uid(), p_foto_url, nullif(left(trim(coalesce(p_bio, '')), 160), ''), v_dest, now())
  on conflict (usuario_id) do update set foto_url = excluded.foto_url, bio = excluded.bio, destacados = excluded.destacados, updated_at = now();
  return public.mi_tienda_perfil();
end $$;
revoke all on function public.mi_tienda_perfil(), public.mi_tienda_guardar(text, text, uuid[]) from public, anon;
grant execute on function public.mi_tienda_perfil(), public.mi_tienda_guardar(text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------- Tiempo estimado de entrega
create or replace function public.tienda_estimado(p_barrio text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  ahora timestamp := now() at time zone 'America/Bogota';
  h int := extract(hour from ahora)::int;
  v_n int; v_pct numeric; e50 numeric; e75 numeric; v50 numeric; v75 numeric; v_nb int;
  d timestamp; a timestamp; m25 numeric; m75 numeric;
begin
  with e as (
    select p.barrio,
      extract(hour from p.created_at at time zone 'America/Bogota')::int hc,
      (p.entregado_at at time zone 'America/Bogota')::date = (p.created_at at time zone 'America/Bogota')::date mismo,
      extract(epoch from (p.asignado_at - p.created_at)) / 60 espera,
      extract(epoch from (p.entregado_at - p.asignado_at)) / 60 viaje,
      extract(epoch from ((p.entregado_at at time zone 'America/Bogota')::time)) / 60 min_entrega
    from pedidos p
    where p.estado = 'entregado' and p.canal = 'domicilio' and not p.envio_nacional
      and p.asignado_at is not null and p.entregado_at is not null and p.created_at > now() - interval '120 days'
  )
  select
    count(*) filter (where hc = h), avg(mismo::int) filter (where hc = h),
    percentile_cont(0.5) within group (order by espera) filter (where mismo and hc between h - 1 and h + 1 and espera between 0 and 900),
    percentile_cont(0.75) within group (order by espera) filter (where mismo and hc between h - 1 and h + 1 and espera between 0 and 900),
    count(*) filter (where lower(trim(barrio)) = lower(trim(p_barrio)) and viaje between 1 and 600),
    percentile_cont(0.25) within group (order by min_entrega) filter (where mismo and hc between 6 and 8),
    percentile_cont(0.75) within group (order by min_entrega) filter (where mismo and hc between 6 and 8)
  into v_n, v_pct, e50, e75, v_nb, m25, m75 from e;
  with e as (
    select lower(trim(p.barrio)) b, extract(epoch from (p.entregado_at - p.asignado_at)) / 60 viaje
    from pedidos p
    where p.estado = 'entregado' and p.canal = 'domicilio' and not p.envio_nacional
      and p.asignado_at is not null and p.entregado_at is not null and p.created_at > now() - interval '120 days'
  )
  select percentile_cont(0.5) within group (order by viaje), percentile_cont(0.75) within group (order by viaje)
  into v50, v75 from e where viaje between 1 and 600 and (v_nb < 5 or b = lower(trim(p_barrio)));

  if coalesce(v_n, 0) >= 10 and coalesce(v_pct, 0) >= 0.75 and e50 is not null and v50 is not null then
    d := ahora + make_interval(mins => (e50 + v50)::int);
    a := ahora + make_interval(mins => greatest(e75 + v75, e50 + v50 + 30)::int);
    if extract(hour from a) < 20 then
      d := date_trunc('hour', d) + make_interval(mins => (floor(extract(minute from d) / 15) * 15)::int);
      a := date_trunc('hour', a) + make_interval(mins => (ceil(extract(minute from a) / 15) * 15)::int);
      return jsonb_build_object('cuando', 'hoy', 'desde', to_char(d, 'HH24:MI'), 'hasta', to_char(a, 'HH24:MI'), 'base', v_nb);
    end if;
  end if;
  if m25 is null then return jsonb_build_object('cuando', 'manana'); end if;
  d := date_trunc('day', ahora) + interval '1 day' + make_interval(mins => (floor(m25 / 15) * 15)::int);
  a := date_trunc('day', ahora) + interval '1 day' + make_interval(mins => (ceil(m75 / 15) * 15)::int);
  return jsonb_build_object('cuando', case when h < 6 then 'hoy' else 'manana' end, 'desde', to_char(d, 'HH24:MI'), 'hasta', to_char(a, 'HH24:MI'), 'base', v_nb);
end $function$;
revoke all on function public.tienda_estimado(text) from public;
grant execute on function public.tienda_estimado(text) to anon, authenticated;

create or replace function public.tienda_barrios()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('barrio', nombre, 'domicilio', valor) order by nombre), '[]') from zonas_domicilio
$$;
revoke all on function public.tienda_barrios() from public;
grant execute on function public.tienda_barrios() to anon, authenticated;

-- ---------------------------------------------------------------- Página del pedido (/pago/<código>)
create or replace function public.tienda_pago(p_codigo uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object('id', w.id, 'estado', case when w.estado = 'confirmado' then 'por_confirmar' else w.estado end,
    'confirmado', w.estado = 'confirmado', 'pago', w.pago, 'pago_estado', w.pago_estado, 'pago_metodo', w.pago_metodo,
    'subtotal', w.subtotal, 'domicilio', w.valor_domicilio, 'recargo', w.recargo, 'total', w.subtotal + w.valor_domicilio + w.recargo,
    'descuento', w.descuento, 'cupon', w.cupon,
    'cliente', split_part(w.cliente_nombre, ' ', 1), 'items', w.items, 'vendedora', u.nombre, 'vendedora_id', left(w.vendedor_id::text, 8),
    'vendedora_telefono', u.telefono, 'seguimiento', pe.seguimiento, 'pedido_id', pe.numero,
    'telefonos', (select c.telefonos from configuracion c limit 1))
  from pedidos_web w left join profiles u on u.id = w.vendedor_id
  left join pedidos pe on pe.id = w.pedido_id
  where w.codigo = p_codigo
$function$;
revoke all on function public.tienda_pago(uuid) from public;
grant execute on function public.tienda_pago(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- Pedir desde la tienda (con cupón y barrio de la lista)
-- Versión nueva con dos parámetros más (p_pago y p_cupon); la anterior de 7 sigue igual.
create or replace function public.tienda_pedir(p_vendedor text, p_nombre text, p_telefono text, p_direccion text, p_barrio text,
  p_observaciones text, p_items jsonb, p_pago text, p_cupon text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_vid uuid := public.vendedor_tienda(p_vendedor);
  v_ip text := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  v_tel text := trim(coalesce(p_telefono, ''));
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s{2,}', ' ', 'g');
  it jsonb; pr productos; v_cant int; v_color text; v_talla text;
  v_items jsonb := '[]'; v_sub numeric := 0; v_dom numeric; v_id bigint; v_codigo uuid; v_desc numeric := 0; v_sub2 numeric; v_cupon text;
begin
  if coalesce(p_pago, 'contra_entrega') <> 'contra_entrega' then raise exception 'El pago en línea todavía no está disponible. Elige pagar al recibir.'; end if;
  if p_vendedor is not null and v_vid is null then raise exception 'Este enlace ya no está activo'; end if;
  if v_nombre !~ '\w' or v_nombre ~ '[0-9]' or length(v_nombre) > 80 then raise exception 'Escribe tu nombre (solo letras)'; end if;
  if v_tel !~ '^(3[0-9]{9}|60[0-9]{8}|\+[0-9]{1,4} [0-9]{6,14})$' then raise exception 'Revisa tu número de celular'; end if;
  if length(trim(coalesce(p_direccion, ''))) < 5 then raise exception 'Escribe tu dirección completa'; end if;
  if length(trim(coalesce(p_barrio, ''))) < 2 then raise exception 'Escribe tu barrio'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Tu pedido está vacío'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'Son demasiados productos para un solo pedido'; end if;
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
    if v_color is not null and exists (select 1 from producto_colores c where c.producto_id = pr.id and c.nombre = v_color and not c.disponible) then
      raise exception 'El color % de % se agotó. Elige otro.', v_color, pr.nombre;
    end if;
    if v_talla = any (coalesce(pr.tallas_agotadas, '{}')) then raise exception 'La talla % de % se agotó. Elige otra.', v_talla, pr.nombre; end if;
    v_items := v_items || jsonb_build_object('producto_id', pr.id, 'nombre', pr.nombre, 'cantidad', v_cant,
      'precio', pr.precio_sugerido, 'color', v_color, 'talla', v_talla);
    v_sub := v_sub + pr.precio_sugerido * v_cant;
  end loop;

  -- Cupón: el descuento se reparte en los precios de los productos
  if nullif(trim(coalesce(p_cupon, '')), '') is not null then
    v_cupon := upper(trim(p_cupon));
    v_desc := public.descuento_cupon(v_cupon, v_sub);
    if v_desc > 0 then
      select jsonb_agg(x || jsonb_build_object('precio', round((x->>'precio')::numeric * (v_sub - v_desc) / v_sub), 'precio_lista', (x->>'precio')::numeric) order by n)
        into v_items from jsonb_array_elements(v_items) with ordinality t(x, n);
      select sum((x->>'precio')::numeric * (x->>'cantidad')::int) into v_sub2 from jsonb_array_elements(v_items) x;
      v_desc := v_sub - v_sub2;
      v_sub := v_sub2;
    end if;
    update cupones set usos = usos + 1 where codigo = v_cupon;
  end if;

  select valor into v_dom from zonas_domicilio where public.barrio_normal(nombre) = public.barrio_normal(p_barrio) limit 1;
  if v_dom is null then raise exception 'Elige tu barrio de la lista. Si no eres de Cali, escribe solo el nombre de tu ciudad.'; end if;

  insert into pedidos_web (vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones,
    valor_domicilio, domicilio_por_confirmar, items, subtotal, ip, cupon, descuento)
  values (v_vid, v_nombre, v_tel, left(trim(p_direccion), 200), left(trim(p_barrio), 120), nullif(left(trim(coalesce(p_observaciones, '')), 300), ''),
    v_dom, false, v_items, v_sub, nullif(v_ip, ''), v_cupon, v_desc)
  returning id, codigo into v_id, v_codigo;
  if v_vid is null then
    perform public.notificar_roles(array['admin']::user_role[], 'pedido_web',
      'Pedido de la tienda: ' || split_part(v_nombre, ' ', 1) || ' · ' || public.fmt_pesos(v_sub + v_dom),
      'Llama al cliente y confírmalo · ' || trim(p_barrio), 'pedidos-web');
  else
    perform public.notificar(v_vid, 'pedido_web',
      'Pedido de tu tienda: ' || split_part(v_nombre, ' ', 1) || ' · ' || public.fmt_pesos(v_sub + v_dom),
      'Llama al cliente y confírmalo · ' || trim(p_barrio), 'pedidos-web');
  end if;
  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'subtotal', v_sub, 'domicilio', v_dom,
    'domicilio_por_confirmar', false, 'recargo', 0, 'descuento', v_desc, 'cupon', v_cupon, 'pago', 'contra_entrega');
end $function$;
revoke all on function public.tienda_pedir(text, text, text, text, text, text, jsonb, text, text) from public;
grant execute on function public.tienda_pedir(text, text, text, text, text, text, jsonb, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- Cambios en funciones que ya existían
do $$
declare v text;
begin
  -- Catálogo: lo más vendido, reseñas, "Nuevo", el vendedor con foto/frase/destacados y si hay pago en línea
  v := replace(pg_get_functiondef('public.tienda(text)'::regprocedure), chr(13), '');
  if position('''rating''' in v) = 0 then
    v := replace(v, 'select i.producto_id, sum(i.cantidad) n from pedido_items i join pedidos x',
                    'select i.producto_id, sum(i.cantidad) n, rank() over (order by sum(i.cantidad) desc) rk from pedido_items i join pedidos x');
    v := replace(v, '''disponibles'', greatest(p.stock, 0))',
      '''disponibles'', greatest(p.stock, 0), ''top'', case when v.rk <= 10 then v.rk end,
        ''rating'', (select round(avg(r.estrellas)::numeric, 1) from producto_resenas r where r.producto_id = p.id),
        ''resenas'', (select count(*) from producto_resenas r where r.producto_id = p.id),
        ''nuevo'', p.created_at > now() - interval ''15 days'')');
    v := replace(v, 'jsonb_build_object(''id'', left(v_vend.id::text, 8), ''nombre'', v_vend.nombre, ''telefono'', v_vend.telefono)',
      'jsonb_build_object(''id'', left(v_vend.id::text, 8), ''nombre'', v_vend.nombre, ''telefono'', v_vend.telefono,
                   ''foto_url'', coalesce((select vt.foto_url from vendedores_tienda vt where vt.usuario_id = v_vid), v_vend.avatar_url),
                   ''bio'', (select vt.bio from vendedores_tienda vt where vt.usuario_id = v_vid),
                   ''destacados'', coalesce((select to_jsonb(vt.destacados) from vendedores_tienda vt where vt.usuario_id = v_vid), ''[]''))');
    v := replace(v, '''negocio'', (select nombre_negocio from configuracion limit 1),',
      '''negocio'', (select nombre_negocio from configuracion limit 1), ''pagos_linea'', false,');
    if position('''rating''' in v) = 0 or position('rk from' in v) = 0 or position('vendedores_tienda' in v) = 0 or position('pagos_linea' in v) = 0 then
      raise exception 'No se pudo cambiar tienda';
    end if;
    execute v;
  end if;

  -- Pedidos de la tienda: muestran el cupón y el código del pedido
  v := replace(pg_get_functiondef('public.pedidos_web_lista()'::regprocedure), chr(13), '');
  if position('''cupon''' in v) = 0 then
    v := replace(v, '''pedido_id'', w.pedido_id,', '''pedido_id'', w.pedido_id, ''cupon'', w.cupon, ''descuento'', w.descuento,');
    if position('''cupon''' in v) = 0 then raise exception 'No se pudo cambiar pedidos_web_lista'; end if;
    execute v;
  end if;

  -- Seguimiento: cada producto trae su id y la calificación que ya le dio el cliente
  v := replace(pg_get_functiondef('public.seguimiento(uuid)'::regprocedure), chr(13), '');
  if position('''producto_id'', i.producto_id' in v) = 0 then
    v := replace(v, 'jsonb_build_object(''nombre'', coalesce(pr.nombre, ''Producto''), ''cantidad'', i.cantidad,',
      'jsonb_build_object(''producto_id'', i.producto_id, ''resena'', (select r.estrellas from producto_resenas r where r.pedido_id = p.id and r.producto_id = i.producto_id),
        ''imagen_url'', pr.imagen_url, ''nombre'', coalesce(pr.nombre, ''Producto''), ''cantidad'', i.cantidad,');
    if position('''producto_id'', i.producto_id' in v) = 0 then raise exception 'No se pudo cambiar seguimiento'; end if;
    execute v;
  end if;
end $$;
