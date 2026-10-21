import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { downloadOutline, searchOutline, shareOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { ProductoCatalogo as Producto, SELECT_CATALOGO, aCatalogo } from './producto-catalogo';
import { Producto as ProductoKaesuri } from '../../shared/models/models';
import { mensajeError, numero, pesos, urlImagen, urlMini } from '../../shared/formato';
import { FotoCatalogo, ProductoDetalleComponent, galeriaProducto } from './producto-detalle.component';

type Filtro = 'todos' | 'disponibles';

function normal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Catálogo para los vendedores (copiado de Jasta): los productos activos, con foto, descripción y precio, y el PDF para mandar */
@Component({
  selector: 'app-catalogo',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon, ProductoDetalleComponent],
  styles: [
    `
      .barra-cat { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; padding: 0 28px 14px; }
      .barra-cat .buscar { flex: 1 1 260px; max-width: 420px; }
      .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; padding: 4px 28px 28px; }
      .prod { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-lg);
        background: var(--surface); overflow: hidden; cursor: pointer; transition: border-color 160ms var(--ease), box-shadow 160ms var(--ease), transform 160ms var(--ease); }
      @media (hover: hover) { .prod:hover { border-color: var(--border-strong); box-shadow: var(--shadow-pop); } }
      .prod:active { transform: scale(0.985); }
      .prod:focus-visible { outline: 2px solid var(--oro); outline-offset: 2px; }
      .ver-mas { font-size: 12px; font-weight: 600; color: var(--oro-texto); }
      .foto { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; border: none; border-bottom: var(--perfora);
        background: #fff; cursor: pointer; }
      .foto img { width: 100%; height: 100%; object-fit: contain; padding: 8px; box-sizing: border-box; display: block; }
      .foto img.capa { position: absolute; inset: 0; opacity: 0; transform: scale(0.97); transition: opacity 320ms var(--ease), transform 420ms var(--ease); }
      .foto img.capa.on { opacity: 1; transform: none; }
      .tonos { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 2px 0 1px; }
      .tono { width: 20px; height: 20px; padding: 0; border-radius: 50%; border: 2px solid var(--surface); background: var(--tono);
        box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; transition: transform 160ms var(--ease), box-shadow 160ms var(--ease); }
      .tono.on { box-shadow: 0 0 0 2px var(--oro); transform: scale(1.12); }
      .tono:active { transform: scale(0.92); }
      .tono-nombre { font-size: 12px; color: var(--text-soft); animation: aparece 220ms var(--ease); }
      @keyframes aparece { from { opacity: 0; transform: translateX(-3px); } }
      @media (prefers-reduced-motion: reduce) { .foto img.capa, .tono { transition: none; } }
      .foto .inicial { display: grid; place-items: center; width: 100%; height: 100%; background: var(--oro-wash); color: var(--oro-texto);
        font-size: 40px; font-weight: 650; cursor: default; }
      .agotado { position: absolute; top: 8px; left: 8px; padding: 3px 7px; border-radius: 5px; background: rgba(15, 23, 42, 0.72); color: #fff;
        font-size: 11px; font-weight: 600; }
      .datos-prod { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px 12px; flex: 1; }
      .nombre { margin: 0; font-size: 13.5px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .tallas { display: flex; flex-wrap: wrap; gap: 4px; }
      .tallas span { min-width: 26px; height: 22px; padding: 0 6px; display: inline-grid; place-items: center; border: 1px solid var(--border-strong); border-radius: 5px; font-family: var(--mono-font); font-size: 11.5px; font-weight: 600; color: var(--text-soft); }
      .mas-fotos { position: absolute; left: 8px; bottom: 8px; padding: 2px 8px; border-radius: 10px; background: rgba(20, 18, 14, 0.62); color: #fff; font-size: 11px; font-weight: 600; }
      .desc { margin: 0; font-size: 12.5px; line-height: 1.35; color: var(--text-soft); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .precios { margin-top: auto; padding-top: 8px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .precio { font-size: 17px; font-weight: 650; white-space: nowrap; }
      .base { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
      .stock { font-size: 11.5px; color: var(--text-muted); }
      .stock.bajo { color: var(--danger); }
      .mas { display: flex; justify-content: center; padding: 0 28px 32px; }
      .progreso { font-size: 13px; color: var(--text-soft); }
      @media (max-width: 760px) {
        .barra-cat { padding: 0 16px 12px; }
        .barra-cat .buscar { max-width: none; }
        .rejilla { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 4px 16px 20px; }
        .datos-prod { padding: 8px 10px 10px; }
        .precio { font-size: 15px; }
        .precios { flex-direction: column; align-items: flex-start; gap: 1px; }
        .mas { padding: 0 16px 24px; }
      }
    `,
  ],
  template: `
    <div class="vista">
      <div class="vista-head">
        <h1>Catálogo <small class="num">{{ numero(filtrados().length) }}</small></h1>
        <button class="b b-pri" (click)="descargar()" [disabled]="generando() || !filtrados().length">
          <ion-icon [name]="compartir ? 'share-outline' : 'download-outline'"></ion-icon>
          {{ generando() ? 'Preparando PDF… ' + progreso() + '%' : 'Descargar PDF' }}
        </button>
      </div>

      <div class="barra-cat">
        <label class="buscar">
          <ion-icon name="search-outline"></ion-icon>
          <input type="search" placeholder="Buscar producto o SKU" [ngModel]="q()" (ngModelChange)="q.set($event); limite.set(60)" />
        </label>
        <div class="chips">
          <button class="chip" [class.on]="filtro() === 'todos'" (click)="filtro.set('todos')">Todos</button>
          <button class="chip" [class.on]="filtro() === 'disponibles'" (click)="filtro.set('disponibles')">Con stock</button>
        </div>
        @if (generando()) { <span class="progreso">Cargando fotos para el PDF…</span> }
      </div>

      @if (cargando()) {
        <p class="vacio" style="margin: 0 28px">Cargando catálogo…</p>
      } @else if (!filtrados().length) {
        <p class="vacio" style="margin: 0 28px">No hay productos con esa búsqueda.</p>
      }

      <div class="rejilla">
        @for (p of visibles(); track p.id) {
          <article class="prod" tabindex="0" role="button" [attr.aria-label]="'Ver todo de ' + p.nombre" (click)="abrir(p)" (keydown.enter)="abrir(p)">
            @if (fotos(p).length) {
              <button type="button" class="foto" tabindex="-1" aria-hidden="true">
                <!-- Todas las fotos apiladas: al cambiar de color se funden una en otra -->
                @for (f of fotos(p); track f.url) {
                  <img [src]="urlMini(f.url)" alt="" loading="lazy" decoding="async" class="capa" [class.on]="f.color === colorActivo(p)" />
                }
                @if (agotado(p)) { <span class="agotado">Sin stock</span> }
                @if (galeria(p).length > 1) { <span class="mas-fotos">{{ p.videos?.length ? '▶ ' : '' }}{{ galeria(p).length - (p.videos?.length ?? 0) }} {{ galeria(p).length - (p.videos?.length ?? 0) === 1 ? 'foto' : 'fotos' }}{{ p.videos?.length ? ' + video' : '' }}</span> }
              </button>
            } @else {
              <div class="foto"><span class="inicial" aria-hidden="true">{{ p.nombre.charAt(0) }}</span>
                @if (agotado(p)) { <span class="agotado">Sin stock</span> }</div>
            }
            <div class="datos-prod">
              <h2 class="nombre">{{ p.nombre }}</h2>
              @if (p.colores?.length) {
                <div class="tonos" role="group" [attr.aria-label]="'Colores de ' + p.nombre">
                  @for (c of p.colores!; track c.id) {
                    <button type="button" class="tono" [class.on]="colorActivo(p) === c.id" [style.--tono]="c.hex || '#ccc'"
                      [attr.aria-label]="c.nombre" [title]="c.nombre" (click)="elegirColor(p, c.id); $event.stopPropagation()" (keydown.enter)="$event.stopPropagation()"></button>
                  }
                  <span class="tono-nombre">{{ nombreColor(p) }}</span>
                </div>
              }
              @if (p.tallas?.length) {
                <div class="tallas" [attr.aria-label]="'Tallas: ' + p.tallas!.join(', ')">@for (t of p.tallas!; track t) { <span>{{ t }}</span> }</div>
              }
              @if (p.descripcion) { <p class="desc">{{ p.descripcion }}</p> }
              @if (p.controla_stock && p.stock > 0) {
                <span class="stock" [class.bajo]="p.stock < 5">{{ p.stock === 1 ? 'Queda 1' : 'Quedan ' + p.stock }}</span>
              }
              <div class="precios">
                <span class="precio num">{{ pesos(p.precio_venta) }}</span>
                <span class="base num" title="Precio base: lo mínimo que puedes cobrar">Base {{ pesos(p.precio_base) }}</span>
              </div>
              <span class="ver-mas">Ver todo ›</span>
            </div>
          </article>
        }
      </div>
      @if (abierto(); as p) {
        <app-producto-detalle [producto]="p" [fotos]="galeria(p)" [colorInicial]="colorActivo(p)" (cerrar)="abierto.set(null)"></app-producto-detalle>
      }
      @if (filtrados().length > visibles().length) {
        <div class="mas"><button class="b" (click)="limite.update((n) => n + 60)">Ver más ({{ filtrados().length - visibles().length }})</button></div>
      }
    </div>
  `,
})
export class CatalogoPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  productos = signal<Producto[]>([]);
  cargando = signal(true);
  q = signal('');
  filtro = signal<Filtro>('todos');
  /** Color elegido en cada tarjeta (id del producto → id del color) */
  colorElegido = signal<Record<string, number>>({});
  limite = signal(60);
  /** Producto con la ficha abierta */
  abierto = signal<Producto | null>(null);
  generando = signal(false);
  progreso = signal(0);
  readonly compartir = typeof navigator !== 'undefined' && 'canShare' in navigator && /iPhone|iPad|Android/i.test(navigator.userAgent);

  filtrados = computed(() => {
    const t = normal(this.q().trim());
    return this.productos().filter((p) => {
      if (this.filtro() === 'disponibles' && this.agotado(p)) return false;
      return !t || normal(`${p.nombre} ${p.sku ?? ''} ${p.descripcion ?? ''} ${(p.colores ?? []).map((c) => c.nombre).join(' ')}`).includes(t);
    });
  });
  visibles = computed(() => this.filtrados().slice(0, this.limite()));

  pesos = pesos;
  numero = numero;
  urlImagen = urlImagen;
  urlMini = urlMini;

  constructor() {
    addIcons({ downloadOutline, searchOutline, shareOutline });
  }

  async ngOnInit(): Promise<void> {
    const { data, error } = await this.sb.client
      .from('productos')
      .select(SELECT_CATALOGO)
      .eq('activo', true)
      .order('nombre');
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.productos.set(((data ?? []) as unknown as ProductoKaesuri[]).map(aCatalogo));
  }

  agotado(p: Producto): boolean {
    return p.controla_stock && p.stock <= 0;
  }

  /** Fotos del producto: la principal y la de cada color (color = null es la principal) */
  fotos(p: Producto): { url: string; titulo: string; color: number | null }[] {
    const lista: { url: string; titulo: string; color: number | null }[] = [];
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
    return lista;
  }

  /** Todas las fotos del producto para la ficha: principal, colores, adicionales y videos */
  galeria(p: Producto): FotoCatalogo[] {
    return galeriaProducto(p);
  }

  /** Color elegido en la tarjeta; si ese color no tiene foto se sigue viendo la principal */
  colorActivo(p: Producto): number | null {
    const id = this.colorElegido()[p.id] ?? null;
    return id !== null && this.fotos(p).some((f) => f.color === id) ? id : this.fotos(p)[0]?.color ?? null;
  }

  nombreColor(p: Producto): string {
    const id = this.colorElegido()[p.id];
    const c = (p.colores ?? []).find((x) => x.id === id);
    return c ? c.nombre : `${p.colores!.length} ${p.colores!.length === 1 ? 'color' : 'colores'}`;
  }

  elegirColor(p: Producto, id: number): void {
    this.colorElegido.update((m) => ({ ...m, [p.id]: id }));
  }

  abrir(p: Producto): void {
    this.abierto.set(p);
  }

  /** Arma el PDF con lo que está filtrado. En el celular abre "Compartir" (WhatsApp, Guardar en Archivos…) */
  async descargar(): Promise<void> {
    this.generando.set(true);
    this.progreso.set(0);
    try {
      const { generarCatalogoPdf } = await import('../../shared/catalogo-pdf');
      const yo = await this.sb.getCurrentProfile();
      const archivo = await generarCatalogoPdf({
        productos: this.filtrados(),
        vendedora: yo ? { nombre: yo.nombre, telefono: yo.telefono ?? null } : null,
        avance: (f) => this.progreso.set(Math.round(f * 100)),
      });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (this.compartir && nav.canShare?.({ files: [archivo] })) {
        try {
          await nav.share({ files: [archivo], title: 'Catálogo Variedades JYB' });
          return;
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(archivo);
      a.download = archivo.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.toast.ok('Catálogo descargado');
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.generando.set(false);
    }
  }
}
