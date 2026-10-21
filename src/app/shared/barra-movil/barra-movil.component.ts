// src/app/shared/barra-movil/barra-movil.component.ts
// Barra de arriba en el celular: logo, tema, avisos y la cuenta (foto). Va dentro
// del contenido (pegada arriba al hacer scroll), así nunca tapa los botones de cada página.
// En pantallas grandes no se muestra (allá está el menú lateral o los botones de siempre).
import { Component, HostBinding, Input } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { moonOutline, sunnyOutline } from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { NotificacionesComponent } from '../notificaciones/notificaciones.component';
import { CambiarAreaComponent } from '../cambiar-area/cambiar-area.component';

@Component({
  selector: 'app-barra-movil',
  standalone: true,
  imports: [IonIcon, NotificacionesComponent, CambiarAreaComponent],
  styles: [
    `
      :host {
        position: sticky;
        top: 0;
        z-index: 90;
        display: block;
        padding-top: env(safe-area-inset-top);
        background: color-mix(in srgb, var(--k-bg) 88%, transparent);
        -webkit-backdrop-filter: saturate(1.6) blur(14px);
        backdrop-filter: saturate(1.6) blur(14px);
        border-bottom: 1px solid var(--k-border);
      }
      .barra { display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 12px 0 14px; }
      .marca { display: flex; align-items: center; gap: 8px; min-width: 0; margin-right: auto; }
      .marca img { width: 32px; height: 32px; object-fit: contain; flex-shrink: 0; }
      .marca span { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--k-text); }
      .tema { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--k-border); background: var(--k-card-bg);
        color: var(--k-text-soft); display: grid; place-items: center; font-size: 18px; cursor: pointer; flex-shrink: 0; }
      @media (min-width: 861px) {
        :host(:not(.siempre)) { display: none; }
      }
    `,
  ],
  template: `
    <div class="barra">
      <div class="marca">
        <img src="assets/icon/logo.png" alt="" />
        <span>Variedades JYB</span>
      </div>
      <button type="button" class="tema" (click)="theme.toggle()" [attr.aria-label]="theme.isDark() ? 'Modo claro' : 'Modo oscuro'">
        <ion-icon [name]="theme.isDark() ? 'sunny-outline' : 'moon-outline'"></ion-icon>
      </button>
      <app-notificaciones modo="barra"></app-notificaciones>
      <app-cambiar-area modo="barra"></app-cambiar-area>
    </div>
  `,
})
export class BarraMovilComponent {
  /** En las áreas sin menú lateral la barra se ve también en el computador */
  @Input() @HostBinding('class.siempre') siempre = false;

  constructor(public theme: ThemeService) {
    addIcons({ moonOutline, sunnyOutline });
  }
}
