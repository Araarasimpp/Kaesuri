import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { formatoFechaCO } from '../../shared/fecha-colombia';

interface Resumen {
  total: { cantidad: number; promedio: number | null };
  entregados: number;
  domiciliarios: { nombre: string; cantidad: number; promedio: number; bajas: number }[];
  comentarios: { numero: number; estrellas: number; comentario: string; fecha: string; cliente: string; domiciliario: string | null }[];
}

/**
 * Reportes → Calificaciones de las entregas (como en Jasta): los clientes califican desde su
 * enlace de seguimiento. Promedio, por domiciliario y los últimos comentarios del periodo.
 */
@Component({
  selector: 'app-calificaciones',
  standalone: true,
  host: { class: 'jt' },
  styles: [
    `
      :host { display: block; margin-top: 20px; padding: 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
      h2 { margin: 0 0 4px; font-size: 17px; }
      .sub { margin: 0 0 12px; font-size: 13px; color: var(--text-soft); }
      .tot { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 14px; color: var(--text-soft); }
      .tot b { font-size: 26px; color: var(--text); font-family: var(--mono-font); }
      .estrella { color: var(--oro); }
      .lista { list-style: none; margin: 12px 0 0; padding: 0; }
      .lista li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border-soft, var(--border)); font-size: 14px; }
      .lista small { color: var(--text-muted); }
      .bajas { color: var(--danger); font-weight: 600; }
      .com { margin: 14px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; }
      .com small { display: block; color: var(--text-muted); }
    `,
  ],
  template: `
    <h2>Calificaciones de las entregas</h2>
    <p class="sub">Los clientes califican desde su enlace de seguimiento cuando reciben el pedido.</p>
    @if (r(); as d) {
      @if (d.total.cantidad) {
        <div class="tot"><span class="estrella">★</span><b>{{ d.total.promedio }}</b> de 5 · {{ d.total.cantidad }}
          {{ d.total.cantidad === 1 ? 'calificación' : 'calificaciones' }} de {{ d.entregados }} entregas</div>
        <ul class="lista">
          @for (m of d.domiciliarios; track m.nombre) {
            <li><span>{{ m.nombre }} <small>· {{ m.cantidad }}</small>@if (m.bajas) { <span class="bajas"> · {{ m.bajas }} de 3 o menos</span> }</span>
              <span><span class="estrella">★</span> {{ m.promedio }}</span></li>
          }
        </ul>
        @if (d.comentarios.length) {
          <ul class="com">
            @for (k of d.comentarios; track k.fecha) {
              <li><span class="estrella">{{ '★'.repeat(k.estrellas) }}</span> "{{ k.comentario }}"
                <small>#{{ k.numero }} · {{ k.cliente }}@if (k.domiciliario) { · entregó {{ k.domiciliario }} } · {{ fecha(k.fecha) }}</small></li>
            }
          </ul>
        }
      } @else {
        <p class="sub" style="margin: 0">Todavía no hay calificaciones en este periodo.</p>
      }
    }
  `,
})
export class CalificacionesComponent implements OnChanges {
  @Input() desde = '';
  @Input() hasta = '';
  private sb = inject(SupabaseService);
  r = signal<Resumen | null>(null);

  async ngOnChanges(): Promise<void> {
    if (!this.desde || !this.hasta) return;
    const { data, error } = await this.sb.client.rpc('calificaciones_resumen', { p_desde: this.desde, p_hasta: this.hasta });
    if (!error) this.r.set(data as Resumen);
  }

  fecha(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' });
  }
}
