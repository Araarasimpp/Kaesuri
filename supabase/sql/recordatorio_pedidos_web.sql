-- ============================================================================
--  Kaesuri · Pedidos de la tienda sin confirmar (como en Jasta)
--  Recordatorio al vendedor a los 15 min y aviso al admin si a la hora sigue igual.
--  YA APLICADO en Supabase; la revisión cada 5 minutos (cron) está en PENDIENTE_correr_en_supabase.sql.
-- ============================================================================

alter table public.pedidos_web add column if not exists recordado_at timestamptz,
  add column if not exists escalado_at timestamptz;

create or replace function public.revisar_pedidos_web()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  w record;
  v_hora int := extract(hour from now() at time zone 'America/Bogota');
begin
  -- De noche no se molesta a nadie: lo pendiente se avisa a las 7 a. m.
  if v_hora < 7 or v_hora >= 21 then return; end if;

  for w in select pw.* from pedidos_web pw
           where pw.estado = 'por_confirmar' and pw.recordado_at is null and pw.created_at < now() - interval '15 minutes'
           for update skip locked loop
    if w.vendedor_id is null then
      perform public.notificar_roles(array['admin']::user_role[], 'pedido_web',
        '⏰ ' || split_part(w.cliente_nombre, ' ', 1) || ' está esperando tu llamada',
        'Pedido de la tienda sin confirmar desde las ' || lower(to_char(w.created_at at time zone 'America/Bogota', 'FMHH12:MI AM'))
          || ' · ' || public.fmt_pesos(w.subtotal + w.valor_domicilio) || '. Llámalo antes de que se enfríe.', 'pedidos-web');
    else
      perform public.notificar(w.vendedor_id, 'pedido_web',
        '⏰ ' || split_part(w.cliente_nombre, ' ', 1) || ' está esperando tu llamada',
        'Pedido de la tienda sin confirmar desde las ' || lower(to_char(w.created_at at time zone 'America/Bogota', 'FMHH12:MI AM'))
          || ' · ' || public.fmt_pesos(w.subtotal + w.valor_domicilio) || '. Llámalo antes de que se enfríe.', 'pedidos-web');
    end if;
    update pedidos_web set recordado_at = now() where id = w.id;
  end loop;

  -- Si a los 45 min del recordatorio sigue igual, se le avisa al admin (si era de un vendedor)
  for w in select pw.*, u.nombre vendedor from pedidos_web pw left join profiles u on u.id = pw.vendedor_id
           where pw.estado = 'por_confirmar' and pw.escalado_at is null and pw.recordado_at < now() - interval '45 minutes'
           for update of pw skip locked loop
    if w.vendedor_id is not null then
      perform public.notificar_roles(array['admin']::user_role[], 'pedido_web',
        'Pedido de la tienda lleva más de 1 hora sin confirmar',
        split_part(w.cliente_nombre, ' ', 1) || ' · ' || public.fmt_pesos(w.subtotal + w.valor_domicilio) || ' · catálogo de ' || split_part(coalesce(w.vendedor, ''), ' ', 1),
        'pedidos-web');
    end if;
    update pedidos_web set escalado_at = now() where id = w.id;
  end loop;
end;
$function$;
revoke all on function public.revisar_pedidos_web() from public, anon, authenticated;

-- Los que ya llevan más de un día esperando no se avisan de golpe
update public.pedidos_web set recordado_at = now(), escalado_at = now()
where estado = 'por_confirmar' and created_at < now() - interval '1 day' and recordado_at is null;
