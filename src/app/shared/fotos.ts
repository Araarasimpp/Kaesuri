import { SupabaseClient } from '@supabase/supabase-js';

/** Achica la foto (máx. 1600 px) y la deja en JPEG para subirla rápido */
export async function prepararFoto(archivo: Blob, maximo = 1600, calidad = 0.88): Promise<Blob> {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, maximo / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo leer la foto'))), 'image/jpeg', calidad));
}

/**
 * Sube una foto de producto al bucket "productos" (solo admin) y devuelve su dirección pública.
 * También guarda su miniatura (mini/…, 360 px) para las listas y el catálogo.
 */
export async function subirFoto(sb: SupabaseClient, archivo: Blob, carpeta: string): Promise<string> {
  const [blob, mini] = await Promise.all([prepararFoto(archivo), prepararFoto(archivo, 360, 0.78)]);
  const ruta = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await sb.storage.from('productos').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  // Sin miniatura la app muestra la foto original, así que un fallo aquí no detiene nada
  await sb.storage.from('productos').upload('mini/' + ruta, mini, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' }).catch(() => undefined);
  return sb.storage.from('productos').getPublicUrl(ruta).data.publicUrl;
}
