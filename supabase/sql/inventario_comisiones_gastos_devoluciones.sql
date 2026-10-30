-- ============================================================================
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--  Kaesuri · Inventario y compras, liquidación de vendedores, gastos, devoluciones
--  y garantías, rentabilidad por producto y alertas de stock (como en Jasta)
--
--  Diferencias con Jasta:
--   · En Kaesuri todos los productos llevan inventario (stock se descuenta al crear
--     el pedido y vuelve al cancelarlo), así que no hay "controla_stock".
--   · La comisión de cada pedido ya está guardada en pedidos.comision.
--   · El costo está en productos.costo (no por línea): las devoluciones guardan una
--     copia del costo del momento.
--   · Los movimientos van en la tabla que ya existía, movimientos_inventario.
-- ============================================================================

-- Fotos (facturas, comprobantes) válidas: rutas del bucket privado "comprobantes", sin "..",
-- máximo 10. Las sube la app en la carpeta de quien las sube.
create or replace function public.comprobantes_validos(p text[])
returns text[] language sql immutable set search_path to '' as $$
  select coalesce((select array_agg(f) from (select f from unnest(coalesce(p, '{}')) f
                    where f <> '' and f not like '%..%' and length(f) < 300 limit 10) s), '{}')
$$;

-- ---------------------------------------------------------------- Inventario y compras
alter table public.productos add column if not exists stock_minimo integer not null default 3;
alter table public.movimientos_inventario add column if not exists tipo text;
alter table public.movimientos_inventario add column if not exists stock_antes integer;
alter table public.movimientos_inventario add column if not exists stock_despues integer;
alter table public.movimientos_inventario add column if not exists compra_id bigint;
alter table public.movimientos_inventario add column if not exists autor text;

create table if not exists public.compras (
  id bigint generated always as identity primary key,
  fecha date not null,
  proveedor text not null,
  nota text,
  total numeric not null default 0,
  comprobantes text[] not null default '{}',
  creado_por uuid references public.profiles(id),
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  anulada boolean not null default false
);
create table if not exists public.compra_items (
  id bigint generated always as identity primary key,
  compra_id bigint not null references public.compras(id),
  producto_id uuid not null references public.productos(id),
  nombre text not null,
  cantidad integer not null check (cantidad > 0),
  costo numeric not null check (costo >= 0)
);
create index if not exists compra_items_compra_idx on public.compra_items (compra_id);
create index if not exists compra_items_producto_idx on public.compra_items (producto_id);
create index if not exists compras_fecha_idx on public.compras (fecha desc);
alter table public.compras enable row level security;
alter table public.compra_items enable row level security;
revoke all on public.compras, public.compra_items from anon, authenticated;

create or replace function public.puede_inventario() returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.tiene_rol('admin', 'despachador')
$$;

-- Compra a proveedor: sube el stock y (si el admin lo pide) actualiza el costo del producto
create or replace function public.registrar_compra(p_fecha date, p_proveedor text, p_nota text, p_items jsonb, p_comprobantes text[], p_actualizar_costo boolean)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id bigint; it jsonb; pr productos; v_cant int; v_costo numeric; v_total numeric := 0;
  v_admin boolean := public.tiene_rol('admin'); v_yo uuid := auth.uid(); v_nombre text := (select nombre from profiles where id = auth.uid());
begin
  if not public.puede_inventario() then raise exception 'No tienes permiso para registrar compras'; end if;
  if nullif(trim(coalesce(p_proveedor, '')), '') is null then raise exception 'Escribe el proveedor'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un producto'; end if;
  insert into compras (fecha, proveedor, nota, comprobantes, creado_por, creado_por_nombre)
  values (coalesce(p_fecha, (now() at time zone 'America/Bogota')::date), left(trim(p_proveedor), 120), nullif(trim(coalesce(p_nota, '')), ''),
          public.comprobantes_validos(p_comprobantes), v_yo, v_nombre)
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::int;
    -- Quien despacha no ve costos: lo que registra queda con el costo actual del producto
    v_costo := case when v_admin then coalesce((it->>'costo')::numeric, 0) end;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    if v_costo < 0 then raise exception 'Costo inválido'; end if;
    select * into pr from productos where id = (it->>'producto_id')::uuid for update;
    if not found then raise exception 'Producto no encontrado'; end if;
    v_costo := coalesce(v_costo, pr.costo, 0);
    insert into compra_items (compra_id, producto_id, nombre, cantidad, costo) values (v_id, pr.id, pr.nombre, v_cant, v_costo);
    update productos set stock = stock + v_cant, updated_at = now(),
      costo = case when v_admin and p_actualizar_costo and v_costo > 0 then v_costo else costo end
    where id = pr.id;
    insert into movimientos_inventario (producto_id, usuario_id, cantidad, motivo, tipo, stock_antes, stock_despues, compra_id, autor)
    values (pr.id, v_yo, v_cant, 'Compra a ' || left(trim(p_proveedor), 120), 'compra', pr.stock, pr.stock + v_cant, v_id, v_nombre);
    v_total := v_total + v_cant * v_costo;
  end loop;
  update compras set total = v_total where id = v_id;
  return v_id;
