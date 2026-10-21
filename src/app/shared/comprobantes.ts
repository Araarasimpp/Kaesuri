import { SupabaseClient } from '@supabase/supabase-js';
import { prepararFoto } from './fotos';

/**
 * Sube una foto (factura o comprobante) al bucket privado "comprobantes", en la
 * carpeta de quien la sube, y devuelve su ruta interna (así se guarda; para verla
 * se pide un enlace firmado). Copiado de Jasta.
 */
export async function subirComprobante(sb: SupabaseClient, archivo: Blob): Promise<string> {
  const { data } = await sb.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('Tu sesión se cerró, vuelve a entrar');
  const blob = await prepararFoto(archivo, 1600);
  const ruta = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from('comprobantes').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return ruta;
}

/** Enlaces firmados (1 hora) para ver fotos del bucket privado "comprobantes" */
export async function urlsComprobantes(sb: SupabaseClient, rutas: string[]): Promise<string[]> {
  const firmadas = new Map<string, string>();
  if (rutas.length) {
    try {
      const { data } = await sb.storage.from('comprobantes').createSignedUrls(rutas, 3600);
      for (const f of data ?? []) if (f.path && f.signedUrl) firmadas.set(f.path, f.signedUrl);
    } catch {
      /* sin enlace: la foto se muestra vacía */
    }
  }
  return rutas.map((r) => firmadas.get(r) ?? '');
}
