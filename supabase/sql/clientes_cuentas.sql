-- ============================================================================
--  Kaesuri · Cuentas de clientes de la tienda (como en Jasta). Tablas y funciones YA APLICADAS.
--  Lo que conecta el registro (auth), los triggers y el cierre de lecturas para que un cliente
--  con sesión no vea nada de adentro está en PENDIENTE_correr_en_supabase.sql (sección 17).
--  Mientras no se corra esa sección, las cuentas siguen apagadas en la tienda.
--  Los clientes NO son del equipo: no tienen fila en profiles, así que tiene_rol() les da falso.
-- ============================================================================

create table if not exists public.clientes_cuentas (
  id bigint generated always as identity primary key,
  auth_id uuid not null unique,
  nombre text not null default '',
  email text,
  prefijo text not null default '57',
  telefono text,
  tipo_doc text not null default 'CC',
  documento text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clientes_cuentas enable row level security;
revoke all on public.clientes_cuentas from anon, authenticated;

create table if not exists public.clientes_direcciones (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references public.clientes_cuentas(id),
  etiqueta text not null default 'Casa',
  direccion text not null,
  barrio text not null,
  indicaciones text,
  principal boolean not null default false,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists clientes_direcciones_cliente_idx on public.clientes_direcciones (cliente_id) where activa;
alter table public.clientes_direcciones enable row level security;
revoke all on public.clientes_direcciones from anon, authenticated;

create table if not exists public.clientes_favoritos (
  cliente_id bigint not null references public.clientes_cuentas(id),
  producto_id uuid not null references public.productos(id) on delete cascade,
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (cliente_id, producto_id)
);
alter table public.clientes_favoritos enable row level security;
revoke all on public.clientes_favoritos from anon, authenticated;

create table if not exists public.clientes_ayuda (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references public.clientes_cuentas(id),
  pedido_id uuid references public.pedidos(id) on delete set null,
  pedido_web_id bigint references public.pedidos_web(id) on delete set null,
  motivo text not null,
  mensaje text,
  estado text not null default 'abierta',
  respuesta text,
  resuelta_at timestamptz,
  resuelta_por text,
  created_at timestamptz not null default now()
);
create index if not exists clientes_ayuda_cliente_idx on public.clientes_ayuda (cliente_id);
alter table public.clientes_ayuda enable row level security;
revoke all on public.clientes_ayuda from anon, authenticated;

alter table public.pedidos add column if not exists cliente_cuenta_id bigint references public.clientes_cuentas(id);
create index if not exists pedidos_cliente_cuenta_idx on public.pedidos (cliente_cuenta_id) where cliente_cuenta_id is not null;
alter table public.pedidos_web add column if not exists cliente_cuenta_id bigint references public.clientes_cuentas(id);
create index if not exists pedidos_web_cliente_cuenta_idx on public.pedidos_web (cliente_cuenta_id) where cliente_cuenta_id is not null;

-- ---------------------------------------------------------------- Funciones del cliente (solo su cuenta)
create or replace function public.cliente_yo()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when c.id is null then null else jsonb_build_object(
    'id', c.id, 'nombre', c.nombre, 'email', c.email, 'prefijo', c.prefijo, 'telefono', c.telefono,
    'tipo_doc', c.tipo_doc, 'avatar_url', c.avatar_url, 'documento', c.documento, 'desde', c.created_at,
    'direcciones', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'etiqueta', d.etiqueta, 'direccion', d.direccion, 'barrio', d.barrio,
        'indicaciones', d.indicaciones, 'principal', d.principal) order by d.principal desc, d.created_at)
      from clientes_direcciones d where d.cliente_id = c.id and d.activa), '[]'),
    'tarjetas', '[]'::jsonb,
    'favoritos', coalesce((select jsonb_agg(f.producto_id order by f.updated_at desc) from clientes_favoritos f where f.cliente_id = c.id and f.activo), '[]')
  ) end
  from (select 1) x left join clientes_cuentas c on c.auth_id = auth.uid()
$$;

