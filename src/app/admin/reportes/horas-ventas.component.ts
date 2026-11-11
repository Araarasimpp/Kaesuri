import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { numero, pesos } from '../../shared/formato';

interface Celda { dow: number; hora: number; pedidos: number; ventas: number; local: number; web: number }

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const HORAS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 a. m. a 10 p. m.

/**
 * Horas y días con más ventas: mapa de calor (día de la semana × hora) del periodo elegido,
 * con lo más fuerte resumido y una sugerencia de cuándo publicar.
 */
@Component({
  selector: 'app-horas-ventas',
  standalone: true,
  host: { class: 'jt' },
  imports: [SkeletonComponent],
  styles: [
    `
      :host { display: block; }
      .suave { color: var(--text-soft); }
      .resumen { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
      .dato { padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
      .dato small { display: block; font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
      .dato strong { display: block; margin-top: 4px; font-size: 17px; }
      .dato span { display: block; font-size: 12.5px; color: var(--text-soft); }
      .tip { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 16px; padding: 12px 14px; border-radius: var(--radius); background: var(--accent-wash); color: var(--text); font-size: 14px; line-height: 1.45; }
      .tip b { color: var(--accent); }
      .barra { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
      .seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--surface-2); }
      .seg button { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--text-soft); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
      .seg button.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,.12); }
      .mapa { overflow-x: auto; padding-bottom: 6px; }
      table { border-collapse: separate; border-spacing: 3px; min-width: 640px; width: 100%; }
      th { font-size: 11px; font-weight: 600; color: var(--text-muted); text-align: center; white-space: nowrap; }
      th.dia { text-align: left; padding-right: 6px; font-size: 12.5px; color: var(--text-soft); }
      td { height: 30px; border-radius: 6px; text-align: center; font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; cursor: default; }
      td.pico { outline: 2px solid var(--accent); outline-offset: -1px; }
      .leyenda { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--text-muted); }
      .leyenda i { width: 22px; height: 12px; border-radius: 3px; }
      .vacio-txt { margin: 0; padding: 20px 0; text-align: center; color: var(--text-soft); font-size: 14px; }
      @media (max-width: 640px) { .resumen { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    `,
  ],
  template: `
    @if (cargando() && !celdas().length) {
      <app-skeleton variante="filas" [cantidad]="7"></app-skeleton>
    } @else if (total().pedidos) {
      <div class="resumen">
        <div class="dato"><small>Mejor día</small><strong>{{ mejorDia().nombre }}</strong><span>{{ metrica() === 'pedidos' ? numero(mejorDia().valor) + ' pedidos' : pesos(mejorDia().valor) }} · {{ mejorDia().pct }}% del total</span></div>
        <div class="dato"><small>Mejor hora</small><strong>{{ franja(mejorHora().hora) }}</strong><span>{{ mejorHora().pct }}% de los pedidos</span></div>
        <div class="dato"><small>El pico</small><strong>{{ pico().dia }} {{ hora12(pico().hora) }}</strong><span>{{ numero(pico().pedidos) }} pedidos en esa hora</span></div>
        <div class="dato"><small>Día más flojo</small><strong>{{ peorDia().nombre }}</strong><span>{{ peorDia().pct }}% del total</span></div>
      </div>
      <p class="tip">💡 <span>La gente compra más entre <b>{{ franja(mejorHora().hora) }}</b>, sobre todo los <b>{{ mejorDia().nombre.toLowerCase() }}</b>.
        Publica estados, historias y promociones <b>1 hora antes</b> (hacia las {{ hora12(mejorHora().hora - 1) }}) para llegar cuando más compran.
        @if (peorDia().pct < 10) { Los <b>{{ peorDia().nombre.toLowerCase() }}</b> se vende poco: buen día para un cupón o una promoción que los mueva. }</span></p>

      <div class="barra">
        <div class="seg" role="group" aria-label="Qué mostrar">
          <button type="button" [class.on]="metrica() === 'pedidos'" (click)="metrica.set('pedidos')">Pedidos</button>
          <button type="button" [class.on]="metrica() === 'ventas'" (click)="metrica.set('ventas')">Ventas $</button>
        </div>
        <small class="suave">{{ numero(total().pedidos) }} pedidos · {{ pesos(total().ventas) }} en el periodo · todos los pedidos no cancelados, sin los demás filtros</small>
      </div>
      <div class="mapa">
        <table>
          <thead><tr><th></th>@for (h of horas; track h) { <th>{{ horaCorta(h) }}</th> }</tr></thead>
          <tbody>
            @for (d of dias; track $index; let i = $index) {
              <tr>
                <th class="dia">{{ d.slice(0, 3) }}</th>
                @for (h of horas; track h) {
                  @if (celda(i + 1, h); as c) {
                    <td [style.background]="color(valor(c))" [style.color]="valor(c) / max() > 0.55 ? '#fff' : 'var(--text-soft)'" [class.pico]="esPico(i + 1, h)"
                      [title]="d + ' ' + hora12(h) + ': ' + c.pedidos + ' pedidos · ' + pesos(c.ventas)">{{ valor(c) ? (metrica() === 'pedidos' ? c.pedidos : corto(c.ventas)) : '' }}</td>
                  } @else { <td [style.background]="color(0)"></td> }
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="leyenda"><span>Menos</span><i [style.background]="color(0)"></i><i [style.background]="color(max() * 0.25)"></i><i [style.background]="color(max() * 0.5)"></i><i [style.background]="color(max() * 0.75)"></i><i [style.background]="color(max())"></i><span>Más</span></div>
    } @else {
      <p class="vacio-txt">No hay pedidos en este periodo.</p>
    }
  `,
})
export class HorasVentasComponent implements OnChanges {
  private sb = inject(SupabaseService);
  @Input() desde: string | null | undefined = null;
  @Input() hasta: string | null | undefined = null;

