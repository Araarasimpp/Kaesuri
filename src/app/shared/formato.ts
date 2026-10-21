const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

export function pesos(v: number | null | undefined): string {
  return COP.format(Number(v ?? 0)).replace(/\s/g, ' ');
}

export function numero(v: number | null | undefined): string {
  return NUM.format(Number(v ?? 0));
}

/** Dirección que se puede mostrar (en Kaesuri las fotos ya se guardan con la URL completa) */
export function urlImagen(ruta: string | null | undefined): string | null {
  return ruta || null;
}

/**
 * Miniatura (máx. 360 px) de una foto del bucket "productos", para listas y tarjetas.
 * Si no existe (fotos subidas antes), la app vuelve sola a la foto original (ver AppComponent).
 */
export function urlMini(ruta: string | null | undefined): string | null {
  const u = urlImagen(ruta);
  if (!u || !u.includes('/object/public/productos/') || u.includes('/object/public/productos/mini/')) return u;
  return u.replace('/object/public/productos/', '/object/public/productos/mini/');
}

/** Mensaje legible a partir de un error de Supabase */
export function mensajeError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^.*?ERROR:\s*/, '');
}
