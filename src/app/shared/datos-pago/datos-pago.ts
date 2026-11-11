/** Datos de pago privados de una persona del equipo (cédula y cuenta donde se le paga) */
export interface DatosPago {
  documento?: string | null;
  banco?: string | null;
  tipo_cuenta?: 'ahorros' | 'corriente' | 'nequi' | 'daviplata' | 'otro' | null;
  numero_cuenta?: string | null;
  titular?: string | null;
  updated_at?: string;
}

export const TIPOS_CUENTA: { id: NonNullable<DatosPago['tipo_cuenta']>; label: string }[] = [
  { id: 'ahorros', label: 'Cuenta de ahorros' },
  { id: 'corriente', label: 'Cuenta corriente' },
  { id: 'nequi', label: 'Nequi' },
  { id: 'daviplata', label: 'Daviplata' },
  { id: 'otro', label: 'Otro' },
];

/** "Bancolombia · Cuenta de ahorros · 123-456789-01" */
export function resumenCuenta(d: DatosPago | null | undefined): string {
  if (!d?.numero_cuenta) return '';
  const tipo = TIPOS_CUENTA.find((t) => t.id === d.tipo_cuenta)?.label;
  return [d.banco, tipo, d.numero_cuenta].filter(Boolean).join(' · ');
}
