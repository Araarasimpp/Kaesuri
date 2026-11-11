import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { mensajeError, pesos, urlMini } from '../../shared/formato';
import { formatoFechaCO } from '../../shared/fecha-colombia';
import { confirmar } from '../../shared/dialogo';

interface Quieto {
  id: string; nombre: string; sku: string | null; imagen_url: string | null; categoria: string | null;
  /** null = no lleva conteo de unidades */
  stock: number | null; costo: number | null; precio: number | null; plata: number;
  ultima_venta: string | null; nunca: boolean; dias: number; vendidas_90: number;
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Productos quietos: los que llevan 30, 60, 90 o más días sin venderse (pedidos entregados, ventas
 * del local y cuentas por cobrar), con la plata que hay metida en ellos para hacerles oferta o
 * dejar de comprarlos.
 */
@Component({
  selector: 'app-quietos',
  standalone: true,
  imports: [FormsModule, RouterLink, SkeletonComponent],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 900px; }
      .dias { display: flex; gap: 8px; flex-wrap: wrap; }
      .dias button { height: 38px; padding: 0 16px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft); font: inherit; font-size: 14px; cursor: pointer; }
      .dias button.on { border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 650; }
      .barra { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .barra input { flex: 1; min-width: 180px; height: 40px; }
      .barra select { height: 40px; }
      .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .item { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .item img, .item .ini { width: 56px; height: 56px; border-radius: 10px; object-fit: contain; background: #fff; display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
      .nom { font-size: 14.5px; font-weight: 650; line-height: 1.3; }
      .sub { display: block; font-size: 12.5px; color: var(--text-muted); margin-top: 2px; }
      .tiempo { display: inline-block; margin-top: 4px; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; background: var(--oro-wash); color: var(--oro-texto); }
      .tiempo.grave { background: var(--danger-wash); color: var(--danger); }
      .der { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; }
      .plata { font-family: var(--mono-font); font-size: 16px; font-weight: 700; }
      .der small { font-size: 12px; color: var(--text-muted); }
      .acc { grid-column: 2 / -1; display: flex; gap: 14px; flex-wrap: wrap; }
      .link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; }
      .link.peligro { color: var(--danger); }
      .vacio-txt { margin: 0; padding: 24px 0; text-align: center; font-size: 14px; color: var(--text-soft); }
      .ideas { margin: 0; padding-left: 18px; font-size: 13.5px; color: var(--text-soft); line-height: 1.5; }
      @media (max-width: 560px) { .item { grid-template-columns: 48px minmax(0, 1fr); } .item img, .item .ini { width: 48px; height: 48px; } .der { grid-column: 2; align-items: flex-start; text-align: left; flex-direction: row; gap: 10px; flex-wrap: wrap; } }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Lo que no se está vendiendo</p><h1>Productos quietos</h1></div>
      </div>
      <p class="ayuda" style="margin: 0">Productos activos que llevan muchos días sin venderse (cuenta pedidos entregados, ventas del local y cuentas por cobrar). Si nunca se han vendido, cuenta desde que se crearon. Hazles oferta o cupón, o deja de comprarlos.</p>

      <div class="dias" role="group" aria-label="Días sin venderse">
        @for (d of opciones; track d) {
          <button type="button" [class.on]="dias() === d" [attr.aria-pressed]="dias() === d" (click)="cambiarDias(d)">+{{ d }} días</button>
        }
      </div>

      <div class="kpis" role="list">
        <div class="kpi kpi-principal" role="listitem">
          <span class="kpi-label">Productos quietos</span>
          <span class="kpi-valor num">{{ cargando() ? '…' : lista().length }}</span>
          <span class="kpi-nota">Sin venderse hace +{{ dias() }} días</span>
        </div>
        <div class="kpi" role="listitem">
          <span class="kpi-label">Plata quieta</span>
          <span class="kpi-valor num">{{ cargando() ? '…' : pesos(plata()) }}</span>
          <span class="kpi-nota">Unidades en bodega × costo{{ sinConteo() ? ' (' + sinConteo() + ' sin conteo)' : '' }}</span>
        </div>
        <div class="kpi" role="listitem">
          <span class="kpi-label">Nunca vendidos</span>
          <span class="kpi-valor num">{{ cargando() ? '…' : nunca() }}</span>
          <span class="kpi-nota">Desde que se crearon</span>
        </div>
      </div>

      <div class="barra">
        <input type="search" class="inp" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Buscar producto o categoría" aria-label="Buscar" />
        <select class="inp" [ngModel]="orden()" (ngModelChange)="orden.set($event)" aria-label="Ordenar">
          <option value="plata">Más plata quieta</option>
          <option value="dias">Más días sin venderse</option>
          <option value="costo">Más caros</option>
        </select>
      </div>

      @if (cargando()) {
        <app-skeleton variante="filas" [cantidad]="5"></app-skeleton>
      } @else {
        <ul class="lista">
          @for (p of filtrados(); track p.id) {
            <li class="item">
              @if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <span class="ini">{{ p.nombre.charAt(0) }}</span> }
              <div>
                <span class="nom">{{ p.nombre }}</span>
                <span class="sub">{{ p.categoria || 'Sin categoría' }}{{ p.sku ? ' · ' + p.sku : '' }} · costo {{ pesos(p.costo) }} · precio {{ pesos(p.precio) }}</span>
                <span class="tiempo" [class.grave]="p.dias >= 90">{{ p.nunca ? 'Nunca se ha vendido · ' + p.dias + ' días en catálogo' : p.dias + ' días sin venderse · última ' + fecha(p.ultima_venta!) }}</span>
              </div>
              <div class="der">
                @if (p.stock !== null) {
                  <span class="plata">{{ pesos(p.plata) }}</span><small>{{ p.stock }} {{ p.stock === 1 ? 'unidad' : 'unidades' }}</small>
                } @else { <small>Sin conteo de unidades</small> }
                @if (p.vendidas_90) { <small>{{ p.vendidas_90 }} vendidas en 90 días</small> }
              </div>
              <div class="acc">
                <button class="link" (click)="copiarEnlace(p)">Copiar enlace del catálogo</button>
                <a class="link" routerLink="/admin/cupones">Crear cupón</a>
                <button class="link peligro" (click)="desactivar(p)">Quitar del catálogo</button>
              </div>
            </li>
          } @empty {
            <li class="vacio-txt">{{ q().trim() ? 'Nada con esa búsqueda.' : '¡Bien! No hay productos sin venderse hace más de ' + dias() + ' días.' }}</li>
          }
        </ul>
        @if (lista().length) {
          <section class="panel">
            <h2 style="margin: 0 0 6px; font-size: 15px">¿Qué hacer con ellos?</h2>
            <ul class="ideas">
              <li>Bájales el precio o crea un cupón y compártelo con el enlace del producto.</li>
              <li>Pónlos de primeros en tus estados de WhatsApp: muchos no se venden porque nadie los ve.</li>
              <li>No vuelvas a comprar los que llevan +90 días hasta que salgan.</li>
              <li>Si ya no los vas a vender, quítalos del catálogo para que no estorben.</li>
            </ul>
          </section>
        }
      }
    </div>
  `,
})
export class QuietosPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  opciones = [30, 60, 90, 180];
  dias = signal(30);
  lista = signal<Quieto[]>([]);
  cargando = signal(true);
  q = signal('');
  orden = signal<'plata' | 'dias' | 'costo'>('plata');
  pesos = pesos;
  urlMini = urlMini;

  plata = computed(() => this.lista().reduce((s, p) => s + Number(p.plata || 0), 0));
  nunca = computed(() => this.lista().filter((p) => p.nunca).length);
  sinConteo = computed(() => this.lista().filter((p) => p.stock === null).length);
  filtrados = computed(() => {
    const t = normal(this.q());
    const o = this.orden();
    const l = this.lista().filter((p) => !t || normal(p.nombre).includes(t) || normal(p.categoria ?? '').includes(t) || normal(p.sku ?? '').includes(t));
    const k = (p: Quieto) => (o === 'plata' ? Number(p.plata) * 1e6 + p.dias : o === 'dias' ? p.dias : Number(p.costo ?? 0));
    return [...l].sort((a, b) => k(b) - k(a));
  });

  ngOnInit(): void {
    void this.cargar();
  }

  cambiarDias(d: number): void {
    this.dias.set(d);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const { data, error } = await this.sb.client.rpc('productos_quietos', { p_dias: this.dias() });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.lista.set((data ?? []) as Quieto[]);
  }

  async copiarEnlace(p: Quieto): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${location.origin}/tienda?p=${p.id}`);
      this.toast.ok('Enlace copiado');
    } catch {
      this.toast.error('No se pudo copiar');
    }
  }

  async desactivar(p: Quieto): Promise<void> {
    if (!(await confirmar(`¿Quitar "${p.nombre}" del catálogo? Queda inactivo y lo puedes volver a activar en Productos.`, { aceptar: 'Quitar', peligro: true }))) return;
    const { error } = await this.sb.client.from('productos').update({ activo: false, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) return this.toast.error(mensajeError(error));
    this.lista.update((l) => l.filter((x) => x.id !== p.id));
    this.toast.ok('Producto quitado del catálogo');
  }

  fecha(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
