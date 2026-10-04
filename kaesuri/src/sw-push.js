// src/sw-push.js — service worker de Variedades JYB.
// Muestra los avisos push aunque la app esté cerrada y, al tocarlos, abre la
// app en la pantalla correcta. No guarda nada en caché: la app siempre carga
// la versión más reciente desde Vercel.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (e) {
    datos = { title: 'Variedades JYB', body: event.data ? event.data.text() : '' };
  }

  const titulo = datos.title || 'Variedades JYB';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.body || '',
      icon: '/assets/icon/logo.png',
      badge: '/assets/icon/logo.png',
      tag: datos.tag || undefined,
      renotify: !!datos.tag,
      data: { url: datos.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if (v.url.startsWith(self.location.origin) && 'focus' in v) {
          return v.focus().then((enfocada) => (enfocada && 'navigate' in enfocada ? enfocada.navigate(destino) : enfocada));
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
