// src/app/shared/fecha-colombia.ts
// Colombia usa UTC-5 todo el año (no tiene horario de verano), así que el
// offset es siempre fijo — no hace falta ninguna librería de zonas horarias.

const TZ = 'America/Bogota';
const OFFSET = '-05:00';

/** Fecha de "hoy" en Colombia, formato YYYY-MM-DD */
export function hoyColombiaISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Instante UTC correspondiente a las 00:00:00 en Colombia del dia dado (o hoy) */
export function inicioDiaColombia(fechaISO?: string): Date {
  const dia = fechaISO ?? hoyColombiaISO();
  return new Date(`${dia}T00:00:00${OFFSET}`);
}

/** Instante UTC correspondiente a las 23:59:59.999 en Colombia del dia dado (o hoy) */
export function finDiaColombia(fechaISO?: string): Date {
  const dia = fechaISO ?? hoyColombiaISO();
  return new Date(`${dia}T23:59:59.999${OFFSET}`);
}

/** El dia (YYYY-MM-DD) en Colombia al que pertenece un timestamp cualquiera */
export function diaColombiaDe(fechaIso: string): string {
  return new Date(fechaIso).toLocaleDateString('en-CA', { timeZone: TZ });
}

export function formatoFechaCO(fechaIso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(fechaIso).toLocaleDateString('es-CO', { timeZone: TZ, ...opts });
}

export function formatoHoraCO(fechaIso: string): string {
  return new Date(fechaIso).toLocaleTimeString('es-CO', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}