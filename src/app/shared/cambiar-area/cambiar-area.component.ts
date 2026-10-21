// src/app/shared/cambiar-area/cambiar-area.component.ts
// Menú de la cuenta: la foto de la persona, "Mi perfil" y, para quien tiene varios roles
// (por ejemplo vendedor y domiciliario), pasar de un área a otra.
// modo="sidebar": dentro del menú lateral (PC). modo="flotante": botón fijo arriba a la derecha.

import { Component, ElementRef, HostListener, Input, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmarkOutline, personCircleOutline } from 'ionicons/icons';
import { SupabaseService, areasDe } from '../../core/services/supabase.service';
import { AvatarComponent } from '../avatar/avatar.component';

@Component({
  selector: 'app-cambiar-area',
  standalone: true,
  imports: [CommonModule, IonIcon, AvatarComponent],
  template: `
    <div class="area" [ngClass]="modo" [style.right.px]="modo === 'flotante' ? derecha : null" *ngIf="perfil() as p">
      <button
        type="button"
        class="boton"
        (click)="abierto.set(!abierto())"
        [attr.aria-expanded]="abierto()"
        aria-haspopup="menu"
        [attr.aria-label]="'Mi cuenta (' + p.nombre + ')'"
        [attr.title]="compacto ? p.nombre : null"
      >
        <app-avatar [nombre]="p.nombre" [foto]="p.avatar_url" [tam]="modo === 'sidebar' ? 26 : modo === 'barra' ? 30 : 34"></app-avatar>
        <span class="nombre" *ngIf="modo === 'sidebar' && !compacto">{{ p.nombre }}</span>
      </button>
      <div class="panel" *ngIf="abierto()" role="menu">
        <button type="button" role="menuitem" class="opcion" (click)="ir(raiz + '/perfil')">
          <span>Mi perfil</span>
          <ion-icon name="person-circle-outline" aria-hidden="true"></ion-icon>
        </button>
        <p class="titulo" *ngIf="areas().length > 1">Estás en {{ actual }}</p>
        <button
          type="button"
          role="menuitem"
          class="opcion"
          *ngFor="let a of areas().length > 1 ? areas() : []"
          [class.actual]="a.etiqueta === actual"
          (click)="ir(a.ruta)"
        >
          <span>{{ a.etiqueta }}</span>
          <ion-icon *ngIf="a.etiqueta === actual" name="checkmark-outline" aria-hidden="true"></ion-icon>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .area { position: relative; }
      .boton { display: flex; align-items: center; gap: 10px; border: none; background: transparent; color: var(--k-text-soft);
        font-family: var(--k-font); font-size: 14px; font-weight: 500; cursor: pointer; }
      .boton ion-icon { font-size: 18px; flex-shrink: 0; }
      .nombre { overflow: hidden; text-overflow: ellipsis; }
      .sidebar .boton { width: 100%; padding: 6px 8px; border-radius: 8px; white-space: nowrap; }
      .sidebar .boton:hover { background: var(--k-hover); color: var(--k-text); }
      .flotante { position: fixed; top: calc(env(safe-area-inset-top) + 12px); z-index: 95; }
      .flotante .boton { width: 44px; height: 44px; justify-content: center; border-radius: 10px; border: 1px solid var(--k-border);
        background: var(--k-card-bg); }
      .panel { position: absolute; z-index: 200; min-width: 220px; padding: 6px; background: var(--k-card-bg); border: 1px solid var(--k-border);
        border-radius: 12px; box-shadow: var(--k-shadow-lg); color: var(--k-text); }
      .sidebar .panel { left: calc(100% + 8px); bottom: 0; }
      .flotante .panel { right: 0; top: calc(100% + 8px); }
      .barra .boton { width: 40px; height: 40px; justify-content: center; border-radius: 50%; }
      .barra .panel { right: 0; top: calc(100% + 8px); }
      .titulo { margin: 6px 10px 8px; font-size: 12px; font-weight: 600; color: var(--k-text-soft); text-transform: uppercase; letter-spacing: 0.04em; }
      .opcion { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 0 10px;
        border: none; border-radius: 8px; background: transparent; color: var(--k-text); font-family: var(--k-font); font-size: 15px;
        font-weight: 500; text-align: left; cursor: pointer; }
      .opcion:hover { background: var(--k-hover); }
      .opcion.actual { color: var(--k-role-ink); font-weight: 650; }
    `,
  ],
})
export class CambiarAreaComponent implements OnInit {
  @Input() modo: 'sidebar' | 'flotante' | 'barra' = 'flotante';
  /** Distancia al borde derecho en modo flotante (para quedar al lado de los otros botones) */
  @Input() derecha = 16;
  /** Oculta el texto (menú lateral contraído) */
  @Input() compacto = false;

  perfil = this.supabase.perfil;
  areas = computed(() => {
    const p = this.perfil();
    return p ? areasDe(p) : [];
  });
  abierto = signal(false);

  constructor(private supabase: SupabaseService, private router: Router, private host: ElementRef<HTMLElement>) {
    addIcons({ checkmarkOutline, personCircleOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.supabase.getCurrentProfile();
  }

  /** Área donde está ahora ("/vendedor", "/admin"…) */
  get raiz(): string {
    return '/' + this.router.url.split(/[/?#]/)[1];
  }

  get actual(): string {
    return this.areas().find((a) => a.ruta === this.raiz)?.etiqueta ?? '';
  }

  ir(ruta: string): void {
    this.abierto.set(false);
    this.router.navigateByUrl(ruta);
  }

  @HostListener('document:click', ['$event'])
  cerrarAlTocarFuera(e: MouseEvent): void {
    if (this.abierto() && !this.host.nativeElement.contains(e.target as Node)) this.abierto.set(false);
  }

  @HostListener('document:keydown.escape')
  cerrarConEscape(): void {
    this.abierto.set(false);
  }
}
