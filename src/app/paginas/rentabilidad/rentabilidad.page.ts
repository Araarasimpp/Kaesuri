import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { RangoComponent, RangoFechas } from '../../shared/rango/rango.component';
import { mensajeError, numero, pesos, urlMini } from '../../shared/formato';
import { hoyColombiaISO } from '../../shared/fecha-colombia';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

interface Fila {
  producto_id: string | null;
  nombre: string;
  imagen_url: string | null;
  activo: boolean;
  unidades: number;
  pedidos: number;
  ventas: number;
  ganancia_tienda: number;
  ganancia_vendedoras: number;
  costo: number;
  devueltas: number;
  reembolsos: number;
  perdidas: number;
  novedades: number;
  ganancia_neta: number;
}
type Orden = 'ganancia_neta' | 'ganancia_tienda' | 'unidades' | 'ventas' | 'margen' | 'devoluciones';

/**
 * Rentabilidad por producto (solo admin, como en Jasta): cuánto deja cada producto en
 * los pedidos entregados del periodo, y cuánto le restan las devoluciones (la ganancia
 * que se devolvió y lo que costó lo que se dañó).
 */
@Component({
  selector: 'app-rentabilidad',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, RangoComponent, SkeletonComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1100px; }
      .controles { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .controles input { flex: 1; min-width: 200px; }
      .controles select { width: auto; }
      td .prod { display: flex; gap: 10px; align-items: center; min-width: 0; }
      td .prod img, td .prod .ini { width: 36px; height: 36px; flex-shrink: 0; border-radius: 8px; object-fit: cover; background: var(--surface-2);
        display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
      td .prod span { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .neg { color: var(--danger); }
      .pos { color: var(--efectivo-texto); }
      .margen { display: inline-block; min-width: 46px; padding: 1px 7px; border-radius: 8px; font-size: 12px; font-weight: 700; text-align: center;
        background: var(--ok-wash); color: var(--efectivo-texto); }
      .margen.bajo { background: var(--oro-wash); color: var(--oro-texto); }
      .margen.malo { background: var(--danger-wash); color: var(--danger); }
      td.num { white-space: nowrap; }
      td small { display: block; font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
      th { white-space: nowrap; }
      .mas-btn { margin: 10px auto 0; display: block; }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ etiqueta() }}</p><h1>Rentabilidad por producto</h1></div>
      </div>
      <app-rango inicial="mes" (cambio)="cambiarRango($event)"></app-rango>

      <div class="kpis" role="list">
        <div class="kpi kpi-principal" role="listitem"><span class="kpi-label">Ganancia neta tienda</span><span class="kpi-valor num">{{ pesos(tot().neta) }}</span>
          <span class="kpi-nota">Después de devoluciones</span></div>
        <div class="kpi" role="listitem"><span class="kpi-label">Ventas</span><span class="kpi-valor num">{{ pesos(tot().ventas) }}</span>
          <span class="kpi-nota">{{ numero(tot().unidades) }} unidades entregadas</span></div>
        <div class="kpi" role="listitem"><span class="kpi-label">Margen de la tienda</span><span class="kpi-valor num">{{ pct(tot().tienda, tot().ventas) }}</span>
          <span class="kpi-nota">Ganancia tienda ÷ ventas</span></div>
        <div class="kpi" role="listitem"><span class="kpi-label">Restan las devoluciones</span><span class="kpi-valor num">{{ pesos(tot().perdidas) }}</span>
          <span class="kpi-nota">{{ numero(tot().devueltas) }} unidades devueltas</span></div>
      </div>

      <div class="controles">
        <input class="inp" type="search" [(ngModel)]="texto" placeholder="Buscar producto" aria-label="Buscar producto" />
        <select class="inp inp-chico" [(ngModel)]="orden" aria-label="Ordenar">
          <option value="ganancia_neta">Más ganancia neta</option>
          <option value="ganancia_tienda">Más ganancia tienda</option>
          <option value="unidades">Más vendidos</option>
          <option value="ventas">Más ventas en plata</option>
          <option value="margen">Menor margen primero</option>
          <option value="devoluciones">Más devoluciones</option>
        </select>
      </div>

      <div class="tabla-wrap">
        <table class="tabla tarjetas-cel">
          <thead><tr><th>Producto</th><th class="der">Vendidos</th><th class="der">Ventas</th><th class="der">Ganancia tienda</th><th class="der">Margen</th>
            <th class="der">Devueltos</th><th class="der">Restan</th><th class="der">Ganancia neta</th></tr></thead>
          <tbody>
            @for (f of visibles().slice(0, limite()); track f.nombre + f.producto_id) {
              <tr>
                <td data-etq="Producto"><span class="prod">
                  @if (urlMini(f.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <span class="ini">{{ f.nombre.charAt(0) }}</span> }
                  <span>{{ f.nombre }}</span></span></td>
                <td class="der num" data-etq="Vendidos">{{ numero(f.unidades) }}<small>{{ f.pedidos }} pedidos</small></td>
                <td class="der num" data-etq="Ventas">{{ pesos(f.ventas) }}</td>
                <td class="der num" data-etq="Ganancia tienda">{{ pesos(f.ganancia_tienda) }}<small>vendedores {{ pesos(f.ganancia_vendedoras) }}</small></td>
                <td class="der" data-etq="Margen"><span class="margen" [class.bajo]="margen(f) < 15" [class.malo]="margen(f) < 5">{{ pct(f.ganancia_tienda, f.ventas) }}</span></td>
                <td class="der num" data-etq="Devueltos">{{ f.devueltas || '—' }}@if (f.unidades && f.devueltas) {<small>{{ pct(f.devueltas, f.unidades) }}</small>}</td>
                <td class="der num" data-etq="Restan" [class.neg]="f.perdidas > 0">{{ f.perdidas ? '−' + pesos(f.perdidas) : '—' }}</td>
                <td class="der num" data-etq="Ganancia neta" [class.neg]="f.ganancia_neta < 0"><strong>{{ pesos(f.ganancia_neta) }}</strong></td>
              </tr>
            } @empty {
              @if (cargando()) { <tr><td colspan="8" class="suave"><app-skeleton variante="filas" [cantidad]="8"></app-skeleton></td></tr> } @else { <tr><td colspan="8" class="suave">No hay ventas entregadas en este periodo.</td></tr> }
            }
          </tbody>
        </table>
      </div>
      @if (visibles().length > limite()) {
        <button class="b mas-btn" (click)="limite.set(limite() + 50)">Ver más ({{ visibles().length - limite() }})</button>
      }
      <p class="ayuda" style="margin: 0">Ganancia tienda = (precio base − precio de compra) × unidades. "Restan" = la ganancia de la tienda en lo que se devolvió con reembolso
        más el costo de lo que llegó dañado. Pedidos entregados en el periodo; devoluciones registradas en el periodo.</p>
    </div>
  `,
})
export class RentabilidadPage {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  filas = signal<Fila[]>([]);
  cargando = signal(true);
  etiqueta = signal('');
  limite = signal(50);
  private textoS = signal('');
  private ordenS = signal<Orden>('ganancia_neta');
  pesos = pesos;
  numero = numero;
  urlMini = urlMini;
  private rango: RangoFechas | null = null;
  private consulta = 0;

  get texto(): string {
    return this.textoS();
  }
  set texto(v: string) {
    this.textoS.set(v);
    this.limite.set(50);
  }
  get orden(): Orden {
    return this.ordenS();
  }
  set orden(v: Orden) {
    this.ordenS.set(v);
  }

  tot = computed(() =>
    this.filas().reduce(
      (a, f) => ({
        ventas: a.ventas + Number(f.ventas), tienda: a.tienda + Number(f.ganancia_tienda), neta: a.neta + Number(f.ganancia_neta),
        perdidas: a.perdidas + Number(f.perdidas), unidades: a.unidades + Number(f.unidades), devueltas: a.devueltas + Number(f.devueltas),
      }),
      { ventas: 0, tienda: 0, neta: 0, perdidas: 0, unidades: 0, devueltas: 0 }
    )
  );

  visibles = computed(() => {
    const t = this.textoS().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const o = this.ordenS();
    const lista = this.filas().filter((f) => !t || f.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(t));
    const clave = (f: Fila): number => {
      if (o === 'margen') return -this.margen(f);
      if (o === 'devoluciones') return Number(f.devueltas);
      return Number(f[o]);
    };
    return [...lista].sort((a, b) => clave(b) - clave(a));
  });

  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    this.etiqueta.set(r.etiqueta);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    const n = ++this.consulta;
    this.cargando.set(true);
    const { data, error } = await this.sb.client.rpc('rentabilidad', { p_desde: r.desde || '2020-01-01', p_hasta: r.hasta || hoyColombiaISO() });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.filas.set((data ?? []) as Fila[]);
  }

  margen(f: Fila): number {
    return Number(f.ventas) ? (Number(f.ganancia_tienda) / Number(f.ventas)) * 100 : 0;
  }

  pct(a: number, b: number): string {
    return Number(b) ? Math.round((Number(a) / Number(b)) * 100) + '%' : '—';
  }
}
