// Edge Function telegram-config: conecta el bot de Telegram desde la app (como en Jasta).
//
// POST { token } con la sesión de un admin (Authorization: Bearer …):
//  1. Revisa que la sesión sea de un admin.
//  2. Revisa que el token sea de un bot (getMe).
//  3. Guarda el token y un secreto nuevo en privado.telegram_config (la app no
//     puede leer ese esquema; el token nunca vuelve al navegador).
//  4. Le dice a Telegram que mande los mensajes a telegram-bot (setWebhook),
//     de a uno en orden (max_connections = 1) y con ese secreto.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

/** ¿La sesión que llama es de un admin? (se valida el token contra Auth y se miran sus roles) */
async function esAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data.user) return false;
  const { data: p } = await db.from('profiles').select('roles, activo').eq('id', data.user.id).maybeSingle();
  return !!p && p.activo !== false && (p.roles ?? []).includes('admin');
}

async function api(token: string, metodo: string, datos: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  if (!(await esAdmin(req))) return json({ error: 'Solo el admin puede conectar el bot' }, 403);

  let token = '';
  try {
    token = String((await req.json()).token ?? '').trim();
  } catch {
    /* cuerpo vacío */
  }
  if (!/^\d+:[\w-]{30,}$/.test(token)) return json({ error: 'Ese no parece un token de bot. Cópialo completo desde @BotFather.' }, 400);

  const yo = await api(token, 'getMe');
  if (!yo.ok) return json({ error: 'Telegram no reconoce ese token. Revisa que esté completo.' }, 400);

  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secreto = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  // Primero se guarda (el bot necesita el secreto para aceptar lo que llegue) y luego se conecta
  const { error } = await db.rpc('telegram_config_guardar', { p_token: token, p_secreto: secreto, p_bot: yo.result.username });
  if (error) return json({ error: 'No se pudo guardar: ' + error.message }, 500);
  const w = await api(token, 'setWebhook', {
    url: `${URL_SB}/functions/v1/telegram-bot`,
    secret_token: secreto,
    max_connections: 1,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  if (!w.ok) return json({ error: 'Telegram no aceptó la conexión: ' + (w.description ?? 'error desconocido') }, 502);

  await api(token, 'setMyCommands', {
    commands: [
      { command: 'ruta', description: 'Lo que lleva el domiciliario de este grupo' },
      { command: 'vincular', description: 'Vincular este grupo con el código de la app' },
      { command: 'ayuda', description: 'Cómo funciona' },
    ],
  });

  return json({ bot: yo.result.username });
});
