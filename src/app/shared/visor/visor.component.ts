import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline, closeOutline, shareOutline, downloadOutline } from 'ionicons/icons';
import { FotoVisor, VisorService } from './visor.service';

const ZOOM_MAX = 4;
const ZOOM_DOBLE_TOQUE = 2.5;

/**
 * Visor de fotos a pantalla completa, dentro de la app.
 * Celular: deslizar de lado cambia de foto, hacia abajo cierra; dos dedos o
 * doble toque hacen zoom y con zoom se arrastra la foto. Un toque esconde los botones.
 * Computador: flechas del teclado, Esc y rueda/doble clic para zoom.
 */
@Component({
  selector: 'app-visor',
  standalone: true,
  imports: [IonIcon],
  styles: [
    `
      .visor { position: fixed; inset: 0; z-index: 3000; display: flex; flex-direction: column; overflow: hidden;
        background: rgba(0, 0, 0, var(--fondo, 0.94)); color: #fff; animation: entrar 160ms ease-out;
        -webkit-user-select: none; user-select: none; }
      @keyframes entrar { from { opacity: 0; } }
      .escenario { position: absolute; inset: 0; touch-action: none; overflow: hidden; }
      .pista { display: flex; height: 100%; will-change: transform; }
      .pista.animar { transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1); }
      .lamina { flex: 0 0 100%; height: 100%; display: flex; align-items: center; justify-content: center;
        padding: calc(56px + env(safe-area-inset-top)) 12px calc(48px + env(safe-area-inset-bottom)); box-sizing: border-box; }
      .lamina img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; transform-origin: center center;
        -webkit-user-drag: none; pointer-events: none; }
      .lamina img.animar { transition: transform 220ms ease-out; }
      .cargando { position: absolute; font-size: 13px; color: rgba(255, 255, 255, 0.6); }

      .barra { position: absolute; left: 0; right: 0; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
        padding: calc(8px + env(safe-area-inset-top)) 10px 8px; background: linear-gradient(rgba(0, 0, 0, 0.55), transparent);
        transition: opacity 180ms ease; }
      .titulo { flex: 1; min-width: 0; font-size: 14px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .contador { font-family: var(--mono-font); font-size: 13px; color: rgba(255, 255, 255, 0.75); white-space: nowrap; }
      .boton { width: 40px; height: 40px; flex-shrink: 0; display: grid; place-items: center; padding: 0; border: none; border-radius: 50%;
        background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 21px; cursor: pointer; }
      .boton:disabled { opacity: 0.4; }
      @media (hover: hover) { .boton:hover:not(:disabled) { background: rgba(255, 255, 255, 0.24); } }
      .flecha { position: absolute; top: 50%; z-index: 2; transform: translateY(-50%); width: 46px; height: 46px; font-size: 24px; }
      .flecha.izq { left: 16px; }
      .flecha.der { right: 16px; }
      .puntos { position: absolute; left: 0; right: 0; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 2;
        display: flex; justify-content: center; gap: 6px; transition: opacity 180ms ease; }
      .puntos span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, 0.35); transition: background 150ms, transform 150ms; }
      .puntos span.on { background: #fff; transform: scale(1.25); }
      .oculto { opacity: 0; pointer-events: none; }
      @media (hover: none) { .flecha { display: none; } }
    `,
  ],
  template: `
    @if (abierto()) {
      <div class="visor" role="dialog" aria-modal="true" aria-label="Foto" [style.--fondo]="fondo()">
        <div class="escenario"
          (pointerdown)="bajar($event)" (pointermove)="mover($event)" (pointerup)="subir($event)" (pointercancel)="subir($event)"
          (wheel)="rueda($event)" (dblclick)="dobleClic($event)">
          <div class="pista" [class.animar]="animar()" [style.transform]="'translate3d(calc(' + -indice() * 100 + '% + ' + dx() + 'px), ' + dy() + 'px, 0)'">
            @for (f of fotos(); track f.url; let i = $index) {
              <div class="lamina">
                @if (!cargadas().has(f.url)) { <span class="cargando">Cargando…</span> }
                <img [src]="f.url" [alt]="f.titulo || 'Foto'" draggable="false" (load)="cargada(f.url)"
                  [class.animar]="i === indice() && animarZoom()"
                  [style.transform]="i === indice() ? 'translate3d(' + tx() + 'px, ' + ty() + 'px, 0) scale(' + escala() + ')' : null" />
              </div>
            }
          </div>
        </div>

        <div class="barra" [class.oculto]="!controles()">
          <button class="boton" aria-label="Cerrar" (click)="cerrar()"><ion-icon name="close-outline"></ion-icon></button>
          <span class="titulo">{{ actual()?.titulo || '' }}</span>
          @if (fotos().length > 1) { <span class="contador">{{ indice() + 1 }} / {{ fotos().length }}</span> }
          <button class="boton" [attr.aria-label]="puedeCompartir ? 'Compartir foto' : 'Descargar foto'" [disabled]="guardando()" (click)="compartir()">
            <ion-icon [name]="puedeCompartir ? 'share-outline' : 'download-outline'"></ion-icon>
          </button>
        </div>

        @if (fotos().length > 1) {
          <button class="boton flecha izq" aria-label="Foto anterior" [disabled]="indice() === 0" (click)="ir(indice() - 1)"><ion-icon name="chevron-back-outline"></ion-icon></button>
          <button class="boton flecha der" aria-label="Foto siguiente" [disabled]="indice() === fotos().length - 1" (click)="ir(indice() + 1)"><ion-icon name="chevron-forward-outline"></ion-icon></button>
          <div class="puntos" [class.oculto]="!controles()" aria-hidden="true">
            @for (f of fotos(); track f.url; let i = $index) { <span [class.on]="i === indice()"></span> }
          </div>
        }
      </div>
    }
  `,
})
export class VisorComponent {
  private visor = inject(VisorService);

