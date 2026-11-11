-- ============================================================================
--  Kaesuri · Calendario (como en Jasta). YA APLICADO en Supabase; el aviso de los recordatorios
--  cada 5 minutos (cron) está en PENDIENTE_correr_en_supabase.sql.
--  * Ventas de cada día (admin) y ventas del local (venta_local).
--  * Caja del local de cada día (cuadrada, faltó, sobró; entregada y recibida).
--  * Pagos: deudas que vencen, abonos a proveedores, comisiones pagadas, abonos recibidos de
--    cuentas por cobrar y lo pendiente (comisiones por pagar, cuentas por cobrar).
--  * Recordatorios: cada persona crea los suyos (una vez, cada semana, cada mes o cada año); el
--    admin puede ponerlos para todo el equipo. Los festivos de Colombia se calculan en la app.
-- ============================================================================

create table if not exists public.recordatorios (
  id bigint generated always as identity primary key,
  usuario_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  nota text,
  fecha date not null,
  hora time,
  repetir text not null default 'no' check (repetir in ('no', 'semanal', 'mensual', 'anual')),
  equipo boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.recordatorio_hechos (
  recordatorio_id bigint not null references public.recordatorios(id) on delete cascade,
  dia date not null,
  primary key (recordatorio_id, dia)
);
create table if not exists privado.recordatorio_avisos (
  recordatorio_id bigint not null references public.recordatorios(id) on delete cascade,
  dia date not null,
  primary key (recordatorio_id, dia)
);
alter table public.recordatorios enable row level security;
alter table public.recordatorio_hechos enable row level security;
revoke all on public.recordatorios, public.recordatorio_hechos from anon, authenticated;

-- ¿El recordatorio cae en ese día?
create or replace function public.recordatorio_cae(p_fecha date, p_repetir text, p_dia date)
returns boolean language sql immutable set search_path to '' as $$
  select p_dia >= p_fecha and case p_repetir
    when 'no' then p_dia = p_fecha
    when 'semanal' then (p_dia - p_fecha) % 7 = 0
    when 'mensual' then extract(day from p_dia) = least(extract(day from p_fecha),
      extract(day from (date_trunc('month', p_dia) + interval '1 month - 1 day')))
    when 'anual' then extract(month from p_dia) = extract(month from p_fecha)
      and extract(day from p_dia) = least(extract(day from p_fecha), extract(day from (date_trunc('month', p_dia) + interval '1 month - 1 day')))
    else false end
$$;

create or replace function public.guardar_recordatorio(p_id bigint, p_titulo text, p_nota text, p_fecha date, p_hora time, p_repetir text, p_equipo boolean)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_yo uuid := auth.uid(); v_id bigint; v_tit text := public.texto_limpio(p_titulo, 120);
  v_equipo boolean := coalesce(p_equipo, false) and public.tiene_rol('admin');
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  if v_tit is null then raise exception 'Escribe qué hay que recordar'; end if;
  if p_fecha is null then raise exception 'Elige el día'; end if;
  if coalesce(p_repetir, 'no') not in ('no', 'semanal', 'mensual', 'anual') then raise exception 'Repetición inválida'; end if;
  if p_id is null then
    insert into recordatorios (usuario_id, titulo, nota, fecha, hora, repetir, equipo)
    values (v_yo, v_tit, public.texto_limpio(p_nota, 400), p_fecha, p_hora, coalesce(p_repetir, 'no'), v_equipo) returning id into v_id;
  else
    update recordatorios set titulo = v_tit, nota = public.texto_limpio(p_nota, 400), fecha = p_fecha, hora = p_hora,
      repetir = coalesce(p_repetir, 'no'), equipo = v_equipo
     where id = p_id and (usuario_id = v_yo or public.tiene_rol('admin')) returning id into v_id;
    if v_id is null then raise exception 'Ese recordatorio no existe'; end if;
    delete from privado.recordatorio_avisos where recordatorio_id = v_id and dia >= (now() at time zone 'America/Bogota')::date;
  end if;
  return v_id;
end $function$;

create or replace function public.borrar_recordatorio(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from recordatorios where id = p_id and (usuario_id = auth.uid() or public.tiene_rol('admin'));
  if not found then raise exception 'Ese recordatorio no existe'; end if;
end $function$;

-- Marcar hecho (o quitarlo) en un día
create or replace function public.marcar_recordatorio(p_id bigint, p_dia date, p_hecho boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from recordatorios r where r.id = p_id and (r.usuario_id = auth.uid() or r.equipo)) then
    raise exception 'Ese recordatorio no existe';
  end if;
  if p_hecho then insert into recordatorio_hechos values (p_id, p_dia) on conflict do nothing;
  else delete from recordatorio_hechos where recordatorio_id = p_id and dia = p_dia; end if;
end $function$;

-- Todo lo del calendario entre dos fechas ("url" es la sección de la app, sin el área)
create or replace function public.calendario(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_yo uuid := auth.uid();
  v_admin boolean := public.tiene_rol('admin');
  v_caja boolean := public.tiene_rol('admin', 'venta_local');
  d timestamptz := (p_desde::text || ' 00:00 America/Bogota')::timestamptz;
  h timestamptz := ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz;
begin
  if v_yo is null then raise exception 'Sin permiso'; end if;
  if p_hasta < p_desde or p_hasta - p_desde > 62 then raise exception 'Rango inválido'; end if;
  return jsonb_build_object(
    'admin', v_admin,
    'caja', v_caja,
    -- Ventas por día: el admin ve todo (pedidos + local, con ganancia); venta_local, solo el local
    'ventas', case when v_admin or v_caja then coalesce((select jsonb_agg(jsonb_build_object('dia', a.dia, 'pedidos', a.n, 'vendido', a.t, 'local', a.nl,
        'ganancia', case when v_admin then coalesce(b.g, 0) end) order by a.dia)
      from (select (p.created_at at time zone 'America/Bogota')::date dia, count(*) n, count(*) filter (where p.canal = 'local') nl, sum(p.total) t
            from pedidos p
            where p.estado = 'entregado' and p.created_at >= d and p.created_at < h and (v_admin or p.canal = 'local')
            group by 1) a
      left join (select (p.created_at at time zone 'America/Bogota')::date dia,
                   sum((coalesce(i.precio_base, 0) - coalesce(pr.costo, 0)) * i.cantidad) g
                 from pedidos p join pedido_items i on i.pedido_id = p.id left join productos pr on pr.id = i.producto_id
                 where v_admin and p.estado = 'entregado' and p.created_at >= d and p.created_at < h
                 group by 1) b on b.dia = a.dia), '[]') else '[]'::jsonb end,
    'cajas', case when v_caja then coalesce((select jsonb_agg(jsonb_build_object('dia', c.fecha, 'diferencia', c.diferencia, 'contado', c.contado,
        'recoger', c.recoger, 'entregado', c.entregado_at is not null, 'recibido', c.recibido_at is not null, 'quien', c.usuario_nombre) order by c.fecha)
      from cierres_caja c where c.fecha between p_desde and p_hasta), '[]') else '[]'::jsonb end,
    'pagos', case when v_admin then coalesce((select jsonb_agg(x order by x->>'dia') from (
        select jsonb_build_object('dia', dd.vence, 'tipo', 'vence', 'titulo', 'Vence deuda: ' || dd.proveedor, 'detalle', dd.concepto,
          'valor', greatest(dd.total - coalesce((select sum(a.valor) from deuda_abonos a where a.deuda_id = dd.id and not a.anulado), 0), 0), 'url', 'deudas') x
        from deudas dd where dd.estado = 'abierta' and dd.vence between p_desde and p_hasta
        union all
        select jsonb_build_object('dia', a.fecha, 'tipo', 'pagado', 'titulo', 'Abono a ' || dd.proveedor, 'detalle', a.nota, 'valor', a.valor, 'url', 'deudas')
        from deuda_abonos a join deudas dd on dd.id = a.deuda_id where not a.anulado and a.fecha between p_desde and p_hasta
        union all
        select jsonb_build_object('dia', (l.pagado_at at time zone 'America/Bogota')::date, 'tipo', 'pagado', 'titulo', 'Comisión pagada a ' || split_part(u.nombre, ' ', 1),
          'detalle', l.cantidad_pedidos || ' pedidos', 'valor', l.total, 'url', 'comisiones')
        from liquidaciones l join profiles u on u.id = l.vendedor_id
        where not l.anulada and l.pagado_at >= d and l.pagado_at < h
        union all
        select jsonb_build_object('dia', a.fecha, 'tipo', 'cobrado', 'titulo', 'Abono de ' || c.nombre, 'detalle', a.nota, 'valor', a.valor, 'url', 'cuentas')
        from cuenta_abonos a join cuentas_cobrar c on c.id = a.cuenta_id where a.fecha between p_desde and p_hasta) s), '[]') else '[]'::jsonb end,
    'pendientes', case when v_admin then jsonb_build_object(
        'deudas_vencidas', (select count(*) from deudas dd where dd.estado = 'abierta' and dd.vence < (now() at time zone 'America/Bogota')::date),
        'comisiones', (select coalesce(sum(t.total), 0) from public.liquidaciones_pendientes() t),
        'vendedores', (select count(*) from public.liquidaciones_pendientes() t),
        'por_cobrar', (select coalesce(sum(e.total), 0) from cuenta_entregas e join cuentas_cobrar c on c.id = e.cuenta_id where c.activa)
                    - (select coalesce(sum(a.valor), 0) from cuenta_abonos a join cuentas_cobrar c on c.id = a.cuenta_id where c.activa))
      else null end,
    'recordatorios', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'titulo', r.titulo, 'nota', r.nota, 'hora', to_char(r.hora, 'HH24:MI'),
        'fecha', r.fecha, 'repetir', r.repetir, 'equipo', r.equipo, 'dia', g.dia, 'mio', r.usuario_id = v_yo,
        'de', case when r.usuario_id <> v_yo then split_part(u.nombre, ' ', 1) end,
        'hecho', exists (select 1 from recordatorio_hechos x where x.recordatorio_id = r.id and x.dia = g.dia)) order by g.dia, r.hora nulls first, r.id)
      from recordatorios r
      join profiles u on u.id = r.usuario_id
      cross join lateral (select gs::date dia from generate_series(greatest(p_desde, r.fecha), p_hasta, interval '1 day') gs) g
      where (r.usuario_id = v_yo or r.equipo) and public.recordatorio_cae(r.fecha, r.repetir, g.dia)), '[]'));
