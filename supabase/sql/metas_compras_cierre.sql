-- ============================================================================
--  Kaesuri · Avance de metas, lista de compras sugerida y cierre del día (como en Jasta)
--  YA APLICADO en Supabase. Lo que manda por Telegram (cierre del día y lista de compras de
--  los lunes) y las revisiones automáticas (cron) están en PENDIENTE_correr_en_supabase.sql.
-- ============================================================================

-- ================================================================ 1. Metas
-- Lo mismo que cuenta el ranking: vendedor = pedidos entregados suyos; domiciliario = domicilios entregados
create or replace function public.avance_metas(p_desde date, p_hasta date, p_semana boolean)
returns table(usuario_id uuid, tipo text, cantidad int, meta int)
language sql stable security definer set search_path to 'public' as $$
  with ent as (
    select * from pedidos
    where estado = 'entregado'
      and coalesce(entregado_at, created_at) >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz
      and coalesce(entregado_at, created_at) < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz
  )
  select u.id, 'vendedor', (select count(*)::int from ent where ent.vendedor_id = u.id),
    case when p_semana then mt.meta_ventas_semana else mt.meta_ventas end
  from profiles u join metas mt on mt.usuario_id = u.id
  where coalesce(u.activo, true) and 'vendedor' = any (u.roles)
  union all
  select u.id, 'domiciliario', (select count(*)::int from ent where ent.domiciliario_id = u.id and coalesce(ent.canal, 'domicilio') <> 'local'),
    case when p_semana then mt.meta_entregas_semana else mt.meta_entregas end
  from profiles u join metas mt on mt.usuario_id = u.id
  where coalesce(u.activo, true) and 'domiciliario' = any (u.roles)
$$;
revoke all on function public.avance_metas(date, date, boolean) from public, anon, authenticated;

-- Avance propio (para la tarjeta de Mi panel / Mi resumen)
create or replace function public.mi_meta()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_yo uuid := auth.uid();
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date := date_trunc('month', v_hoy)::date;
  v_sem date := date_trunc('week', v_hoy)::date;
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  return jsonb_build_object(
    'hoy', v_hoy,
    'fin_mes', (v_mes + interval '1 month - 1 day')::date,
    'mes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'cantidad', cantidad, 'meta', meta)), '[]')
            from public.avance_metas(v_mes, v_hoy, false) where usuario_id = v_yo and meta > 0),
    'semana', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'cantidad', cantidad, 'meta', meta)), '[]')
               from public.avance_metas(v_sem, v_hoy, true) where usuario_id = v_yo and meta > 0));
end $function$;
revoke all on function public.mi_meta() from public, anon;
grant execute on function public.mi_meta() to authenticated;

create table if not exists privado.metas_hitos (
  usuario_id uuid not null,
  periodo text not null,
  tipo text not null,
  hito int not null,
  created_at timestamptz not null default now(),
  primary key (usuario_id, periodo, tipo, hito)
);

-- Avisa el hito más alto que se acaba de pasar (no varios de golpe). Del mes: 50, 80 y 100 %; de la semana: 100 %.
create or replace function public.revisar_metas(p_avisar boolean default true)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date := date_trunc('month', v_hoy)::date;
  v_sem date := date_trunc('week', v_hoy)::date;
  r record; v_hito int; v_que text; v_falta int;
