import { AfterViewInit, Component, OnInit, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, createOutline, checkmarkOutline, chevronBackOutline, chevronForwardOutline, closeOutline, copyOutline, expandOutline, shareSocialOutline } from 'ionicons/icons';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { ProductoCatalogo as Producto } from './producto-catalogo';
import { pesos, urlImagen } from '../../shared/formato';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';

export interface FotoCatalogo {
  url: string;
  titulo: string;
  /** id del color de esa foto; null = principal; -1 = foto adicional; -2 = video */
  color: number | null;
  /** Es un video (se reproduce en el carrusel y se comparte junto con la foto) */
  video?: boolean;
}

/** Todas las fotos del producto para la ficha: principal, la de cada color, las adicionales y los videos */
export function galeriaProducto(p: Producto): FotoCatalogo[] {
  const lista: FotoCatalogo[] = [];
  const principal = urlImagen(p.imagen_url);
  if (principal) lista.push({ url: principal, titulo: p.nombre, color: null });
  for (const c of p.colores ?? []) {
    const u = urlImagen(c.imagen_url);
    if (!u) continue;
    const igual = lista.find((x) => x.url === u);
    // Si la foto del color es la misma principal, esa foto queda como de ese color
    if (igual) {
      if (igual.color === null) Object.assign(igual, { titulo: `${p.nombre} · ${c.nombre}`, color: c.id });
    } else lista.push({ url: u, titulo: `${p.nombre} · ${c.nombre}`, color: c.id });
  }
  (p.imagenes ?? []).forEach((ruta, i) => {
    const u = urlImagen(ruta);
    if (u && !lista.some((x) => x.url === u)) lista.push({ url: u, titulo: `${p.nombre} · foto ${i + 2}`, color: -1 });
  });
  // Los videos van justo después de la foto principal
  const videos = (p.videos ?? []).map((u, i) => ({ url: u, titulo: `${p.nombre} · video${(p.videos?.length ?? 0) > 1 ? ' ' + (i + 1) : ''}`, color: -2, video: true }));
  if (videos.length) lista.splice(Math.min(1, lista.length), 0, ...videos);
  return lista;
}

/**
 * Ficha completa de un producto del catálogo: todas sus fotos en un carrusel
 * (se desliza o se tocan las miniaturas), los colores (llevan a su foto), las
 * tallas, la descripción entera, los precios y la ganancia, y botones para
 * compartir el producto o hacer un pedido con él.
 */