create or replace function public.cliente_guardar(p_nombre text, p_prefijo text, p_telefono text, p_tipo_doc text, p_documento text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint := (select id from clientes_cuentas where auth_id = auth.uid());
  v_tel text := nullif(left(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 14), '');
  v_pre text := coalesce(nullif(regexp_replace(coalesce(p_prefijo, ''), '\D', '', 'g'), ''), '57');
begin
  if v_id is null then raise exception 'Inicia sesión con tu cuenta de cliente'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'Escribe tu nombre'; end if;
  if v_tel is null or (v_pre = '57' and length(v_tel) <> 10) then raise exception 'Escribe tu celular (10 números)'; end if;
  update clientes_cuentas set nombre = left(trim(p_nombre), 80), prefijo = v_pre, telefono = v_tel,
    tipo_doc = case when p_tipo_doc in ('CC', 'CE', 'NIT', 'PP', 'TI') then p_tipo_doc else 'CC' end,
    documento = nullif(left(regexp_replace(coalesce(p_documento, ''), '[^0-9A-Za-z-]', '', 'g'), 20), ''), updated_at = now()
  where id = v_id;
  return public.cliente_yo();
end $$;

create or replace function public.cliente_guardar_direccion(p_id bigint, p_etiqueta text, p_direccion text, p_barrio text, p_indicaciones text, p_principal boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cli bigint := (select id from clientes_cuentas where auth_id = auth.uid()); v_id bigint; v_primera boolean;
begin
  if v_cli is null then raise exception 'Inicia sesión con tu cuenta de cliente'; end if;
  if length(trim(coalesce(p_direccion, ''))) < 5 then raise exception 'Escribe la dirección completa'; end if;
  if length(trim(coalesce(p_barrio, ''))) < 3 then raise exception 'Elige el barrio (o tu ciudad si no eres de Cali)'; end if;
  v_primera := not exists (select 1 from clientes_direcciones where cliente_id = v_cli and activa and (p_id is null or id <> p_id));
  if p_id is null then
    if (select count(*) from clientes_direcciones where cliente_id = v_cli and activa) >= 10 then raise exception 'Puedes guardar hasta 10 direcciones'; end if;
    insert into clientes_direcciones (cliente_id, etiqueta, direccion, barrio, indicaciones, principal)
    values (v_cli, coalesce(nullif(left(trim(coalesce(p_etiqueta, '')), 30), ''), 'Casa'), left(trim(p_direccion), 200), left(trim(p_barrio), 80),
            nullif(left(trim(coalesce(p_indicaciones, '')), 200), ''), coalesce(p_principal, false) or v_primera)
    returning id into v_id;
  else
    update clientes_direcciones set etiqueta = coalesce(nullif(left(trim(coalesce(p_etiqueta, '')), 30), ''), 'Casa'),
      direccion = left(trim(p_direccion), 200), barrio = left(trim(p_barrio), 80), indicaciones = nullif(left(trim(coalesce(p_indicaciones, '')), 200), ''),
      principal = coalesce(p_principal, false) or v_primera
    where id = p_id and cliente_id = v_cli and activa returning id into v_id;
    if v_id is null then raise exception 'Esa dirección ya no existe'; end if;
  end if;
  if (select principal from clientes_direcciones where id = v_id) then
    update clientes_direcciones set principal = false where cliente_id = v_cli and id <> v_id and principal;
  end if;
  return public.cliente_yo();
end $$;

create or replace function public.cliente_quitar_direccion(p_id bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cli bigint := (select id from clientes_cuentas where auth_id = auth.uid()); v_era boolean;
begin
  if v_cli is null then raise exception 'Inicia sesión con tu cuenta de cliente'; end if;
  update clientes_direcciones set activa = false, principal = false where id = p_id and cliente_id = v_cli and activa returning true into v_era;
  if v_era is null then raise exception 'Esa dirección ya no existe'; end if;
  if not exists (select 1 from clientes_direcciones where cliente_id = v_cli and activa and principal) then
    update clientes_direcciones set principal = true
    where id = (select id from clientes_direcciones where cliente_id = v_cli and activa order by created_at limit 1);
  end if;
  return public.cliente_yo();
end $$;

create or replace function public.cliente_foto(p_url text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cli bigint := (select id from clientes_cuentas where auth_id = auth.uid());
begin
  if v_cli is null then raise exception 'Inicia sesión con tu cuenta de cliente'; end if;
  if p_url is not null and p_url not like 'https://mswqdzpsynvdanxdfidf.supabase.co/storage/v1/object/public/avatars/' || auth.uid()::text || '/%' then
    raise exception 'Foto inválida';
  end if;
  update clientes_cuentas set avatar_url = p_url, updated_at = now() where id = v_cli;
  return public.cliente_yo();
end $$;

create or replace function public.cliente_favorito(p_producto uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cli bigint := (select id from clientes_cuentas where auth_id = auth.uid());
begin
  if v_cli is null then raise exception 'Inicia sesión para guardar favoritos'; end if;
  if not exists (select 1 from productos where id = p_producto) then raise exception 'Ese producto no existe'; end if;
  insert into clientes_favoritos (cliente_id, producto_id, activo, updated_at) values (v_cli, p_producto, coalesce(p_on, true), now())
  on conflict (cliente_id, producto_id) do update set activo = excluded.activo, updated_at = now();
  return coalesce((select jsonb_agg(producto_id order by updated_at desc) from clientes_favoritos where cliente_id = v_cli and activo), '[]');
end $$;

create or replace function public.cliente_favoritos()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre, 'precio', p.precio_sugerido, 'imagen_url', p.imagen_url,
      'agotado', coalesce(p.stock, 0) <= 0 or not p.activo) order by f.updated_at desc), '[]')
  from clientes_favoritos f
  join clientes_cuentas c on c.id = f.cliente_id and c.auth_id = auth.uid()
  join productos p on p.id = f.producto_id
  where f.activo
$$;

-- Sus compras: las de la tienda y los pedidos unidos a su cuenta. Solo datos para el cliente (nada de costos).
-- Los estados de Kaesuri se muestran como los de la tienda: pendiente → por alistar / alistado, en ruta → despachado.
create or replace function public.cliente_compras()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with yo as (select c.id from clientes_cuentas c where c.auth_id = auth.uid()),
  tienda_tel as (select substring(regexp_replace(coalesce((select telefonos from configuracion limit 1), ''), '[\s.]', '', 'g') from '\d{10}') tel),
  web as (select pw.* from pedidos_web pw join yo on pw.cliente_cuenta_id = yo.id),
  ped as (select p.* from pedidos p join yo on p.cliente_cuenta_id = yo.id),
  filas as (
    select pw.created_at fecha, pw.codigo::text codigo, 'pago' ruta, p.numero pedido, p.id pedido_uuid, pw.id pedido_web, p.seguimiento::text seguimiento,
      case when p.id is not null then case p.estado::text when 'pendiente' then case when p.alistado_at is not null then 'alistado' else 'por_alistar' end
                                                           when 'en_ruta' then 'despachado' else p.estado::text end
           when pw.estado = 'cancelado' then 'cancelado' else 'por_confirmar' end estado,
      coalesce(p.total, pw.subtotal + coalesce(pw.valor_domicilio, 0) + coalesce(pw.recargo, 0)) total,
      coalesce(p.valor_domicilio, pw.valor_domicilio) domicilio,
      case when pw.estado <> 'cancelado' then pw.atendido_at end confirmado_at,
      p.alistado_at,
      case when p.estado in ('en_ruta', 'entregado') then coalesce(p.enviado_at, p.asignado_at, p.alistado_at) end enviado_at,
      p.entregado_at,
      coalesce(p.direccion, pw.direccion) direccion, coalesce(p.barrio, pw.barrio) barrio,
      pw.pago, pw.pago_estado, coalesce(p.canal, 'domicilio') canal,
      coalesce(p.vendedor_id, pw.vendedor_id) vendedor_id,
      case when p.id is not null then
        (select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'nombre', coalesce(pr.nombre, 'Producto'), 'cantidad', i.cantidad, 'precio', i.precio_unitario,
            'color', i.color, 'talla', i.talla, 'imagen_url', pr.imagen_url,
            'mi_resena', (select r.estrellas from producto_resenas r where r.pedido_id = p.id and r.producto_id = i.producto_id)) order by i.id)
         from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id)
      else
        (select jsonb_agg(jsonb_build_object('producto_id', x->>'producto_id', 'nombre', x->>'nombre', 'cantidad', (x->>'cantidad')::int,
            'precio', (x->>'precio')::numeric, 'color', x->>'color', 'talla', x->>'talla', 'imagen_url', pr.imagen_url, 'mi_resena', null))
         from jsonb_array_elements(pw.items) x left join productos pr on pr.id::text = x->>'producto_id')
      end items
    from web pw left join pedidos p on p.id = pw.pedido_id
    union all
    select p.created_at, p.seguimiento::text, 'seguimiento', p.numero, p.id, null, p.seguimiento::text,
      case p.estado::text when 'pendiente' then case when p.alistado_at is not null then 'alistado' else 'por_alistar' end
                          when 'en_ruta' then 'despachado' else p.estado::text end,
      p.total, p.valor_domicilio, p.created_at, p.alistado_at,
      case when p.estado in ('en_ruta', 'entregado') then coalesce(p.enviado_at, p.asignado_at, p.alistado_at) end,
      p.entregado_at, p.direccion, p.barrio, null, null, coalesce(p.canal, 'domicilio'), p.vendedor_id,
      (select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'nombre', coalesce(pr.nombre, 'Producto'), 'cantidad', i.cantidad, 'precio', i.precio_unitario,
          'color', i.color, 'talla', i.talla, 'imagen_url', pr.imagen_url,
          'mi_resena', (select r.estrellas from producto_resenas r where r.pedido_id = p.id and r.producto_id = i.producto_id)) order by i.id)
       from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id)
    from ped p where not exists (select 1 from web w where w.pedido_id = p.id)
  )
  select coalesce(jsonb_agg(
      to_jsonb(f) - 'vendedor_id' - 'pedido_web' - 'pedido_uuid'
      || jsonb_build_object(
        'calif', (select c.estrellas from calificaciones c where c.pedido_id = f.pedido_uuid limit 1),
        'whatsapp', coalesce(substring(regexp_replace(coalesce((select u.telefono from profiles u where u.id = f.vendedor_id and coalesce(u.activo, true)), ''), '\D', '', 'g') from '\d{10}'), (select tel from tienda_tel)),
        'ayudas', coalesce((select jsonb_agg(jsonb_build_object('motivo', a.motivo, 'mensaje', a.mensaje, 'estado', a.estado, 'fecha', a.created_at, 'respuesta', a.respuesta,
              'resuelta_por', split_part(coalesce(a.resuelta_por, ''), ' ', 1)) order by a.created_at desc)
            from clientes_ayuda a join yo on a.cliente_id = yo.id
            where (f.pedido_uuid is not null and a.pedido_id = f.pedido_uuid) or (f.pedido_web is not null and a.pedido_web_id = f.pedido_web)), '[]'))
      order by f.fecha desc), '[]')
  from (select * from filas order by fecha desc limit 100) f