end;
$function$;

create or replace function public.anular_compra(p_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_nombre text := (select nombre from profiles where id = auth.uid());
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede anular compras'; end if;
  update compras set anulada = true where id = p_id and not anulada;
  if not found then raise exception 'La compra no existe o ya estaba anulada'; end if;
  for r in select i.producto_id, i.cantidad, p.stock from compra_items i join productos p on p.id = i.producto_id where i.compra_id = p_id loop
    update productos set stock = stock - r.cantidad, updated_at = now() where id = r.producto_id;
    insert into movimientos_inventario (producto_id, usuario_id, cantidad, motivo, tipo, stock_antes, stock_despues, compra_id, autor)
    values (r.producto_id, auth.uid(), -r.cantidad, 'Compra anulada', 'anulacion', r.stock, r.stock - r.cantidad, p_id, v_nombre);
  end loop;
end;
$function$;

-- Conteo físico: el stock queda en lo que se contó y se guarda la diferencia
create or replace function public.ajustar_stock(p_producto uuid, p_contado integer, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare pr productos;
begin
  if not public.puede_inventario() then raise exception 'No tienes permiso para ajustar el inventario'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'Escribe cuántos hay'; end if;
  select * into pr from productos where id = p_producto for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if pr.stock = p_contado then return; end if;
  update productos set stock = p_contado, updated_at = now() where id = pr.id;
  insert into movimientos_inventario (producto_id, usuario_id, cantidad, motivo, tipo, stock_antes, stock_despues, autor)
  values (pr.id, auth.uid(), p_contado - pr.stock, coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Conteo'), 'ajuste', pr.stock, p_contado,
          (select nombre from profiles where id = auth.uid()));
end;
$function$;

create or replace function public.guardar_stock_minimo(p_producto uuid, p_minimo integer)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.puede_inventario() then raise exception 'Sin permiso'; end if;
  update productos set stock_minimo = greatest(coalesce(p_minimo, 0), 0) where id = p_producto;
end $function$;

-- Lista de inventario: stock, mínimo, lo vendido en 30 días y (solo admin) el costo
create or replace function public.inventario()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_admin boolean := public.tiene_rol('admin');
begin
  if not public.puede_inventario() then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'sku', p.sku, 'imagen_url', p.imagen_url, 'categoria', p.categoria, 'stock', p.stock,
      'stock_minimo', p.stock_minimo, 'costo', case when v_admin then p.costo end,
      'vendidos_30', coalesce(v.n, 0)) order by p.nombre), '[]'::jsonb)
    from productos p
    left join (select i.producto_id, sum(i.cantidad) n from pedido_items i join pedidos pe on pe.id = i.pedido_id
               where pe.estado = 'entregado' and pe.entregado_at >= now() - interval '30 days' group by 1) v on v.producto_id = p.id
    where p.activo);
end;
$function$;

-- Historial de un producto: compras, ajustes, devoluciones y ventas (lo más reciente primero)
create or replace function public.movimientos_producto(p_producto uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.puede_inventario() then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(x order by x->>'fecha' desc), '[]'::jsonb) from (
    (select jsonb_build_object('fecha', m.created_at, 'tipo', coalesce(m.tipo, case when m.motivo = 'venta' then 'venta' else 'ajuste' end),
        'cantidad', m.cantidad,
        'detalle', case when m.motivo = 'venta' then coalesce('Pedido #' || pe.numero || ' · ' || pe.cliente_nombre, 'Venta') else m.motivo end,
        'autor', coalesce(m.autor, u.nombre), 'stock_despues', m.stock_despues) x
       from movimientos_inventario m
       left join profiles u on u.id = m.usuario_id
       left join lateral (select x.numero, x.cliente_nombre from pedido_items i join pedidos x on x.id = i.pedido_id
                           where m.motivo = 'venta' and i.producto_id = m.producto_id and i.cantidad = -m.cantidad
                             and x.created_at between m.created_at - interval '1 minute' and m.created_at + interval '1 minute'
                           limit 1) pe on true
      where m.producto_id = p_producto order by m.created_at desc limit 80)) s);
end;
$function$;

create or replace function public.compras_lista(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_admin boolean := public.tiene_rol('admin');
begin
  if not public.puede_inventario() then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'fecha', c.fecha, 'proveedor', c.proveedor, 'nota', c.nota,
      'total', case when v_admin then c.total end, 'comprobantes', c.comprobantes, 'creado_por_nombre', c.creado_por_nombre,
      'created_at', c.created_at, 'anulada', c.anulada,
      'items', (select jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'costo', case when v_admin then i.costo end) order by i.id)
                from compra_items i where i.compra_id = c.id)) order by c.fecha desc, c.id desc), '[]'::jsonb)
    from compras c where c.fecha between p_desde and p_hasta);
