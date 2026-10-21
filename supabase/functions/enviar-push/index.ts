// supabase/functions/enviar-push/index.ts
// Envía un aviso push a todos los dispositivos del usuario dueño de la notificación.
// La llama la base de datos (trigger trg_disparar_push) cada vez que se crea un aviso.
//
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ej. mailto:tucorreo@gmail.com)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya los pone Supabase automáticamente.
//
// Se despliega SIN verificación de JWT (la base de datos la llama sin llave). Es seguro:
// solo acepta el id de un aviso que exista y que todavía no se haya enviado, y lo marca
// como enviado antes de mandarlo, así que no se puede usar para enviar mensajes inventados
// ni repetir avisos.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const RUTAS: Record<string, string> = {
  admin: '/admin',
  despachador: '/despachador',
  vendedor: '/vendedor',
  domiciliario: '/domiciliario',
};

function rutaPara(rol: string | null, enlace: string | null): string {
  const raiz = RUTAS[rol ?? ''] ?? '/';
  // Mensaje del chat ('chat:<pedido>'): abre el chat de ese pedido
  if (enlace?.startsWith('chat:')) {
    const lista = rol === 'admin' || rol === 'despachador' ? raiz + '/pedidos' : raiz;
    return `${lista}?chat=${enlace.slice(5)}`;
  }
  if (rol === 'vendedor') return raiz;
  if (rol === 'domiciliario') return enlace === 'cuadres' ? raiz + '/cuadres' : raiz;
  if (enlace === 'pedidos' || enlace === 'cuadres') return `${raiz}/${enlace}`;
  return raiz;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 });

  let id: string | undefined;
  try {
    ({ id } = await req.json());
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return new Response('Falta el id', { status: 400 });

  const publica = Deno.env.get('VAPID_PUBLIC_KEY');
  const privada = Deno.env.get('VAPID_PRIVATE_KEY');
  const sujeto = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:soporte@variedadesjyb.com';
  if (!publica || !privada) return new Response('Faltan las llaves VAPID', { status: 500 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // Se "reclama" el aviso: solo una llamada puede marcarlo como enviado.
  const { data: aviso } = await sb
    .from('notificaciones')
    .update({ push_enviado: true })
    .eq('id', id)
    .eq('push_enviado', false)
    .select('id, usuario_id, titulo, mensaje, enlace')
    .maybeSingle();

  if (!aviso) return new Response('Nada que enviar', { status: 200 });

  const [{ data: perfil }, { data: subs }] = await Promise.all([
    sb.from('profiles').select('role').eq('id', aviso.usuario_id).maybeSingle(),
    sb.from('push_suscripciones').select('id, endpoint, p256dh, auth').eq('usuario_id', aviso.usuario_id),
  ]);

  if (!subs?.length) return new Response('Sin dispositivos', { status: 200 });

  webpush.setVapidDetails(sujeto, publica, privada);
  const payload = JSON.stringify({
    title: aviso.titulo,
    body: aviso.mensaje ?? '',
    url: rutaPara(perfil?.role ?? null, aviso.enlace),
    tag: aviso.id,
  });

  let enviados = 0;
  const vencidas: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 60 * 60 * 24,
          urgency: 'high',
        });
        enviados++;
      } catch (e) {
        const codigo = (e as { statusCode?: number }).statusCode;
        if (codigo === 404 || codigo === 410) vencidas.push(s.id); // el dispositivo ya no existe
        else console.error('Error enviando push', codigo, (e as Error).message);
      }
    })
  );

  if (vencidas.length) await sb.from('push_suscripciones').delete().in('id', vencidas);

  return new Response(JSON.stringify({ enviados, borradas: vencidas.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
