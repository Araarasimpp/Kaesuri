import { Component, Input, computed, signal } from '@angular/core';

export interface Segmento { etiqueta: string; valor: number; color: string }

/**
 * Gráfica de dona en SVG (sin librerías): cada segmento con su color y un hueco entre ellos.
 * En el centro va un valor y una etiqueta. Al pasar el mouse por un segmento se ve su parte.
 */
@Component({
  selector: 'app-dona',
  standalone: true,
  styles: [
    `
      :host { display: block; }
      .caja { position: relative; width: var(--tam, 150px); aspect-ratio: 1; margin: 0 auto; }
      svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
      circle { fill: none; transition: stroke-width 160ms ease, opacity 160ms ease; }
      .pista { stroke: var(--surface-2); }
      .seg { cursor: default; }
      .seg.apagado { opacity: 0.35; }
      .centro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 18%; pointer-events: none; }
      .centro strong { font-family: var(--mono-font); font-size: var(--tam-valor, 18px); font-weight: 700; line-height: 1.1; color: var(--text); white-space: nowrap; }
      .centro span { margin-top: 3px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); }
      .leyenda { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .leyenda li { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; font-size: 13px; color: var(--text-soft); }
      .leyenda i { width: 10px; height: 10px; border-radius: 3px; }
      .leyenda b { font-family: var(--mono-font); font-weight: 600; color: var(--text); }
      .leyenda li.on { color: var(--text); }
    `,
  ],
  template: `
    <div class="caja" [style.--tam]="tam + 'px'" [style.--tam-valor]="tamValor + 'px'">
      <svg viewBox="0 0 100 100" role="img" [attr.aria-label]="etiquetaAria()">
        <circle class="pista" cx="50" cy="50" [attr.r]="r" [attr.stroke-width]="grosor" />
        @for (a of arcos(); track a.etiqueta) {
          <circle class="seg" cx="50" cy="50" [attr.r]="r" [attr.stroke]="a.color" [attr.stroke-width]="enfocado() === a.etiqueta ? grosor + 3 : grosor"
            stroke-linecap="round" [attr.stroke-dasharray]="a.largo + ' ' + circ" [attr.stroke-dashoffset]="-a.inicio"
            [class.apagado]="enfocado() && enfocado() !== a.etiqueta" (mouseenter)="enfocado.set(a.etiqueta)" (mouseleave)="enfocado.set(null)">
            <title>{{ a.etiqueta }}: {{ a.pct }}%</title>
          </circle>
        }
      </svg>
      <div class="centro">
        @if (enfocadoSeg(); as e) { <strong>{{ e.pct }}%</strong><span>{{ e.etiqueta }}</span> }
        @else { <strong>{{ valor }}</strong>@if (etiqueta) { <span>{{ etiqueta }}</span> } }
      </div>
    </div>
    @if (leyenda) {
      <ul class="leyenda">
        @for (a of arcos(); track a.etiqueta) {
          <li [class.on]="enfocado() === a.etiqueta" (mouseenter)="enfocado.set(a.etiqueta)" (mouseleave)="enfocado.set(null)">
            <i [style.background]="a.color"></i><span>{{ a.etiqueta }}</span><b>{{ formato ? formato(a.valor) : a.valor }}</b>
          </li>
        }
      </ul>
    }
  `,
})
export class DonaComponent {
  private segs = signal<Segmento[]>([]);
  @Input() set segmentos(v: Segmento[] | null | undefined) { this.segs.set((v ?? []).filter((s) => Number(s.valor) > 0)); }
  /** Texto grande del centro */
  @Input() valor: string | number = '';
  /** Texto pequeño debajo del valor */
  @Input() etiqueta = '';
  @Input() tam = 150;
  @Input() tamValor = 18;
  @Input() leyenda = true;
  /** Cómo mostrar cada valor en la leyenda (ej. pesos) */
  @Input() formato: ((n: number) => string) | null = null;

  readonly r = 40;
  readonly grosor = 11;
  readonly circ = 2 * Math.PI * 40;
  enfocado = signal<string | null>(null);

  arcos = computed(() => {
    const l = this.segs();
    const total = l.reduce((s, x) => s + Number(x.valor), 0);
    if (!total) return [];
    // Hueco entre segmentos (en largo de arco), descontando lo que ocupan las puntas redondas
    const hueco = l.length > 1 ? this.grosor + 3 : 0;
    let inicio = 0;
    return l.map((x) => {
      const parte = (Number(x.valor) / total) * this.circ;
      const largo = Math.max(0.001, parte - hueco);
      const a = { ...x, inicio: inicio + hueco / 2, largo, pct: Math.round((Number(x.valor) / total) * 100) };
      inicio += parte;
      return a;
    });
  });
  enfocadoSeg = computed(() => this.arcos().find((a) => a.etiqueta === this.enfocado()) ?? null);
  etiquetaAria = computed(() => this.arcos().map((a) => `${a.etiqueta} ${a.pct}%`).join(', '));
}
