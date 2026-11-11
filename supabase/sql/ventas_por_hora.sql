-- Kaesuri · Reportes → "Horas y días" (como en Jasta). YA APLICADO.
-- Pedidos y ventas por día de la semana (isodow 1-7) y hora de Colombia en un periodo. Solo admin.
create or replace function public.ventas_por_hora(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tiene_rol('admin') then raise exception 'Sin permiso'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('dow', dow, 'hora', hora, 'pedidos', n, 'ventas', v, 'local', nl, 'web', nw) order by dow, hora) from (
    select extract(isodow from p.created_at at time zone 'America/Bogota')::int dow,
           extract(hour from p.created_at at time zone 'America/Bogota')::int hora,
           count(*) n, round(sum(p.total - coalesce(p.valor_domicilio, 0))) v,
           count(*) filter (where p.canal = 'local') nl,
           count(*) filter (where exists (select 1 from pedidos_web w where w.pedido_id = p.id)) nw
    from pedidos p
    where p.estado <> 'cancelado'
      and p.created_at >= (p_desde::text || ' 00:00 America/Bogota')::timestamptz
      and p.created_at < ((p_hasta + 1)::text || ' 00:00 America/Bogota')::timestamptz
    group by 1, 2) x), '[]');
end $$;
revoke all on function public.ventas_por_hora(date, date) from public, anon;
grant execute on function public.ventas_por_hora(date, date) to authenticated;