end $function$;

-- Cada 5 minutos: avisa los recordatorios de hoy (7 a. m. los que no tienen hora)
create or replace function public.avisar_recordatorios()
returns int language plpgsql security definer set search_path to 'public' as $function$
declare v_hoy date := (now() at time zone 'America/Bogota')::date; v_hora time := (now() at time zone 'America/Bogota')::time; r record; n int := 0; v_u uuid;
begin
  for r in select x.* from recordatorios x
           where public.recordatorio_cae(x.fecha, x.repetir, v_hoy)
             and coalesce(x.hora, time '07:00') <= v_hora
             and not exists (select 1 from privado.recordatorio_avisos a where a.recordatorio_id = x.id and a.dia = v_hoy)
             and not exists (select 1 from recordatorio_hechos h where h.recordatorio_id = x.id and h.dia = v_hoy) loop
    insert into privado.recordatorio_avisos values (r.id, v_hoy) on conflict do nothing;
    for v_u in select id from profiles where case when r.equipo then coalesce(activo, true) and cardinality(roles) > 0 else id = r.usuario_id end loop
      perform public.notificar(v_u, 'recordatorio', '📅 ' || r.titulo,
        coalesce(r.nota, case when r.hora is not null then 'Hoy a las ' || to_char(r.hora, 'HH12:MI am') else 'Para hoy' end), 'calendario');
    end loop;
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.avisar_recordatorios() from public, anon, authenticated;

revoke all on function public.guardar_recordatorio(bigint, text, text, date, time, text, boolean), public.borrar_recordatorio(bigint),
  public.marcar_recordatorio(bigint, date, boolean), public.calendario(date, date) from public, anon;
grant execute on function public.guardar_recordatorio(bigint, text, text, date, time, text, boolean), public.borrar_recordatorio(bigint),
  public.marcar_recordatorio(bigint, date, boolean), public.calendario(date, date) to authenticated;
