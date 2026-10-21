// src/app/shared/nav-movil/nav-movil.component.ts
// Barra de navegación de abajo en el celular. Flota por encima de la barra de gestos
// del iPhone y muestra las secciones principales con su nombre; "Más" abre todas las
// opciones del área (también el tema y cerrar sesión), así ninguna queda escondida.
import { Component, HostBinding, HostListener, Input, effect, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, appsOutline, closeOutline, logOutOutline, moonOutline, sunnyOutline } from 'ionicons/icons';
import { filter } from 'rxjs';
import { SupabaseService } from '../../core/services/supabase.service';
import { ThemeService } from '../../core/services/theme.service';

export interface ItemNav {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-nav-movil',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IonIcon],
  styleUrls: ['./nav-movil.component.scss'],
  template: `
    <nav class="nav" aria-label="Navegación">
      @for (it of izquierda; track it.path) {
        <a [routerLink]="it.path" routerLinkActive="activo" [routerLinkActiveOptions]="{ exact: it.path === raiz }" class="tab">
          <ion-icon [name]="it.icon" aria-hidden="true"></ion-icon><span>{{ it.label }}</span>
        </a>
      }
      @if (accion) {
        <a [routerLink]="accion.path" class="accion" [attr.aria-label]="accion.label"><ion-icon name="add" aria-hidden="true"></ion-icon></a>
      }
      @for (it of derecha; track it.path) {
        <a [routerLink]="it.path" routerLinkActive="activo" [routerLinkActiveOptions]="{ exact: it.path === raiz }" class="tab">
          <ion-icon [name]="it.icon" aria-hidden="true"></ion-icon><span>{{ it.label }}</span>
        </a>
      }
      <button type="button" class="tab" [class.activo]="masActivo()" (click)="abierto.set(true)" aria-haspopup="dialog">
        <ion-icon name="apps-outline" aria-hidden="true"></ion-icon><span>Más</span>
      </button>
    </nav>

    @if (abierto()) {
      <button type="button" class="velo" aria-label="Cerrar" (click)="abierto.set(false)"></button>
      <div class="hoja" role="dialog" aria-label="Todas las opciones">
        <div class="hoja-tirador" aria-hidden="true"></div>
        <div class="hoja-cabecera">
          <strong>Menú</strong>
          <button type="button" class="cerrar" (click)="abierto.set(false)" aria-label="Cerrar"><ion-icon name="close-outline"></ion-icon></button>
        </div>
        <div class="grilla">
          @for (it of todos; track it.path) {
            <a [routerLink]="it.path" routerLinkActive="activo" [routerLinkActiveOptions]="{ exact: it.path === raiz }" class="opcion">
              <span class="icono"><ion-icon [name]="it.icon" aria-hidden="true"></ion-icon></span>
              <span class="nombre">{{ it.label }}</span>
            </a>
          }
        </div>
        <div class="fila">
          <button type="button" class="b" (click)="theme.toggle()">
            <ion-icon [name]="theme.isDark() ? 'sunny-outline' : 'moon-outline'" aria-hidden="true"></ion-icon>{{ theme.isDark() ? 'Modo claro' : 'Modo oscuro' }}
          </button>
          <button type="button" class="b salir" (click)="salir()">
            <ion-icon name="log-out-outline" aria-hidden="true"></ion-icon>Cerrar sesión
          </button>
        </div>
      </div>
    }
  `,
})
export class NavMovilComponent {
  /** Secciones que se ven siempre (hasta 4; la mitad a cada lado del botón +) */
  @Input() principales: ItemNav[] = [];
  /** Todas las secciones del área (se ven en "Más") */
  @Input() todos: ItemNav[] = [];
  /** Botón + del centro (nuevo pedido, nueva venta…) */
  @Input() accion: { path: string; label: string } | null = null;
  /** Ruta de inicio del área (se marca activa solo si es exacta) */
  @Input() raiz = '';
  /** En las áreas sin menú lateral la barra se ve también en el computador */
  @Input() @HostBinding('class.siempre') siempre = false;

  abierto = signal(false);
  private url = signal('');

  constructor(
    public theme: ThemeService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({ add, appsOutline, closeOutline, logOutOutline, moonOutline, sunnyOutline });
    // Con el menú abierto se esconde lo que flota fuera de la app (aviso de instalar)
    effect(() => document.body.classList.toggle('menu-movil-abierto', this.abierto()));
    this.url.set(this.router.url);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.url.set((e as NavigationEnd).urlAfterRedirects);
      this.abierto.set(false);
    });
  }

  get izquierda(): ItemNav[] {
    return this.principales.slice(0, Math.ceil(this.principales.length / 2));
  }

  get derecha(): ItemNav[] {
    return this.principales.slice(Math.ceil(this.principales.length / 2));
  }

  /** "Más" se marca cuando estás en una sección que no está en la barra */
  masActivo(): boolean {
    const u = this.url().split(/[?#]/)[0];
    const enBarra = this.principales.some((p) => (p.path === this.raiz ? u === p.path : u.startsWith(p.path)));
    return !enBarra && (this.accion ? !u.startsWith(this.accion.path) : true);
  }

  @HostListener('document:keydown.escape')
  cerrar(): void {
    this.abierto.set(false);
  }

  async salir(): Promise<void> {
    this.abierto.set(false);
    await this.supabase.logout();
    void this.router.navigateByUrl('/auth/login');
  }
}
