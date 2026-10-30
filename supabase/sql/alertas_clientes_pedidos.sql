-- ============================================================================
--  Kaesuri · Clientes problemáticos, pedidos repetidos y pedidos quietos (como en Jasta)
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--  (La revisión automática de pedidos quietos cada hora está en PENDIENTE_correr_en_supabase.sql.)
-- ============================================================================

-- ---------------------------------------------------------------- Marca manual de un cliente
create table if not exists public.clientes_alerta (
  telefono text primary key,
  nota text not null check (length(trim(nota)) between 1 and 300),
  autor text,
  created_at timestamptz not null default now()
);
alter table public.clientes_alerta enable row level security;
revoke all on public.clientes_alerta from anon, authenticated;

-- El admin marca (o desmarca con nota vacía) a un cliente por su teléfono
create or replace function public.marcar_cliente(p_telefono text, p_nota text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.tiene_rol('admin') then raise exception 'Solo el admin puede marcar clientes'; end if;
  if nullif(trim(coalesce(p_telefono, '')), '') is null then raise exception 'Falta el teléfono'; end if;
  if nullif(trim(coalesce(p_nota, '')), '') is null then
    delete from clientes_alerta where telefono = trim(p_telefono);
  else
    insert into clientes_alerta (telefono, nota, autor) values (trim(p_telefono), left(trim(p_nota), 300), (select nombre from profiles where id = auth.uid()))
    on conflict (telefono) do update set nota = excluded.nota, autor = excluded.autor, created_at = now();
  end if;
end;
$function$;

-- Historial del cliente al escribir su teléfono en Nuevo pedido: pedidos que salieron y se
-- cancelaron (no recibió), novedades de entrega, devoluciones y la marca manual del admin.
create or replace function public.riesgo_cliente(p_telefono text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  m clientes_alerta;
  v_tel text := right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10);
  v_ped int; v_ent int; v_rech int; v_nov int; v_dev int; v_ult timestamptz; v_nivel text;
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and coalesce(activo, true)) then raise exception 'Sin permiso'; end if;
  if length(v_tel) < 7 then return jsonb_build_object('nivel', null); end if;
  select count(*), count(*) filter (where p.estado = 'entregado'),
         count(*) filter (where p.estado = 'cancelado' and p.domiciliario_id is not null),
         coalesce(sum(p.novedades), 0),
         max(p.created_at) filter (where p.estado = 'cancelado' and p.domiciliario_id is not null)
    into v_ped, v_ent, v_rech, v_nov, v_ult
    from pedidos p where right(regexp_replace(coalesce(p.cliente_telefono, ''), '\D', '', 'g'), 10) = v_tel;
  select count(*) into v_dev from devoluciones d join pedidos x on x.id = d.pedido_id
   where right(regexp_replace(coalesce(x.cliente_telefono, ''), '\D', '', 'g'), 10) = v_tel and d.tipo = 'devolucion';
  select * into m from clientes_alerta where right(regexp_replace(telefono, '\D', '', 'g'), 10) = v_tel limit 1;
  v_nivel := case
    when m.telefono is not null or v_rech >= 2 or v_dev >= 2 or (v_rech >= 1 and v_ent = 0) then 'alto'
    when v_rech >= 1 or v_dev >= 1 or v_nov >= 3 then 'medio'
  end;
  return jsonb_build_object(
    'nivel', v_nivel, 'pedidos', v_ped, 'entregados', v_ent, 'rechazados', v_rech, 'novedades', v_nov,
    'devoluciones', v_dev, 'ultimo_rechazo', v_ult,
    'marca', case when m.telefono is null then null else jsonb_build_object('nota', m.nota, 'autor', m.autor, 'fecha', m.created_at) end);
end;
$function$;

-- ---------------------------------------------------------------- Pedidos repetidos
-- Pedidos del mismo teléfono en las últimas 24 horas (sin cancelar), para avisar antes de
-- crear uno que parece el mismo. Solo lo necesario para decidir.
create or replace function public.pedidos_parecidos(p_telefono text, p_productos uuid[] default '{}', p_excluir uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'numero', p.numero, 'estado', p.estado, 'created_at', p.created_at, 'canal', p.canal,
      'vendedor', split_part(coalesce(u.nombre, ''), ' ', 1),
      'productos', (select string_agg(i.cantidad || ' × ' || coalesce(pr.nombre, 'Producto'), ', ' order by i.id)
                      from pedido_items i left join productos pr on pr.id = i.producto_id where i.pedido_id = p.id),
      'mismos', exists (select 1 from pedido_items i where i.pedido_id = p.id and i.producto_id = any (coalesce(p_productos, '{}'))))
    order by p.created_at desc), '[]')
  from pedidos p
  left join profiles u on u.id = p.vendedor_id
  where exists (select 1 from profiles where id = auth.uid() and coalesce(activo, true))
    and length(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) >= 7
    and right(regexp_replace(coalesce(p.cliente_telefono, ''), '\D', '', 'g'), 10) = right(regexp_replace(p_telefono, '\D', '', 'g'), 10)
    and p.created_at > now() - interval '24 hours'
    and p.estado <> 'cancelado'
    and p.id is distinct from p_excluir
