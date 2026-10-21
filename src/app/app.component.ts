import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { InstalarAppComponent } from './shared/instalar-app/instalar-app.component';
import { SkeletonComponent } from './shared/skeleton/skeleton.component';
import { VisorComponent } from './shared/visor/visor.component';
import { ToastComponent } from './shared/toast/toast.component';
import { activarArrastreDeHojas } from './shared/arrastrar-hojas';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonApp, IonRouterOutlet, InstalarAppComponent, SkeletonComponent, VisorComponent, ToastComponent],
})
export class AppComponent implements OnInit, OnDestroy {
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

  private quitarArrastre?: () => void;

  // Si una miniatura no existe (fotos subidas antes de las miniaturas), se muestra la foto original
  private sinMini = (e: Event): void => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.src.includes('/object/public/productos/mini/'))
      img.src = img.src.replace('/object/public/productos/mini/', '/object/public/productos/');
  };

  ngOnInit(): void {
    document.addEventListener('error', this.sinMini, true);
    // Las hojas que vienen de Jasta se cierran arrastrándolas hacia abajo en el celular
    this.quitarArrastre = activarArrastreDeHojas();
  }

  ngOnDestroy(): void {
    document.removeEventListener('error', this.sinMini, true);
    this.quitarArrastre?.();
  }
}
