/**
 * Comisión de Wompi (2,65 % + $700, más IVA del 19 % sobre la comisión): se le cobra al cliente lo justo
 * para que al negocio le llegue completo el valor. Igual que privado.recargo_wompi en la base de datos.
 */
export function recargoWompi(base: number): number {
  if (!(base > 0)) return 0;
  return Math.ceil(((base + 700 * 1.19) / (1 - 0.0265 * 1.19) - base) / 100) * 100;
}
