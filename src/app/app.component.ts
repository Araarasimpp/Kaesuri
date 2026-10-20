import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { InstalarAppComponent } from './shared/instalar-app/instalar-app.component';
import { SkeletonComponent } from './shared/skeleton/skeleton.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonApp, IonRouterOutlet, InstalarAppComponent, SkeletonComponent],
})
export class AppComponent {
  /**
   * Al abrir la app se revisa la sesión antes de mostrar la pantalla del rol
   * (app-init y el guard). Mientras tanto se ve el skeleton en vez de una
   * pantalla vacía. Se quita cuando llega la primera pantalla real
   * ('/' es solo app-init decidiendo a dónde ir).
   */
  readonly arrancando = signal(true);

  constructor() {
    const router = inject(Router);
    const sub = router.events.subscribe((e) => {
      const lista = (e instanceof NavigationEnd && e.urlAfterRedirects !== '/') || e instanceof NavigationError;
      if (lista) {
        this.arrancando.set(false);
        sub.unsubscribe();
      }
    });
  }
}