  readonly dias = DIAS;
  readonly horas = HORAS;
  readonly pesos = pesos;
  readonly numero = numero;
  celdas = signal<Celda[]>([]);
  cargando = signal(false);
  metrica = signal<'pedidos' | 'ventas'>('pedidos');
  private consulta = 0;

  private mapa = computed(() => new Map(this.celdas().map((c) => [c.dow * 100 + c.hora, c])));
  valor = (c: Celda) => (this.metrica() === 'pedidos' ? Number(c.pedidos) : Number(c.ventas));
  max = computed(() => Math.max(1, ...this.celdas().filter((c) => c.hora >= 6 && c.hora <= 22).map((c) => this.valor(c))));
  total = computed(() => this.celdas().reduce((t, c) => ({ pedidos: t.pedidos + Number(c.pedidos), ventas: t.ventas + Number(c.ventas) }), { pedidos: 0, ventas: 0 }));
  private porDia = computed(() => DIAS.map((nombre, i) => ({ nombre, valor: this.celdas().filter((c) => c.dow === i + 1).reduce((s, c) => s + this.valor(c), 0) })));
  private totalMetrica = computed(() => this.porDia().reduce((s, d) => s + d.valor, 0) || 1);
  mejorDia = computed(() => { const d = [...this.porDia()].sort((a, b) => b.valor - a.valor)[0]; return { ...d, pct: Math.round((d.valor / this.totalMetrica()) * 100) }; });
  peorDia = computed(() => { const d = [...this.porDia()].sort((a, b) => a.valor - b.valor)[0]; return { ...d, pct: Math.round((d.valor / this.totalMetrica()) * 100) }; });
  mejorHora = computed(() => {
    const por = HORAS.map((h) => ({ hora: h, n: this.celdas().filter((c) => c.hora === h).reduce((s, c) => s + Number(c.pedidos), 0) }));
    const m = por.sort((a, b) => b.n - a.n)[0];
    return { hora: m.hora, pct: Math.round((m.n / (this.total().pedidos || 1)) * 100) };
  });
  pico = computed(() => {
    const c = [...this.celdas()].sort((a, b) => Number(b.pedidos) - Number(a.pedidos))[0];
    return c ? { dia: DIAS[c.dow - 1], hora: c.hora, pedidos: Number(c.pedidos) } : { dia: '', hora: 0, pedidos: 0 };
  });

  ngOnChanges(): void {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    if (!this.desde || !this.hasta) return;
    const n = ++this.consulta;
    this.cargando.set(true);
    const { data } = await this.sb.client.rpc('ventas_por_hora', { p_desde: this.desde, p_hasta: this.hasta });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    this.celdas.set((data as Celda[]) ?? []);
  }

  celda(dow: number, h: number): Celda | undefined {
    return this.mapa().get(dow * 100 + h);
  }
  esPico(dow: number, h: number): boolean {
    const p = this.pico();
    return DIAS[dow - 1] === p.dia && h === p.hora;
  }
  color(v: number): string {
    const t = Math.min(1, v / this.max());
    return t <= 0 ? 'var(--surface-2)' : `color-mix(in srgb, var(--accent) ${Math.round(12 + t * 88)}%, var(--surface))`;
  }
  horaCorta(h: number): string {
    return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;
  }
  hora12(h: number): string {
    const x = ((h % 24) + 24) % 24;
    return `${x % 12 || 12} ${x < 12 ? 'a. m.' : 'p. m.'}`;
  }
  franja(h: number): string {
    return `${h % 12 || 12} y ${(h + 1) % 12 || 12} ${h + 1 < 12 ? 'a. m.' : 'p. m.'}`;
  }
  corto(v: number): string {
    return v >= 1_000_000 ? (v / 1_000_000).toFixed(1).replace('.0', '') + 'M' : v >= 1000 ? Math.round(v / 1000) + 'k' : String(v);
  }
}
