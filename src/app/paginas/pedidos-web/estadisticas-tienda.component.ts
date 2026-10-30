import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { mensajeError, numero, pesos, urlMini } from '../../shared/formato';
import { formatoFechaCO } from '../../shared/fecha-colombia';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

interface Estadisticas {
  resumen: { visitas: number; agregaron: number; pedidos: number; confirmados: number; ventas: number };
  por_dia: { dia: string; visitas: number; pedidos: number }[];
  productos: { id: string; nombre: string; imagen_url: string | null; vistos: number; agregados: number }[];
  vendedoras: { nombre: string; visitas: number; pedidos: number; confirmados: number; ventas: number }[] | null;
}

/**
 * Cómo le va al catálogo: cuántos lo abrieron, cuántos agregaron algo, cuántos pidieron
 * y cuánto se vendió; las visitas de cada día y los productos que más miran.
 * El vendedor ve su catálogo; el admin, todos (y la tabla por vendedor).
 */
@Component({
  selector: 'app-estadisticas-tienda',
  standalone: true,
  imports: [SkeletonComponent],
  styles: [
    `
      :host { display: block; }
      .cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
      .chips { display: flex; gap: 6px; }
      .chips button { height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft);
        font: inherit; font-size: 13px; cursor: pointer; }
      .chips button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .embudo { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
      .paso { display: grid; grid-template-columns: 150px minmax(0, 1fr) 64px; gap: 10px; align-items: center; font-size: 13.5px; }
      .paso .etq { color: var(--text-soft); }
      .riel { height: 14px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
      .barra { height: 100%; border-radius: 0 4px 4px 0; background: var(--accent); min-width: 2px; transition: width 400ms var(--ease); }
      .paso .num { text-align: right; font-weight: 700; color: var(--text); }
      .paso small { display: block; font-size: 11.5px; font-weight: 450; color: var(--text-muted); }
      .vendido { margin-top: 14px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
      .vendido strong { font-family: var(--mono-font); font-size: 26px; letter-spacing: -0.02em; }
      .vendido span { font-size: 13px; color: var(--text-muted); }
      h3 { margin: 20px 0 8px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
      .dias { position: relative; display: flex; align-items: flex-end; gap: 3px; height: 160px; padding-top: 48px; box-sizing: border-box; border-bottom: 1px solid var(--border); }
      .col { flex: 1; height: 100%; display: flex; align-items: flex-end; cursor: default; }
      .col i { display: block; width: 100%; border-radius: 4px 4px 0 0; background: var(--accent); min-height: 2px; opacity: .85; }
      .col.hoy i, .col:hover i { opacity: 1; }
      .col.cero i { background: var(--border-strong); }
      .ejes { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--text-muted); }
      .tip { position: absolute; top: 0; transform: translateX(-50%); padding: 6px 9px; border-radius: 8px; background: var(--text); color: var(--bg);
        font-size: 12px; line-height: 1.35; white-space: nowrap; pointer-events: none; z-index: 2; }
      .prods { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .prods li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 7px 0; border-bottom: var(--perfora); font-size: 13px; }
      .prods li:last-child { border-bottom: 0; }
      .prods img, .prods .ini { width: 40px; height: 40px; border-radius: 8px; object-fit: contain; background: #fff; }
      .prods .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .prods small { color: var(--text-muted); white-space: nowrap; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; font-size: 11.5px; font-weight: 650; color: var(--text-muted); padding: 6px 4px; border-bottom: 1px solid var(--border); }
      td { padding: 7px 4px; border-bottom: var(--perfora); }
      .der { text-align: right; font-variant-numeric: tabular-nums; }
      .vacio { margin: 12px 0 0; font-size: 13.5px; color: var(--text-soft); }
    `,
  ],
  template: `
    <section class="panel">
      <div class="cab">
        <h2 class="seccion-titulo" style="margin: 0">{{ esAdmin() ? 'Cómo les va a los catálogos' : 'Cómo le va a tu catálogo' }}</h2>
        <div class="chips" role="group" aria-label="Periodo">
          <button [class.on]="dias() === 7" (click)="cambiar(7)">7 días</button>
          <button [class.on]="dias() === 30" (click)="cambiar(30)">30 días</button>
        </div>
      </div>

      @if (e(); as d) {
        <div class="embudo">
          @for (p of embudo(); track p.etq) {
            <div class="paso">
              <span class="etq">{{ p.etq }}</span>
              <span class="riel"><span class="barra" [style.width.%]="p.ancho"></span></span>
              <span class="num">{{ numero(p.valor) }}@if (p.pct !== null) {<small>{{ p.pct }}%</small>}</span>
            </div>
          }
        </div>
        <div class="vendido"><strong>{{ pesos(d.resumen.ventas) }}</strong><span>vendido con pedidos confirmados del catálogo</span></div>

        @if (!d.resumen.visitas) {
          <p class="vacio">Todavía nadie ha abierto {{ esAdmin() ? 'los catálogos' : 'tu catálogo' }} en estos días. Comparte el enlace y aquí vas a ver quién lo mira.</p>
        } @else {
          <h3>Visitas por día</h3>
          <div class="dias" (mouseleave)="sobre.set(null)">
            @for (x of d.por_dia; track x.dia; let i = $index) {
              <div class="col" [class.cero]="!x.visitas" [class.hoy]="i === d.por_dia.length - 1" (mouseenter)="sobre.set(i)"
                [attr.aria-label]="fecha(x.dia) + ': ' + x.visitas + ' visitas, ' + x.pedidos + ' pedidos'">
                <i [style.height.%]="(x.visitas / maxDia()) * 100"></i>
              </div>
            }
            @if (sobre() !== null) {
              <div class="tip" [style.left.%]="((sobre()! + 0.5) / d.por_dia.length) * 100">
                <b>{{ fecha(d.por_dia[sobre()!].dia) }}</b><br />{{ d.por_dia[sobre()!].visitas }} visitas · {{ d.por_dia[sobre()!].pedidos }} pedidos
              </div>
            }
          </div>
          <div class="ejes"><span>{{ fecha(d.por_dia[0].dia) }}</span><span>Hoy</span></div>

          @if (d.productos.length) {
            <h3>Lo que más miran</h3>
            <ul class="prods">
              @for (p of d.productos; track p.id) {
                <li>
                  @if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <span class="ini"></span> }
                  <span class="nom">{{ p.nombre }}</span>
                  <small>{{ p.vistos }} lo vieron · {{ p.agregados }} lo agregaron</small>
                </li>
              }
            </ul>
          }
        }

        @if (d.vendedoras?.length) {
          <h3>Por vendedor</h3>
          <table>
            <thead><tr><th>Catálogo</th><th class="der">Visitas</th><th class="der">Pedidos</th><th class="der">Confirmados</th><th class="der">Vendido</th></tr></thead>
            <tbody>
              @for (v of d.vendedoras; track v.nombre) {
                <tr><td>{{ v.nombre }}</td><td class="der">{{ v.visitas }}</td><td class="der">{{ v.pedidos }}</td><td class="der">{{ v.confirmados }}</td><td class="der">{{ pesos(v.ventas) }}</td></tr>
              }
            </tbody>
          </table>
        }
      } @else {
        @if (error()) { <p class="vacio">{{ error() }}</p> } @else { <app-skeleton variante="filas" [cantidad]="4"></app-skeleton> }
      }
    </section>
  `,
})
export class EstadisticasTiendaComponent implements OnInit {
  private sb = inject(SupabaseService);

