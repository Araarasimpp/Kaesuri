-- ============================================================================
--  Kaesuri · Transferencias por revisar (como en Jasta). YA APLICADO en Supabase (columnas y
--  funciones). Los triggers que las marcan al entregar y el recordatorio cada 30 minutos
--  están en PENDIENTE_correr_en_supabase.sql.
--  Cada pago presencial con transferencia (entrega a domicilio o venta del local) queda "por
--  revisar" hasta que el admin confirma en el banco que sí llegó.
-- ============================================================================

alter table public.pedidos
  add column if not exists transferencia_estado text check (transferencia_estado in ('por_revisar', 'llego', 'no_llego')),
  add column if not exists transferencia_revisada_at timestamptz,
  add column if not exists transferencia_revisada_por text,
  add column if not exists transferencia_nota text;
create index if not exists pedidos_transferencia_por_revisar_idx on public.pedidos (entregado_at) where transferencia_estado = 'por_revisar';

-- Lo que debió llegar por transferencia: todo el total, o la parte de transferencia en mixto
create or replace function public.valor_transferencia(p public.pedidos) returns numeric language sql immutable set search_path to '' as $$
  select case p.metodo_pago when 'transferencia' then coalesce(p.monto_transferencia, p.total)
                            when 'mixto' then coalesce(p.monto_transferencia, 0) else 0 end
$$;

-- Al quedar entregado con transferencia: queda por revisar y se avisa a los admins
create or replace function public.marcar_transferencia()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_valor numeric := public.valor_transferencia(new); v_quien text;
begin
  if new.estado <> 'entregado' or v_valor <= 0 or new.transferencia_estado is not null then return null; end if;
  update pedidos set transferencia_estado = 'por_revisar' where id = new.id;
  select nombre into v_quien from profiles where id = case when new.canal = 'local' then coalesce(new.registrado_por, new.vendedor_id) else new.domiciliario_id end;
  perform public.notificar_roles(array['admin']::user_role[], 'transferencia',
    '💸 Revisa una transferencia de ' || public.fmt_pesos(v_valor),
    case when new.canal = 'local' then 'Venta del local #' else 'Pedido #' end || new.numero || ' · ' || coalesce(new.cliente_nombre, 'Cliente')
      || coalesce(' · registró ' || split_part(v_quien, ' ', 1), '') || '. Mira en el banco si llegó y confírmalo.',
    'transferencias');
  return null;
end $function$;

-- Si la venta se cancela o el pedido deja de estar entregado, ya no hay nada que revisar
create or replace function public.desmarcar_transferencia()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.transferencia_estado = 'por_revisar' and (new.estado <> 'entregado' or public.valor_transferencia(new) <= 0) then
    new.transferencia_estado := null;
  end if;
  return new;
end $function$;
revoke all on function public.marcar_transferencia(), public.desmarcar_transferencia() from public, anon, authenticated;

-- Lista para la página Transferencias
create or replace function public.transferencias_lista(p_estado text default 'por_revisar')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'estado') = 'por_revisar' desc,
      case when x->>'estado' = 'por_revisar' then x->>'entregado_at' end asc, x->>'revisada_at' desc) from (
    select jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'estado', p.transferencia_estado, 'canal', p.canal, 'cliente', p.cliente_nombre, 'telefono', p.cliente_telefono,
      'total', p.total, 'transferencia', public.valor_transferencia(p), 'esperado', public.valor_transferencia(p), 'tipo', p.metodo_pago,
      'entregado_at', p.entregado_at, 'comprobantes', coalesce(p.comprobantes, '{}'),
      'domiciliario', m.nombre, 'vendedor', v.nombre,
      'revisada_at', p.transferencia_revisada_at, 'revisada_por', p.transferencia_revisada_por, 'nota', p.transferencia_nota) x
    from pedidos p
    left join profiles m on m.id = p.domiciliario_id
    left join profiles v on v.id = p.vendedor_id
    where case coalesce(p_estado, 'por_revisar')
            when 'por_revisar' then p.transferencia_estado = 'por_revisar'
            when 'no_llego' then p.transferencia_estado = 'no_llego'
            else p.transferencia_estado in ('llego', 'no_llego') and p.transferencia_revisada_at > now() - interval '15 days' end
    limit 300) s), '[]');
