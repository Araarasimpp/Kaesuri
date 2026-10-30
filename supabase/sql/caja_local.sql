-- ============================================================================
--  Kaesuri · Cuadre de caja del local (arqueo), como en Jasta
--  Quien vende en el local cuenta el efectivo al cerrar; se compara con lo que debería haber
--  (base con la que abrió + efectivo de las ventas del día). Si falta o sobra, se le avisa al admin.
--  YA APLICADO en Supabase.
-- ============================================================================

create table if not exists public.cierres_caja (
  fecha date primary key,
  base numeric not null default 0 check (base >= 0),
  efectivo_ventas numeric not null default 0,
  esperado numeric not null default 0,
  contado numeric not null check (contado >= 0),
  diferencia numeric not null default 0,
  nota text,
  usuario_id uuid references public.profiles(id) on delete set null,
  usuario_nombre text,
  updated_at timestamptz not null default now()
);
alter table public.cierres_caja enable row level security;
revoke all on public.cierres_caja from anon, authenticated;

-- Ventas del local de un día (sin canceladas): cuántas, total, efectivo y transferencias
create or replace function public.cierre_local(p_dia date)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with v as (
    select p.* from pedidos p
    where p.canal = 'local' and p.estado <> 'cancelado'
      and p.created_at >= (p_dia::text || ' 00:00 America/Bogota')::timestamptz
      and p.created_at < ((p_dia + 1)::text || ' 00:00 America/Bogota')::timestamptz
  )
  select jsonb_build_object(
    'ventas', (select count(*) from v),
    'total', (select coalesce(sum(total), 0) from v),
    'efectivo', (select coalesce(sum(case when metodo_pago = 'efectivo' then total when metodo_pago = 'mixto' then coalesce(monto_efectivo, 0) else 0 end), 0) from v),
    'transferencia', (select coalesce(sum(case when metodo_pago = 'transferencia' then total when metodo_pago = 'mixto' then coalesce(monto_transferencia, 0) else 0 end), 0) from v),
    'por_vendedor', (select string_agg(nombre || ' ' || n || ' (' || public.fmt_pesos(t) || ')', ' · ' order by t desc) from (
        select coalesce(split_part(u.nombre, ' ', 1), 'Tienda') nombre, count(*) n, sum(v.total) t
        from v left join profiles u on u.id = v.vendedor_id group by 1) s))
$$;
revoke all on function public.cierre_local(date) from public, anon, authenticated;

-- Lo de la caja de un día: lo que debería haber y el conteo (si ya se hizo)
create or replace function public.caja_local(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_dia date := coalesce(p_fecha, (now() at time zone 'America/Bogota')::date);
  l jsonb := public.cierre_local(v_dia);
  c cierres_caja;
begin
  if not public.tiene_rol('admin', 'venta_local') then raise exception 'Sin permiso'; end if;
  select * into c from cierres_caja where fecha = v_dia;
  return jsonb_build_object(
    'fecha', v_dia,
    'ventas', (l->>'ventas')::int,
    'total', (l->>'total')::numeric,
    'efectivo', (l->>'efectivo')::numeric,
    'transferencia', (l->>'transferencia')::numeric,
    -- La base se sugiere con la del último cuadre
    'base_sugerida', coalesce(c.base, (select base from cierres_caja where fecha < v_dia order by fecha desc limit 1), 0),
    'cierre', case when c.fecha is null then null else jsonb_build_object(
      'base', c.base, 'esperado', c.esperado, 'contado', c.contado, 'diferencia', c.diferencia, 'nota', c.nota,
      'quien', c.usuario_nombre, 'hora', c.updated_at) end);
end $function$;

create or replace function public.cuadrar_caja(p_fecha date, p_base numeric, p_contado numeric, p_nota text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_dia date := coalesce(p_fecha, (now() at time zone 'America/Bogota')::date);
  v_efe numeric := (public.cierre_local(v_dia)->>'efectivo')::numeric;
  v_base numeric := round(greatest(coalesce(p_base, 0), 0));
  v_contado numeric := round(coalesce(p_contado, -1));
  v_esp numeric; v_dif numeric; v_nota text := nullif(left(trim(coalesce(p_nota, '')), 300), '');
  v_nombre text := (select nombre from profiles where id = auth.uid());
begin
  if not public.tiene_rol('admin', 'venta_local') then raise exception 'Sin permiso'; end if;
  if v_contado < 0 then raise exception 'Escribe cuánto efectivo contaste'; end if;
  if v_dia > (now() at time zone 'America/Bogota')::date then raise exception 'Esa fecha todavía no ha llegado'; end if;
  if v_dia < (now() at time zone 'America/Bogota')::date - 7 and not public.tiene_rol('admin') then
    raise exception 'Solo el admin puede cuadrar días de hace más de una semana';
  end if;
  v_esp := v_base + v_efe;
  v_dif := v_contado - v_esp;
  insert into cierres_caja (fecha, base, efectivo_ventas, esperado, contado, diferencia, nota, usuario_id, usuario_nombre, updated_at)
  values (v_dia, v_base, v_efe, v_esp, v_contado, v_dif, v_nota, auth.uid(), v_nombre, now())
  on conflict (fecha) do update set base = excluded.base, efectivo_ventas = excluded.efectivo_ventas, esperado = excluded.esperado,
    contado = excluded.contado, diferencia = excluded.diferencia, nota = excluded.nota, usuario_id = excluded.usuario_id,
    usuario_nombre = excluded.usuario_nombre, updated_at = now();

  perform public.notificar_roles(array['admin']::user_role[], 'caja',
    case when v_dif = 0 then 'Caja del local cuadrada ✓'
         when v_dif < 0 then 'Caja del local: faltan ' || public.fmt_pesos(-v_dif)
         else 'Caja del local: sobran ' || public.fmt_pesos(v_dif) end,
    coalesce(v_nombre, 'Alguien') || ' contó ' || public.fmt_pesos(v_contado) || ' · debía haber ' || public.fmt_pesos(v_esp)
      || coalesce(' · "' || v_nota || '"', ''),
    'ventas-local');
  return jsonb_build_object('esperado', v_esp, 'contado', v_contado, 'diferencia', v_dif);
end $function$;
revoke all on function public.caja_local(date), public.cuadrar_caja(date, numeric, numeric, text) from public, anon;
grant execute on function public.caja_local(date), public.cuadrar_caja(date, numeric, numeric, text) to authenticated;
