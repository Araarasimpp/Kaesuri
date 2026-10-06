-- Kaesuri · Cuadres sin cerrar (misma solución que Home ALS)
-- Pegar completo en Supabase → SQL Editor → Run (proyecto Kaesuri).
--  1. cuadres.cerrado_por: quién cerró el cuadre (null = cierre automático).
--  2. El admin / despachador pueden cerrar el cuadre del día de un domiciliario.
--  3. El domiciliario, al cerrar, incluye también sus días atrasados (un cuadre por día).
--  4. Cada noche a las 11:50 p. m. se cierran solos los que queden abiertos.
--  5. Avisos según quién cerró.

begin;

alter table public.cuadres add column if not exists cerrado_por uuid references public.profiles(id);
-- Los cuadres que ya existen los cerró el propio domiciliario (sin ensuciar el historial de actividad)
alter table public.cuadres disable trigger trg_auditar;
update public.cuadres set cerrado_por = domiciliario_id where cerrado_por is null;
alter table public.cuadres enable trigger trg_auditar;

-- Núcleo: cierra el cuadre de UN día de un domiciliario (sin chequeo de permisos)
create or replace function public.cuadre_cerrar_interno(p_domiciliario uuid, p_fecha date, p_cerrado_por uuid)
returns uuid language plpgsql security definer set search_path = public as $f$
declare
  v_id uuid;
  v_ini timestamptz := (p_fecha::text || ' 00:00:00-05:00')::timestamptz;
  v_fin timestamptz := (p_fecha::text || ' 23:59:59.999-05:00')::timestamptz;
  v_dom numeric(12,2); v_ef numeric(12,2); v_tr numeric(12,2); v_tot numeric(12,2); v_n int;
begin
  -- Bloquea los pedidos para que dos cierres a la vez no se crucen
  perform 1 from public.pedidos
   where domiciliario_id = p_domiciliario and estado = 'entregado' and cuadre_id is null
     and entregado_at between v_ini and v_fin
   for update;

  select coalesce(sum(valor_domicilio), 0),
         coalesce(sum(total) filter (where metodo_pago = 'efectivo'), 0),
         coalesce(sum(total) filter (where metodo_pago = 'transferencia'), 0),
         coalesce(sum(total), 0), count(*)
    into v_dom, v_ef, v_tr, v_tot, v_n
    from public.pedidos
   where domiciliario_id = p_domiciliario and estado = 'entregado' and cuadre_id is null
     and entregado_at between v_ini and v_fin;

  if v_n = 0 then return null; end if;

  insert into public.cuadres (domiciliario_id, fecha, cantidad_pedidos, total_domicilios, total_efectivo,
                              total_transferencia, total_general, estado, cerrado_por)
  values (p_domiciliario, p_fecha, v_n, v_dom, v_ef, v_tr, v_tot, 'pendiente', p_cerrado_por)
  returning id into v_id;

  update public.pedidos set cuadre_id = v_id
   where domiciliario_id = p_domiciliario and estado = 'entregado' and cuadre_id is null
     and entregado_at between v_ini and v_fin;
  return v_id;
end;
$f$;
revoke all on function public.cuadre_cerrar_interno(uuid, date, uuid) from public, anon, authenticated;

drop function if exists public.cerrar_cuadre(date);

-- Domiciliario: cierra lo suyo hasta p_fecha (días atrasados incluidos, un cuadre por día).
-- Admin / despachador: cierran el día p_fecha del domiciliario indicado.
create or replace function public.cerrar_cuadre(
  p_fecha date default ((now() at time zone 'America/Bogota'))::date,
  p_domiciliario uuid default null)
returns uuid language plpgsql security definer set search_path = public as $f$
declare
  v_rol text := public.current_role()::text;
  v_dom uuid := coalesce(p_domiciliario, auth.uid());
  v_propio boolean := v_dom is not distinct from auth.uid();
  v_id uuid; v_ult uuid; r record;
