// Edge Function telegram-bot: el bot de despachos de Kaesuri en Telegram (webhook). Como en Jasta.
//
// Cada domiciliario tiene un grupo con quien despacha y el bot. Quien despacha
// manda la foto del rótulo al grupo; el bot lee el código QR del rótulo
// ("KAESURI-<número>") y le asigna ese pedido al domiciliario del grupo (queda
// En ruta), en el orden en que llegan las fotos, y responde en el grupo.
//
// Comandos:
//   /start CÓDIGO    (chat privado)  vincula la cuenta de quien despacha
//   /vincular CÓDIGO (en el grupo)   vincula el grupo a un domiciliario
//   /ruta            (en el grupo)   lista lo que lleva el domiciliario
//   /ayuda
// Si una foto no se puede leer, también sirve escribir el número: 215
//
// Telegram manda el encabezado X-Telegram-Bot-Api-Secret-Token con el secreto
// que se configuró en setWebhook (telegram-config); sin él no se atiende nada.
// Se despliega con verify_jwt = false (quien llama es Telegram).
import { createClient } from 'npm:@supabase/supabase-js@2';
import jpeg from 'npm:jpeg-js@0.4.4';
import { leerQrImagen } from './lector.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

interface Config {
  token: string;
  secreto: string;
  bot_usuario: string | null;
}

let cache: { config: Config | null; hasta: number } = { config: null, hasta: 0 };
async function config(): Promise<Config | null> {
  if (Date.now() < cache.hasta) return cache.config;
  const { data } = await db.rpc('telegram_config_leer');
  cache = { config: (data as Config | null) ?? null, hasta: Date.now() + 60_000 };
  return cache.config;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

async function api(token: string, metodo: string, datos: Record<string, unknown>): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(datos),
  });
  return r.json();
}

function responder(token: string, msg: any, texto: string): Promise<unknown> {
  return api(token, 'sendMessage', {
    chat_id: msg.chat.id,
    text: texto,
    reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
  });
}

/** Número de pedido dentro del texto del QR ("KAESURI-215") */
function pedidoDeQr(texto: string): number | null {
  const m = texto.match(/KAESURI[\s:#-]*(\d{1,9})/i);
  return m ? Number(m[1]) : null;
}

/** Número escrito a mano: "215", "#215" o "pedido 215" */
function pedidoDeTexto(texto: string): number | null {
  const m = texto.trim().match(/^(?:pedido\s*)?#?\s*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

/** Baja la foto de Telegram y busca el QR con el lector robusto (prueba primero la más grande) */
async function leerQr(token: string, ids: string[]): Promise<number | null> {
  for (const id of ids) {
    try {
      const f = await api(token, 'getFile', { file_id: id });
      if (!f.ok) continue;
      const r = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
      const texto = await leerQrImagen(new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height);
      const n = texto ? pedidoDeQr(texto) : null;
      if (n) return n;
    } catch (e) {
      console.error('leerQr', e);
    }
  }
  return null;
}

async function esDespachador(telegramId: number): Promise<boolean> {
  return !!(await rpc<string | null>('telegram_despachador', { p_telegram_id: telegramId }));
}

const AYUDA =
  'Soy el bot de despachos de Variedades JYB.\n\n' +
  '1. Quien despacha vincula su cuenta con el código de "Mi perfil → Telegram" en la app.\n' +
  '2. En el grupo de cada domiciliario se escribe /vincular CÓDIGO (el código sale en Configuración → Telegram).\n' +
  '3. Manden aquí la foto de cada rótulo: el pedido se le asigna al domiciliario del grupo, en el orden de las fotos.\n\n' +
  'Si una foto no se lee, escriban el número del pedido (ej. 215). /ruta muestra lo que lleva el domiciliario.';

async function despachar(token: string, msg: any, numero: number): Promise<void> {
  const r = await rpc<{ texto?: string; repetido?: boolean }>('telegram_despachar', {
    p_chat_id: msg.chat.id, p_message_id: msg.message_id, p_telegram_id: msg.from.id, p_numero: numero,
  });
  if (r?.texto && !r.repetido) await responder(token, msg, r.texto);
}

async function atender(cfg: Config, msg: any): Promise<void> {
  const token = cfg.token;
  const chat = msg.chat;
  const esGrupo = chat.type === 'group' || chat.type === 'supergroup';
  const texto: string = msg.text ?? msg.caption ?? '';

  // Un grupo normal que pasa a supergrupo cambia de número: se mantiene el vínculo
  if (msg.migrate_to_chat_id) {
    await rpc('telegram_migrar_grupo', { p_de: chat.id, p_a: msg.migrate_to_chat_id });
    return;
  }

  if (texto.startsWith('/')) {
    const [cmdCrudo, ...resto] = texto.trim().split(/\s+/);
    const cmd = cmdCrudo.split('@')[0].toLowerCase();
    const arg = resto.join(' ').trim();
    if ((cmd === '/start' || cmd === '/vincular' || cmd === '/grupo') && arg) {
      const nombre = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Telegram';
      const t = await rpc<string>('telegram_vincular', {
        p_codigo: arg, p_telegram_id: msg.from.id, p_nombre: nombre, p_chat_id: chat.id, p_titulo: chat.title ?? null, p_es_grupo: esGrupo,
      });
      await responder(token, msg, t);
    } else if (cmd === '/ruta' && esGrupo) {
      await responder(token, msg, await rpc<string>('telegram_ruta', { p_chat_id: chat.id }));
    } else if (cmd === '/start' || cmd === '/ayuda' || cmd === '/help') {
      await responder(token, msg, AYUDA);
    }
    return;
  }

  if (!esGrupo || !msg.from) return;

  const fotos: string[] = [];
  if (Array.isArray(msg.photo) && msg.photo.length) {
    // De la más grande a la siguiente: si la grande no se lee, a veces la otra sí
    const ordenadas = [...msg.photo].sort((a: any, b: any) => b.width * b.height - a.width * a.height);
    fotos.push(...ordenadas.slice(0, 2).map((p: any) => p.file_id));
  } else if (msg.document?.mime_type === 'image/jpeg') {
    fotos.push(msg.document.file_id);
  }

  if (fotos.length) {
    // Las fotos de otras personas (p. ej. el domiciliario mandando evidencias) se ignoran
    if (!(await esDespachador(msg.from.id))) return;
    const numero = (await leerQr(token, fotos)) ?? (texto ? pedidoDeTexto(texto) : null);
    if (!numero) {
      await responder(token, msg, '⚠️ No pude leer el código del rótulo. Manda otra foto más de cerca y con luz, o escribe el número del pedido.');
      return;
    }
    await despachar(token, msg, numero);
    return;
  }

  const numero = pedidoDeTexto(texto);
  if (numero && (await esDespachador(msg.from.id))) await despachar(token, msg, numero);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const secreto = req.headers.get('x-telegram-bot-api-secret-token');
  let cfg = await config();
  // Recién conectado otro token: el secreto guardado en memoria puede ser el viejo
  if (cfg?.secreto !== secreto) {
    cache.hasta = 0;
    cfg = await config();
  }
  if (!cfg || !secreto || secreto !== cfg.secreto) {
    return new Response('no', { status: 401 });
  }
  try {
    const update = await req.json();
    const msg = update.message;
    if (msg) await atender(cfg, msg);
  } catch (e) {
    // Se responde 200 igual: si no, Telegram reintenta el mismo mensaje sin parar
    console.error('telegram-bot', e);
  }
  return new Response('ok');
});
