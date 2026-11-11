-- ============================================================================
--  Kaesuri · Garantías con técnico y cambio por otro producto (como en Jasta). YA APLICADO.
--  * Una garantía ya no toca el inventario; se escribe por qué se deja (nota obligatoria) y
--    después se registra el técnico, la fecha, las observaciones y si quedó resuelta.
--  * Cambio por otro producto más caro: lo devuelto sigue igual (vuelve al inventario o queda
--    dañado), el producto nuevo sale del inventario al precio del catálogo y el cliente paga la
--    diferencia. Si la paga en efectivo, entra sola a la caja del local. La ganancia del cambio
--    suma en la utilidad (Gastos).
-- ============================================================================

alter table public.devoluciones
  add column if not exists tecnico text,
  add column if not exists tecnico_fecha date,
  add column if not exists tecnico_obs text,
  add column if not exists resuelta_at timestamptz,
  add column if not exists nuevo_producto_id uuid references public.productos(id),
  add column if not exists nuevo_nombre text,
  add column if not exists nuevo_cantidad int,
  add column if not exists nuevo_precio numeric,
  add column if not exists nuevo_costo numeric,
  add column if not exists diferencia numeric not null default 0,
  add column if not exists diferencia_metodo text,
  add column if not exists ajuste_ganancia numeric not null default 0;

