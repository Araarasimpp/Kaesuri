// src/app/shared/instalar-app/instalar-app.component.ts
// Invita a instalar la app en la pantalla de inicio.
// - Android / PC: botón "Instalar" (usa el aviso nativo del navegador).
// - iPhone / iPad (Safari): instrucciones, porque Apple no permite un botón directo.
// Si la persona lo cierra, no vuelve a aparecer en 14 días.

import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PushService } from '../../core/services/push.service';

const CLAVE_OCULTO = 'jyb-instalar-oculto-hasta';

@Component({
  selector: 'app-instalar-app',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './instalar-app.component.html',
  styleUrls: ['./instalar-app.component.scss'],
})
export class InstalarAppComponent implements OnInit, OnDestroy {
  // Señales: cambian desde eventos del navegador y la vista se actualiza sola.
  readonly visible = signal(false);
  readonly modo = signal<'boton' | 'ios'>('boton');

  private alSerInstalable = () => this.evaluar();
  private alInstalar = () => this.visible.set(false);

  ngOnInit(): void {
    window.addEventListener('jyb-instalable', this.alSerInstalable);
    window.addEventListener('appinstalled', this.alInstalar);
    this.evaluar();
  }

  ngOnDestroy(): void {
    window.removeEventListener('jyb-instalable', this.alSerInstalable);
    window.removeEventListener('appinstalled', this.alInstalar);
  }

  private evaluar(): void {
    if (PushService.instalada() || this.oculto()) {
      this.visible.set(false);
      return;
    }
    if ((window as any).__jybInstalar) {
      this.modo.set('boton');
      this.visible.set(true);
    } else if (PushService.esIOS()) {
      this.modo.set('ios');
      this.visible.set(true);
    }
  }

  async instalar(): Promise<void> {
    const aviso = (window as any).__jybInstalar;
    if (!aviso) return;
    aviso.prompt();
    const { outcome } = await aviso.userChoice;
    (window as any).__jybInstalar = null;
    if (outcome === 'accepted') this.visible.set(false);
  }

  cerrar(): void {
    this.visible.set(false);
    try {
      localStorage.setItem(CLAVE_OCULTO, String(Date.now() + 14 * 24 * 60 * 60 * 1000));
    } catch {
      // modo privado: no pasa nada
    }
  }

  private oculto(): boolean {
    try {
      return Number(localStorage.getItem(CLAVE_OCULTO) ?? 0) > Date.now();
    } catch {
      return false;
    }
  }
}
