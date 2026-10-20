-- Kaesuri · Alistamiento de pedidos
-- YA APLICADO en Supabase (proyecto Kaesuri) el 14 oct 2026; se guarda como registro.
--  1. pedidos.alistado_at / alistado_por: cuándo y quién empacó un pedido pendiente.
--     Un pendiente con alistado_at es "Alistado" (pestaña propia en Pedidos) y los
--     rótulos se imprimen en el orden de alistado_at.
--  2. trg_alistamiento: pone la hora del servidor y quién alistó, solo admin/despachador,
--     y solo sobre pedidos pendientes.

alter table public.pedidos add column if not exists alistado_at timestamptz;
alter table public.pedidos add column if not exists alistado_por uuid references public.profiles(id);
create index if not exists pedidos_alistados_idx on public.pedidos (alistado_at)
  where estado = 'pendiente' and alistado_at is not null;

create or replace function public.pedido_alistamiento() returns trigger
language plpgsql set search_path = public as $f$
begin
  if new.alistado_at is distinct from old.alistado_at then
    if current_user in ('authenticated', 'anon')
       and public.current_role() not in ('admin'::user_role, 'despachador'::user_role) then
      raise exception 'Solo el admin o el despachador pueden alistar pedidos';
    end if;
    if new.alistado_at is not null then
      if old.estado <> 'pendiente' then
        raise exception 'Solo se pueden alistar pedidos pendientes';
      end if;
      -- Hora del servidor: el orden de alistamiento no depende del reloj de cada celular
      new.alistado_at := clock_timestamp();
      new.alistado_por := auth.uid();
    else
      new.alistado_por := null;
    end if;
  end if;
  return new;
end;
$f$;

create trigger trg_alistamiento
  before update of alistado_at on public.pedidos
  for each row execute function public.pedido_alistamiento();

notify pgrst, 'reload schema';