@Component({
  selector: 'app-producto-detalle',
  standalone: true,
  host: { class: 'jt' },
  imports: [IonIcon],
  styles: [
    `
      .hoja { width: min(620px, 100vw); }
      .hoja-body { padding: 0 0 20px; gap: 0; }
      .hoja-body > * { flex-shrink: 0; }
      .hoja-head h2 { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

      /* Carrusel */
      .galeria { position: relative; background: #fff; border-bottom: var(--perfora); }
      .carrusel { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; }
      .carrusel::-webkit-scrollbar { display: none; }
      .slide { flex: 0 0 100%; aspect-ratio: 1; max-height: 50dvh; scroll-snap-align: center; scroll-snap-stop: always; display: block; position: relative;
        padding: 0; border: 0; background: none; cursor: zoom-in; }
      .slide img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 14px; box-sizing: border-box; display: block; }
      .sin-foto { aspect-ratio: 16 / 9; display: grid; place-items: center; background: var(--oro-wash); color: var(--oro-texto); font-size: 56px; font-weight: 650; }
      .flecha { position: absolute; top: 50%; translate: 0 -50%; width: 38px; height: 38px; display: grid; place-items: center; border: 1px solid var(--border);
        border-radius: 50%; background: rgba(255, 255, 255, 0.92); color: #0f172a; font-size: 18px; cursor: pointer; box-shadow: var(--shadow-pop); transition: opacity 160ms; }
      .flecha:disabled { opacity: 0; pointer-events: none; }
      .flecha.izq { left: 10px; } .flecha.der { right: 10px; }
      .contador { position: absolute; top: 10px; right: 10px; padding: 3px 9px; border-radius: 11px; background: rgba(20, 18, 14, 0.66); color: #fff;
        font-size: 11.5px; font-weight: 600; font-family: var(--mono-font); }
      .ampliar { position: absolute; bottom: 10px; right: 10px; width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%;
        background: rgba(20, 18, 14, 0.66); color: #fff; font-size: 16px; cursor: pointer; }
      .agotado { position: absolute; top: 10px; left: 10px; padding: 3px 8px; border-radius: 5px; background: rgba(15, 23, 42, 0.72); color: #fff; font-size: 11.5px; font-weight: 600; }
      .miniaturas { display: flex; gap: 8px; padding: 10px 20px; overflow-x: auto; scrollbar-width: none; border-bottom: var(--perfora); }
      .miniaturas::-webkit-scrollbar { display: none; }
      .mini { flex: none; width: 56px; height: 56px; padding: 0; border: 1px solid var(--border); border-radius: 8px; background: #fff; overflow: hidden; cursor: pointer;
        opacity: 0.65; transition: opacity 160ms, box-shadow 160ms, transform 160ms; }
      .mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .mini { position: relative; }
      .mini video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
      .mini .play { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 16px; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7); background: rgba(0, 0, 0, 0.18); }
      .video-slide { cursor: default; background: #111; }
      .video-slide video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; background: #111; }
      .b.listo { border-color: var(--oro); box-shadow: 0 0 0 3px var(--oro-wash); animation: llama 1s ease-in-out 2; }
      @keyframes llama { 50% { box-shadow: 0 0 0 6px var(--oro-wash); } }
      .mini.on { opacity: 1; box-shadow: 0 0 0 2px var(--oro); transform: translateY(-1px); }

      /* Información */
      .info { display: flex; flex-direction: column; gap: 18px; padding: 18px 24px 0; }
      .titulo h3 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.25; }
      .titulo p { margin: 4px 0 0; font-size: 12.5px; color: var(--text-muted); }
      .precios { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
      .precios div { display: flex; flex-direction: column; gap: 3px; padding: 11px 14px; box-shadow: 1px 0 0 var(--border); }
      .precios span { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
      .precios strong { font-family: var(--mono-font); font-size: 17px; font-weight: 650; white-space: nowrap; }
      .precios .gana { background: var(--oro-wash); }
      .precios .gana span, .precios .gana strong { color: var(--oro-texto); }
      .bloque h4 { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
      .bloque h4 em { font-style: normal; text-transform: none; letter-spacing: 0; color: var(--text); font-weight: 600; font-size: 13px; margin-left: 6px; }
      .colores { display: flex; flex-wrap: wrap; gap: 8px; }
      .color { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 12px 0 6px; border: 1px solid var(--border-strong); border-radius: 17px;
        background: var(--surface); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; transition: border-color 140ms, box-shadow 140ms; }
      .color .tono { width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }
      .color.on { border-color: var(--oro); box-shadow: 0 0 0 1px var(--oro); font-weight: 600; }
      .color small { color: var(--text-muted); font-size: 11px; }
      .tallas { display: flex; flex-wrap: wrap; gap: 6px; }
      .tallas span { min-width: 36px; height: 32px; padding: 0 10px; display: inline-grid; place-items: center; border: 1px solid var(--border-strong); border-radius: 7px;
        font-family: var(--mono-font); font-size: 13px; font-weight: 600; }
      .desc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      .desc-head h4 { margin: 0; }
      .copiar { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 11px; border: 1px solid var(--border-strong); border-radius: 15px;
        background: var(--surface); color: var(--text-soft); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: color 150ms, border-color 150ms, background 150ms; }
      .copiar ion-icon { font-size: 15px; }
      @media (hover: hover) { .copiar:hover { color: var(--text); border-color: var(--text-muted); } }
      .copiar:active { transform: scale(0.96); }
      .copiar.hecho { color: var(--efectivo-texto); border-color: var(--efectivo); background: color-mix(in srgb, var(--st-entregado) 8%, transparent); }
      .desc { margin: 0; font-size: 14px; line-height: 1.55; color: var(--text-soft); white-space: pre-line; }
      .datos { grid-template-columns: 110px 1fr; }
      .datos dt { color: var(--text-muted); }
      .datos dd { margin: 0; }
      .neg { color: var(--danger); font-weight: 600; }
      .bajo { color: var(--danger); }
      .hoja-pie .b ion-icon { font-size: 17px; }
      @media (max-width: 760px) {
        .info { padding: 16px 16px 0; }
        .miniaturas { padding: 10px 16px; }
        .precios strong { font-size: 15px; }
        .precios div { padding: 10px 11px; }
        .flecha { display: none; }
      }
      @media (prefers-reduced-motion: reduce) { .carrusel { scroll-behavior: auto; } }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cerrar" (click)="cerrar.emit()"></button>
    <aside class="hoja" role="dialog" aria-labelledby="t-ficha">
      <div class="hoja-head">
        <h2 id="t-ficha">{{ producto.nombre }}</h2>
        <button class="b b-icono" aria-label="Cerrar" (click)="cerrar.emit()"><ion-icon name="close-outline"></ion-icon></button>
      </div>
      <div class="hoja-body">
        @if (fotos.length) {
          <div class="galeria">
            <div class="carrusel" #carrusel (scroll)="alDeslizar()" aria-label="Fotos del producto" tabindex="0" (keydown.arrowRight)="ir(actual() + 1)" (keydown.arrowLeft)="ir(actual() - 1)">
              @for (f of fotos; track f.url; let i = $index) {
                @if (f.video) {
                  <div class="slide video-slide"><video [src]="f.url + '#t=0.1'" controls playsinline preload="metadata" [attr.aria-label]="f.titulo"></video></div>
                } @else {
                  <button type="button" class="slide" (click)="ampliar(i)" [attr.aria-label]="'Ver en grande: ' + f.titulo">
                    <img [src]="f.url" alt="" [attr.loading]="i < 2 ? 'eager' : 'lazy'" decoding="async" />
                  </button>
                }
              }
            </div>
            @if (fotos.length > 1) {
              <span class="contador" aria-live="polite">{{ actual() + 1 }} / {{ fotos.length }}</span>
              <button type="button" class="flecha izq" (click)="ir(actual() - 1)" [disabled]="actual() === 0" aria-label="Foto anterior"><ion-icon name="chevron-back-outline"></ion-icon></button>
              <button type="button" class="flecha der" (click)="ir(actual() + 1)" [disabled]="actual() === fotos.length - 1" aria-label="Foto siguiente"><ion-icon name="chevron-forward-outline"></ion-icon></button>
            }
            @if (!fotos[actual()]?.video) {
              <button type="button" class="ampliar" (click)="ampliar(actual())" aria-label="Ver en grande"><ion-icon name="expand-outline"></ion-icon></button>
            }
            @if (agotado()) { <span class="agotado">Sin stock</span> }
          </div>
          @if (fotos.length > 1) {
            <div class="miniaturas" #miniaturas>
              @for (f of fotos; track f.url; let i = $index) {
                <button type="button" class="mini" [class.on]="actual() === i" (click)="ir(i)" [attr.aria-label]="(f.video ? 'Video ' : 'Foto ') + (i + 1)">
                  @if (f.video) { <video [src]="f.url + '#t=0.1'" muted playsinline preload="metadata"></video><span class="play" aria-hidden="true">▶</span> }
                  @else { <img [src]="f.url" alt="" loading="lazy" /> }
                </button>
              }
            </div>
          }
        } @else {
          <div class="sin-foto" aria-hidden="true">{{ producto.nombre.charAt(0) }}</div>
        }

        <div class="info">
          <div class="titulo">
            <h3>{{ producto.nombre }}</h3>
            @if (producto.sku) { <p>SKU {{ producto.sku }}</p> }
          </div>

          @if (modo === 'catalogo') {
            <div class="precios">
              <div><span>Precio</span><strong>{{ pesos(producto.precio_venta) }}</strong></div>
              <div><span>Base</span><strong>{{ pesos(producto.precio_base) }}</strong></div>
              <div class="gana"><span>Ganas</span><strong>{{ pesos(ganancia()) }}</strong></div>
            </div>
          } @else if (esAdmin()) {
            <!-- Desde un pedido: los precios solo los ve el admin -->
            <div class="precios">
              <div><span>Precio venta</span><strong>{{ pesos(producto.precio_venta) }}</strong></div>
              <div><span>Precio base</span><strong>{{ pesos(producto.precio_base) }}</strong></div>
              <div class="gana"><span>Costo</span><strong>{{ pesos(producto.precio_compra) }}</strong></div>
            </div>
          }

          @if (producto.colores?.length) {
            <div class="bloque">
              <h4>Colores <em>{{ colorVisto()?.nombre ?? producto.colores!.length + (producto.colores!.length === 1 ? ' color' : ' colores') }}</em></h4>
              <div class="colores">
                @for (c of producto.colores!; track c.id) {
                  <button type="button" class="color" [class.on]="colorVisto()?.id === c.id" (click)="verColor(c.id)" [attr.aria-pressed]="colorVisto()?.id === c.id">
                    <span class="tono" [style.background]="c.hex || '#ccc'"></span>{{ c.nombre }}
                    @if (!c.imagen_url) { <small>sin foto</small> }
                  </button>
                }
              </div>
            </div>
          }

          @if (producto.tallas?.length) {
            <div class="bloque">
              <h4>Tallas disponibles</h4>
              <div class="tallas">@for (t of producto.tallas!; track t) { <span>{{ t }}</span> }</div>
            </div>
          }

          @if (producto.descripcion) {
            <div class="bloque">
              <div class="desc-head">
                <h4>Descripción</h4>
                <button type="button" class="copiar" [class.hecho]="copiado()" (click)="copiarDescripcion()" [attr.aria-label]="copiado() ? 'Descripción copiada' : 'Copiar descripción'">
                  <ion-icon [name]="copiado() ? 'checkmark-outline' : 'copy-outline'" aria-hidden="true"></ion-icon>{{ copiado() ? 'Copiada' : 'Copiar' }}
                </button>
              </div>
              <p class="desc">{{ producto.descripcion }}</p>
            </div>
          }

          <div class="bloque">
            <h4>Disponibilidad</h4>
            <dl class="datos">
              <dt>Stock</dt>
              <dd>
                @if (!producto.controla_stock) { Disponible }
                @else if (producto.stock <= 0) { <span class="neg">Sin stock</span> }
                @else { <span [class.bajo]="producto.stock < 5">{{ producto.stock === 1 ? 'Queda 1 unidad' : 'Quedan ' + producto.stock + ' unidades' }}</span> }
              </dd>
              <dt>Fotos</dt><dd>{{ nFotos() || 'Sin fotos' }}</dd>
              @if (videos().length) { <dt>Videos</dt><dd>{{ videos().length }}</dd> }
            </dl>
          </div>
        </div>
      </div>
      <div class="hoja-pie">
        @if (modo === 'catalogo') {
          <button class="b" [class.listo]="!!listos()" (click)="compartir()" [disabled]="compartiendo()">
            <ion-icon [name]="puedeCompartir ? 'share-social-outline' : 'copy-outline'"></ion-icon>{{ textoCompartir() }}
          </button>
          <button class="b b-pri" (click)="pedir()"><ion-icon name="add-outline"></ion-icon>Hacer pedido</button>
        } @else {
          <button class="b" (click)="cerrar.emit()"><ion-icon name="close-outline"></ion-icon>Cerrar</button>
          @if (esAdmin()) {
            <button class="b b-pri" (click)="editar()"><ion-icon name="create-outline"></ion-icon>Editar producto</button>
          }
        }
      </div>
    </aside>
  `,
})
export class ProductoDetalleComponent implements AfterViewInit, OnDestroy, OnInit {
  @Input({ required: true }) producto!: Producto;
  @Input() fotos: FotoCatalogo[] = [];
  /** Color que se estaba viendo en la tarjeta: la ficha abre en su foto */
  @Input() colorInicial: number | null = null;
  /** 'pedido' = abierta desde un pedido: sin compartir; precios y Editar solo para el admin */
  @Input() modo: 'catalogo' | 'pedido' = 'catalogo';
  @Output() cerrar = new EventEmitter<void>();

  @ViewChild('carrusel') carrusel?: ElementRef<HTMLDivElement>;
  @ViewChild('miniaturas') miniaturas?: ElementRef<HTMLDivElement>;

  private visor = inject(VisorService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private sb = inject(SupabaseService);
  esAdmin = signal(false);

  actual = signal(0);
  /** Color tocado aunque no tenga foto propia */
  colorTocado = signal<number | null>(null);
  compartiendo = signal(false);
  /** Se acaba de copiar la descripción (el botón muestra "Copiada" un momento) */
  copiado = signal(false);
  private timerCopia?: ReturnType<typeof setTimeout>;
  /** % de descarga del video para compartir (null = no se está descargando) */
  progreso = signal<number | null>(null);
  /** Archivos ya preparados (foto + video) para compartir con un solo toque */
  listos = signal<File[] | null>(null);
  videos = computed(() => this.fotos.filter((f) => f.video));
  nFotos = computed(() => this.fotos.filter((f) => !f.video).length);
  textoCompartir = computed(() => {
    if (!this.puedeCompartir) return 'Copiar info';
    const p = this.progreso();
    if (this.compartiendo()) return p !== null ? `Preparando video… ${p}%` : 'Preparando…';
    return this.listos() ? 'Compartir ahora' : 'Compartir';
  });
  readonly puedeCompartir = typeof navigator !== 'undefined' && 'share' in navigator;
  pesos = pesos;

  ganancia = computed(() => Number(this.producto.precio_venta) - Number(this.producto.precio_base));
  agotado = computed(() => this.producto.controla_stock && this.producto.stock <= 0);
  colorVisto = computed(() => {
    const id = this.colorTocado() ?? this.fotos[this.actual()]?.color;
    return (this.producto.colores ?? []).find((c) => c.id === id) ?? null;
  });

  private raf = 0;
  private teclas = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.cerrar.emit();
  };

  constructor() {
    addIcons({ addOutline, createOutline, checkmarkOutline, chevronBackOutline, chevronForwardOutline, closeOutline, copyOutline, expandOutline, shareSocialOutline });
  }

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((p) => this.esAdmin.set(!!p && rolesDe(p).includes('admin')));
  }

  ngAfterViewInit(): void {
    document.addEventListener('keydown', this.teclas);
    const i = this.colorInicial !== null ? this.fotos.findIndex((f) => f.color === this.colorInicial) : -1;
    if (i > 0) requestAnimationFrame(() => this.ir(i, false));
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.teclas);
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timerCopia);
  }

  /** Lleva el carrusel a la foto i */
  ir(i: number, suave = true): void {
    const el = this.carrusel?.nativeElement;
    if (!el || i < 0 || i >= this.fotos.length) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: suave ? 'smooth' : 'auto' });
    this.marcar(i);
  }

  alDeslizar(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const el = this.carrusel?.nativeElement;
      if (!el) return;
      const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      if (i !== this.actual()) this.marcar(i);
    });
  }

  private marcar(i: number): void {
    // El video que queda fuera de la vista se pausa
    if (i !== this.actual()) this.carrusel?.nativeElement.querySelectorAll('video').forEach((v) => v.pause());
    this.actual.set(i);
    this.colorTocado.set(null);
    // La miniatura activa queda a la vista
    const m = this.miniaturas?.nativeElement.children[i] as HTMLElement | undefined;
    m?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  verColor(id: number): void {
    const i = this.fotos.findIndex((f) => f.color === id);
    if (i >= 0) this.ir(i);
    // Sin foto propia: solo se marca el color
    else this.colorTocado.set(id);
  }

  async copiarDescripcion(): Promise<void> {
    const texto = (this.producto.descripcion ?? '').trim();
    if (!texto) return;
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // Navegadores sin portapapeles moderno: se copia con un campo oculto
      const t = document.createElement('textarea');
      t.value = texto;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      if (!ok) return this.toast.error('No se pudo copiar');
    }
    this.copiado.set(true);
    clearTimeout(this.timerCopia);
    this.timerCopia = setTimeout(() => this.copiado.set(false), 1800);
  }

  /** Abre el producto en Productos para editarlo (solo el admin) */
  editar(): void {
    this.cerrar.emit();
    void this.router.navigate(['/admin/productos'], { queryParams: { editar: this.producto.id } });
  }

  /** El visor es solo de fotos */
  ampliar(i: number): void {
    const fotos = this.fotos.filter((f) => !f.video);
    const precio = this.modo === 'catalogo' || this.esAdmin() ? ` · ${pesos(this.producto.precio_venta)}` : '';
    this.visor.abrir(fotos.map((f) => ({ url: f.url, titulo: f.titulo + precio })), Math.max(0, fotos.indexOf(this.fotos[i])));
  }

  /** Texto para mandarle al cliente (sin precio base ni ganancia) */
  private texto(): string {
    const p = this.producto;
    return [
      `*${p.nombre}*`,
      `Precio: ${pesos(p.precio_venta)}`,
      p.colores?.length ? `Colores: ${p.colores.map((c) => c.nombre).join(', ')}` : '',
      p.tallas?.length ? `Tallas: ${p.tallas.join(', ')}` : '',
      p.descripcion ?? '',
    ].filter(Boolean).join('\n');
  }

  /**
   * En el celular comparte la foto que se ve y el video del producto, con la
   * información (WhatsApp, etc.); en el computador copia el texto.
   * El video puede tardar en bajar: si el teléfono ya no deja abrir "Compartir"
   * después de esperar (iPhone), el botón queda en "Compartir ahora" con todo listo.
   */
  async compartir(): Promise<void> {
    const texto = this.texto();
    if (!this.puedeCompartir) {
      try {
        await navigator.clipboard.writeText(texto);
        this.toast.ok('Información copiada');
      } catch {
        this.toast.error('No se pudo copiar');
      }
      return;
    }
    const listos = this.listos();
    if (listos) return this.enviar(texto, listos, false);
    this.compartiendo.set(true);
    try {
      const files = await this.prepararArchivos();
      await this.enviar(texto, files, true);
    } finally {
      this.compartiendo.set(false);
      this.progreso.set(null);
    }
  }

  private async enviar(texto: string, files: File[], primeraVez: boolean): Promise<void> {
    // Si no se pueden mandar foto y video juntos, se manda lo que se pueda
    let archivos = files;
    if (archivos.length && !navigator.canShare?.({ files: archivos })) {
      archivos = archivos.filter((f) => navigator.canShare?.({ files: [f] }));
      if (archivos.length > 1 && !navigator.canShare?.({ files: archivos })) archivos = archivos.slice(0, 1);
    }
    try {
      await navigator.share({ title: this.producto.nombre, text: texto, ...(archivos.length ? { files: archivos } : {}) });
      this.listos.set(null);
    } catch (e) {
      const nombre = (e as Error)?.name;
      if (nombre === 'AbortError') return;
      if (nombre === 'NotAllowedError' && primeraVez) {
        // Pasó mucho tiempo bajando el video: un toque más y sale
        this.listos.set(files);
        this.toast.ok('Listo: toca "Compartir ahora"');
        return;
      }
      this.toast.error('No se pudo compartir');
    }
  }

  /** La foto que se está viendo (o la principal) y el primer video */
  private async prepararArchivos(): Promise<File[]> {
    const base = this.producto.nombre.replace(/[^\w-]+/g, '_').slice(0, 40) || 'producto';
    const vista = this.fotos[this.actual()];
    const foto = vista && !vista.video ? vista : this.fotos.find((f) => !f.video);
    const video = vista?.video ? vista : this.fotos.find((f) => f.video);
    const files: File[] = [];
    if (foto) {
      try {
        const blob = await (await fetch(foto.url)).blob();
        files.push(new File([blob], `${base}.jpg`, { type: blob.type || 'image/jpeg' }));
      } catch {
        /* sin foto */
      }
    }
    if (video) {
      try {
        const blob = await this.bajar(video.url);
        const ext = /quicktime/.test(blob.type) || /\.mov($|\?)/i.test(video.url) ? 'mov' : 'mp4';
        files.push(new File([blob], `${base}.${ext}`, { type: blob.type || (ext === 'mov' ? 'video/quicktime' : 'video/mp4') }));
      } catch {
        this.toast.error('No se pudo bajar el video; se comparte solo la foto');
      }
    }
    return files;
  }

  /** Descarga con porcentaje, para mostrar el avance del video */
  private async bajar(url: string): Promise<Blob> {
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error('No se pudo bajar');
    const total = Number(r.headers.get('content-length')) || 0;
    const lector = r.body.getReader();
    const partes: Uint8Array[] = [];
    let n = 0;
    this.progreso.set(0);
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      partes.push(value);
      n += value.length;
      if (total) this.progreso.set(Math.min(99, Math.round((n / total) * 100)));
    }
    return new Blob(partes as BlobPart[], { type: r.headers.get('content-type') ?? 'video/mp4' });
  }

  /** Abre "Nuevo pedido" con este producto (y el color que se está viendo) */
  pedir(): void {
    const color = this.colorVisto()?.nombre;
    this.cerrar.emit();
    // El "Nuevo pedido" de cada área (vendedor, despachador o admin)
    const area = this.router.url.split('/')[1];
    const ruta = area === 'vendedor' ? '/vendedor/nuevo-pedido' : `/${area === 'despachador' ? 'despachador' : 'admin'}/pedidos/nuevo`;
    void this.router.navigate([ruta], { queryParams: { producto: this.producto.id, ...(color ? { color } : {}) } });
  }
}
