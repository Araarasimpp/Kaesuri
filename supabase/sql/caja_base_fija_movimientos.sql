-- ============================================================================
--  Kaesuri · Caja del local: base fija, entradas y salidas, entrega y recibo del efectivo
--  (como en Jasta). YA APLICADO en Supabase.
--   · La base la pone solo el admin (configuracion.base_caja) y es la misma todos los días.
--   · Quien vende en el local registra entradas (plata que entra y no es venta) y salidas
--     (gastos pagados con la caja: quedan en Gastos como "Caja del local: …").
--   · Al cuadrar: debe haber = base + efectivo de ventas + entradas − salidas. Se recoge lo
--     contado menos la base (la base se queda en la caja).
--   · Quien vende marca "Entregué" y el admin confirma "Recibí".
--  cuadrar_caja(fecha, contado, nota) reemplaza a la de 4 parámetros (que ya no se usa).
-- ============================================================================

alter table public.configuracion add column if not exists base_caja numeric not null default 0 check (base_caja >= 0);

create table if not exists public.caja_movimientos (
  id bigint generated always as identity primary key,
  fecha date not null default ((now() at time zone 'America/Bogota')::date),
  tipo text not null check (tipo in ('entrada', 'salida')),
  concepto text not null,
  valor numeric not null check (valor > 0),
  nota text,
  comprobantes text[] not null default '{}',
  -- La salida queda también como gasto (si se borra el gasto, se borra el movimiento)
  gasto_id bigint references public.gastos(id) on delete cascade,
  usuario_id uuid references public.profiles(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists caja_movimientos_fecha_idx on public.caja_movimientos (fecha);
alter table public.caja_movimientos enable row level security;
revoke all on public.caja_movimientos from anon, authenticated;

alter table public.cierres_caja
  add column if not exists entradas numeric not null default 0,
  add column if not exists salidas numeric not null default 0,
  add column if not exists recoger numeric not null default 0,
  add column if not exists entregado_at timestamptz,
  add column if not exists entregado_por text,
  add column if not exists recibido_at timestamptz,
  add column if not exists recibido_por text,
  add column if not exists recibido numeric;

create or replace function public.fijar_base_caja(p_valor numeric)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin cambia la base de la caja'; end if;
  if coalesce(p_valor, -1) < 0 then raise exception 'Escribe la base'; end if;
  update configuracion set base_caja = round(p_valor) where id = true;
end $function$;

create or replace function public.caja_mov_totales(p_dia date, out entradas numeric, out salidas numeric)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(sum(valor) filter (where tipo = 'entrada'), 0), coalesce(sum(valor) filter (where tipo = 'salida'), 0)
  from caja_movimientos where fecha = p_dia
$$;
revoke all on function public.caja_mov_totales(date) from public, anon, authenticated;

create or replace function public.caja_movimiento(p_tipo text, p_concepto text, p_valor numeric, p_nota text, p_comprobantes text[], p_fecha date default null)
returns bigint language plpgsql security definer set search_path to 'public' as $function$
declare v_id bigint; v_gasto bigint; v_dia date := coalesce(p_fecha, (now() at time zone 'America/Bogota')::date);
  v_valor numeric := round(coalesce(p_valor, 0)); v_conc text := public.texto_limpio(p_concepto, 80); v_nota text := public.texto_limpio(p_nota, 300);
  v_comp text[] := public.comprobantes_validos(p_comprobantes);
begin
  if not public.tiene_rol('admin', 'venta_local') then raise exception 'Sin permiso'; end if;
  if p_tipo not in ('entrada', 'salida') then raise exception 'Elige si es entrada o salida'; end if;
  if v_valor <= 0 then raise exception 'Escribe el valor'; end if;
  if v_conc is null then raise exception 'Escribe el concepto'; end if;
  if v_dia > (now() at time zone 'America/Bogota')::date then raise exception 'Esa fecha todavía no ha llegado'; end if;
  if v_dia < (now() at time zone 'America/Bogota')::date and not public.tiene_rol('admin') then
    raise exception 'Solo el admin registra movimientos de días anteriores';
  end if;
  if exists (select 1 from cierres_caja where fecha = v_dia and recibido_at is not null) then
    raise exception 'La caja de ese día ya se entregó y recibió';
  end if;
  if p_tipo = 'salida' then
    insert into gastos (fecha, categoria, descripcion, valor, metodo, comprobantes, creado_por, creado_por_nombre)
    values (v_dia, 'otros', 'Caja del local: ' || v_conc || coalesce(' · ' || v_nota, ''), v_valor, 'efectivo', v_comp, auth.uid(), public.mi_nombre())
    returning id into v_gasto;
  end if;
  insert into caja_movimientos (fecha, tipo, concepto, valor, nota, comprobantes, gasto_id, usuario_id, usuario_nombre)
  values (v_dia, p_tipo, v_conc, v_valor, v_nota, v_comp, v_gasto, auth.uid(), public.mi_nombre())
  returning id into v_id;
  if not public.tiene_rol('admin') then
    perform public.notificar_roles(array['admin']::user_role[], 'caja',
      case when p_tipo = 'salida' then 'Salida de caja: ' else 'Entrada a caja: ' end || public.fmt_pesos(v_valor),
      public.mi_nombre() || ' · ' || v_conc || coalesce(' · ' || v_nota, ''), 'ventas-local');
  end if;
  return v_id;
end $function$;

-- Borrar un movimiento (el admin; o quien lo hizo, el mismo día y antes de entregar la caja)
create or replace function public.borrar_caja_movimiento(p_id bigint)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare m caja_movimientos;
begin
  if not public.tiene_rol('admin', 'venta_local') then raise exception 'Sin permiso'; end if;
  select * into m from caja_movimientos where id = p_id;
  if not found then raise exception 'Ese movimiento ya no existe'; end if;
  if not public.tiene_rol('admin') then
    if m.usuario_id is distinct from auth.uid() or m.fecha <> (now() at time zone 'America/Bogota')::date then
      raise exception 'Solo el admin puede borrar este movimiento';
    end if;
    if exists (select 1 from cierres_caja where fecha = m.fecha and entregado_at is not null) then
      raise exception 'La caja ya se entregó: pídele al admin que lo borre';
    end if;
  end if;
  delete from caja_movimientos where id = m.id;
  if m.gasto_id is not null then delete from gastos where id = m.gasto_id; end if;
end $function$;

create or replace function public.caja_local(p_fecha date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_dia date := coalesce(p_fecha, (now() at time zone 'America/Bogota')::date);
  l jsonb := public.cierre_local(v_dia);
  c cierres_caja;
  t record;
  v_admin boolean := public.tiene_rol('admin');
begin
  if not public.tiene_rol('admin', 'venta_local') then raise exception 'Sin permiso'; end if;
  select * into c from cierres_caja where fecha = v_dia;
  select * into t from public.caja_mov_totales(v_dia);
  return jsonb_build_object(
    'fecha', v_dia,
    'admin', v_admin,
    'ventas', (l->>'ventas')::int,
    'total', (l->>'total')::numeric,
    'efectivo', (l->>'efectivo')::numeric,
    'transferencia', (l->>'transferencia')::numeric,
    'base', (select base_caja from configuracion limit 1),
    'entradas', t.entradas,
    'salidas', t.salidas,
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'concepto', m.concepto, 'valor', m.valor, 'nota', m.nota,
        'comprobantes', m.comprobantes, 'quien', m.usuario_nombre, 'hora', m.created_at,
        'mio', m.usuario_id = auth.uid()) order by m.created_at)
      from caja_movimientos m where m.fecha = v_dia), '[]'),
    'cierre', case when c.fecha is null then null else jsonb_build_object(
      'base', c.base, 'esperado', c.esperado, 'contado', c.contado, 'diferencia', c.diferencia, 'nota', c.nota,
      'quien', c.usuario_nombre, 'hora', c.updated_at, 'recoger', c.recoger, 'entradas', c.entradas, 'salidas', c.salidas,
      'entregado_at', c.entregado_at, 'entregado_por', c.entregado_por, 'recibido_at', c.recibido_at, 'recibido_por', c.recibido_por, 'recibido', c.recibido) end,
    -- Para el admin: cajas entregadas que todavía no ha recibido (de cualquier día)
    'por_recibir', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('fecha', x.fecha, 'recoger', x.recoger, 'entregado_por', x.entregado_por,
        'entregado_at', x.entregado_at) order by x.fecha)
      from cierres_caja x where x.entregado_at is not null and x.recibido_at is null), '[]') else '[]'::jsonb end);
