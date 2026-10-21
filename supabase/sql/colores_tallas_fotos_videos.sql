-- ============================================================================
--  Kaesuri · Colores, tallas, fotos y videos de productos (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  · producto_colores: cada producto puede tener varios colores, con nombre, tono y
--    su propia foto (bucket "productos", carpeta colores/).
--  · productos.imagenes: fotos aparte de la principal y de los colores (máx. 12).
--  · productos.tallas: tallas disponibles (vacío = no maneja tallas, máx. 40).
--  · productos.videos: hasta 3 videos (bucket público "videos", máx. 20 MB cada uno).
--  · pedido_items.color / talla: lo que eligió el vendedor (texto, se conserva aunque
--    después se borre el color o la talla del producto). crear_pedido los guarda.
--  Lo ven todos los usuarios con sesión; solo el admin crea, cambia o quita.
-- ============================================================================

create table if not exists public.producto_colores (
  id bigint generated always as identity primary key,
  producto_id uuid not null references public.productos(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 1 and 40),
  hex text check (hex is null or hex ~ '^#[0-9a-fA-F]{6}$'),
  imagen_url text,
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists producto_colores_producto_idx on public.producto_colores (producto_id, orden);
alter table public.producto_colores enable row level security;
create policy producto_colores_ver on public.producto_colores for select to authenticated using (true);
create policy producto_colores_admin on public.producto_colores for all to authenticated
  using ((select public.tiene_rol('admin'))) with check ((select public.tiene_rol('admin')));

alter table public.productos add column if not exists imagenes text[] not null default '{}',
  add column if not exists tallas text[] not null default '{}',
  add column if not exists videos text[] not null default '{}';
alter table public.productos add constraint productos_extras_max
  check (cardinality(tallas) <= 40 and cardinality(imagenes) <= 12 and cardinality(videos) <= 3);

alter table public.pedido_items add column if not exists color text check (color is null or length(color) <= 40),
  add column if not exists talla text check (talla is null or length(talla) <= 40);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 20971520, array['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'video/x-m4v'])
on conflict (id) do nothing;
create policy "videos: admin" on storage.objects for all to authenticated
  using (bucket_id = 'videos' and (select public.tiene_rol('admin')))
  with check (bucket_id = 'videos' and (select public.tiene_rol('admin')));

-- crear_pedido: igual que antes, y guarda el color y la talla de cada línea
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
    insert into public.pedido_items (pedido_id, producto_id, cantidad, precio_unitario, precio_base, color, talla)
    values (
      v_pedido_id,
      (v_item->>'producto_id')::uuid,
      (v_item->>'cantidad')::int,
      (v_item->>'precio_unitario')::numeric,
      (v_item->>'precio_base')::numeric,
      nullif(left(trim(v_item->>'color'), 40), ''),
      nullif(left(trim(v_item->>'talla'), 40), '')
    );
  end loop;

  return v_numero;
end;
$function$;
