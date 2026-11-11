-- ============================================================================
--  Kaesuri · Propinas por transferencia (como en Jasta). YA APLICADO, salvo el cambio de
--  cuadres.total_a_entregar, que está en PENDIENTE_correr_en_supabase.sql (sección 16).
--  Si el cliente transfiere más del total, lo que sobra es propina del domiciliario. Esa plata
--  queda en la cuenta del negocio, así que en el cuadre se le descuenta de lo que entrega,
--  igual que sus domicilios. El total del pedido no cambia. La propina en efectivo no se
--  registra (ya la tiene él).
-- ============================================================================

alter table public.pedidos add column if not exists propina numeric not null default 0 check (propina >= 0);
alter table public.cuadres add column if not exists total_propinas numeric not null default 0;

-- Entregar con propina (nueva versión con un parámetro más; la anterior sigue igual)
create or replace function public.entregar_pedido(p_pedido_id uuid, p_metodo text, p_comprobantes text[], p_efectivo numeric, p_propina numeric)
returns void language plpgsql set search_path to 'public' as $function$
declare v_prop numeric := round(greatest(coalesce(p_propina, 0), 0)); v_total numeric;
begin
  if v_prop > 0 and p_metodo = 'efectivo' then raise exception 'La propina en efectivo no se registra: ya la tienes tú'; end if;
  select total into v_total from pedidos where id = p_pedido_id;
  if v_prop > coalesce(v_total, 0) then raise exception 'Revisa la propina: es más que el valor del pedido'; end if;
  perform public.entregar_pedido(p_pedido_id, p_metodo, p_comprobantes, p_efectivo);
  if v_prop > 0 then update pedidos set propina = v_prop where id = p_pedido_id; end if;
end $function$;
revoke all on function public.entregar_pedido(uuid, text, text[], numeric, numeric) from public, anon;
grant execute on function public.entregar_pedido(uuid, text, text[], numeric, numeric) to authenticated;

do $$
declare v text;
begin
  -- El cuadre guarda el total de propinas
  v := replace(pg_get_functiondef('public.cuadre_cerrar_interno(uuid,date,uuid)'::regprocedure), chr(13), '');
  if position('total_propinas' in v) = 0 then
    v := replace(v, 'v_dom numeric(12,2); v_ef numeric(12,2);', 'v_prop numeric(12,2); v_dom numeric(12,2); v_ef numeric(12,2);');
    v := replace(v, '         coalesce(sum(total), 0), count(*)
    into v_dom, v_ef, v_tr, v_tot, v_n', '         coalesce(sum(total), 0), count(*), coalesce(sum(propina), 0)
    into v_dom, v_ef, v_tr, v_tot, v_n, v_prop');
    v := replace(v, 'total_transferencia, total_general, estado, cerrado_por)', 'total_transferencia, total_general, estado, cerrado_por, total_propinas)');
    v := replace(v, 'v_tr, v_tot, ''pendiente'', p_cerrado_por)', 'v_tr, v_tot, ''pendiente'', p_cerrado_por, v_prop)');
    if position('v_prop)' in v) = 0 or position('into v_dom, v_ef, v_tr, v_tot, v_n, v_prop' in v) = 0 then raise exception 'No se pudo cambiar cuadre_cerrar_interno'; end if;
    execute v;
  end if;

  -- Devolver una entrega borra la propina
  v := replace(pg_get_functiondef('public.devolver_entrega(uuid)'::regprocedure), chr(13), '');
  if position('propina = 0' in v) = 0 then
    v := replace(v, 'metodo_pago = null,', 'metodo_pago = null, propina = 0,');
    if position('propina = 0' in v) = 0 then raise exception 'No se pudo cambiar devolver_entrega'; end if;
    execute v;
  end if;

  -- Mi resumen del domiciliario: propinas del periodo y por cuadrar
  v := replace(pg_get_functiondef('public.resumen_domiciliario(date,date,uuid)'::regprocedure), chr(13), '');
  if position('propinas' in v) = 0 then
    v := replace(v, '''ganado'', (select coalesce(sum(valor_domicilio), 0) from ent),', '''ganado'', (select coalesce(sum(valor_domicilio), 0) from ent), ''propinas'', (select coalesce(sum(propina), 0) from ent),');
    v := replace(v, '''domicilios'', coalesce(sum(valor_domicilio), 0))', '''domicilios'', coalesce(sum(valor_domicilio), 0), ''propinas'', coalesce(sum(propina), 0))');
    if position('''propinas''' in v) = 0 then raise exception 'No se pudo cambiar resumen_domiciliario'; end if;
    execute v;
  end if;
end $$;
