-- ============================================================================
--  Kaesuri · Pedidos de la tienda sospechosos (como en Jasta). YA APLICADO.
--  Señales del pedido (además de riesgo_cliente, que mira el historial del teléfono):
--   · varios pedidos del mismo celular en 24 h
--   · la misma conexión (IP) con 3+ celulares distintos en 24 h
--   · pedidos de la tienda cancelados antes
--   · la misma dirección con rechazos de otro celular
--   · el mismo celular con otro nombre
--   · cliente nuevo con pedido de $300.000+
--  No marca pedidos con el celular de alguien del equipo. pedidos_web_lista() devuelve 'sospecha'.
-- ============================================================================
create or replace function public.dir_normal(t text) returns text language sql immutable set search_path to '' as $$
  select regexp_replace(lower(translate(coalesce(t, ''), 'áéíóúÁÉÍÓÚ#-', 'aeiouAEIOU  ')), '[^a-z0-9]', '', 'g')
$$;

create or replace function public.sospecha_pedido_web(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare w pedidos_web; r text[] := '{}'; v_n int; v_alto boolean := false; v_ent int; v_total numeric; v_dir text; v_nombre text;
begin
  if not public.tiene_rol('admin', 'vendedor') then raise exception 'Sin permiso'; end if;
  select * into w from pedidos_web where id = p_id;
  if not found then return null; end if;
  if exists (select 1 from profiles u where regexp_replace(coalesce(u.telefono, ''), '\D', '', 'g') = regexp_replace(w.cliente_telefono, '\D', '', 'g')) then return null; end if;
  v_total := coalesce(w.subtotal, 0) + coalesce(w.valor_domicilio, 0);
  select count(*) into v_n from pedidos_web where cliente_telefono = w.cliente_telefono and id <> w.id and created_at between w.created_at - interval '24 hours' and w.created_at;
  if v_n >= 1 then r := r || (v_n + 1 || ' pedidos de este celular en 24 horas'); end if;
  if w.ip is not null then
    select count(distinct cliente_telefono) into v_n from pedidos_web where ip = w.ip and id <> w.id and created_at between w.created_at - interval '24 hours' and w.created_at and cliente_telefono <> w.cliente_telefono;
    if v_n >= 2 then r := r || ('Desde la misma conexión hicieron pedidos con ' || v_n + 1 || ' celulares distintos hoy'); v_alto := true; end if;
  end if;
  select count(*) into v_n from pedidos_web where cliente_telefono = w.cliente_telefono and id <> w.id and created_at < w.created_at and estado = 'cancelado';
  if v_n >= 1 then r := r || (v_n || case when v_n = 1 then ' pedido de la tienda cancelado antes' else ' pedidos de la tienda cancelados antes' end); if v_n >= 2 then v_alto := true; end if; end if;
  v_dir := public.dir_normal(w.direccion);
  if length(v_dir) >= 6 then
    select count(*) into v_n from pedidos p where p.cliente_telefono <> w.cliente_telefono and p.estado = 'cancelado' and p.domiciliario_id is not null
      and public.dir_normal(p.direccion) = v_dir and lower(coalesce(p.barrio, '')) = lower(coalesce(w.barrio, ''));
    if v_n >= 1 then r := r || ('Esta dirección tuvo ' || v_n || case when v_n = 1 then ' rechazo' else ' rechazos' end || ' con otro celular'); v_alto := true; end if;
  end if;
  select p.cliente_nombre into v_nombre from pedidos p where p.cliente_telefono = w.cliente_telefono
    and split_part(lower(trim(p.cliente_nombre)), ' ', 1) <> split_part(lower(trim(w.cliente_nombre)), ' ', 1) order by p.created_at desc limit 1;
  if v_nombre is not null then r := r || ('Este celular antes pidió como "' || v_nombre || '"'); end if;
  select count(*) into v_ent from pedidos where cliente_telefono = w.cliente_telefono and estado = 'entregado';
  if v_ent = 0 and v_total >= 300000 then r := r || ('Cliente nuevo con un pedido de ' || public.fmt_pesos(v_total) || ' para pagar al recibir'); end if;
  if cardinality(r) = 0 then return null; end if;
  return jsonb_build_object('nivel', case when v_alto or cardinality(r) >= 3 then 'alto' else 'medio' end, 'razones', to_jsonb(r));
end $function$;
revoke all on function public.sospecha_pedido_web(bigint) from public, anon;
grant execute on function public.sospecha_pedido_web(bigint) to authenticated;

do $$
declare v text := replace(pg_get_functiondef('public.pedidos_web_lista()'::regprocedure), chr(13), '');
begin
  if position('sospecha' in v) = 0 then
    v := replace(v, '''riesgo'', case when w.estado = ''por_confirmar'' then public.riesgo_cliente(w.cliente_telefono) end)',
      '''riesgo'', case when w.estado = ''por_confirmar'' then public.riesgo_cliente(w.cliente_telefono) end,
      ''sospecha'', case when w.estado = ''por_confirmar'' then public.sospecha_pedido_web(w.id) end)');
    if position('sospecha' in v) = 0 then raise exception 'No se pudo cambiar pedidos_web_lista'; end if;
    execute v;
  end if;
end $$;