end $function$;

-- Cuántas faltan (para la franja roja de arriba)
create or replace function public.transferencias_pendientes()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select case when public.tiene_rol('admin') then
    (select jsonb_build_object('n', count(*), 'valor', coalesce(sum(public.valor_transferencia(p)), 0), 'desde', min(entregado_at))
     from pedidos p where transferencia_estado = 'por_revisar')
  else jsonb_build_object('n', 0, 'valor', 0) end
$$;

-- El admin confirma si llegó o no; si no llegó, le avisa a quien la registró
create or replace function public.revisar_transferencia(p_pedido uuid, p_llego boolean, p_nota text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare p pedidos; v_nota text := nullif(left(trim(coalesce(p_nota, '')), 300), ''); v_quien uuid;
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin confirma transferencias'; end if;
  select * into p from pedidos where id = p_pedido for update;
  if not found then raise exception 'Ese pedido no existe'; end if;
  if p.transferencia_estado is null then raise exception 'Este pedido no tiene transferencia por revisar'; end if;
  if not p_llego and v_nota is null then raise exception 'Escribe qué pasó (ej: no aparece en el banco, llegó menos)'; end if;
  update pedidos set transferencia_estado = case when p_llego then 'llego' else 'no_llego' end,
    transferencia_revisada_at = now(), transferencia_revisada_por = public.mi_nombre(), transferencia_nota = v_nota
   where id = p.id;
  if not p_llego then
    v_quien := case when p.canal = 'local' then coalesce(p.registrado_por, p.vendedor_id) else p.domiciliario_id end;
    if v_quien is not null then
      perform public.notificar(v_quien, 'transferencia', '⚠️ No llegó la transferencia de ' || public.fmt_pesos(public.valor_transferencia(p)),
        'Pedido #' || p.numero || ' · ' || coalesce(p.cliente_nombre, 'Cliente') || ': ' || v_nota, case when p.canal = 'local' then 'ventas-local' else 'inicio' end);
    end if;
    perform public.notificar_roles(array['admin']::user_role[], 'transferencia', '⚠️ No llegó la transferencia de ' || public.fmt_pesos(public.valor_transferencia(p)),
      'Pedido #' || p.numero || ' · ' || coalesce(p.cliente_nombre, 'Cliente') || ': ' || v_nota, 'transferencias');
  end if;
end $function$;

-- Recordatorio cada 30 minutos mientras quede alguna sin revisar (7 a. m. a 10 p. m.).
-- Borra el recordatorio anterior sin leer para que no se amontonen.
create or replace function public.recordar_transferencias()
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_n int; v_valor numeric; v_desde timestamptz; v_hora int := extract(hour from now() at time zone 'America/Bogota'); v_horas int;
begin
  if v_hora < 7 or v_hora >= 22 then return; end if;
  select count(*), coalesce(sum(public.valor_transferencia(p)), 0), min(entregado_at) into v_n, v_valor, v_desde
    from pedidos p where transferencia_estado = 'por_revisar';
  if v_n = 0 then return; end if;
  v_horas := floor(extract(epoch from now() - v_desde) / 3600);
  delete from notificaciones where tipo = 'transferencia_pendiente' and not leida;
  perform public.notificar_roles(array['admin']::user_role[], 'transferencia_pendiente',
    case when v_horas >= 3 then '🚨🚨 ' else '🚨 ' end || v_n || case when v_n = 1 then ' transferencia sin revisar' else ' transferencias sin revisar' end
      || ' · ' || public.fmt_pesos(v_valor),
    case when v_horas >= 1 then 'La más vieja lleva ' || v_horas || (case when v_horas = 1 then ' hora' else ' horas' end) || ' esperando. ' else '' end
      || 'Entra al banco, revísalas y confírmalas. Este aviso se repite cada 30 minutos hasta que las revises.',
    'transferencias');
end $function$;
revoke all on function public.recordar_transferencias() from public, anon, authenticated;

revoke all on function public.transferencias_lista(text), public.transferencias_pendientes(), public.revisar_transferencia(uuid, boolean, text) from public, anon;
grant execute on function public.transferencias_lista(text), public.transferencias_pendientes(), public.revisar_transferencia(uuid, boolean, text) to authenticated;