  fotos = this.visor.fotos;
  indice = this.visor.indice;
  abierto = computed(() => this.fotos().length > 0);
  actual = computed<FotoVisor | undefined>(() => this.fotos()[this.indice()]);

  // Deslizar (sin zoom)
  dx = signal(0);
  dy = signal(0);
  animar = signal(false);
  // Zoom de la foto actual
  escala = signal(1);
  tx = signal(0);
  ty = signal(0);
  animarZoom = signal(false);

  controles = signal(true);
  guardando = signal(false);
  cargadas = signal(new Set<string>());
  fondo = computed(() => String(Math.max(0.35, 0.94 - Math.abs(this.dy()) / 600)));
  readonly puedeCompartir = typeof navigator !== 'undefined' && 'share' in navigator;

  private punteros = new Map<number, { x: number; y: number }>();
  private eje: 'x' | 'y' | null = null;
  private inicio = { x: 0, y: 0, t: 0 };
  private pellizco: { dist: number; escala: number; cx: number; cy: number; tx: number; ty: number } | null = null;
  private huboPellizco = false;
  private ultimoTipo = 'mouse';
  private ultimoToque = { t: 0, x: 0, y: 0 };
  private timerToque?: ReturnType<typeof setTimeout>;

  constructor() {
    addIcons({ closeOutline, chevronBackOutline, chevronForwardOutline, shareOutline, downloadOutline });
    // Cada vez que se abre, arranca limpio
    effect(() => {
      if (this.abierto()) this.reiniciar(false);
    });
  }

  // ---------------------------------------------------------------- Teclado
  @HostListener('document:keydown', ['$event'])
  tecla(e: KeyboardEvent): void {
    if (!this.abierto()) return;
    if (e.key === 'Escape') this.cerrar();
    else if (e.key === 'ArrowRight') this.ir(this.indice() + 1);
    else if (e.key === 'ArrowLeft') this.ir(this.indice() - 1);
    else return;
    e.preventDefault();
  }

  cerrar(): void {
    clearTimeout(this.timerToque);
    this.punteros.clear();
    this.visor.cerrar();
  }

