-- ============================================================================
--  Kaesuri · Novedades de entrega, devolver una entrega y QR de pago (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
-- ============================================================================

-- ---------------------------------------------------------------- Novedades
-- El domiciliario no pudo entregar: queda el motivo y qué pasó con el pedido
-- (sigue en ruta para reintentar, o vuelve a la tienda como alistado sin domiciliario).
create table if not exists public.pedido_novedades (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  domiciliario_id uuid references public.profiles(id),
  motivo text not null check (motivo in ('no_contesta', 'direccion', 'sin_dinero', 'no_estaba', 'rechazo', 'reprogramar', 'otro')),
  detalle text,
  accion text not null check (accion in ('reintentar', 'devolver')),
  autor text,
  created_at timestamptz not null default now()
);
create index if not exists pedido_novedades_pedido_idx on public.pedido_novedades (pedido_id);
create index if not exists pedido_novedades_fecha_idx on public.pedido_novedades (created_at desc);
alter table public.pedido_novedades enable row level security;
revoke all on public.pedido_novedades from anon, authenticated;

alter table public.pedidos add column if not exists novedades integer not null default 0;
alter table public.pedidos add column if not exists ultima_novedad text;
alter table public.pedidos add column if not exists novedad_at timestamptz;

create or replace function public.motivo_novedad(p text) returns text language sql immutable set search_path to '' as $$
  select case p when 'no_contesta' then 'No contesta' when 'direccion' then 'Dirección errada'
    when 'sin_dinero' then 'No tenía la plata' when 'no_estaba' then 'No estaba' when 'rechazo' then 'No lo quiso recibir'
    when 'reprogramar' then 'Pidió otro día' else 'Otro motivo' end
$$;

create or replace function public.reportar_novedad(p_pedido uuid, p_motivo text, p_detalle text, p_accion text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p pedidos;
  v_yo uuid := auth.uid();
  v_label text := public.motivo_novedad(p_motivo);
  v_det text := nullif(trim(coalesce(p_detalle, '')), '');
  v_aviso text;
begin
  select * into p from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if not (p.domiciliario_id = v_yo or public.tiene_rol('admin', 'despachador')) then raise exception 'Este pedido no está asignado a ti'; end if;
  if p.estado <> 'en_ruta' then raise exception 'El pedido no está en ruta'; end if;
  if p_motivo not in ('no_contesta', 'direccion', 'sin_dinero', 'no_estaba', 'rechazo', 'reprogramar', 'otro') then raise exception 'Motivo inválido'; end if;
  if p_accion not in ('reintentar', 'devolver') then raise exception 'Acción inválida'; end if;
  if p_motivo = 'otro' and v_det is null then raise exception 'Cuenta qué pasó'; end if;
  insert into pedido_novedades (pedido_id, domiciliario_id, motivo, detalle, accion, autor)
  values (p.id, p.domiciliario_id, p_motivo, left(v_det, 500), p_accion, (select nombre from profiles where id = v_yo));
  -- Devolver: vuelve a la tienda como alistado (sigue con alistado_at), sin domiciliario
  update pedidos set novedades = novedades + 1, ultima_novedad = v_label, novedad_at = now(),
    estado = case when p_accion = 'devolver' then 'pendiente' else estado end,
    domiciliario_id = case when p_accion = 'devolver' then null else domiciliario_id end,
    asignado_at = case when p_accion = 'devolver' then null else asignado_at end
  where id = p.id;
  v_aviso := v_label || coalesce(': ' || v_det, '') || ' · ' || p.cliente_nombre
    || case when p_accion = 'devolver' then ' · vuelve a la tienda' else ' · se reintenta' end;
  perform public.notificar(p.vendedor_id, 'novedad', 'Novedad en el pedido #' || p.numero, v_aviso, 'pedidos');
  perform public.notificar_roles(array['admin', 'despachador']::user_role[], 'novedad', 'Novedad en el pedido #' || p.numero, v_aviso, 'pedidos');
end;
$function$;
revoke all on function public.reportar_novedad(uuid, text, text, text) from public, anon;
grant execute on function public.reportar_novedad(uuid, text, text, text) to authenticated;

-- Abiertas (pedidos con novedad que aún no se entregan ni cancelan), historial del periodo y resúmenes
create or replace function public.novedades(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_yo uuid := auth.uid();
  v_todo boolean := public.tiene_rol('admin', 'despachador');
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'abiertas', (select coalesce(jsonb_agg(x order by x->>'novedad_at' desc), '[]') from (
      select jsonb_build_object('id', p.id, 'numero', p.numero, 'cliente_nombre', p.cliente_nombre, 'cliente_telefono', p.cliente_telefono,
        'barrio', p.barrio, 'direccion', p.direccion, 'total', p.total, 'estado', p.estado, 'novedades', p.novedades,
        'ultima_novedad', p.ultima_novedad, 'novedad_at', p.novedad_at, 'vendedor', v.nombre, 'domiciliario', m.nombre,
        'detalle', (select n.detalle from pedido_novedades n where n.pedido_id = p.id order by n.id desc limit 1)) x
      from pedidos p left join profiles v on v.id = p.vendedor_id left join profiles m on m.id = p.domiciliario_id
      where p.novedades > 0 and p.estado not in ('entregado', 'cancelado')
        and (v_todo or p.vendedor_id = v_yo or p.domiciliario_id = v_yo)) s),
    'historial', (select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]') from (
      select jsonb_build_object('id', n.id, 'pedido_id', p.id, 'numero', p.numero, 'fecha', n.created_at, 'motivo', n.motivo,
        'motivo_label', public.motivo_novedad(n.motivo), 'detalle', n.detalle, 'accion', n.accion, 'autor', n.autor,
        'domiciliario', m.nombre, 'cliente_nombre', p.cliente_nombre, 'barrio', p.barrio, 'estado', p.estado, 'vendedor', v.nombre) x
      from pedido_novedades n join pedidos p on p.id = n.pedido_id
      left join profiles m on m.id = n.domiciliario_id left join profiles v on v.id = p.vendedor_id
      where n.created_at >= d and n.created_at < h and (v_todo or p.vendedor_id = v_yo or n.domiciliario_id = v_yo)
      limit 300) s),
    'por_motivo', (select coalesce(jsonb_agg(jsonb_build_object('motivo', public.motivo_novedad(motivo), 'n', c) order by c desc), '[]') from (
      select n.motivo, count(*) c from pedido_novedades n join pedidos p on p.id = n.pedido_id
      where n.created_at >= d and n.created_at < h and (v_todo or p.vendedor_id = v_yo or n.domiciliario_id = v_yo) group by 1) s),
    'por_domiciliario', (select coalesce(jsonb_agg(jsonb_build_object('nombre', coalesce(m.nombre, '—'), 'n', c) order by c desc), '[]') from (
      select n.domiciliario_id, count(*) c from pedido_novedades n join pedidos p on p.id = n.pedido_id
      where n.created_at >= d and n.created_at < h and (v_todo or p.vendedor_id = v_yo or n.domiciliario_id = v_yo) group by 1) s
      left join profiles m on m.id = s.domiciliario_id)
  );
