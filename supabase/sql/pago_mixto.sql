-- Kaesuri · Pago mixto (parte en efectivo, parte por transferencia)
-- YA APLICADO en Supabase (proyecto Kaesuri) el 7 oct 2026; se guarda como registro.
--  1. metodo_pago acepta 'mixto'.
--  2. pedidos.monto_efectivo / monto_transferencia: cómo se repartió un pago mixto
--     (en efectivo y transferencia quedan en null: el total va todo a un lado).
--  3. entregar_pedido(): el domiciliario confirma la entrega con el método, la foto
--     del comprobante y, si es mixto, cuánto recibió en efectivo.
--  4. cuadre_cerrar_interno suma la parte en efectivo / transferencia de los mixtos.

-- 1) 'mixto' como método de pago (metodo_pago es texto con check)
alter table public.pedidos drop constraint if exists pedidos_metodo_pago_check;
alter table public.pedidos add constraint pedidos_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('efectivo', 'transferencia', 'mixto'));

begin;

-- 2) Reparto del pago mixto
alter table public.pedidos add column if not exists monto_efectivo numeric(12,2);
alter table public.pedidos add column if not exists monto_transferencia numeric(12,2);

-- Mantiene los montos coherentes. Se llama "trg_zz_..." para que corra DESPUÉS de
-- trg_proteger_pedido_domiciliario (los BEFORE triggers corren en orden alfabético):
-- así el domiciliario no toca estas columnas directamente; las llena este trigger a
-- partir de lo que entregar_pedido() dejó en la variable de la transacción.
create or replace function public.pago_mixto_montos() returns trigger
language plpgsql set search_path = public as $f$
declare
  v_efectivo numeric := nullif(current_setting('kaesuri.pago_efectivo', true), '')::numeric;
begin
  if new.metodo_pago = 'mixto' then
    if v_efectivo is not null then
      new.monto_efectivo := v_efectivo;
    end if;
    if new.monto_efectivo is null or new.monto_efectivo <= 0 or new.monto_efectivo >= new.total then
      raise exception 'En el pago mixto, el efectivo debe ser mayor que 0 y menor que el total del pedido';
    end if;
    new.monto_transferencia := new.total - new.monto_efectivo;
  else
    new.monto_efectivo := null;
    new.monto_transferencia := null;
  end if;
  return new;
end;
$f$;

drop trigger if exists trg_zz_pago_mixto on public.pedidos;
create trigger trg_zz_pago_mixto
  before insert or update on public.pedidos
  for each row execute function public.pago_mixto_montos();

-- 3) Confirmar entrega. Corre con los permisos de quien llama (RLS y
--    trg_proteger_pedido_domiciliario siguen aplicando igual que antes).
create or replace function public.entregar_pedido(
  p_pedido_id uuid,
  p_metodo text,
  p_comprobante text default null,
  p_efectivo numeric default null)
returns void language plpgsql security invoker set search_path = public as $f$
begin
  if p_metodo not in ('efectivo', 'transferencia', 'mixto') then
    raise exception 'Método de pago no válido';
  end if;
  if p_metodo in ('transferencia', 'mixto') and coalesce(p_comprobante, '') = '' then
    raise exception 'Falta la foto del comprobante de transferencia';
  end if;
  if p_metodo = 'mixto' and p_efectivo is null then
    raise exception 'Indica cuánto se recibió en efectivo';
  end if;

  perform set_config('kaesuri.pago_efectivo',
                     case when p_metodo = 'mixto' then p_efectivo::text else '' end, true);

  update public.pedidos
     set estado = 'entregado',
         entregado_at = now(),
         metodo_pago = p_metodo,
         comprobante_url = p_comprobante
   where id = p_pedido_id;

  if not found then
    raise exception 'No se encontró el pedido o no tienes permiso para entregarlo';
  end if;

  perform set_config('kaesuri.pago_efectivo', '', true);
end;
$f$;
revoke all on function public.entregar_pedido(uuid, text, text, numeric) from public, anon;
grant execute on function public.entregar_pedido(uuid, text, text, numeric) to authenticated;

-- 4) Cuadres: la parte en efectivo de un mixto va a efectivo y la otra a transferencia
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
         coalesce(sum(case metodo_pago
                        when 'efectivo' then total
                        when 'mixto' then monto_efectivo
                        else 0 end), 0),
         coalesce(sum(case metodo_pago
                        when 'transferencia' then total
                        when 'mixto' then monto_transferencia
                        else 0 end), 0),
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

commit;

-- Para que la API vea las columnas y la función nuevas de inmediato
notify pgrst, 'reload schema';