  e = signal<Estadisticas | null>(null);
  dias = signal(7);
  sobre = signal<number | null>(null);
  error = signal('');
  esAdmin = signal(false);
  pesos = pesos;
  numero = numero;
  urlMini = urlMini;

  maxDia = computed(() => Math.max(1, ...(this.e()?.por_dia ?? []).map((x) => x.visitas)));

  /** Embudo: de cada paso, qué parte de las visitas llegó ahí */
  embudo = computed(() => {
    const r = this.e()?.resumen;
    if (!r) return [];
    const base = Math.max(1, r.visitas);
    const fila = (etq: string, valor: number, conPct = true) => ({
      etq, valor, ancho: (valor / base) * 100, pct: conPct && r.visitas ? Math.round((valor / r.visitas) * 100) : null,
    });
    return [
      fila('Abrieron el catálogo', r.visitas, false),
      fila('Agregaron algo', r.agregaron),
      fila('Hicieron el pedido', r.pedidos),
      fila('Confirmados', r.confirmados),
    ];
  });

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((p) => this.esAdmin.set(!!p && rolesDe(p).includes('admin')));
    void this.cargar();
  }

  cambiar(d: number): void {
    this.dias.set(d);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('tienda_estadisticas', { p_dias: this.dias() });
    if (error) return this.error.set(mensajeError(error));
    this.e.set(data as Estadisticas);
  }

  fecha(d: string): string {
    return formatoFechaCO(d + 'T12:00:00-05:00', { weekday: 'short', day: 'numeric', month: 'short' });
  }
}