  ir(i: number): void {
    if (i < 0 || i >= this.fotos().length) return;
    this.reiniciar(true);
    this.animar.set(true);
    this.indice.set(i);
  }

  cargada(url: string): void {
    this.cargadas.update((s) => new Set(s).add(url));
  }

  private reiniciar(animado: boolean): void {
    this.animarZoom.set(animado);
    this.escala.set(1);
    this.tx.set(0);
    this.ty.set(0);
    this.dx.set(0);
    this.dy.set(0);
  }

  // ---------------------------------------------------------------- Gestos
  bajar(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.ultimoTipo = e.pointerType;
    this.animar.set(false);
    this.animarZoom.set(false);
    if (this.punteros.size === 1) {
      this.inicio = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.eje = null;
      this.huboPellizco = false;
    } else if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      this.pellizco = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        escala: this.escala(),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        tx: this.tx(),
        ty: this.ty(),
      };
      this.huboPellizco = true;
      this.dx.set(0);
      this.dy.set(0);
    }
  }

  mover(e: PointerEvent): void {
    const previo = this.punteros.get(e.pointerId);
    if (!previo) return;
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.punteros.size >= 2 && this.pellizco) {
      const [a, b] = [...this.punteros.values()];
      const p = this.pellizco;
      const escala = Math.min(ZOOM_MAX, Math.max(1, (p.escala * Math.hypot(a.x - b.x, a.y - b.y)) / p.dist));
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      // El punto entre los dedos se queda bajo los dedos
      const centro = this.centro();
      const k = escala / p.escala;
      this.escala.set(escala);
      this.tx.set(cx - centro.x - (p.cx - centro.x - p.tx) * k);
      this.ty.set(cy - centro.y - (p.cy - centro.y - p.ty) * k);
      return;
    }

    const mx = e.clientX - previo.x;
    const my = e.clientY - previo.y;
    if (this.escala() > 1.01) {
      // Con zoom, el dedo arrastra la foto
      this.tx.update((v) => v + mx);
      this.ty.update((v) => v + my);
      return;
    }
    const totalX = e.clientX - this.inicio.x;
    const totalY = e.clientY - this.inicio.y;
    if (!this.eje && Math.hypot(totalX, totalY) > 8) this.eje = Math.abs(totalX) > Math.abs(totalY) ? 'x' : 'y';
    if (this.eje === 'x') {
      // En los extremos se resiste un poco
      const extremo = (totalX > 0 && this.indice() === 0) || (totalX < 0 && this.indice() === this.fotos().length - 1);
      this.dx.set(extremo ? totalX / 3 : totalX);
    } else if (this.eje === 'y') {
      this.dy.set(Math.max(-60, totalY));
    }
  }

  subir(e: PointerEvent): void {
    if (!this.punteros.has(e.pointerId)) return;
    this.punteros.delete(e.pointerId);
    if (this.punteros.size === 1) {
      // Quedó un dedo después de pellizcar: sigue como arrastre desde aquí
      const [p] = [...this.punteros.values()];
      this.inicio = { x: p.x, y: p.y, t: performance.now() };
      this.pellizco = null;
      return;
    }
    if (this.punteros.size > 0) return;
    this.pellizco = null;

    const totalX = e.clientX - this.inicio.x;
    const totalY = e.clientY - this.inicio.y;
    const ms = performance.now() - this.inicio.t;

    if (this.escala() > 1.01) {
      this.ajustarLimites();
      if (!this.huboPellizco && Math.hypot(totalX, totalY) < 6) this.toque(e);
      return;
    }
    if (this.huboPellizco) {
      this.reiniciar(true);
      return;
    }

    this.animar.set(true);
    if (this.eje === 'x') {
      const rapido = Math.abs(totalX) / Math.max(ms, 1) > 0.5;
      if (totalX < -60 || (rapido && totalX < -20)) this.ir(this.indice() + 1);
      else if (totalX > 60 || (rapido && totalX > 20)) this.ir(this.indice() - 1);
      this.dx.set(0);
      return;
    }
    if (this.eje === 'y') {
      if (totalY > 110 || (totalY > 40 && totalY / Math.max(ms, 1) > 0.5)) return this.cerrar();
      this.dy.set(0);
      return;
    }
    this.toque(e);
  }

  /** Un toque muestra/esconde los botones; dos toques seguidos hacen zoom */
  private toque(e: PointerEvent): void {
    const ahora = performance.now();
    const cerca = Math.hypot(e.clientX - this.ultimoToque.x, e.clientY - this.ultimoToque.y) < 30;
    if (ahora - this.ultimoToque.t < 300 && cerca) {
      clearTimeout(this.timerToque);
      this.ultimoToque.t = 0;
      if (e.pointerType !== 'mouse') this.alternarZoom(e.clientX, e.clientY);
      return;
    }
    this.ultimoToque = { t: ahora, x: e.clientX, y: e.clientY };
    clearTimeout(this.timerToque);
    // Con el mouse, un clic fuera de la foto la cierra
    if (e.pointerType === 'mouse' && this.escala() <= 1.01) {
      const r = document.querySelectorAll<HTMLImageElement>('app-visor .lamina img')[this.indice()]?.getBoundingClientRect();
      if (r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) this.cerrar();
      return;
    }
    this.timerToque = setTimeout(() => this.controles.update((v) => !v), 300);
  }

  dobleClic(e: MouseEvent): void {
    // En pantallas táctiles el doble toque ya lo maneja toque(); el navegador
    // además dispara dblclick y lo desharía
    if (this.ultimoTipo !== 'mouse') return;
    this.alternarZoom(e.clientX, e.clientY);
  }

  rueda(e: WheelEvent): void {
    e.preventDefault();
    const escala = Math.min(ZOOM_MAX, Math.max(1, this.escala() * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    this.zoomEn(escala, e.clientX, e.clientY, false);
  }

  private alternarZoom(x: number, y: number): void {
    this.zoomEn(this.escala() > 1.01 ? 1 : ZOOM_DOBLE_TOQUE, x, y, true);
  }

  private zoomEn(escala: number, x: number, y: number, animado: boolean): void {
    const c = this.centro();
    const k = escala / this.escala();
    this.animarZoom.set(animado);
    this.tx.set(escala === 1 ? 0 : x - c.x - (x - c.x - this.tx()) * k);
    this.ty.set(escala === 1 ? 0 : y - c.y - (y - c.y - this.ty()) * k);
    this.escala.set(escala);
    this.ajustarLimites();
  }

  /** Que la foto con zoom no se pueda sacar de la pantalla */
  private ajustarLimites(): void {
    const img = document.querySelectorAll<HTMLImageElement>('app-visor .lamina img')[this.indice()];
    if (!img) return;
    const s = this.escala();
    const maxX = Math.max(0, (img.offsetWidth * s - window.innerWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * s - window.innerHeight) / 2);
    const x = Math.min(maxX, Math.max(-maxX, this.tx()));
    const y = Math.min(maxY, Math.max(-maxY, this.ty()));
    if (x !== this.tx() || y !== this.ty()) {
      this.animarZoom.set(true);
      this.tx.set(x);
      this.ty.set(y);
    }
  }

  private centro(): { x: number; y: number } {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  // ------------------------------------------------------- Compartir/bajar
  async compartir(): Promise<void> {
    const f = this.actual();
    if (!f) return;
    this.guardando.set(true);
    try {
      const blob = await fetch(f.url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))));
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const nombre = `${(f.titulo || 'foto').replace(/[^\w\-áéíóúñ ]+/gi, '').trim().replace(/\s+/g, '-') || 'foto'}.${ext}`;
      const archivo = new File([blob], nombre, { type: blob.type });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (this.puedeCompartir && nav.canShare?.({ files: [archivo] })) {
        await nav.share({ files: [archivo], title: f.titulo });
      } else if (this.puedeCompartir) {
        await nav.share({ url: f.url, title: f.titulo });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch {
      // Cancelar el menú de compartir no es un error
    } finally {
      this.guardando.set(false);
    }
  }
}