end $function$;

-- Cuadrar: la base es la fija del admin
create or replace function public.cuadrar_caja(p_fecha date, p_contado numeric, p_nota text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_dia date := coalesce(p_fecha, (now() at time zone 'America/Bogota')::date);
  v_efe numeric := (public.cierre_local(v_dia)->>'efectivo')::numeric;
  v_base numeric := coalesce((select base_caja from configuracion limit 1), 0);
  v_contado numeric := round(coalesce(p_contado, -1));
  t record; v_esp numeric; v_dif numeric; v_rec numeric; v_nota text := nullif(left(trim(coalesce(p_nota, '')), 300), '');
begin
  if not public.tiene_rol('admin', 'venta_local') then raise exception 'Sin permiso'; end if;
  if v_contado < 0 then raise exception 'Escribe cuánto efectivo contaste'; end if;
  if v_dia > (now() at time zone 'America/Bogota')::date then raise exception 'Esa fecha todavía no ha llegado'; end if;
  if v_dia < (now() at time zone 'America/Bogota')::date - 7 and not public.tiene_rol('admin') then
    raise exception 'Solo el admin puede cuadrar días de hace más de una semana';
  end if;
  if exists (select 1 from cierres_caja where fecha = v_dia and recibido_at is not null) then
    raise exception 'La caja de ese día ya se entregó y recibió';
  end if;
  select * into t from public.caja_mov_totales(v_dia);
  v_esp := v_base + v_efe + t.entradas - t.salidas;
  v_dif := v_contado - v_esp;
  v_rec := greatest(v_contado - v_base, 0);
  insert into cierres_caja (fecha, base, efectivo_ventas, entradas, salidas, esperado, contado, diferencia, recoger, nota, usuario_id, usuario_nombre, updated_at)
  values (v_dia, v_base, v_efe, t.entradas, t.salidas, v_esp, v_contado, v_dif, v_rec, v_nota, auth.uid(), public.mi_nombre(), now())
  on conflict (fecha) do update set base = excluded.base, efectivo_ventas = excluded.efectivo_ventas, entradas = excluded.entradas,
    salidas = excluded.salidas, esperado = excluded.esperado, contado = excluded.contado, diferencia = excluded.diferencia,
    recoger = excluded.recoger, nota = excluded.nota, usuario_id = excluded.usuario_id, usuario_nombre = excluded.usuario_nombre,
    updated_at = now(), entregado_at = null, entregado_por = null;

  perform public.notificar_roles(array['admin']::user_role[], 'caja',
    case when v_dif = 0 then 'Caja del local cuadrada ✓'
         when v_dif < 0 then 'Caja del local: faltan ' || public.fmt_pesos(-v_dif)
         else 'Caja del local: sobran ' || public.fmt_pesos(v_dif) end,
    coalesce(public.mi_nombre(), 'Alguien') || ' contó ' || public.fmt_pesos(v_contado) || ' · debía haber ' || public.fmt_pesos(v_esp)
      || ' · para recoger ' || public.fmt_pesos(v_rec)
      || case when v_contado < v_base then ' · ¡no alcanza para la base!' else '' end
      || coalesce(' · "' || v_nota || '"', ''),
    'ventas-local');
  return jsonb_build_object('esperado', v_esp, 'contado', v_contado, 'diferencia', v_dif, 'recoger', v_rec, 'base', v_base);
end $function$;

-- Quien vende entrega el efectivo recogido
create or replace function public.entregar_caja(p_fecha date)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare c cierres_caja;
begin
  if not public.tiene_rol('admin', 'venta_local') then raise exception 'Sin permiso'; end if;
  select * into c from cierres_caja where fecha = p_fecha for update;
  if not found then raise exception 'Primero cuadra la caja'; end if;
  if c.recibido_at is not null then raise exception 'Esa caja ya se recibió'; end if;
  update cierres_caja set entregado_at = now(), entregado_por = public.mi_nombre() where fecha = c.fecha;
  perform public.notificar_roles(array['admin']::user_role[], 'caja',
    coalesce(public.mi_nombre(), 'Alguien') || ' te entregó ' || public.fmt_pesos(c.recoger) || ' de la caja',
    'Caja del ' || to_char(c.fecha, 'DD/MM') || '. Confírmalo en Ventas del local → Recibí.', 'ventas-local');
end $function$;

-- El admin confirma que recibió la plata (o cuánto recibió)
create or replace function public.recibir_caja(p_fecha date, p_valor numeric default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare c cierres_caja;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin confirma lo recibido'; end if;
  select * into c from cierres_caja where fecha = p_fecha for update;
  if not found then raise exception 'Esa caja no se ha cuadrado'; end if;
  update cierres_caja set recibido_at = now(), recibido_por = public.mi_nombre(), recibido = round(coalesce(p_valor, c.recoger)),
    entregado_at = coalesce(entregado_at, now()), entregado_por = coalesce(entregado_por, public.mi_nombre())
   where fecha = c.fecha;
end $function$;

create or replace function public.caja_historial(p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('fecha', c.fecha, 'base', c.base, 'efectivo', c.efectivo_ventas, 'entradas', c.entradas,
      'salidas', c.salidas, 'esperado', c.esperado, 'contado', c.contado, 'diferencia', c.diferencia, 'recoger', c.recoger, 'quien', c.usuario_nombre,
      'entregado_por', c.entregado_por, 'recibido', c.recibido, 'recibido_at', c.recibido_at, 'nota', c.nota) order by c.fecha desc)
    from cierres_caja c where c.fecha >= (now() at time zone 'America/Bogota')::date - greatest(coalesce(p_dias, 30), 1)), '[]');
end $function$;

revoke all on function public.fijar_base_caja(numeric), public.caja_movimiento(text, text, numeric, text, text[], date),
  public.borrar_caja_movimiento(bigint), public.caja_local(date), public.cuadrar_caja(date, numeric, text),
  public.entregar_caja(date), public.recibir_caja(date, numeric), public.caja_historial(int) from public, anon;
grant execute on function public.fijar_base_caja(numeric), public.caja_movimiento(text, text, numeric, text, text[], date),
  public.borrar_caja_movimiento(bigint), public.caja_local(date), public.cuadrar_caja(date, numeric, text),
  public.entregar_caja(date), public.recibir_caja(date, numeric), public.caja_historial(int) to authenticated;