end;
$function$;

revoke all on function public.registrar_compra(date, text, text, jsonb, text[], boolean), public.anular_compra(bigint),
  public.ajustar_stock(uuid, integer, text), public.guardar_stock_minimo(uuid, integer), public.inventario(),
  public.movimientos_producto(uuid), public.compras_lista(date, date) from public, anon;
grant execute on function public.registrar_compra(date, text, text, jsonb, text[], boolean), public.anular_compra(bigint),
  public.ajustar_stock(uuid, integer, text), public.guardar_stock_minimo(uuid, integer), public.inventario(),
  public.movimientos_producto(uuid), public.compras_lista(date, date) to authenticated;

-- ---------------------------------------------------------------- Liquidación de vendedores
-- La comisión de cada pedido entregado (pedidos.comision) se le paga al vendedor en una
-- liquidación. Solo cuentan los entregados desde configuracion.liquidar_desde (lo anterior
-- ya se pagó por fuera).
alter table public.configuracion add column if not exists liquidar_desde date;
update public.configuracion set liquidar_desde = coalesce(liquidar_desde, (now() at time zone 'America/Bogota')::date);

create table if not exists public.liquidaciones (
  id bigint generated always as identity primary key,
  vendedor_id uuid not null references public.profiles(id),
  desde date, hasta date,
  cantidad_pedidos integer not null default 0,
  total numeric not null default 0,
  metodo text not null default 'transferencia' check (metodo in ('efectivo', 'transferencia', 'otro')),
  comprobantes text[] not null default '{}',
  nota text,
  pagado_at timestamptz not null default now(),
  pagado_por uuid references public.profiles(id),
  pagado_por_nombre text,
  anulada boolean not null default false
);
create index if not exists liquidaciones_vendedor_idx on public.liquidaciones (vendedor_id, pagado_at desc);
alter table public.liquidaciones enable row level security;
revoke all on public.liquidaciones from anon, authenticated;
grant select on public.liquidaciones to authenticated;
create policy "liquidaciones: ver" on public.liquidaciones for select to authenticated
  using ((select public.tiene_rol('admin')) or vendedor_id = (select auth.uid()));

alter table public.pedidos add column if not exists liquidacion_id bigint references public.liquidaciones(id);
create index if not exists pedidos_por_liquidar_idx on public.pedidos (vendedor_id) where liquidacion_id is null and estado = 'entregado';

-- (El permiso para que el vendedor vea el comprobante de su pago está en PENDIENTE_correr_en_supabase.sql)

-- ---------------------------------------------------------------- Devoluciones y garantías
-- Una devolución sale de un pedido entregado: qué productos y cuántos, el tipo (devolución
-- con reembolso, cambio o garantía), el motivo y qué pasa con lo que regresa (vuelve al
-- inventario o se daña) y si se entrega otro. En una devolución con reembolso se le
-- descuenta al vendedor su ganancia de esas unidades en su próxima liquidación.
create table if not exists public.devoluciones (
  id bigint generated always as identity primary key,
  pedido_id uuid not null references public.pedidos(id),
  tipo text not null check (tipo in ('devolucion', 'cambio', 'garantia')),
  motivo text not null check (motivo in ('defectuoso', 'llego_danado', 'no_le_gusto', 'talla_color', 'incompleto', 'otro')),
  estado_producto text not null check (estado_producto in ('vuelve_stock', 'danado')),
  reemplazo boolean not null default false,
  reembolso numeric not null default 0 check (reembolso >= 0),
  metodo text check (metodo in ('efectivo', 'transferencia', 'otro')),
  comision_descuento numeric not null default 0,
  nota text,
  fotos text[] not null default '{}',
  liquidacion_id bigint references public.liquidaciones(id),
  creado_por uuid references public.profiles(id),
  creado_por_nombre text,
  created_at timestamptz not null default now()
);
create table if not exists public.devolucion_items (
  id bigint generated always as identity primary key,
  devolucion_id bigint not null references public.devoluciones(id),
  item_id uuid not null references public.pedido_items(id),
  producto_id uuid references public.productos(id),
  nombre text not null,
  cantidad integer not null check (cantidad > 0),
  precio_venta numeric not null default 0,
  precio_base numeric not null default 0,
  precio_compra numeric not null default 0
);
create index if not exists devoluciones_pedido_idx on public.devoluciones (pedido_id);
create index if not exists devoluciones_fecha_idx on public.devoluciones (created_at desc);
create index if not exists devolucion_items_dev_idx on public.devolucion_items (devolucion_id);
create index if not exists devolucion_items_item_idx on public.devolucion_items (item_id);
create index if not exists devolucion_items_prod_idx on public.devolucion_items (producto_id);
alter table public.devoluciones enable row level security;
alter table public.devolucion_items enable row level security;
revoke all on public.devoluciones, public.devolucion_items from anon, authenticated;

