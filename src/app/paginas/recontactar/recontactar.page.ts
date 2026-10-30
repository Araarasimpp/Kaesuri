import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Profile, SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError, numero, pesos } from '../../shared/formato';
import { enlaceWhatsapp } from '../../shared/whatsapp';
import { enlaceTienda } from '../pedidos-web/pedidos-web.page';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

interface ClienteDormido {
  telefono: string; nombre: string; barrio: string | null; dias: number; compras: number; total: number; ultima: string;
  vendedora: string | null; productos: string | null; contactado: string | null; marcado: boolean;
}
type Rango = '30' | '60' | '90' | '180';
const RANGOS: { id: Rango; label: string; desde: number; hasta: number | null }[] = [
  { id: '30', label: '1 a 2 meses', desde: 30, hasta: 59 },
  { id: '60', label: '2 a 3 meses', desde: 60, hasta: 89 },
  { id: '90', label: '3 a 6 meses', desde: 90, hasta: 179 },
  { id: '180', label: 'Más de 6 meses', desde: 180, hasta: null },
];

function normal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Clientes que ya compraron y llevan un tiempo sin volver. Con un toque se les escribe por
 * WhatsApp con un mensaje listo que lleva el enlace del catálogo del vendedor.
 * Primero los que más han comprado; los ya contactados (últimos 30 días) quedan al final.
 */
@Component({
  selector: 'app-recontactar',
  standalone: true,
  imports: [SkeletonComponent, FormsModule],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 900px; }
      .rangos { display: flex; gap: 8px; flex-wrap: wrap; }
      .rangos button { height: 38px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft);
        font: inherit; font-size: 14px; cursor: pointer; }
      .rangos button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .rangos b { margin-left: 6px; font-family: var(--mono-font); font-weight: 650; }
      .lista { display: flex; flex-direction: column; gap: 10px; }
      .cli { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 14px; align-items: center; padding: 14px 16px; border: 1px solid var(--border);
        border-radius: var(--radius-lg); background: var(--surface); }
      .cli.hecho { opacity: .6; }
      .cli strong { font-size: 15px; }
      .cli p { margin: 3px 0 0; font-size: 13px; color: var(--text-soft); }
      .cli small { display: block; margin-top: 3px; font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .etq { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 650; vertical-align: 1px; }
      .etq.ok { background: var(--ok-wash); color: var(--efectivo-texto); }
      .etq.mal { background: var(--danger-wash); color: var(--danger); }
      .wa { display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border-radius: 10px; background: #25d366; color: #fff; font-weight: 650;
        font-size: 14px; text-decoration: none; white-space: nowrap; }
      .vacio-txt { margin: 0; padding: 24px 0; text-align: center; color: var(--text-soft); }
      @media (max-width: 560px) { .cli { grid-template-columns: 1fr; } .wa { justify-content: center; } }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Ya te compraron y llevan un tiempo sin volver</p><h1>Clientes para recontactar</h1></div>
      </div>
      <p class="ayuda" style="margin: 0">Toca <strong>WhatsApp</strong> y se abre la conversación con un mensaje listo que lleva {{ esAdmin() ? 'el enlace del catálogo' : 'el enlace de tu catálogo' }}.
        Primero salen los que más han comprado.</p>

      <div class="rangos" role="group" aria-label="Hace cuánto compraron">
        @for (r of rangos; track r.id) {
          <button [class.on]="rango() === r.id" (click)="elegir(r.id)">{{ r.label }}@if (conteos(); as c) {<b>{{ numero(c[r.id]) }}</b>}</button>
        }
      </div>
      <input class="inp" type="search" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Buscar por nombre, barrio o producto" aria-label="Buscar" />

      <div class="lista">
        @for (c of visibles(); track c.telefono) {
          <article class="cli" [class.hecho]="!!c.contactado">
            <div style="min-width: 0">
              <strong>{{ c.nombre }}</strong>
              @if (c.contactado) { <span class="etq ok">Le escribiste {{ hace(c.contactado) }}</span> }
              @if (c.marcado) { <span class="etq mal">Cliente marcado</span> }
              <p>{{ c.barrio || 'Sin barrio' }} · hace {{ c.dias }} días · {{ c.compras }} {{ c.compras === 1 ? 'compra' : 'compras' }} · {{ pesos(c.total) }}{{ esAdmin() && c.vendedora ? ' · ' + c.vendedora : '' }}</p>
              @if (c.productos) { <small>Lo último: {{ c.productos }}</small> }
            </div>
            <a class="wa" [href]="whatsapp(c)" target="_blank" rel="noopener" (click)="contactado(c)">WhatsApp</a>
          </article>
        } @empty {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="6"></app-skeleton> } @else { <p class="vacio-txt">{{ q() ? 'Nadie coincide con esa búsqueda.' : 'No hay clientes en este rango.' }}</p> }
        }
      </div>
      @if (lista().length >= 150) {
        <p class="ayuda" style="margin: 0; text-align: center">Se muestran los 150 que más han comprado de este rango.</p>
      }
    </div>
  `,
})
export class RecontactarPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  rangos = RANGOS;
  rango = signal<Rango>('30');
  lista = signal<ClienteDormido[]>([]);
  conteos = signal<Record<Rango, number> | null>(null);
  cargando = signal(true);
  q = signal('');
  esAdmin = signal(false);
  private yo: Profile | null = null;
  pesos = pesos;
  numero = numero;

  visibles = computed(() => {
    const q = normal(this.q());
    const l = this.lista().filter((c) => !q || normal(`${c.nombre} ${c.barrio ?? ''} ${c.productos ?? ''}`).includes(q));
    // Los que ya contactaste se van al final
    return [...l.filter((c) => !c.contactado), ...l.filter((c) => c.contactado)];
  });

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((p) => {
      this.yo = p;
      this.esAdmin.set(!!p && rolesDe(p).includes('admin'));
    });
    void this.cargar();
  }

  elegir(r: Rango): void {
    this.rango.set(r);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const r = RANGOS.find((x) => x.id === this.rango())!;
    this.cargando.set(true);
    const { data, error } = await this.sb.client.rpc('recontactar', { p_desde: r.desde, p_hasta: r.hasta });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const d = data as { conteos: Record<Rango, number>; lista: ClienteDormido[] };
    this.conteos.set(d.conteos);
    this.lista.set(d.lista ?? []);
  }

  whatsapp(c: ClienteDormido): string {
    const u = this.yo;
    const yo = !this.esAdmin() && u ? (u.nombre ?? '').trim().split(/\s+/)[0] : '';
    const enlace = enlaceTienda(!this.esAdmin() && u ? { id: u.id, nombre: u.nombre } : null);
    const nombre = c.nombre.trim().split(/\s+/)[0];
    const producto = (c.productos ?? '').split(', ')[0];
    const quien = yo ? `Soy ${yo}, de Variedades JYB.` : 'Te escribimos de Variedades JYB.';
    const pregunta = producto ? ` ¿Cómo te ha ido con ${producto.toLowerCase()}?` : '';
    return enlaceWhatsapp(c.telefono,
      `Hola ${nombre} 👋 ${quien}${pregunta} Te comparto el catálogo con todo lo nuevo: ahí ves fotos y precios, y puedes pedir directo 👉 ${enlace}`);
  }

  contactado(c: ClienteDormido): void {
    const ahora = new Date().toISOString();
    this.lista.update((l) => l.map((x) => (x.telefono === c.telefono ? { ...x, contactado: ahora } : x)));
    void this.sb.client.rpc('marcar_contactado', { p_telefono: c.telefono }).then();
  }

  hace(iso: string): string {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
    return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
  }
}