$function$;

revoke all on function public.marcar_cliente(text, text), public.riesgo_cliente(text), public.pedidos_parecidos(text, uuid[], uuid) from public, anon;
grant execute on function public.marcar_cliente(text, text), public.riesgo_cliente(text), public.pedidos_parecidos(text, uuid[], uuid) to authenticated;

-- Marca del admin de cada teléfono (para la lista de Clientes)
create or replace function public.clientes_marcados()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(right(regexp_replace(telefono, '\D', '', 'g'), 10), jsonb_build_object('nota', nota, 'autor', autor)), '{}')
    from clientes_alerta
   where exists (select 1 from profiles where id = auth.uid() and coalesce(activo, true))
$$;
revoke all on function public.clientes_marcados() from public, anon;
grant execute on function public.clientes_marcados() to authenticated;

-- ---------------------------------------------------------------- Pedidos quietos
-- Más de 24 horas en el mismo punto (por alistar, alistado sin salir o en ruta sin entregar):
-- se le avisa una vez a quien le toca y al admin un resumen.
create table if not exists privado.pedidos_quietos (
  pedido_id uuid not null,
  estado text not null,
  created_at timestamptz not null default now(),
  primary key (pedido_id, estado)
);

create or replace function public.tiempo_horas(h int) returns text language sql immutable set search_path to '' as $$
  select case when h < 48 then h || ' horas' else (h / 24) || ' días' end
$$;

create or replace function public.revisar_quietos()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r record; v_n int := 0; v_lista text := '';
begin
  for r in
    select x.* from (
      select p.id, p.numero, p.vendedor_id, p.domiciliario_id, split_part(p.cliente_nombre, ' ', 1) cliente,
        case when p.estado = 'pendiente' and p.alistado_at is null then 'por_alistar'
             when p.estado = 'pendiente' then 'alistado' else 'en_ruta' end paso,
        case when p.estado = 'pendiente' and p.alistado_at is null then p.created_at
             when p.estado = 'pendiente' then p.alistado_at else coalesce(p.asignado_at, p.created_at) end desde
      from pedidos p
      where p.estado in ('pendiente', 'en_ruta') and coalesce(p.canal, 'domicilio') <> 'local'
    ) x
    where x.desde < now() - interval '24 hours'
      and not exists (select 1 from privado.pedidos_quietos q where q.pedido_id = x.id and q.estado = x.paso)
    order by x.numero
  loop
    insert into privado.pedidos_quietos (pedido_id, estado) values (r.id, r.paso) on conflict do nothing;
    v_n := v_n + 1;
    if v_n <= 5 then v_lista := v_lista || case when v_lista = '' then '' else ', ' end || '#' || r.numero; end if;
    if r.paso = 'por_alistar' then
      perform public.notificar_roles(array['despachador']::user_role[], 'pedido_quieto',
        'Pedido #' || r.numero || ' lleva ' || public.tiempo_horas(floor(extract(epoch from now() - r.desde) / 3600)::int) || ' sin alistar',
        'De ' || r.cliente || '. Revisa si falta algo para alistarlo.', 'pedidos');
    elsif r.paso = 'alistado' then
      perform public.notificar_roles(array['despachador']::user_role[], 'pedido_quieto',
        'Pedido #' || r.numero || ' lleva ' || public.tiempo_horas(floor(extract(epoch from now() - r.desde) / 3600)::int) || ' alistado sin salir',
        'De ' || r.cliente || '. Falta asignarle domiciliario.', 'pedidos');
    else
      perform public.notificar(r.domiciliario_id, 'pedido_quieto',
        'Pedido #' || r.numero || ' lleva ' || public.tiempo_horas(floor(extract(epoch from now() - r.desde) / 3600)::int) || ' en ruta',
        'De ' || r.cliente || '. Si ya se entregó, márcalo; si no, reporta la novedad.', 'inicio');
      perform public.notificar(r.vendedor_id, 'pedido_quieto',
        'Pedido #' || r.numero || ' lleva más de un día en ruta', 'De ' || r.cliente || '.', 'pedidos');
    end if;
  end loop;
  if v_n > 0 then
    perform public.notificar_roles(array['admin']::user_role[], 'pedido_quieto',
      case when v_n = 1 then '1 pedido lleva más de un día sin moverse' else v_n || ' pedidos llevan más de un día sin moverse' end,
      v_lista || case when v_n > 5 then ' y ' || (v_n - 5) || ' más' else '' end || '. Ya les avisamos a los encargados.', 'pedidos');
  end if;
end;
$function$;
revoke all on function public.revisar_quietos() from public, anon, authenticated;