end;
$function$;
revoke all on function public.novedades(date, date) from public, anon;
grant execute on function public.novedades(date, date) to authenticated;

-- ---------------------------------------------------------------- Devolver una entrega
-- Admin: un pedido marcado como entregado por error (p. ej. con el comprobante equivocado)
-- vuelve a En ruta con el mismo domiciliario, para entregarlo de nuevo con el soporte correcto.
-- Solo si todavía no entró a un cuadre. El stock no se toca (se descontó al crear el pedido).
create or replace function public.devolver_entrega(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare p pedidos;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede devolver una entrega'; end if;
  select * into p from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if p.estado <> 'entregado' then raise exception 'El pedido no está entregado'; end if;
  if p.cuadre_id is not null then raise exception 'El pedido ya está en un cuadre: no se puede devolver'; end if;
  if p.domiciliario_id is null then raise exception 'El pedido no tiene domiciliario'; end if;
  update pedidos set estado = 'en_ruta', entregado_at = null, metodo_pago = null,
    comprobante_url = null, comprobantes = null
  where id = p_pedido;
  perform public.notificar(p.domiciliario_id, 'pedido_asignado', 'El pedido #' || p.numero || ' volvió a tu ruta',
    'El admin devolvió la entrega: entrégalo de nuevo con el comprobante correcto.', 'inicio');
end;
$function$;
revoke all on function public.devolver_entrega(uuid) from public, anon;
grant execute on function public.devolver_entrega(uuid) to authenticated;

-- ---------------------------------------------------------------- Cuentas para recibir transferencias
-- El admin las pone en Configuración (banco, titular, número y la foto del QR). El equipo las ve
-- para mostrarle el QR al cliente al entregar (Mis entregas) o en el local.
create table if not exists public.cuentas_pago (
  id bigint generated always as identity primary key,
  nombre text not null check (length(trim(nombre)) between 2 and 60),
  titular text,
  numero text,
  qr_url text,
  activa boolean not null default true,
  orden int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.cuentas_pago enable row level security;
create policy "cuentas_pago: ver equipo" on public.cuentas_pago for select to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and coalesce(activo, true)));
create policy "cuentas_pago: admin" on public.cuentas_pago for all to authenticated
  using ((select public.tiene_rol('admin'))) with check ((select public.tiene_rol('admin')));
revoke all on public.cuentas_pago from anon;
grant select, insert, update, delete on public.cuentas_pago to authenticated;
