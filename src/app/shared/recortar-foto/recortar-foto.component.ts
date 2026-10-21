import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, signal } from '@angular/core';

const LADO_SALIDA = 512;
const ZOOM_MAX = 4;

/**
 * Ajustar la foto de perfil antes de subirla: se arrastra para encuadrar y se
 * agranda o achica con dos dedos, la rueda del mouse o la barra. Devuelve un
 * JPEG cuadrado de 512 px con lo que queda dentro del círculo.
 */
@Component({
  selector: 'app-recortar-foto',
  standalone: true,
  styles: [
    `
      .cuerpo { display: flex; flex-direction: column; align-items: center; gap: 16px; }
      .marco { position: relative; width: var(--lado); height: var(--lado); border-radius: var(--radius-lg); overflow: hidden;
        background: #111; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; }
      .marco:active { cursor: grabbing; }
      .marco img { position: absolute; left: 50%; top: 50%; max-width: none; pointer-events: none; -webkit-user-drag: none; will-change: transform; }
      /* Todo lo de afuera del círculo queda oscuro: así se ve lo que va a quedar */
      .mascara { position: absolute; inset: 0; pointer-events: none; border-radius: 50%; box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.55);
        outline: 2px solid rgba(255, 255, 255, 0.85); outline-offset: -2px; }
      .zoom { display: flex; align-items: center; gap: 10px; width: var(--lado); font-size: 18px; color: var(--text-soft); }
      .zoom input { flex: 1; accent-color: var(--accent); }
      .ayuda { margin: 0; text-align: center; font-size: 13px; color: var(--text-soft); }
      .cargando { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 13px; }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cancelar" (click)="cancelar.emit()"></button>
    <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-recorte">
      <div class="hoja-head"><h2 id="t-recorte">Ajusta tu foto</h2></div>
      <div class="hoja-body">
        <div class="cuerpo" [style.--lado]="lado + 'px'">
          <div class="marco" (pointerdown)="bajar($event)" (pointermove)="mover($event)" (pointerup)="subir($event)"
            (pointercancel)="subir($event)" (wheel)="rueda($event)">
            @if (url()) {
              <img [src]="url()" alt="" [style.width.px]="anchoBase()" [style.height.px]="altoBase()"
                [style.transform]="'translate(-50%, -50%) translate(' + x() + 'px, ' + y() + 'px) scale(' + zoom() + ')'" />
            } @else {
              <span class="cargando">Cargando foto…</span>
            }
            <span class="mascara" aria-hidden="true"></span>
          </div>
          <label class="zoom">
            <span aria-hidden="true">−</span>
            <input type="range" min="1" [max]="zoomMax" step="0.01" [value]="zoom()" (input)="cambiarZoom(+$any($event.target).value)" aria-label="Tamaño de la foto" />
            <span aria-hidden="true">+</span>
          </label>
          <p class="ayuda">Arrastra la foto para encuadrarla. Agrándala con dos dedos o con la barra.</p>
        </div>
      </div>
      <div class="hoja-pie">
        <button class="b" (click)="cancelar.emit()">Cancelar</button>
        <button class="b b-pri" [disabled]="!url() || guardando" (click)="listo()">{{ guardando ? 'Guardando…' : 'Usar esta foto' }}</button>
      </div>
    </div>
  `,
})
export class RecortarFotoComponent implements OnInit, OnDestroy {
  @Input({ required: true }) archivo!: File;
  @Input() guardando = false;
  @Output() recortada = new EventEmitter<Blob>();
  @Output() cancelar = new EventEmitter<void>();

  // Cabe en pantallas bajitas (iPhone SE) sin esconder los botones de abajo
  readonly lado = Math.max(200, Math.min(300, window.innerWidth - 64, window.innerHeight - 380));
  readonly zoomMax = ZOOM_MAX;
  url = signal<string | null>(null);
  anchoBase = signal(0);
  altoBase = signal(0);
  zoom = signal(1);
  x = signal(0);
  y = signal(0);

  private bmp: ImageBitmap | null = null;
  private punteros = new Map<number, { x: number; y: number }>();
  private pellizco: { dist: number; zoom: number } | null = null;

  async ngOnInit(): Promise<void> {
    try {
      this.bmp = await createImageBitmap(this.archivo);
    } catch {
      this.cancelar.emit();
      return;
    }
    // La foto cubre el cuadro completo con zoom 1 (como "cover")
    const k = Math.max(this.lado / this.bmp.width, this.lado / this.bmp.height);
    this.anchoBase.set(this.bmp.width * k);
    this.altoBase.set(this.bmp.height * k);
    this.url.set(URL.createObjectURL(this.archivo));
  }

  ngOnDestroy(): void {
    const u = this.url();
    if (u) URL.revokeObjectURL(u);
    this.bmp?.close?.();
  }

  // ------------------------------------------------------------ Encuadre
  /** La foto nunca deja ver el fondo dentro del cuadro */
  private ajustar(): void {
    const z = this.zoom();
    const mx = Math.max(0, (this.anchoBase() * z - this.lado) / 2);
    const my = Math.max(0, (this.altoBase() * z - this.lado) / 2);
    this.x.set(Math.min(mx, Math.max(-mx, this.x())));
    this.y.set(Math.min(my, Math.max(-my, this.y())));
  }

  cambiarZoom(z: number): void {
    const nuevo = Math.min(ZOOM_MAX, Math.max(1, z));
    const k = nuevo / this.zoom();
    // Se acerca hacia el centro del cuadro
    this.x.update((v) => v * k);
    this.y.update((v) => v * k);
    this.zoom.set(nuevo);
    this.ajustar();
  }

  bajar(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.punteros.size === 2) {
      const [a, b] = [...this.punteros.values()];
      this.pellizco = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom() };
    }
  }

  mover(e: PointerEvent): void {
    const previo = this.punteros.get(e.pointerId);
    if (!previo) return;
    this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.punteros.size >= 2 && this.pellizco) {
      const [a, b] = [...this.punteros.values()];
      this.cambiarZoom((this.pellizco.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / this.pellizco.dist);
      return;
    }
    this.x.update((v) => v + e.clientX - previo.x);
    this.y.update((v) => v + e.clientY - previo.y);
    this.ajustar();
  }

  subir(e: PointerEvent): void {
    this.punteros.delete(e.pointerId);
    if (this.punteros.size < 2) this.pellizco = null;
  }

  rueda(e: WheelEvent): void {
    e.preventDefault();
    this.cambiarZoom(this.zoom() * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  // ------------------------------------------------------------- Resultado
  listo(): void {
    const bmp = this.bmp;
    if (!bmp) return;
    const c = document.createElement('canvas');
    c.width = c.height = LADO_SALIDA;
    const ctx = c.getContext('2d')!;
    const k = LADO_SALIDA / this.lado;
    const w = this.anchoBase() * this.zoom() * k;
    const h = this.altoBase() * this.zoom() * k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LADO_SALIDA, LADO_SALIDA);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, LADO_SALIDA / 2 + this.x() * k - w / 2, LADO_SALIDA / 2 + this.y() * k - h / 2, w, h);
    c.toBlob((b) => b && this.recortada.emit(b), 'image/jpeg', 0.88);
  }
}