begin
  for r in select a.*, 'mes:' || to_char(v_mes, 'YYYY-MM') periodo, false semana from public.avance_metas(v_mes, v_hoy, false) a where a.meta > 0
           union all
           select a.*, 'semana:' || v_sem, true from public.avance_metas(v_sem, v_hoy, true) a where a.meta > 0 loop
    select max(h) into v_hito from unnest(case when r.semana then array[100] else array[50, 80, 100] end) h
    where r.cantidad * 100 >= r.meta * h
      and not exists (select 1 from privado.metas_hitos m where m.usuario_id = r.usuario_id and m.periodo = r.periodo and m.tipo = r.tipo and m.hito >= h);
    continue when v_hito is null;
    insert into privado.metas_hitos (usuario_id, periodo, tipo, hito)
    select r.usuario_id, r.periodo, r.tipo, h from unnest(case when r.semana then array[100] else array[50, 80, 100] end) h where h <= v_hito
    on conflict do nothing;
    continue when not p_avisar;

    v_que := case when r.tipo = 'vendedor' then 'ventas' else 'entregas' end;
    v_falta := r.meta - r.cantidad;
    if v_hito = 100 then
      perform public.notificar(r.usuario_id, 'meta',
        case when r.semana then '🎉 ¡Cumpliste tu meta de la semana!' else '🏆 ¡Cumpliste tu meta del mes!' end,
        r.cantidad || ' de ' || r.meta || ' ' || v_que || '. ¡Excelente trabajo!', 'ranking');
      perform public.notificar_roles(array['admin']::user_role[], 'meta',
        (select split_part(nombre, ' ', 1) from profiles where id = r.usuario_id) || ' cumplió su meta ' || case when r.semana then 'de la semana' else 'del mes' end,
        r.cantidad || ' de ' || r.meta || ' ' || v_que, 'ranking');
    else
      perform public.notificar(r.usuario_id, 'meta',
        '🔥 Vas en el ' || v_hito || ' % de tu meta del mes',
        r.cantidad || ' de ' || r.meta || ' ' || v_que || '. Te ' || case when v_falta = 1 then 'falta 1' else 'faltan ' || v_falta end || ', ¡tú puedes!',
        'ranking');
    end if;
  end loop;
end $function$;
revoke all on function public.revisar_metas(boolean) from public, anon, authenticated;

-- Lo que ya se había alcanzado antes de esto queda anotado sin avisar
select public.revisar_metas(false);

-- ================================================================ 2. Lista de compras sugerida
-- Ritmo de venta = unidades de los últimos 60 días (no cancelados) / 60. Se sugiere tener para
-- p_dias días (por defecto 3 semanas), nunca menos que el stock mínimo.
create or replace function public.compras_sugeridas_base(p_dias int default 21)
returns table(id uuid, nombre text, categoria text, stock int, vendidos_60 int, dias int, sugerido int, costo numeric)
language sql stable security definer set search_path to 'public' as $$
  with v as (
    select i.producto_id, sum(i.cantidad)::int n from pedido_items i join pedidos p on p.id = i.pedido_id
    where p.estado <> 'cancelado' and p.created_at > now() - interval '60 days' group by 1
  ), s as (
    select p.id, p.nombre, public.categoria_normal(p.categoria) categoria, p.stock, coalesce(v.n, 0) n, p.costo,
      greatest(ceil(coalesce(v.n, 0) / 60.0 * greatest(p_dias, 1))::int, coalesce(p.stock_minimo, 0)) objetivo
    from productos p join v on v.producto_id = p.id
    where coalesce(p.activo, true)
  )
  select id, nombre, categoria, stock, n,
    case when n > 0 then floor(greatest(stock, 0) / (n / 60.0))::int end,
    objetivo - greatest(stock, 0), costo
  from s
  where objetivo - greatest(stock, 0) > 0
  order by greatest(stock, 0) / greatest(n / 60.0, 0.0001), n desc
$$;
revoke all on function public.compras_sugeridas_base(int) from public, anon, authenticated;

create or replace function public.compras_sugeridas(p_dias int default 21)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_admin boolean := public.tiene_rol('admin');
begin
  if not public.tiene_rol('admin', 'despachador') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'categoria', c.categoria, 'stock', c.stock,
      'vendidos_60', c.vendidos_60, 'dias', c.dias, 'sugerido', c.sugerido, 'costo', case when v_admin then c.costo end))
    from public.compras_sugeridas_base(least(greatest(coalesce(p_dias, 21), 7), 90)) c), '[]');
end $function$;
revoke all on function public.compras_sugeridas(int) from public, anon;
grant execute on function public.compras_sugeridas(int) to authenticated;

-- ================================================================ 3. Cierre del día (texto)
create or replace function public.cierre_dia_texto(p_dia date)
returns text language plpgsql stable security definer set search_path to 'public' as $function$
declare
  d timestamptz := (p_dia::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_dia + 1)::text || ' 00:00 America/Bogota')::timestamptz;
  v_ent int; v_ventas numeric; v_gan numeric; v_gastos numeric; v_nuevos int; v_canc int; v_nov int; v_nov_abiertas int;
  v_por_alistar int; v_alistados int; v_ruta int; v_comis numeric; v_top text;
  l jsonb := public.cierre_local(p_dia);