$function$;

-- Pedir ayuda con un pedido: le llega al admin y al vendedor del pedido. Máximo 5 por hora.
create or replace function public.cliente_pedir_ayuda(p_codigo text, p_ruta text, p_motivo text, p_mensaje text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c clientes_cuentas; v_ped uuid; v_num bigint; v_web bigint; v_vend uuid; v_txt text := nullif(left(trim(coalesce(p_mensaje, '')), 600), '');
  v_mot text := left(trim(coalesce(p_motivo, '')), 60); v_tit text; v_msg text;
begin
  select * into c from clientes_cuentas where auth_id = auth.uid();
  if c.id is null then raise exception 'Inicia sesión con tu cuenta'; end if;
  if v_mot = '' then raise exception 'Elige qué pasó'; end if;
  if v_mot = 'Otro' and v_txt is null then raise exception 'Cuéntanos qué pasó'; end if;
  if p_ruta = 'pago' then
    select pw.id, pw.pedido_id, pw.vendedor_id into v_web, v_ped, v_vend from pedidos_web pw where pw.codigo::text = p_codigo and pw.cliente_cuenta_id = c.id;
  else
    select p.id, p.vendedor_id into v_ped, v_vend from pedidos p where p.seguimiento::text = p_codigo and p.cliente_cuenta_id = c.id;
  end if;
  if v_ped is null and v_web is null then raise exception 'Ese pedido no es de tu cuenta'; end if;
  if (select count(*) from clientes_ayuda where cliente_id = c.id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Ya nos escribiste varias veces. Te vamos a contactar pronto.';
  end if;
  insert into clientes_ayuda (cliente_id, pedido_id, pedido_web_id, motivo, mensaje) values (c.id, v_ped, v_web, v_mot, v_txt);
  select numero into v_num from pedidos where id = v_ped;
  v_tit := '🆘 Ayuda con ' || case when v_num is not null then 'el pedido #' || v_num else 'el pedido web #' || v_web end || ': ' || v_mot;
  v_msg := split_part(trim(coalesce(nullif(c.nombre, ''), 'El cliente')), ' ', 1) || coalesce(' (' || c.telefono || ')', '')
    || coalesce(': "' || v_txt || '"', ' pide ayuda. Llámalo o escríbele.');
  perform public.notificar_roles(array['admin']::user_role[], 'ayuda_cliente', v_tit, v_msg, 'ayuda-clientes');
  if v_vend is not null and not exists (select 1 from profiles where id = v_vend and 'admin' = any (roles)) then
    perform public.notificar(v_vend, 'ayuda_cliente', v_tit, v_msg, 'ayuda-clientes');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cliente_yo(), public.cliente_guardar(text, text, text, text, text),
  public.cliente_guardar_direccion(bigint, text, text, text, text, boolean), public.cliente_quitar_direccion(bigint), public.cliente_foto(text),
  public.cliente_favorito(uuid, boolean), public.cliente_favoritos(), public.cliente_compras(), public.cliente_pedir_ayuda(text, text, text, text) from public, anon;
grant execute on function public.cliente_yo(), public.cliente_guardar(text, text, text, text, text),
  public.cliente_guardar_direccion(bigint, text, text, text, text, boolean), public.cliente_quitar_direccion(bigint), public.cliente_foto(text),
  public.cliente_favorito(uuid, boolean), public.cliente_favoritos(), public.cliente_compras(), public.cliente_pedir_ayuda(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- Página "Ayuda a clientes" (admin y vendedores)
create or replace function public.ayuda_clientes_lista(p_estado text default 'abierta')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_admin boolean := public.tiene_rol('admin'); v_yo uuid := auth.uid();
begin
  if not (v_admin or public.tiene_rol('vendedor')) then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(x order by x.abierta desc, x.fecha desc) from (
    select a.id, a.motivo, a.mensaje, a.estado, a.estado = 'abierta' abierta, a.created_at fecha, a.respuesta, a.resuelta_at, a.resuelta_por,
      c.nombre cliente, c.prefijo, c.telefono, c.email, c.avatar_url,
      p.numero pedido_id, a.pedido_web_id, coalesce(p.estado::text, pw.estado) estado_pedido, coalesce(p.total, pw.subtotal + pw.valor_domicilio + coalesce(pw.recargo, 0)) total,
      coalesce(p.barrio, pw.barrio) barrio, v.nombre vendedora,
      (select string_agg(i.cantidad || ' × ' || coalesce(pr.nombre, 'Producto'), ', ' order by i.id) from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = a.pedido_id) productos_ped,
      (select string_agg((x->>'cantidad') || ' × ' || (x->>'nombre'), ', ') from jsonb_array_elements(pw.items) x) productos_web
    from clientes_ayuda a
    join clientes_cuentas c on c.id = a.cliente_id
    left join pedidos p on p.id = a.pedido_id
    left join pedidos_web pw on pw.id = a.pedido_web_id
    left join profiles v on v.id = coalesce(p.vendedor_id, pw.vendedor_id)
    where (p_estado is null or p_estado = 'todas' or a.estado = p_estado)
      and (v_admin or coalesce(p.vendedor_id, pw.vendedor_id) = v_yo)
    order by a.created_at desc limit 300) x), '[]');
end $function$;

create or replace function public.ayuda_cliente_resolver(p_id bigint, p_respuesta text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_admin boolean := public.tiene_rol('admin'); v_vend uuid;
begin
  if not (v_admin or public.tiene_rol('vendedor')) then raise exception 'Sin permiso'; end if;
  select coalesce(p.vendedor_id, pw.vendedor_id) into v_vend from clientes_ayuda a
    left join pedidos p on p.id = a.pedido_id left join pedidos_web pw on pw.id = a.pedido_web_id where a.id = p_id;
  if not found then raise exception 'Ese reporte ya no existe'; end if;
  if not v_admin and v_vend is distinct from auth.uid() then raise exception 'Ese pedido no es tuyo'; end if;
  update clientes_ayuda set estado = 'resuelta', respuesta = nullif(left(trim(coalesce(p_respuesta, '')), 500), ''),
    resuelta_at = now(), resuelta_por = public.mi_nombre() where id = p_id;
end $function$;

create or replace function public.ayuda_cliente_reabrir(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_admin boolean := public.tiene_rol('admin'); v_vend uuid;
begin
  if not (v_admin or public.tiene_rol('vendedor')) then raise exception 'Sin permiso'; end if;
  select coalesce(p.vendedor_id, pw.vendedor_id) into v_vend from clientes_ayuda a
    left join pedidos p on p.id = a.pedido_id left join pedidos_web pw on pw.id = a.pedido_web_id where a.id = p_id;
  if not found then raise exception 'Ese reporte ya no existe'; end if;
  if not v_admin and v_vend is distinct from auth.uid() then raise exception 'Ese pedido no es tuyo'; end if;
  update clientes_ayuda set estado = 'abierta', resuelta_at = null, resuelta_por = null where id = p_id;
end $function$;
revoke all on function public.ayuda_clientes_lista(text), public.ayuda_cliente_resolver(bigint, text), public.ayuda_cliente_reabrir(bigint) from public, anon;
grant execute on function public.ayuda_clientes_lista(text), public.ayuda_cliente_resolver(bigint, text), public.ayuda_cliente_reabrir(bigint) to authenticated;
