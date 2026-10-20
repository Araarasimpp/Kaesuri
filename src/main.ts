import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { leerEnlaceDeCorreo } from './app/auth/enlace-correo';

// Antes de arrancar: si se abrió un enlace del correo (recuperar contraseña o
// un enlace vencido), se anota para llevar a la persona a la pantalla correcta.
leerEnlaceDeCorreo();

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
  ],
});

// PWA: service worker para los avisos push (app cerrada) y aviso de instalación.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw-push.js').catch(() => undefined));
}
window.addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();
  (window as any).__jybInstalar = evento;
  window.dispatchEvent(new Event('jyb-instalable'));
});
