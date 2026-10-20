// Puente para que el domiciliario entregue pedidos de Variedades JYB desde la app de Jasta.
//
// La app de Jasta llama aquí con su propia sesión (Authorization: Bearer <token de Jasta>).
// Se valida ese token contra Jasta, se toma el correo y se busca el domiciliario con ese
// correo en Kaesuri. Todo lo demás lo hacen las funciones jasta_* de la base (solo service_role).
//
// Se despliega con verify_jwt = false: el token no es de este proyecto y se valida aquí.
//
// POST { accion: 'resumen' }
// POST { accion: 'entregar', pedido_id, metodo, efectivo?, comprobante? }  comprobante = 'sb://comprobantes/…' de Jasta
// POST { accion: 'cerrar_cuadre' }
import { createClient } from 'npm:@supabase/supabase-js@2';

// Proyecto de Jasta (la llave es la publicable)
const JASTA_URL = 'https://ktksdoedeazkvohewqzx.supabase.co';
const JASTA_KEY = 'sb_publishable_oejAL5ZoXxdyFCRLCLyj8A_tNlI49IX';
const PREFIJO = 'sb://comprobantes/';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

/** Quién es en Jasta (id y correo), o null si la sesión no sirve */
async function usuarioJasta(token: string): Promise<{ id: string; email: string } | null> {
  const r = await fetch(`${JASTA_URL}/auth/v1/user`, { headers: { apikey: JASTA_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id && u?.email ? { id: u.id, email: u.email } : null;
}

/** Copia la foto del comprobante del bucket de Jasta al de Kaesuri y devuelve la ruta en Kaesuri */
async function copiarComprobante(token: string, uid: string, origen: string, pedidoId: string): Promise<string> {
  if (!origen.startsWith(PREFIJO)) throw new Error('Comprobante no válido');
  const ruta = origen.slice(PREFIJO.length);
  // Solo fotos que subió esta misma persona
  if (ruta.split('/')[0] !== uid) throw new Error('Comprobante no válido');
  const r = await fetch(`${JASTA_URL}/storage/v1/object/authenticated/comprobantes/${ruta}`, {
    headers: { apikey: JASTA_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error('No se pudo leer la foto del comprobante');
  const tipo = r.headers.get('content-type') ?? 'image/jpeg';
  const destino = `${pedidoId}-${Date.now()}.${ruta.split('.').pop() || 'jpg'}`;
  const { error } = await db.storage.from('comprobantes').upload(destino, await r.arrayBuffer(), { contentType: tipo, upsert: false });
  if (error) throw new Error('No se pudo guardar la foto del comprobante');
  return destino;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const yo = token ? await usuarioJasta(token) : null;
  if (!yo) return responder({ error: 'Tu sesión de Jasta se cerró, vuelve a entrar' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return responder({ error: 'Solicitud no válida' }, 400);
  }

  try {
    if (body.accion === 'resumen') {
      const { data, error } = await db.rpc('jasta_resumen', { p_email: yo.email });
      if (error) throw error;
      return responder(data);
    }

    if (body.accion === 'entregar') {
      const pedidoId = String(body.pedido_id ?? '');
      const metodo = String(body.metodo ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return responder({ error: 'Pedido no válido' }, 400);
      const comprobante =
        (metodo === 'transferencia' || metodo === 'mixto') && typeof body.comprobante === 'string'
          ? await copiarComprobante(token, yo.id, body.comprobante, pedidoId)
          : null;
      const { error } = await db.rpc('jasta_entregar', {
        p_email: yo.email,
        p_pedido_id: pedidoId,
        p_metodo: metodo,
        p_comprobante: comprobante,
        p_efectivo: metodo === 'mixto' ? Number(body.efectivo) : null,
      });
      if (error) {
        if (comprobante) await db.storage.from('comprobantes').remove([comprobante]);
        throw error;
      }
      return responder({ ok: true });
    }

    if (body.accion === 'cerrar_cuadre') {
      const { data, error } = await db.rpc('jasta_cerrar_cuadre', { p_email: yo.email });
      if (error) throw error;
      return responder({ cuadre_id: data });
    }

    return responder({ error: 'Acción no válida' }, 400);
  } catch (e) {
    const mensaje = (e as { message?: string })?.message || 'No se pudo completar';
    return responder({ error: mensaje }, 400);
  }
});
