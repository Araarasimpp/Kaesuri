import { SupabaseClient } from '@supabase/supabase-js';

/** Cuenta del negocio para recibir transferencias (Configuración → Cuentas para transferencias) */
export interface CuentaPago {
  id: number;
  nombre: string;
  titular: string | null;
  numero: string | null;
  qr_url: string | null;
  activa: boolean;
  orden: number;
}

let cache: { cuando: number; lista: CuentaPago[] } | null = null;

/** Cuentas activas (se guardan 5 minutos para que el QR abra al instante). Si falla, lista vacía. */
export async function cargarCuentas(sb: SupabaseClient, forzar = false): Promise<CuentaPago[]> {
  if (!forzar && cache && Date.now() - cache.cuando < 5 * 60_000) return cache.lista;
  const { data, error } = await sb.from('cuentas_pago').select('*').eq('activa', true).order('orden').order('id');
  if (error) return cache?.lista ?? [];
  cache = { cuando: Date.now(), lista: (data ?? []) as CuentaPago[] };
  return cache.lista;
}

export function olvidarCuentas(): void {
  cache = null;
}
