-- ============================================================================
--  Kaesuri · Colores y tallas agotados (como en Jasta). YA APLICADO en Supabase.
--  En Inventario se marca un color o una talla como agotado: deja de salir en la tienda y no se
--  puede pedir (ni en la tienda ni en Nuevo pedido, que los esconde). El producto sigue a la
--  venta con lo demás.
-- ============================================================================

alter table public.producto_colores add column if not exists disponible boolean not null default true;
alter table public.productos add column if not exists tallas_agotadas text[] not null default '{}';

create or replace function public.guardar_variantes_agotadas(p_producto uuid, p_colores_agotados text[], p_tallas_agotadas text[])
returns void language plpgsql security definer set search_path to 'public' as $function$
declare pr productos;
begin
  if not public.puede_inventario() then raise exception 'No tienes permiso para cambiar el inventario'; end if;
  select * into pr from productos where id = p_producto for update;
  if not found then raise exception 'Ese producto no existe'; end if;
  update producto_colores set disponible = not (nombre = any (coalesce(p_colores_agotados, '{}'))) where producto_id = pr.id;
  update productos set tallas_agotadas = array(select t from unnest(coalesce(p_tallas_agotadas, '{}')) t where t = any (coalesce(pr.tallas, '{}'))),
    updated_at = now() where id = pr.id;
end $function$;
revoke all on function public.guardar_variantes_agotadas(uuid, text[], text[]) from public, anon;
grant execute on function public.guardar_variantes_agotadas(uuid, text[], text[]) to authenticated;

do $$
declare v text;
begin
  -- Inventario: cuántos colores y tallas tiene cada producto y cuántos están agotados
  v := pg_get_functiondef('public.inventario()'::regprocedure);
  if position('''variantes''' in v) = 0 then
    v := replace(v, '''vendidos_30'', coalesce(v.n, 0))',
      '''vendidos_30'', coalesce(v.n, 0),
      ''variantes'', cardinality(coalesce(p.tallas, ''{}'')) + (select count(*) from producto_colores c where c.producto_id = p.id),
      ''agotadas'', cardinality(coalesce(p.tallas_agotadas, ''{}'')) + (select count(*) from producto_colores c where c.producto_id = p.id and not c.disponible))');
    if position('''variantes''' in v) = 0 then raise exception 'No se pudo cambiar inventario'; end if;
    execute v;
  end if;

  -- Tienda: solo colores y tallas disponibles; si no queda ninguno, el producto sale agotado
  v := pg_get_functiondef('public.tienda(text)'::regprocedure);
  if position('tallas_agotadas' in v) = 0 then
    v := replace(v, '''tallas'', coalesce(p.tallas, ''{}''),',
      '''tallas'', coalesce((select array_agg(t) from unnest(p.tallas) t where not (t = any (coalesce(p.tallas_agotadas, ''{}'')))), ''{}''),');
    v := replace(v, 'from producto_colores c where c.producto_id = p.id),',
      'from producto_colores c where c.producto_id = p.id and c.disponible),');
    v := replace(v, '''agotado'', p.stock <= 0,',
      '''agotado'', p.stock <= 0
          or (exists (select 1 from producto_colores c where c.producto_id = p.id)
              and not exists (select 1 from producto_colores c where c.producto_id = p.id and c.disponible))
          or (cardinality(coalesce(p.tallas, ''{}'')) > 0 and coalesce(p.tallas, ''{}'') <@ coalesce(p.tallas_agotadas, ''{}'')),');
    if position('tallas_agotadas' in v) = 0 or position('c.disponible' in v) = 0 then raise exception 'No se pudo cambiar tienda'; end if;
    execute v;
  end if;

  -- Pedir desde la tienda: no deja un color o talla agotados
  v := pg_get_functiondef('public.tienda_pedir(text,text,text,text,text,text,jsonb)'::regprocedure);
  if position('tallas_agotadas' in v) = 0 then
    v := replace(v, '    v_items := v_items || jsonb_build_object(''producto_id'', pr.id,',
      '    if v_color is not null and exists (select 1 from producto_colores c where c.producto_id = pr.id and c.nombre = v_color and not c.disponible) then
      raise exception ''El color % de % se agotó. Elige otro.'', v_color, pr.nombre;
    end if;
    if v_talla = any (coalesce(pr.tallas_agotadas, ''{}'')) then raise exception ''La talla % de % se agotó. Elige otra.'', v_talla, pr.nombre; end if;
    v_items := v_items || jsonb_build_object(''producto_id'', pr.id,');
    if position('tallas_agotadas' in v) = 0 then raise exception 'No se pudo cambiar tienda_pedir'; end if;
    execute v;
  end if;
end $$;