create or replace function public.puede_devoluciones() returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.tiene_rol('admin', 'despachador', 'venta_local')
$$;

create or replace function public.motivo_devolucion(p text) returns text language sql immutable set search_path to '' as $$
  select case p when 'defectuoso' then 'Salió defectuoso' when 'llego_danado' then 'Llegó dañado' when 'no_le_gusto' then 'No le gustó'
    when 'talla_color' then 'Talla o color' when 'incompleto' then 'Llegó incompleto' else 'Otro motivo' end
$$;

-- p_items: [{item_id, cantidad}]
create or replace function public.registrar_devolucion(p_pedido uuid, p_items jsonb, p_tipo text, p_motivo text, p_estado_producto text,
  p_reemplazo boolean, p_reembolso numeric, p_metodo text, p_descontar_comision boolean, p_nota text, p_fotos text[])
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  p pedidos; v_id bigint; it jsonb; i pedido_items; v_cant int; v_ya int; pr productos; v_nom text;
  v_com numeric := 0; v_n int := 0; v_txt text := ''; v_yo uuid := auth.uid(); v_autor text := (select nombre from profiles where id = auth.uid());
begin
  if not public.puede_devoluciones() then raise exception 'No tienes permiso para registrar devoluciones'; end if;
  select * into p from pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if p.estado <> 'entregado' then raise exception 'Solo se registran devoluciones de pedidos entregados'; end if;
  if p_tipo not in ('devolucion', 'cambio', 'garantia') then raise exception 'Tipo inválido'; end if;
  if p_estado_producto not in ('vuelve_stock', 'danado') then raise exception 'Estado del producto inválido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Elige qué productos devuelve'; end if;
  if p_tipo = 'devolucion' and coalesce(p_reembolso, 0) > p.total then raise exception 'El reembolso no puede ser mayor que el pedido'; end if;

  insert into devoluciones (pedido_id, tipo, motivo, estado_producto, reemplazo, reembolso, metodo, nota, fotos, creado_por, creado_por_nombre)
  values (p.id, p_tipo, coalesce(p_motivo, 'otro'), p_estado_producto, p_tipo <> 'devolucion' and coalesce(p_reemplazo, false),
          case when p_tipo = 'devolucion' then coalesce(p_reembolso, 0) else 0 end,
          case when p_tipo = 'devolucion' and coalesce(p_reembolso, 0) > 0 then coalesce(p_metodo, 'efectivo') end,
          nullif(trim(coalesce(p_nota, '')), ''), public.comprobantes_validos(p_fotos), v_yo, v_autor)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 then continue; end if;
    select * into i from pedido_items where id = (it->>'item_id')::uuid and pedido_id = p.id;
    if not found then raise exception 'Ese producto no es de este pedido'; end if;
    select * into pr from productos where id = i.producto_id for update;
    v_nom := coalesce(pr.nombre, 'Producto') || case when coalesce(i.color, '') <> '' or coalesce(i.talla, '') <> ''
               then ' (' || concat_ws(' · ', nullif(i.color, ''), 'Talla ' || nullif(i.talla, '')) || ')' else '' end;
    select coalesce(sum(di.cantidad), 0) into v_ya from devolucion_items di join devoluciones d on d.id = di.devolucion_id
      where di.item_id = i.id and d.tipo = 'devolucion';
    if p_tipo = 'devolucion' and v_ya + v_cant > i.cantidad then raise exception 'De % ya se devolvieron % de %', v_nom, v_ya, i.cantidad; end if;
    if v_cant > i.cantidad then raise exception 'De % solo se vendieron %', v_nom, i.cantidad; end if;
    insert into devolucion_items (devolucion_id, item_id, producto_id, nombre, cantidad, precio_venta, precio_base, precio_compra)
    values (v_id, i.id, i.producto_id, v_nom, v_cant, coalesce(i.precio_unitario, 0), coalesce(i.precio_base, 0), coalesce(pr.costo, 0));
    v_com := v_com + greatest(coalesce(i.precio_unitario, 0) - coalesce(i.precio_base, 0), 0) * v_cant;
    v_n := v_n + v_cant;
    v_txt := v_txt || case when v_txt = '' then '' else ', ' end || v_cant || ' ' || v_nom;

    if pr.id is not null then
      if p_estado_producto = 'vuelve_stock' then
        update productos set stock = stock + v_cant, updated_at = now() where id = pr.id;
        insert into movimientos_inventario (producto_id, usuario_id, cantidad, motivo, tipo, stock_antes, stock_despues, autor)
        values (pr.id, v_yo, v_cant, 'Devolución del pedido #' || p.numero, 'devolucion', pr.stock, pr.stock + v_cant, v_autor);
        pr.stock := pr.stock + v_cant;
      end if;
      if p_tipo <> 'devolucion' and coalesce(p_reemplazo, false) then
        update productos set stock = stock - v_cant, updated_at = now() where id = pr.id;
        insert into movimientos_inventario (producto_id, usuario_id, cantidad, motivo, tipo, stock_antes, stock_despues, autor)
        values (pr.id, v_yo, -v_cant, 'Reemplazo por ' || p_tipo || ' del pedido #' || p.numero, 'devolucion', pr.stock, pr.stock - v_cant, v_autor);
      end if;
    end if;
  end loop;
  if v_n = 0 then raise exception 'Escribe cuántas unidades devuelve'; end if;

  -- Comisión: solo en devolución con reembolso y si se pidió descontarla
  if p_tipo = 'devolucion' and coalesce(p_descontar_comision, true) and v_com > 0 and p.vendedor_id is not null then
    update devoluciones set comision_descuento = v_com where id = v_id;
    perform public.notificar(p.vendedor_id, 'devolucion', 'Devolución en el pedido #' || p.numero,
      v_txt || ' · se descuentan ' || public.fmt_pesos(v_com) || ' de tu comisión', 'comisiones');
  end if;
  return v_id;