begin
  if v_rol is null or v_rol not in ('domiciliario', 'admin', 'despachador') then
    raise exception 'No tienes permiso para cerrar un cuadre';
  end if;
  if not v_propio and v_rol not in ('admin', 'despachador') then
    raise exception 'Solo puedes cerrar tu propio cuadre';
  end if;

  for r in
    select distinct (entregado_at at time zone 'America/Bogota')::date as dia
      from public.pedidos
     where domiciliario_id = v_dom and estado = 'entregado' and cuadre_id is null
       and (entregado_at at time zone 'America/Bogota')::date <= p_fecha
       and (v_propio or (entregado_at at time zone 'America/Bogota')::date = p_fecha)
     order by 1
  loop
    v_id := public.cuadre_cerrar_interno(v_dom, r.dia, auth.uid());
    if v_id is not null then v_ult := v_id; end if;
  end loop;

  if v_ult is null then
    raise exception 'No hay pedidos entregados sin cuadrar';
  end if;
  return v_ult;
end;
$f$;
revoke all on function public.cerrar_cuadre(date, uuid) from public, anon;
grant execute on function public.cerrar_cuadre(date, uuid) to authenticated;

-- Cierre automático de todo lo que quede abierto (lo llama pg_cron cada noche)
create or replace function public.cerrar_cuadres_pendientes()
returns int language plpgsql security definer set search_path = public as $f$
declare r record; v_n int := 0;
begin
  for r in
    select distinct domiciliario_id, (entregado_at at time zone 'America/Bogota')::date as dia
      from public.pedidos
     where estado = 'entregado' and cuadre_id is null and domiciliario_id is not null
  loop
    if public.cuadre_cerrar_interno(r.domiciliario_id, r.dia, null) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$f$;
revoke all on function public.cerrar_cuadres_pendientes() from public, anon, authenticated;

-- Avisos según quién cerró el cuadre
create or replace function public.notif_cuadres() returns trigger
language plpgsql security definer set search_path = public as $f$
declare v_nombre text; v_quien text; v_monto text;
begin
  select nombre into v_nombre from public.profiles where id = new.domiciliario_id;
  if tg_op = 'INSERT' then
    v_monto := new.cantidad_pedidos || ' pedido(s) · debe entregar ' || public.fmt_pesos(new.total_efectivo - new.total_domicilios);
    if new.cerrado_por is not distinct from new.domiciliario_id then
      perform public.notificar_roles(array['admin','despachador']::user_role[], 'cuadre_nuevo',
        coalesce(v_nombre, 'Un domiciliario') || ' cerró su cuadre', v_monto, 'cuadres');
    else
      if new.cerrado_por is null then
        perform public.notificar_roles(array['admin','despachador']::user_role[], 'cuadre_nuevo',
          'Cuadre de ' || coalesce(v_nombre, 'un domiciliario') || ' cerrado automáticamente', v_monto, 'cuadres');
      end if;
      select nombre into v_quien from public.profiles where id = new.cerrado_por;
      perform public.notificar(new.domiciliario_id, 'cuadre_nuevo',
        'Se cerró tu cuadre del ' || to_char(new.fecha, 'DD/MM'),
        case when new.cerrado_por is null then 'Cierre automático' else 'Lo cerró ' || coalesce(v_quien, 'la oficina') end
          || ' · ' || v_monto, 'cuadres');
    end if;
    return new;
  end if;
  if new.estado = 'confirmado' and old.estado is distinct from 'confirmado' then
    select nombre into v_quien from public.profiles where id = new.confirmado_por;
    perform public.notificar(new.domiciliario_id, 'cuadre_recibido',
      'Tu cuadre del ' || to_char(new.fecha, 'DD/MM') || ' fue recibido',
      'Recibido por ' || coalesce(v_quien, 'administración'), 'cuadres');
  end if;
  return new;
end;
$f$;

commit;

-- Cierre automático: 11:50 p. m. hora Colombia (04:50 UTC).
-- Para quitarlo: select cron.unschedule('cerrar-cuadres-noche');
select cron.unschedule(jobid) from cron.job where jobname = 'cerrar-cuadres-noche';
select cron.schedule('cerrar-cuadres-noche', '50 4 * * *', 'select public.cerrar_cuadres_pendientes()') as job;
