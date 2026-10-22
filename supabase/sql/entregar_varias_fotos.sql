-- ============================================================================
--  Kaesuri · Entregar con varias fotos del comprobante (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  pedidos.comprobantes (text[]) ya existía (lo usaba la entrega desde Jasta).
--  Esta versión de entregar_pedido recibe todas las fotos; comprobante_url queda
--  con la primera para lo que todavía la lee. La versión de una sola foto sigue.
-- ============================================================================

create or replace function public.entregar_pedido(p_pedido_id uuid, p_metodo text, p_comprobantes text[], p_efectivo numeric default null)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_fotos text[] := nullif(array_remove(coalesce(p_comprobantes, '{}'), ''), '{}');
begin
  if p_metodo not in ('efectivo', 'transferencia', 'mixto') then
    raise exception 'Método de pago no válido';
  end if;
  if p_metodo in ('transferencia', 'mixto') and v_fotos is null then
    raise exception 'Falta la foto del comprobante de transferencia';
  end if;
  if p_metodo = 'mixto' and p_efectivo is null then
    raise exception 'Indica cuánto se recibió en efectivo';
  end if;
  if p_metodo = 'efectivo' then v_fotos := null; end if;

  perform set_config('kaesuri.pago_efectivo',
                     case when p_metodo = 'mixto' then p_efectivo::text else '' end, true);

  update public.pedidos
     set estado = 'entregado',
         entregado_at = now(),
         metodo_pago = p_metodo,
         comprobante_url = v_fotos[1],
         comprobantes = v_fotos[1:5]
   where id = p_pedido_id;

  if not found then
    raise exception 'No se encontró el pedido o no tienes permiso para entregarlo';
  end if;

  perform set_config('kaesuri.pago_efectivo', '', true);
end;
$function$;
revoke all on function public.entregar_pedido(uuid, text, text[], numeric) from public, anon;
grant execute on function public.entregar_pedido(uuid, text, text[], numeric) to authenticated;