end;
$function$;

create or replace function public.devoluciones_lista(p_desde date, p_hasta date)
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
begin
  if not public.puede_devoluciones() then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'lista', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', dv.id, 'pedido_id', dv.pedido_id, 'numero', pe.numero, 'cliente', pe.cliente_nombre, 'vendedor', v.nombre, 'tipo', dv.tipo,
        'motivo', public.motivo_devolucion(dv.motivo), 'estado_producto', dv.estado_producto, 'reemplazo', dv.reemplazo,
        'reembolso', dv.reembolso, 'metodo', dv.metodo, 'comision_descuento', dv.comision_descuento, 'nota', dv.nota, 'fotos', dv.fotos,
        'creado_por_nombre', dv.creado_por_nombre, 'fecha', dv.created_at,
        'perdida', case when v_admin then (select coalesce(sum(case when dv.estado_producto = 'danado' then di.precio_compra * di.cantidad else 0 end), 0)
                                            from devolucion_items di where di.devolucion_id = dv.id) end,
        'items', (select jsonb_agg(jsonb_build_object('nombre', di.nombre, 'cantidad', di.cantidad) order by di.id) from devolucion_items di where di.devolucion_id = dv.id))
        order by dv.created_at desc), '[]'::jsonb)
      from devoluciones dv join pedidos pe on pe.id = dv.pedido_id left join profiles v on v.id = pe.vendedor_id
      where dv.created_at >= d and dv.created_at < h),
    'por_motivo', (select coalesce(jsonb_agg(jsonb_build_object('motivo', public.motivo_devolucion(motivo), 'n', n) order by n desc), '[]'::jsonb)
      from (select motivo, count(*) n from devoluciones where created_at >= d and created_at < h group by 1) s)
  );
end;
$function$;

-- El pedido entregado con sus productos y lo que ya se devolvió de cada uno (para el formulario)
create or replace function public.pedido_para_devolucion(p_numero bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.puede_devoluciones() then raise exception 'Sin permiso'; end if;
  return (select jsonb_build_object('id', p.id, 'numero', p.numero, 'cliente_nombre', p.cliente_nombre, 'cliente_telefono', p.cliente_telefono,
      'estado', p.estado, 'total', p.total, 'entregado_at', p.entregado_at, 'vendedor', v.nombre,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'cantidad', i.cantidad, 'precio', i.precio_unitario,
                  'nombre', coalesce(pr.nombre, 'Producto') || case when coalesce(i.color, '') <> '' or coalesce(i.talla, '') <> ''
                    then ' (' || concat_ws(' · ', nullif(i.color, ''), 'Talla ' || nullif(i.talla, '')) || ')' else '' end,
                  'devueltas', (select coalesce(sum(di.cantidad), 0) from devolucion_items di join devoluciones d on d.id = di.devolucion_id
                                 where di.item_id = i.id and d.tipo = 'devolucion')) order by i.id), '[]'::jsonb)
                from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id))
    from pedidos p left join profiles v on v.id = p.vendedor_id where p.numero = p_numero);
end;
$function$;

revoke all on function public.registrar_devolucion(uuid, jsonb, text, text, text, boolean, numeric, text, boolean, text, text[]),
  public.devoluciones_lista(date, date), public.pedido_para_devolucion(bigint) from public, anon;
grant execute on function public.registrar_devolucion(uuid, jsonb, text, text, text, boolean, numeric, text, boolean, text, text[]),
  public.devoluciones_lista(date, date), public.pedido_para_devolucion(bigint) to authenticated;

