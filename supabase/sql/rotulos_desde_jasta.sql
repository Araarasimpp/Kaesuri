-- ============================================================================
--  Kaesuri · Rótulos de Variedades JYB impresos desde la app de Jasta
--  YA APLICADO en Supabase (proyecto Kaesuri); se guarda como registro.
--
--  Quien alista en Jasta ve los pedidos de Variedades JYB por despachar y les
--  imprime el rótulo (el mismo diseño de Kaesuri, con su QR "KAESURI-…") desde el
--  mismo computador, sin cambiar de app. Lo usa la función jasta-puente
--  (acciones 'rotulos' y 'marcar_rotulos'), que valida la sesión de Jasta.
--
--  Permiso (lo revisa jasta-puente):
--   · la misma persona (mismo correo) es admin o despachador activo en Kaesuri
--     (jasta_rotulos / jasta_marcar_rotulos), o
--   · es admin o alistador activo en Jasta: jasta-puente lo confirma con Jasta y
--     llama jasta_rotulos_alistador / jasta_marcar_rotulos_alistador.
-- ============================================================================

-- Admin o despachador activo con ese correo
create or replace function public.jasta_despachador(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select id from public.profiles
   where lower(email) = lower(trim(p_email)) and coalesce(activo, true)
     and roles && array['admin', 'despachador']::public.user_role[]
   limit 1;
$function$;

-- Pedidos por despachar (pendientes, alistados primero en orden de alistamiento)
-- con lo que lleva el rótulo, y los datos del negocio para el encabezado.
-- Sin revisar permiso: lo revisan quienes la llaman.
create or replace function public.jasta_rotulos_datos()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'vinculado', true,
    'negocio', (select jsonb_build_object('nombre_negocio', nombre_negocio, 'telefonos', telefonos, 'redes', redes,
                                          'texto_garantia', texto_garantia)
                  from public.configuracion where id),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'cliente_nombre', p.cliente_nombre, 'cliente_telefono', p.cliente_telefono,
               'direccion', p.direccion, 'barrio', p.barrio, 'observaciones', p.observaciones, 'total', p.total,
               'created_at', p.created_at, 'alistado_at', p.alistado_at, 'rotulo_impreso_at', p.rotulo_impreso_at,
               'vendedor', v.nombre,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'nombre', coalesce(pr.nombre, 'Producto')
                                    || case when coalesce(i.color, '') <> '' or coalesce(i.talla, '') <> ''
                                            then ' (' || concat_ws(' · ', nullif(i.color, ''), 'Talla ' || nullif(i.talla, '')) || ')'
                                            else '' end,
                          'cantidad', i.cantidad) order by i.id)
                   from public.pedido_items i left join public.productos pr on pr.id = i.producto_id
                  where i.pedido_id = p.id), '[]'::jsonb))
             order by p.alistado_at nulls last, p.created_at)
        from public.pedidos p left join public.profiles v on v.id = p.vendedor_id
       where p.estado = 'pendiente' and coalesce(p.canal, '') <> 'local'), '[]'::jsonb));
$function$;

create or replace function public.jasta_rotulos(p_email text)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if public.jasta_despachador(p_email) is null then return jsonb_build_object('vinculado', false); end if;
  return public.jasta_rotulos_datos();
end;
$function$;

-- Quien alista en Jasta (jasta-puente ya revisó su rol en Jasta)
create or replace function public.jasta_rotulos_alistador()
returns jsonb language sql stable security definer set search_path to 'public'
as $function$ select public.jasta_rotulos_datos(); $function$;

create or replace function public.jasta_marcar_rotulos_alistador(p_ids uuid[])
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_n int;
begin
  update public.pedidos set rotulo_impreso_at = now()
   where id = any (coalesce(p_ids, '{}')) and estado in ('pendiente', 'en_ruta');
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- Marca los rótulos como impresos (solo pedidos que siguen por despachar)
create or replace function public.jasta_marcar_rotulos(p_email text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_desp uuid := public.jasta_despachador(p_email); v_n int;
begin
  if v_desp is null then raise exception 'Tu correo de Jasta no es admin ni despachador en Variedades JYB'; end if;
  -- Los cambios quedan a nombre de esa persona (Actividad)
  perform set_config('request.jwt.claim.sub', v_desp::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_desp, 'role', 'authenticated')::text, true);
  update public.pedidos set rotulo_impreso_at = now()
   where id = any (coalesce(p_ids, '{}')) and estado in ('pendiente', 'en_ruta');
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.jasta_rotulos_datos() from public, anon, authenticated;
revoke all on function public.jasta_rotulos_alistador() from public, anon, authenticated;
revoke all on function public.jasta_marcar_rotulos_alistador(uuid[]) from public, anon, authenticated;
grant execute on function public.jasta_rotulos_datos() to service_role;
grant execute on function public.jasta_rotulos_alistador() to service_role;
grant execute on function public.jasta_marcar_rotulos_alistador(uuid[]) to service_role;
revoke all on function public.jasta_despachador(text) from public, anon, authenticated;
revoke all on function public.jasta_rotulos(text) from public, anon, authenticated;
revoke all on function public.jasta_marcar_rotulos(text, uuid[]) from public, anon, authenticated;
grant execute on function public.jasta_despachador(text) to service_role;
grant execute on function public.jasta_rotulos(text) to service_role;
grant execute on function public.jasta_marcar_rotulos(text, uuid[]) to service_role;
