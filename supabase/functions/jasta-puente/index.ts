// Puente para que el domiciliario entregue pedidos de Variedades JYB desde la app de Jasta.
//
// La app de Jasta llama aquí con su propia sesión (Authorization: Bearer <token de Jasta>).
// Se valida ese token contra Jasta, se toma el correo y se busca el domiciliario con ese
// correo en Kaesuri. Todo lo demás lo hacen las funciones jasta_* de la base (solo service_role).
//
// Se despliega con verify_jwt = false: el token no es de este proyecto y se valida aquí.
//
// POST { accion: 'resumen' }
// POST { accion: 'entregar', pedido_id, metodo, efectivo?, comprobantes? }  comprobantes = ['sb://comprobantes/…'] de Jasta
// POST { accion: 'cerrar_cuadre' }
// POST { accion: 'entregadas', desde?, hasta? }  (ISO)
// POST { accion: 'rotulos' }                 pedidos de Variedades JYB por despachar (para imprimir sus rótulos en Jasta)
// POST { accion: 'marcar_rotulos', ids }     marca esos rótulos como impresos
// POST { accion: 'pedidos' }                 pedidos activos de Variedades JYB para la lista de Pedidos de Jasta
// POST { accion: 'alistar', ids, alistar }   los alista (o los devuelve a por alistar) desde Jasta
//   Rótulos, pedidos y alistar: sirve a quien es admin o despachador en Kaesuri con el mismo correo,
//   o admin o alistador en Jasta (se le pregunta a Jasta con la misma sesión).
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

/** ¿Es admin o alistador activo en Jasta? (lo dice Jasta, con la sesión de la persona) */
async function alistaEnJasta(token: string, uid: string): Promise<boolean> {
  const r = await fetch(`${JASTA_URL}/rest/v1/usuarios?select=roles,activo&auth_id=eq.${uid}`, {
    headers: { apikey: JASTA_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return false;
  const filas = (await r.json()) as { roles?: string[]; activo?: boolean }[];
  return filas.some((f) => f.activo !== false && (f.roles ?? []).some((x) => x === 'admin' || x === 'alistador'));
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
  const destino = `${pedidoId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ruta.split('.').pop() || 'jpg'}`;
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
      // 'comprobante' (una sola foto) es lo que mandaba la versión anterior de la app
      const enviados = Array.isArray(body.comprobantes) ? body.comprobantes : [body.comprobante];
      const origenes =
        metodo === 'transferencia' || metodo === 'mixto'
          ? enviados.filter((x): x is string => typeof x === 'string' && x !== '').slice(0, 10)
          : [];
      const comprobantes: string[] = [];
      try {
        for (const o of origenes) comprobantes.push(await copiarComprobante(token, yo.id, o, pedidoId));
      } catch (e) {
        if (comprobantes.length) await db.storage.from('comprobantes').remove(comprobantes);
        throw e;
      }
      const { error } = await db.rpc('jasta_entregar', {
        p_email: yo.email,
        p_pedido_id: pedidoId,
        p_metodo: metodo,
        p_comprobantes: comprobantes,
        p_efectivo: metodo === 'mixto' ? Number(body.efectivo) : null,
      });
      if (error) {
        if (comprobantes.length) await db.storage.from('comprobantes').remove(comprobantes);
        throw error;
      }
      return responder({ ok: true });
    }

    if (body.accion === 'cerrar_cuadre') {
      const { data, error } = await db.rpc('jasta_cerrar_cuadre', { p_email: yo.email });
      if (error) throw error;
      return responder({ cuadre_id: data });
    }

    if (body.accion === 'entregadas') {
      const fecha = (v: unknown) => (typeof v === 'string' && !isNaN(Date.parse(v)) ? v : null);
      const { data, error } = await db.rpc('jasta_entregadas', { p_email: yo.email, p_desde: fecha(body.desde), p_hasta: fecha(body.hasta) });
      if (error) throw error;
      return responder(data);
    }

    if (['rotulos', 'marcar_rotulos', 'pedidos', 'alistar'].includes(String(body.accion))) {
      const { data: desp } = await db.rpc('jasta_despachador', { p_email: yo.email });
      const permitido = !!desp || (await alistaEnJasta(token, yo.id));
      if (!permitido) return responder({ vinculado: false });
      if (body.accion === 'pedidos') {
        const { data, error } = await db.rpc('jasta_pedidos_datos');
        if (error) throw error;
        return responder(data);
      }
      if (body.accion === 'alistar') {
        const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
        const { data, error } = await db.rpc('jasta_alistar', { p_email: yo.email, p_ids: ids, p_alistar: body.alistar !== false });
        if (error) throw error;
        return responder({ cambiados: data });
      }
      if (body.accion === 'rotulos') {
        const { data, error } = desp
          ? await db.rpc('jasta_rotulos', { p_email: yo.email })
          : await db.rpc('jasta_rotulos_alistador');
        if (error) throw error;
        return responder(data);
      }
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
      const { data, error } = desp
        ? await db.rpc('jasta_marcar_rotulos', { p_email: yo.email, p_ids: ids })
        : await db.rpc('jasta_marcar_rotulos_alistador', { p_ids: ids });
      if (error) throw error;
      return responder({ marcados: data });
    }

    return responder({ error: 'Acción no válida' }, 400);
  } catch (e) {
    const mensaje = (e as { message?: string })?.message || 'No se pudo completar';
    return responder({ error: mensaje }, 400);
  }
});