-- ---------------------------------------------------------------- Liquidaciones (con descuentos por devolución)
-- Pedidos por liquidar (de un vendedor, o de todos para el admin): entregados, con vendedor
-- y comisión, desde liquidar_desde y sin liquidación
create or replace function public.por_liquidar(p_vendedor uuid)
returns table(id uuid, numero bigint, vendedor_id uuid, dia date, comision numeric, cliente_nombre text, total numeric)
language sql stable security definer set search_path to 'public' as $$
  select p.id, p.numero, p.vendedor_id, (coalesce(p.entregado_at, p.created_at) at time zone 'America/Bogota')::date, coalesce(p.comision, 0), p.cliente_nombre, p.total
  from pedidos p
  where p.estado = 'entregado' and p.liquidacion_id is null and p.vendedor_id is not null and coalesce(p.comision, 0) <> 0
    and (p_vendedor is null or p.vendedor_id = p_vendedor)
    and (coalesce(p.entregado_at, p.created_at) at time zone 'America/Bogota')::date >= coalesce((select liquidar_desde from configuracion limit 1), '2000-01-01')
$$;

-- Descuentos por devolución que entran en la próxima liquidación (líneas negativas)
create or replace function public.descuentos_por_liquidar(p_vendedor uuid)
returns table(devolucion_id bigint, pedido_id uuid, numero bigint, vendedor_id uuid, dia date, comision numeric, nombre text)
language sql stable security definer set search_path to 'public' as $$
  select d.id, d.pedido_id, p.numero, p.vendedor_id, (d.created_at at time zone 'America/Bogota')::date, -d.comision_descuento,
         'Devolución · ' || coalesce((select string_agg(di.cantidad || ' ' || di.nombre, ', ') from devolucion_items di where di.devolucion_id = d.id), '')
  from devoluciones d join pedidos p on p.id = d.pedido_id
  where d.comision_descuento > 0 and d.liquidacion_id is null and p.vendedor_id is not null
    and (p_vendedor is null or p.vendedor_id = p_vendedor)
$$;
revoke all on function public.por_liquidar(uuid), public.descuentos_por_liquidar(uuid) from public, anon, authenticated;

create or replace function public.liquidaciones_pendientes()
returns table(vendedor_id uuid, nombre text, pedidos bigint, total numeric, desde date, hasta date)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid(); v_v uuid;
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  v_v := case when public.tiene_rol('admin') then null else v_yo end;
  return query
    select x.vendedor_id, u.nombre, count(*) filter (where x.es_pedido), sum(x.comision), min(x.dia), max(x.dia)
    from (select l.vendedor_id, l.dia, l.comision, true es_pedido from public.por_liquidar(v_v) l
          union all
          select dl.vendedor_id, dl.dia, dl.comision, false from public.descuentos_por_liquidar(v_v) dl) x
    join profiles u on u.id = x.vendedor_id
    group by 1, 2 order by 4 desc;
end $function$;

-- Pedidos de una liquidación (o los pendientes del vendedor si p_liquidacion es null)
create or replace function public.liquidacion_pedidos(p_vendedor uuid, p_liquidacion bigint)
returns table(id uuid, numero bigint, dia date, cliente_nombre text, total numeric, comision numeric)
language plpgsql stable security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid();
begin
  if v_yo is null or not (public.tiene_rol('admin') or p_vendedor = v_yo) then raise exception 'Sin permiso'; end if;
  if p_liquidacion is null then
    return query
      select x.id, x.numero, x.dia, x.cliente_nombre, x.total, x.comision from (
        select l.id, l.numero, l.dia, l.cliente_nombre, l.total, l.comision from public.por_liquidar(p_vendedor) l
        union all
        select dl.pedido_id, dl.numero, dl.dia, dl.nombre, 0::numeric, dl.comision from public.descuentos_por_liquidar(p_vendedor) dl) x
      order by 3, 2;
  else
    return query
      select x.id, x.numero, x.dia, x.cliente_nombre, x.total, x.comision from (
        select p.id, p.numero, (coalesce(p.entregado_at, p.created_at) at time zone 'America/Bogota')::date dia, p.cliente_nombre, p.total, coalesce(p.comision, 0) comision
          from pedidos p where p.liquidacion_id = p_liquidacion and p.vendedor_id = p_vendedor
        union all
        select d.pedido_id, p.numero, (d.created_at at time zone 'America/Bogota')::date, 'Devolución', 0::numeric, -d.comision_descuento
          from devoluciones d join pedidos p on p.id = d.pedido_id where d.liquidacion_id = p_liquidacion) x
      order by 3, 2;
  end if;
end $function$;

