-- ============================================================================
--  Kaesuri · Seguimiento para el cliente, calificación de la entrega y
--  "Mi resumen" del domiciliario (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
-- ============================================================================

-- ---------------------------------------------------------------- Seguimiento
-- Cada pedido tiene un código imposible de adivinar; con él, cualquiera (sin sesión)
-- ve el estado, las fechas y lo que compró. Nada de costos ni datos de otros pedidos.
-- El estado sale con los nombres de Jasta (por_alistar, alistado, despachado...) para
-- usar la misma página.
alter table public.pedidos add column if not exists seguimiento uuid not null default gen_random_uuid();
create unique index if not exists pedidos_seguimiento_idx on public.pedidos (seguimiento);

create table if not exists public.calificaciones (
  pedido_id uuid primary key references public.pedidos (id) on delete cascade,
  estrellas smallint not null check (estrellas between 1 and 5),
  comentario text,
  domiciliario_id uuid references public.profiles (id),
  vendedor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists calificaciones_fecha_idx on public.calificaciones (created_at desc);
alter table public.calificaciones enable row level security;
revoke all on public.calificaciones from anon, authenticated;

create or replace function public.seguimiento(p_codigo uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', p.numero,
    'estado', case when p.estado = 'pendiente' and p.alistado_at is null then 'por_alistar'
                   when p.estado = 'pendiente' then 'alistado'
                   when p.estado = 'en_ruta' then 'despachado'
                   else p.estado::text end,
    'creado_at', p.created_at, 'alistado_at', p.alistado_at,
    'en_ruta_at', case when p.estado in ('en_ruta', 'entregado') then p.asignado_at end,
    'entregado_at', p.entregado_at,
    'cliente', split_part(trim(p.cliente_nombre), ' ', 1), 'barrio', p.barrio,
    'total', p.total, 'domicilio', p.valor_domicilio, 'local', p.canal = 'local',
    'mensajero', case when p.estado in ('en_ruta', 'entregado') then split_part(trim(m.nombre), ' ', 1) end,
    'novedad', case when p.estado not in ('entregado', 'cancelado') then p.ultima_novedad end,
    'novedad_at', case when p.estado not in ('entregado', 'cancelado') then p.novedad_at end,
    'vendedora', split_part(trim(v.nombre), ' ', 1), 'vendedora_telefono', v.telefono,
    'negocio', c.nombre_negocio, 'telefonos', c.telefonos, 'garantia', c.texto_garantia,
    'calificacion', (select jsonb_build_object('estrellas', k.estrellas, 'comentario', k.comentario) from calificaciones k where k.pedido_id = p.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', coalesce(pr.nombre, 'Producto'), 'cantidad', i.cantidad, 'color', i.color, 'talla', i.talla) order by i.id)
                        from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id), '[]'::jsonb))
  from pedidos p
  left join profiles m on m.id = p.domiciliario_id
  left join profiles v on v.id = p.vendedor_id
  left join lateral (select nombre_negocio, telefonos, texto_garantia from configuracion limit 1) c on true
  where p.seguimiento = p_codigo
$function$;
revoke all on function public.seguimiento(uuid) from public;
grant execute on function public.seguimiento(uuid) to anon, authenticated;

-- ---------------------------------------------------------------- Calificación
-- Pública: el cliente califica desde su enlace (una vez, cuando ya se entregó).
-- 3 o menos: aviso a los admins; 5: aviso al domiciliario.
create or replace function public.calificar_entrega(p_codigo uuid, p_estrellas integer, p_comentario text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare p pedidos; v_com text := nullif(left(trim(coalesce(p_comentario, '')), 300), ''); v_dom text; v_cli text;
begin
  if p_estrellas is null or p_estrellas not between 1 and 5 then raise exception 'Elige de 1 a 5 estrellas'; end if;
  select * into p from pedidos where seguimiento = p_codigo;
  if not found then raise exception 'No encontramos este pedido'; end if;
  if p.estado <> 'entregado' then raise exception 'Podrás calificar cuando te entreguen el pedido'; end if;
  if exists (select 1 from calificaciones where pedido_id = p.id) then raise exception 'Ya calificaste este pedido. ¡Gracias!'; end if;
  insert into calificaciones (pedido_id, estrellas, comentario, domiciliario_id, vendedor_id)
  values (p.id, p_estrellas, v_com, p.domiciliario_id, p.vendedor_id);
  select split_part(trim(nombre), ' ', 1) into v_dom from profiles where id = p.domiciliario_id;
  v_cli := split_part(trim(p.cliente_nombre), ' ', 1);
  if p_estrellas <= 3 then
    perform public.notificar_roles(array['admin']::user_role[], 'calificacion_baja',
      repeat('★', p_estrellas) || repeat('☆', 5 - p_estrellas) || ' · pedido #' || p.numero,
      v_cli || ' calificó la entrega' || coalesce(' de ' || v_dom, '') || coalesce(': "' || v_com || '"', ''), 'pedidos');
  elsif p_estrellas = 5 and p.domiciliario_id is not null then
    perform public.notificar(p.domiciliario_id, 'calificacion_buena', '★★★★★ ¡Te calificaron con 5 estrellas!',
      v_cli || ' · pedido #' || p.numero || coalesce(': "' || v_com || '"', ''), 'inicio');
  end if;
end;
$function$;

-- Para Reportes (admin): promedio por domiciliario y los últimos comentarios del periodo
create or replace function public.calificaciones_resumen(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'total', (select jsonb_build_object('cantidad', count(*), 'promedio', round(avg(estrellas), 1))
              from calificaciones where created_at >= d and created_at < h),
    'entregados', (select count(*) from pedidos where estado = 'entregado' and entregado_at >= d and entregado_at < h and canal <> 'local'),
    'domiciliarios', (select coalesce(jsonb_agg(x order by (x->>'promedio')::numeric desc, (x->>'cantidad')::int desc), '[]') from (
      select jsonb_build_object('nombre', coalesce(u.nombre, 'Sin domiciliario'), 'cantidad', count(*), 'promedio', round(avg(k.estrellas), 1),
        'bajas', count(*) filter (where k.estrellas <= 3)) x
      from calificaciones k left join profiles u on u.id = k.domiciliario_id
      where k.created_at >= d and k.created_at < h group by u.id, u.nombre) s),
    'comentarios', (select coalesce(jsonb_agg(x), '[]') from (
      select jsonb_build_object('numero', p.numero, 'estrellas', k.estrellas, 'comentario', k.comentario, 'fecha', k.created_at,
        'cliente', split_part(trim(p.cliente_nombre), ' ', 1), 'domiciliario', split_part(trim(u.nombre), ' ', 1)) x
      from calificaciones k join pedidos p on p.id = k.pedido_id left join profiles u on u.id = k.domiciliario_id
      where k.created_at >= d and k.created_at < h and k.comentario is not null
      order by k.created_at desc limit 15) s));
end;
$function$;

revoke all on function public.calificar_entrega(uuid, integer, text) from public;
revoke all on function public.calificaciones_resumen(date, date) from public, anon;
grant execute on function public.calificar_entrega(uuid, integer, text) to anon, authenticated;
grant execute on function public.calificaciones_resumen(date, date) to authenticated;

-- El envío por WhatsApp está aparte: whatsapp_seguimiento.sql

-- ---------------------------------------------------------------- Mi resumen del domiciliario
-- Lo que ganó en domicilios en el periodo (y contra el periodo anterior del mismo largo),
-- entregas por día y por hora, barrios, efectividad, calificaciones y lo que tiene por cuadrar.
-- El domiciliario ve lo suyo; el admin puede ver el de cualquiera.
create or replace function public.barrio_normal(p text)
returns text language sql immutable set search_path to '' as $$
  select nullif(regexp_replace(lower(translate(trim(coalesce(p, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g'), '')
$$;

create or replace function public.resumen_domiciliario(p_desde date, p_hasta date, p_domiciliario uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_yo uuid := auth.uid();
  v_id uuid;
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_largo int := p_hasta - p_desde + 1;
  d0 timestamptz;
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  v_id := case when p_domiciliario is not null and public.tiene_rol('admin') then p_domiciliario else v_yo end;
  if v_id = v_yo and not public.tiene_rol('domiciliario', 'admin') then raise exception 'Sin permiso'; end if;
  if p_hasta < p_desde or v_largo > 400 then raise exception 'Rango de fechas inválido'; end if;
  d0 := ((p_desde - v_largo)::text || ' 00:00 America/Bogota')::timestamptz;
  return (
    with ent as (
      select p.*, case p.metodo_pago when 'efectivo' then p.total when 'mixto' then coalesce(p.monto_efectivo, 0) else 0 end efectivo
        from pedidos p
       where p.domiciliario_id = v_id and p.estado = 'entregado' and p.entregado_at >= d and p.entregado_at < h
    ), barrios as (
      select public.barrio_normal(barrio) k, count(*) n, sum(valor_domicilio) dom,
        (array_agg(trim(barrio) order by entregado_at desc))[1] visto
      from ent where public.barrio_normal(barrio) is not null group by 1
    )
    select jsonb_build_object(
      'nombre', (select nombre from profiles where id = v_id),
      'ganado', (select coalesce(sum(valor_domicilio), 0) from ent),
      'entregas', (select count(*) from ent),
      'dias_trabajados', (select count(distinct (entregado_at at time zone 'America/Bogota')::date) from ent),
      'anterior', (select jsonb_build_object('ganado', coalesce(sum(valor_domicilio), 0), 'entregas', count(*))
                   from pedidos where domiciliario_id = v_id and estado = 'entregado' and entregado_at >= d0 and entregado_at < d),
      'cancelados_en_ruta', (select count(*) from pedidos where domiciliario_id = v_id and estado = 'cancelado' and asignado_at >= d and asignado_at < h),
      'novedades', (select count(*) from pedido_novedades where domiciliario_id = v_id and created_at >= d and created_at < h),
      'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', g::date, 'entregas', coalesce(x.n, 0), 'ganado', coalesce(x.dom, 0)) order by g), '[]')
        from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') g
        left join (select (entregado_at at time zone 'America/Bogota')::date dia, count(*) n, sum(valor_domicilio) dom from ent group by 1) x on x.dia = g::date),
      'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', hr, 'entregas', n) order by hr), '[]') from (
        select extract(hour from entregado_at at time zone 'America/Bogota')::int hr, count(*) n from ent group by 1) s),
      'barrios', (select coalesce(jsonb_agg(jsonb_build_object('barrio', coalesce(t.nombre, b.visto), 'entregas', b.n, 'ganado', b.dom) order by b.n desc, b.dom desc), '[]')
        from (select * from barrios order by n desc, dom desc limit 8) b
        left join lateral (select nombre from zonas_domicilio z where public.barrio_normal(z.nombre) = b.k limit 1) t on true),
      'barrios_distintos', (select count(*) from barrios),
      'calificacion', (select jsonb_build_object('promedio', round(avg(estrellas), 1), 'cantidad', count(*))
                       from calificaciones where domiciliario_id = v_id and created_at >= d and created_at < h),
      'comentarios', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('estrellas', k.estrellas, 'comentario', k.comentario, 'fecha', k.created_at) x
        from calificaciones k where k.domiciliario_id = v_id and k.comentario is not null and k.created_at >= d and k.created_at < h
        order by k.created_at desc limit 5) s),
      'por_cuadrar', (select jsonb_build_object('pedidos', count(*),
                        'efectivo', coalesce(sum(case metodo_pago when 'efectivo' then total when 'mixto' then coalesce(monto_efectivo, 0) else 0 end), 0),
                        'domicilios', coalesce(sum(valor_domicilio), 0))
                      from pedidos where domiciliario_id = v_id and estado = 'entregado' and cuadre_id is null)
    ));
end;
$function$;
revoke all on function public.resumen_domiciliario(date, date, uuid) from public, anon;
grant execute on function public.resumen_domiciliario(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------- Código de seguimiento de un pedido
-- Para que el vendedor comparta el enlace desde su panel (solo sus pedidos; la oficina, todos)
create or replace function public.codigo_seguimiento(p_pedido uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.seguimiento from pedidos p
   where p.id = p_pedido
     and (p.vendedor_id = auth.uid() or public.tiene_rol('admin', 'despachador', 'venta_local'));
$function$;
revoke all on function public.codigo_seguimiento(uuid) from public, anon;
grant execute on function public.codigo_seguimiento(uuid) to authenticated;
