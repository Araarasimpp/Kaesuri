import { Component, Input, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { pesos, urlMini } from '../../shared/formato';

interface Prod { id: string; nombre: string; precio: number; imagen_url: string | null; agotado: boolean; categoria?: string | null }

function normal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Enlaces directos a un producto del catálogo: el cliente abre el link y le sale ese producto
 * abierto, listo para agregarlo, sin tener que buscarlo. Lleva el enlace del vendedor, así
 * que el pedido le llega a él.
 */
@Component({
  selector: 'app-enlaces-productos',
  standalone: true,
  imports: [FormsModule],
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 10px; }
      .res { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .res li { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: var(--perfora); }
      .res li:last-child { border-bottom: 0; }
      .mini { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: var(--surface-2); display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
      .nom { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 14px; font-weight: 600; line-height: 1.3; }
      @media (max-width: 520px) { .res li { grid-template-columns: 44px minmax(0, 1fr); } .btns { grid-column: 2; } .btns .b { flex: 1; } }
      .sub { display: block; font-size: 12.5px; color: var(--text-muted); }
      .sub .agot { color: var(--danger); font-weight: 600; }
      .btns { display: flex; gap: 6px; }
      .btns .b { height: 36px; font-size: 13px; padding: 0 12px; }
      .mas { font-size: 12.5px; color: var(--text-muted); margin: 0; text-align: center; }
    `,
  ],
  template: `
    <h2 class="seccion-titulo">Enlace a un producto</h2>
    <p class="ayuda" style="margin: 0">Busca el producto y comparte su enlace: al cliente le abre ese producto directo, listo para pedirlo. El pedido te llega igual que con tu enlace de la tienda.</p>
    <input class="inp" type="search" [ngModel]="q()" (ngModelChange)="q.set($event); cargar()" (focus)="cargar()" placeholder="Buscar producto (ej: armario, freidora…)" aria-label="Buscar producto para compartir" />
    @if (q().trim()) {
      <ul class="res">
        @for (p of encontrados(); track p.id) {
          <li>
            @if (urlMini(p.imagen_url); as u) { <img class="mini" [src]="u" alt="" loading="lazy" /> } @else { <span class="mini">{{ p.nombre.charAt(0) }}</span> }
            <div style="min-width: 0">
              <span class="nom">{{ p.nombre }}</span>
              <span class="sub">{{ pesos(p.precio) }}@if (p.agotado) { · <span class="agot">Agotado</span> }</span>
            </div>
            <div class="btns">
              <button class="b b-pri" (click)="compartir(p)">Compartir</button>
              <button class="b" (click)="copiar(p)">Copiar</button>
            </div>
          </li>
        } @empty {
          <li style="display: block"><p class="mas">{{ productos().length ? 'Ningún producto coincide.' : 'Cargando productos…' }}</p></li>
        }
      </ul>
      @if (total() > encontrados().length) { <p class="mas">Hay {{ total() - encontrados().length }} más: escribe más letras para encontrarlo.</p> }
    }
  `,
})
export class EnlacesProductosComponent {
  /** Enlace de la tienda (el del vendedor o el general) */
  @Input({ required: true }) base!: string;

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  q = signal('');
  productos = signal<Prod[]>([]);
  private cargado = false;
  pesos = pesos;
  urlMini = urlMini;

  private coincidencias = computed(() => {
    const palabras = normal(this.q()).split(/\s+/).filter(Boolean);
    return this.productos().filter((p) => palabras.every((w) => normal(p.nombre).includes(w)));
  });
  encontrados = computed(() => this.coincidencias().slice(0, 8));
  total = computed(() => this.coincidencias().length);

  async cargar(): Promise<void> {
    if (this.cargado) return;
    this.cargado = true;
    const { data, error } = await this.sb.client.rpc('tienda', { p_vendedor: null });
    if (error || !data) {
      this.cargado = false;
      return;
    }
    this.productos.set(((data as { productos: Prod[] }).productos ?? []));
  }

  enlace(p: Prod): string {
    return `${this.base}?p=${p.id}`;
  }

  async compartir(p: Prod): Promise<void> {
    const url = this.enlace(p);
    const texto = `Mira este producto: ${p.nombre} · ${pesos(p.precio)} 👇`;
    if (navigator.share) {
      try {
        await navigator.share({ title: p.nombre, text: texto, url });
        return;
      } catch {
        /* lo cerró: se copia */
      }
    }
    await this.copiar(p);
  }

  async copiar(p: Prod): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.enlace(p));
      this.toast.ok('Enlace del producto copiado');
    } catch {
      this.toast.error('No se pudo copiar el enlace');
    }
  }
}