-- El admin paga lo pendiente de un vendedor hasta un día (incluido)
create or replace function public.pagar_liquidacion(p_vendedor uuid, p_hasta date, p_metodo text, p_comprobantes text[], p_nota text)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint; v_n int; v_total numeric; v_desc numeric; v_desde date; v_hasta date;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin registra pagos a vendedores'; end if;
  if p_metodo not in ('efectivo', 'transferencia', 'otro') then raise exception 'Forma de pago inválida'; end if;
  select count(*), coalesce(sum(comision), 0), min(dia), max(dia) into v_n, v_total, v_desde, v_hasta
    from public.por_liquidar(p_vendedor) where dia <= p_hasta;
  select coalesce(sum(comision), 0) into v_desc from public.descuentos_por_liquidar(p_vendedor) where dia <= p_hasta;
  if v_n = 0 and v_desc = 0 then raise exception 'No hay comisiones pendientes hasta ese día'; end if;
  insert into liquidaciones (vendedor_id, desde, hasta, cantidad_pedidos, total, metodo, comprobantes, nota, pagado_por, pagado_por_nombre)
  values (p_vendedor, v_desde, v_hasta, v_n, v_total + v_desc, p_metodo, public.comprobantes_validos(p_comprobantes),
          nullif(trim(coalesce(p_nota, '')), ''), auth.uid(), (select nombre from profiles where id = auth.uid()))
  returning id into v_id;
  update pedidos set liquidacion_id = v_id where id in (select id from public.por_liquidar(p_vendedor) where dia <= p_hasta);
  update devoluciones set liquidacion_id = v_id where id in (select devolucion_id from public.descuentos_por_liquidar(p_vendedor) where dia <= p_hasta);
  perform public.notificar(p_vendedor, 'liquidacion', 'Te pagaron tus comisiones',
    public.fmt_pesos(v_total + v_desc) || ' · ' || v_n || ' pedidos · ' || p_metodo, 'comisiones');
  return v_id;
end $function$;

-- Pago registrado por error: sus pedidos y descuentos vuelven a quedar pendientes
create or replace function public.anular_liquidacion(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede anular un pago'; end if;
  update liquidaciones set anulada = true where id = p_id and not anulada;
  if not found then raise exception 'El pago no existe o ya estaba anulado'; end if;
  update pedidos set liquidacion_id = null where liquidacion_id = p_id;
  update devoluciones set liquidacion_id = null where liquidacion_id = p_id;
end $function$;

create or replace function public.guardar_liquidar_desde(p_dia date)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  if p_dia is null then raise exception 'Elige un día'; end if;
  update configuracion set liquidar_desde = p_dia;
end $function$;

create or replace function public.liquidar_desde()
returns date language sql stable security definer set search_path to 'public' as $$ select liquidar_desde from configuracion limit 1 $$;

revoke all on function public.liquidaciones_pendientes(), public.liquidacion_pedidos(uuid, bigint),
  public.pagar_liquidacion(uuid, date, text, text[], text), public.anular_liquidacion(bigint),
  public.guardar_liquidar_desde(date), public.liquidar_desde() from public, anon;
grant execute on function public.liquidaciones_pendientes(), public.liquidacion_pedidos(uuid, bigint),
  public.pagar_liquidacion(uuid, date, text, text[], text), public.anular_liquidacion(bigint),
  public.guardar_liquidar_desde(date), public.liquidar_desde() to authenticated;

-- ---------------------------------------------------------------- Gastos
create table if not exists public.gastos (
  id bigint generated always as identity primary key,
  fecha date not null,
  categoria text not null check (categoria in ('arriendo', 'nomina', 'publicidad', 'transporte', 'empaques', 'servicios', 'mantenimiento', 'impuestos', 'otros')),
  descripcion text not null,
  valor numeric not null check (valor > 0),
  metodo text not null default 'efectivo' check (metodo in ('efectivo', 'transferencia', 'otro')),
  comprobantes text[] not null default '{}',
  creado_por uuid references public.profiles(id),
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  anulado boolean not null default false
);
create index if not exists gastos_fecha_idx on public.gastos (fecha desc);
alter table public.gastos enable row level security;
revoke all on public.gastos from anon, authenticated;

create or replace function public.registrar_gasto(p_fecha date, p_categoria text, p_descripcion text, p_valor numeric, p_metodo text, p_comprobantes text[])
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin registra gastos'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Escribe el valor del gasto'; end if;
  if nullif(trim(coalesce(p_descripcion, '')), '') is null then raise exception 'Escribe en qué se gastó'; end if;
  insert into gastos (fecha, categoria, descripcion, valor, metodo, comprobantes, creado_por, creado_por_nombre)
  values (coalesce(p_fecha, (now() at time zone 'America/Bogota')::date), p_categoria, left(trim(p_descripcion), 300), p_valor,
          coalesce(p_metodo, 'efectivo'), public.comprobantes_validos(p_comprobantes), auth.uid(), (select nombre from profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end $function$;

-- Un gasto mal registrado se anula (queda en el historial, ya no suma)
create or replace function public.anular_gasto(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede anular gastos'; end if;
  update gastos set anulado = true where id = p_id and not anulado;
  if not found then raise exception 'El gasto no existe o ya estaba anulado'; end if;
end $function$;

-- Gastos del periodo y la utilidad real (ganancia de la tienda − gastos).
-- Ganancia de la tienda = (precio base − costo del producto) × cantidad, de los pedidos entregados.
create or replace function public.gastos_resumen(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_gan numeric; v_gastos numeric;
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  select coalesce(sum((coalesce(i.precio_base, 0) - coalesce(pr.costo, 0)) * i.cantidad), 0) into v_gan
    from pedidos p join pedido_items i on i.pedido_id = p.id left join productos pr on pr.id = i.producto_id
   where p.estado = 'entregado' and p.entregado_at >= d and p.entregado_at < h;
  select coalesce(sum(valor), 0) into v_gastos from gastos where not anulado and fecha between p_desde and p_hasta;
  return jsonb_build_object(
    'ganancia_tienda', v_gan,
    'gastos', v_gastos,
    'utilidad', v_gan - v_gastos,
    'por_categoria', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'total', t, 'n', n) order by t desc), '[]')
      from (select categoria, sum(valor) t, count(*) n from gastos where not anulado and fecha between p_desde and p_hasta group by 1) s),
    'lista', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'fecha', fecha, 'categoria', categoria, 'descripcion', descripcion, 'valor', valor,
        'metodo', metodo, 'comprobantes', comprobantes, 'creado_por_nombre', creado_por_nombre, 'created_at', created_at, 'anulado', anulado)
        order by fecha desc, id desc), '[]')
      from gastos where fecha between p_desde and p_hasta)
  );
