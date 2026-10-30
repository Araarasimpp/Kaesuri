import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { numero } from '../formato';

interface Avance { tipo: 'vendedor' | 'domiciliario'; cantidad: number; meta: number }
interface MiMeta { hoy: string; fin_mes: string; mes: Avance[]; semana: Avance[] }

/**
 * Tarjeta con el avance hacia la meta propia (del mes y de la semana), la que pone el admin en
 * Ranking. Si no hay meta, no se muestra. Al pasar el 50 %, 80 % y 100 % llega un aviso.
 */
@Component({
  selector: 'app-mi-meta',
  standalone: true,
  imports: [RouterLink],
  styles: [
    `
      :host { display: block; }
      .meta { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .top h2 { margin: 0; font-size: 15px; }
      .top a { font-size: 13px; color: var(--accent); text-decoration: none; white-space: nowrap; }
      .fila { display: flex; flex-direction: column; gap: 6px; }
      .cifras { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 13.5px; color: var(--text-soft); }
      .cifras strong { font-family: var(--mono-font); font-size: 20px; color: var(--text); }
      .cifras .pct { font-weight: 700; color: var(--text); }
      .avance { height: 10px; padding: 0; border: 0; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
      .avance i { display: block; height: 10px; border-radius: inherit; background: var(--accent); transition: width .6s ease; }
      .avance.lista i { background: var(--efectivo-texto); }
      .nota { margin: 0; font-size: 12.5px; color: var(--text-muted); }
      .nota.ok { color: var(--efectivo-texto); font-weight: 650; }
      .semana .cifras strong { font-size: 15px; }
      .semana .avance, .semana .avance i { height: 6px; }
      @media (prefers-reduced-motion: reduce) { .avance i { transition: none; } }
    `,
  ],
  template: `
    @if (filas().length) {
      <section class="meta" aria-label="Tu meta">
        <div class="top"><h2>Tu meta</h2><a [routerLink]="raiz + '/ranking'">Ver ranking</a></div>
        @for (f of filas(); track f.clave) {
          <div class="fila" [class.semana]="f.semana">
            <div class="cifras">
              <span><strong>{{ numero(f.a.cantidad) }}</strong> de {{ numero(f.a.meta) }} {{ f.que }} {{ f.semana ? 'esta semana' : 'este mes' }}</span>
              <span class="pct">{{ f.pct }} %</span>
            </div>
            <div class="avance" [class.lista]="f.pct >= 100" role="progressbar" [attr.aria-valuenow]="f.pct" aria-valuemin="0" aria-valuemax="100"
              [attr.aria-label]="'Avance de la meta ' + (f.semana ? 'de la semana' : 'del mes')"><i [style.width.%]="f.pct > 100 ? 100 : f.pct"></i></div>
            @if (f.nota) { <p class="nota" [class.ok]="f.pct >= 100">{{ f.nota }}</p> }
          </div>
        }
      </section>
    }
  `,
})
export class MiMetaComponent implements OnInit {
  private sb = inject(SupabaseService);
  /** Área donde está (cada una tiene su Ranking) */
  readonly raiz = '/' + inject(Router).url.split(/[/?]/)[1];
  datos = signal<MiMeta | null>(null);
  numero = numero;

  filas = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const hoy = new Date(d.hoy + 'T12:00:00');
    const fin = new Date(d.fin_mes + 'T12:00:00');
    const diasMes = fin.getDate();
    const quedan = diasMes - hoy.getDate() + 1;
    const fila = (a: Avance, semana: boolean) => {
      const pct = Math.round((a.cantidad / a.meta) * 100);
      const que = a.tipo === 'vendedor' ? 'ventas' : 'entregas';
      const falta = a.meta - a.cantidad;
      let nota = '';
      if (falta <= 0) nota = semana ? '¡Cumpliste la meta de la semana!' : '¡Cumpliste la meta del mes! 🏆';
      else if (!semana) {
        const proy = Math.round((a.cantidad / hoy.getDate()) * diasMes);
        nota = `Te ${falta === 1 ? 'falta 1' : 'faltan ' + numero(falta)} en ${quedan === 1 ? 'el último día' : quedan + ' días'}`
          + ` (≈ ${Math.max(1, Math.ceil(falta / quedan))} por día). A este ritmo cierras el mes con ${numero(proy)}.`;
      } else nota = `Te ${falta === 1 ? 'falta 1' : 'faltan ' + numero(falta)} para la meta de la semana.`;
      return { clave: (semana ? 's' : 'm') + a.tipo, a, semana, pct, que, nota };
    };
    return [...d.mes.map((a) => fila(a, false)), ...d.semana.map((a) => fila(a, true))];
  });

  async ngOnInit(): Promise<void> {
    const { data } = await this.sb.client.rpc('mi_meta');
    if (data) this.datos.set(data as MiMeta);
  }
}
