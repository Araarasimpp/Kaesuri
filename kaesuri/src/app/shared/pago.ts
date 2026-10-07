import { MetodoPago } from './models/models';

/** Lo mínimo de un pedido para saber cómo se pagó. */
export interface PagoDePedido {
  total: number;
  metodo_pago: MetodoPago | null;
  monto_efectivo?: number | null;
  monto_transferencia?: number | null;
}

export const ETIQUETA_METODO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  mixto: 'Mixto',
};

/** Lo que aportó el pedido en efectivo (en un mixto, solo esa parte). */
export function efectivoDe(p: PagoDePedido): number {
  if (p.metodo_pago === 'efectivo') return Number(p.total) || 0;
  if (p.metodo_pago === 'mixto') return Number(p.monto_efectivo) || 0;
  return 0;
}

/** Lo que aportó el pedido por transferencia (en un mixto, solo esa parte). */
export function transferenciaDe(p: PagoDePedido): number {
  if (p.metodo_pago === 'transferencia') return Number(p.total) || 0;
  if (p.metodo_pago === 'mixto') return Number(p.monto_transferencia) || 0;
  return 0;
}

/** Transferencia y mixto llevan foto del comprobante. */
export function llevaComprobante(metodo: MetodoPago | null | undefined): boolean {
  return metodo === 'transferencia' || metodo === 'mixto';
}