end $function$;

revoke all on function public.registrar_gasto(date, text, text, numeric, text, text[]), public.anular_gasto(bigint),
  public.gastos_resumen(date, date) from public, anon;
grant execute on function public.registrar_gasto(date, text, text, numeric, text, text[]), public.anular_gasto(bigint),
  public.gastos_resumen(date, date) to authenticated;

-- ---------------------------------------------------------------- Rentabilidad por producto
-- Por producto, en los pedidos entregados del periodo (por fecha de entrega): unidades,
-- ventas, ganancia de la tienda y de los vendedores, y lo que restan las devoluciones del
-- periodo (ganancia perdida por reembolsos + costo de lo dañado).
create or replace function public.rentabilidad(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return (select coalesce(jsonb_agg(x order by (x->>'ganancia_neta')::numeric desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'producto_id', k.producto_id, 'nombre', coalesce(pr.nombre, 'Producto'), 'imagen_url', pr.imagen_url, 'activo', coalesce(pr.activo, false),
      'unidades', coalesce(v.unidades, 0), 'pedidos', coalesce(v.pedidos, 0),
      'ventas', coalesce(v.ventas, 0), 'ganancia_tienda', coalesce(v.gan_tienda, 0), 'ganancia_vendedoras', coalesce(v.gan_vend, 0),
      'costo', coalesce(v.costo, 0),
      'devueltas', coalesce(r.devueltas, 0), 'reembolsos', coalesce(r.reembolsos, 0), 'perdidas', coalesce(r.perdidas, 0),
      'novedades', coalesce(v.novedades, 0),
      'ganancia_neta', coalesce(v.gan_tienda, 0) - coalesce(r.perdidas, 0)) x
    from (
      select i.producto_id from pedido_items i join pedidos p on p.id = i.pedido_id
       where p.estado = 'entregado' and p.entregado_at >= d and p.entregado_at < h and i.producto_id is not null
      union
      select di.producto_id from devolucion_items di join devoluciones dv on dv.id = di.devolucion_id
       where dv.created_at >= d and dv.created_at < h and di.producto_id is not null
    ) k
    left join productos pr on pr.id = k.producto_id
    left join (
      select i.producto_id, sum(i.cantidad) unidades, count(distinct p.id) pedidos,
        sum(i.precio_unitario * i.cantidad) ventas,
        sum((coalesce(i.precio_base, 0) - coalesce(pr2.costo, 0)) * i.cantidad) gan_tienda,
        sum(greatest(coalesce(i.precio_unitario, 0) - coalesce(i.precio_base, 0), 0) * i.cantidad) gan_vend,
        sum(coalesce(pr2.costo, 0) * i.cantidad) costo,
        count(distinct p.id) filter (where p.novedades > 0) novedades
      from pedido_items i join pedidos p on p.id = i.pedido_id left join productos pr2 on pr2.id = i.producto_id
      where p.estado = 'entregado' and p.entregado_at >= d and p.entregado_at < h group by 1
    ) v on v.producto_id = k.producto_id
    left join (
      select di.producto_id,
        sum(di.cantidad) filter (where dv.tipo = 'devolucion') devueltas,
        sum(case when dv.tipo = 'devolucion' then di.precio_venta * di.cantidad else 0 end) reembolsos,
        sum(case when dv.tipo = 'devolucion' then (di.precio_base - di.precio_compra) * di.cantidad else 0 end
          + case when dv.estado_producto = 'danado' then di.precio_compra * di.cantidad else 0 end) perdidas
      from devolucion_items di join devoluciones dv on dv.id = di.devolucion_id
      where dv.created_at >= d and dv.created_at < h group by 1
    ) r on r.producto_id = k.producto_id
  ) s);
end $function$;
revoke all on function public.rentabilidad(date, date) from public, anon;
grant execute on function public.rentabilidad(date, date) to authenticated;