begin
  select count(*), coalesce(sum(total - coalesce(valor_domicilio, 0)), 0) into v_ent, v_ventas
    from pedidos where estado = 'entregado' and entregado_at >= d and entregado_at < h;
  select coalesce(sum((coalesce(i.precio_base, 0) - coalesce(pr.costo, 0)) * i.cantidad), 0) into v_gan
    from pedidos p join pedido_items i on i.pedido_id = p.id left join productos pr on pr.id = i.producto_id
   where p.estado = 'entregado' and p.entregado_at >= d and p.entregado_at < h;
  select coalesce(sum(valor), 0) into v_gastos from gastos where fecha = p_dia;
  select count(*) filter (where estado <> 'cancelado'), count(*) filter (where estado = 'cancelado') into v_nuevos, v_canc
    from pedidos where created_at >= d and created_at < h;
  select count(*) into v_nov from pedido_novedades where created_at >= d and created_at < h;
  select count(*) into v_nov_abiertas from pedidos where novedades > 0 and estado not in ('entregado', 'cancelado');
  select count(*) filter (where estado = 'pendiente' and alistado_at is null), count(*) filter (where estado = 'pendiente' and alistado_at is not null),
         count(*) filter (where estado = 'en_ruta')
    into v_por_alistar, v_alistados, v_ruta from pedidos where estado in ('pendiente', 'en_ruta') and coalesce(canal, 'domicilio') <> 'local';
  select coalesce(sum(comision), 0) into v_comis from (select comision from public.por_liquidar(null) union all select comision from public.descuentos_por_liquidar(null)) z;
  select u.nombre || ' (' || s.n || ')' into v_top from (
    select vendedor_id, count(*) n from pedidos where estado <> 'cancelado' and created_at >= d and created_at < h and vendedor_id is not null
    group by 1 order by 2 desc limit 1) s join profiles u on u.id = s.vendedor_id;

  return '📊 Cierre del día · ' || to_char(p_dia, 'DD/MM/YYYY') || E'\n\n'
    || '✅ Entregados: ' || v_ent || ' · ' || public.fmt_pesos(v_ventas) || E'\n'
    || '💰 Ganancia tienda: ' || public.fmt_pesos(v_gan) || E'\n'
    || '🧾 Gastos: ' || public.fmt_pesos(v_gastos) || E'\n'
    || '📈 Utilidad del día: ' || public.fmt_pesos(v_gan - v_gastos) || E'\n\n'
    || '🆕 Pedidos nuevos: ' || v_nuevos || case when v_canc > 0 then ' · ❌ cancelados: ' || v_canc else '' end || E'\n'
    || coalesce('🏆 Más vendió: ' || v_top || E'\n', '')
    || '⚠️ Novedades hoy: ' || v_nov || case when v_nov_abiertas > 0 then ' · sin resolver: ' || v_nov_abiertas else '' end || E'\n\n'
    || '📦 Por alistar: ' || v_por_alistar || ' · Alistados: ' || v_alistados || ' · En ruta: ' || v_ruta || E'\n'
    || '👛 Comisiones por pagar: ' || public.fmt_pesos(v_comis)
    || case when (l->>'ventas')::int > 0 then E'\n\n'
      || '🏪 Caja del local: ' || (l->>'ventas') || case when (l->>'ventas')::int = 1 then ' venta · ' else ' ventas · ' end || public.fmt_pesos((l->>'total')::numeric) || E'\n'
      || '   💵 Efectivo que debe haber en caja: ' || public.fmt_pesos((l->>'efectivo')::numeric) || E'\n'
      || '   📲 Transferencias: ' || public.fmt_pesos((l->>'transferencia')::numeric) || E'\n'
      || coalesce('   👤 ' || (l->>'por_vendedor'), '')
    else '' end;
end $function$;
revoke all on function public.cierre_dia_texto(date) from public, anon, authenticated;