do $$
declare v text;
begin
  -- Garantía: no toca inventario y la nota es obligatoria; el reemplazo solo aplica a cambios
  v := replace(pg_get_functiondef('public.registrar_devolucion(uuid,jsonb,text,text,text,boolean,numeric,text,boolean,text,text[])'::regprocedure), chr(13), '');
  if position('garantía ya no toca' in v) = 0 then
    v := replace(v, '  if p_tipo not in (''devolucion'', ''cambio'', ''garantia'') then raise exception ''Tipo inválido''; end if;',
      '  if p_tipo not in (''devolucion'', ''cambio'', ''garantia'') then raise exception ''Tipo inválido''; end if;
  -- La garantía ya no toca el inventario: solo se escribe por qué se deja
  if p_tipo = ''garantia'' and nullif(trim(coalesce(p_nota, '''')), '''') is null then raise exception ''Escribe por qué se deja en garantía''; end if;');
    v := replace(v, 'p_estado_producto, p_tipo <> ''devolucion'' and coalesce(p_reemplazo, false),',
      'p_estado_producto, p_tipo = ''cambio'' and coalesce(p_reemplazo, false),');
    v := replace(v, '    if pr.id is not null then', '    if pr.id is not null and p_tipo <> ''garantia'' then');
    v := replace(v, '      if p_tipo <> ''devolucion'' and coalesce(p_reemplazo, false) then', '      if p_tipo = ''cambio'' and coalesce(p_reemplazo, false) then');
    if position('garantía ya no toca' in v) = 0 or position('p_tipo <> ''garantia'' then' in v) = 0
       or position('p_tipo = ''cambio'' and coalesce(p_reemplazo, false),' in v) = 0
       or position('if p_tipo = ''cambio'' and coalesce(p_reemplazo, false) then' in v) = 0 then
      raise exception 'No se pudo cambiar registrar_devolucion';
    end if;
    execute v;
  end if;

  -- Lista: técnico y producto nuevo / diferencia
  v := replace(pg_get_functiondef('public.devoluciones_lista(date,date)'::regprocedure), chr(13), '');
  if position('tecnico' in v) = 0 then
    v := replace(v, '''nota'', dv.nota, ''fotos'', dv.fotos,',
      '''nota'', dv.nota, ''fotos'', dv.fotos, ''tecnico'', dv.tecnico, ''tecnico_fecha'', dv.tecnico_fecha, ''tecnico_obs'', dv.tecnico_obs,
        ''resuelta'', dv.resuelta_at is not null, ''nuevo_nombre'', dv.nuevo_nombre, ''nuevo_cantidad'', dv.nuevo_cantidad,
        ''diferencia'', dv.diferencia, ''diferencia_metodo'', dv.diferencia_metodo,');
    if position('''tecnico''' in v) = 0 then raise exception 'No se pudo cambiar devoluciones_lista'; end if;
    execute v;
  end if;

  -- Utilidad: suma la ganancia de los cambios por otro producto
  v := replace(pg_get_functiondef('public.gastos_resumen(date,date)'::regprocedure), chr(13), '');
  if position('ganancia_cambios' in v) = 0 then
    v := replace(v, 'v_gan numeric; v_gastos numeric;', 'v_gan numeric; v_gastos numeric; v_cambios numeric;');
    v := replace(v, '  select coalesce(sum(valor), 0) into v_gastos', '  select coalesce(sum(ajuste_ganancia), 0) into v_cambios from devoluciones
   where nuevo_producto_id is not null and created_at >= d and created_at < h;
  select coalesce(sum(valor), 0) into v_gastos');
    v := replace(v, '''utilidad'', v_gan - v_gastos,', '''ganancia_cambios'', v_cambios,
    ''utilidad'', v_gan + v_cambios - v_gastos,');
    if position('''ganancia_cambios''' in v) = 0 or position('into v_cambios' in v) = 0 then raise exception 'No se pudo cambiar gastos_resumen'; end if;
    execute v;
  end if;
end $$;

-- Seguimiento de la garantía
create or replace function public.garantia_tecnico(p_id bigint, p_tecnico text, p_fecha date, p_obs text, p_resuelta boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare d devoluciones;
begin
  if not public.puede_devoluciones() then raise exception 'Sin permiso'; end if;
  select * into d from devoluciones where id = p_id for update;
  if not found or d.tipo <> 'garantia' then raise exception 'Esa garantía no existe'; end if;
  if public.texto_limpio(p_tecnico, 80) is null then raise exception 'Escribe el nombre del técnico'; end if;
  if p_fecha is null then raise exception 'Elige la fecha'; end if;
  update devoluciones set tecnico = public.texto_limpio(p_tecnico, 80), tecnico_fecha = p_fecha, tecnico_obs = public.texto_limpio(p_obs, 600),
    resuelta_at = case when coalesce(p_resuelta, false) then coalesce(resuelta_at, now()) end
   where id = d.id;
end $function$;
revoke all on function public.garantia_tecnico(bigint, text, date, text, boolean) from public, anon;
grant execute on function public.garantia_tecnico(bigint, text, date, text, boolean) to authenticated;

-- Cambio por otro producto más caro
create or replace function public.registrar_cambio_otro(p_pedido uuid, p_items jsonb, p_motivo text, p_estado_producto text,
  p_producto_nuevo uuid, p_cantidad_nuevo int, p_metodo text, p_nota text, p_fotos text[])
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint; pr productos; v_valor numeric; v_costo_dev numeric; v_cant int := coalesce(p_cantidad_nuevo, 0);
  v_total numeric; v_dif numeric; v_ajuste numeric; v_caja boolean := false; v_num bigint;
begin
  if not public.puede_devoluciones() then raise exception 'No tienes permiso para registrar cambios'; end if;
  if v_cant <= 0 then raise exception 'Escribe cuántas unidades del producto nuevo'; end if;
  if coalesce(p_metodo, '') not in ('efectivo', 'transferencia', 'otro') then raise exception 'Elige cómo pagó la diferencia'; end if;
  select * into pr from productos where id = p_producto_nuevo and activo for update;
  if not found then raise exception 'El producto nuevo no existe'; end if;
  if pr.stock < v_cant then raise exception 'Solo quedan % de %', greatest(pr.stock, 0), pr.nombre; end if;

  v_id := public.registrar_devolucion(p_pedido, p_items, 'cambio', p_motivo, p_estado_producto, false, 0, null, false, p_nota, p_fotos);
  select coalesce(sum(precio_venta * cantidad), 0), coalesce(sum(precio_compra * cantidad), 0) into v_valor, v_costo_dev
    from devolucion_items where devolucion_id = v_id;
  select numero into v_num from pedidos where id = p_pedido;
  select * into pr from productos where id = p_producto_nuevo;

  v_total := coalesce(pr.precio_sugerido, 0) * v_cant;
  v_dif := v_total - v_valor;
  if v_dif < 0 then raise exception 'El producto nuevo vale menos (% vs %): para eso usa Devolución', public.fmt_pesos(v_total), public.fmt_pesos(v_valor); end if;
  v_ajuste := v_dif - coalesce(pr.costo, 0) * v_cant + case when p_estado_producto = 'vuelve_stock' then v_costo_dev else 0 end;

  update productos set stock = stock - v_cant, updated_at = now() where id = pr.id;
  insert into movimientos_inventario (producto_id, usuario_id, cantidad, motivo, tipo, stock_antes, stock_despues, autor)
  values (pr.id, auth.uid(), -v_cant, 'Cambio del pedido #' || v_num, 'devolucion', pr.stock, pr.stock - v_cant, public.mi_nombre());

  update devoluciones set nuevo_producto_id = pr.id, nuevo_nombre = pr.nombre, nuevo_cantidad = v_cant, nuevo_precio = pr.precio_sugerido,
    nuevo_costo = coalesce(pr.costo, 0), diferencia = v_dif, diferencia_metodo = case when v_dif > 0 then p_metodo end, ajuste_ganancia = v_ajuste
   where id = v_id;

  if v_dif > 0 and p_metodo = 'efectivo' and public.tiene_rol('admin', 'venta_local') then
    begin
      perform public.caja_movimiento('entrada', 'Diferencia por cambio #' || v_num, v_dif, v_cant || ' ' || pr.nombre, '{}',
        (now() at time zone 'America/Bogota')::date);
      v_caja := true;
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('id', v_id, 'diferencia', v_dif, 'valor_devuelto', v_valor, 'total_nuevo', v_total, 'en_caja', v_caja);
end $function$;
revoke all on function public.registrar_cambio_otro(uuid, jsonb, text, text, uuid, int, text, text, text[]) from public, anon;
grant execute on function public.registrar_cambio_otro(uuid, jsonb, text, text, uuid, int, text, text, text[]) to authenticated;
