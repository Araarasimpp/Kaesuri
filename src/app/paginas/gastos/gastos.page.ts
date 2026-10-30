import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addCircleOutline, banOutline, closeOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { RangoComponent, RangoFechas, diaCorto } from '../../shared/rango/rango.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { confirmar } from '../../shared/dialogo';
import { mensajeError, pesos } from '../../shared/formato';
import { hoyColombiaISO } from '../../shared/fecha-colombia';

export const CATEGORIAS_GASTO = [
  { id: 'arriendo', label: 'Arriendo' },
  { id: 'nomina', label: 'Nómina' },
  { id: 'publicidad', label: 'Publicidad' },
  { id: 'transporte', label: 'Transporte y gasolina' },
  { id: 'empaques', label: 'Empaques y bolsas' },
  { id: 'servicios', label: 'Servicios (luz, agua, internet)' },
  { id: 'mantenimiento', label: 'Mantenimiento' },
  { id: 'impuestos', label: 'Impuestos' },
  { id: 'otros', label: 'Otros' },
] as const;

interface Gasto {
  id: number;
  fecha: string;
  categoria: string;
  descripcion: string;
  valor: number;
  metodo: string;
  comprobantes: string[];
  creado_por_nombre: string | null;
  anulado: boolean;
}
interface Resumen {
  ganancia_tienda: number;
  gastos: number;
  utilidad: number;
  por_categoria: { categoria: string; total: number; n: number }[];
  lista: Gasto[];
}

/**
 * Gastos del negocio (arriendo, nómina, publicidad…) y la utilidad real del periodo:
 * la ganancia de la tienda en los pedidos entregados menos lo que costó operar.
 * Un gasto mal registrado no se borra: se anula (sigue en la lista tachado y no suma).
 */
@Component({
  selector: 'app-gastos',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon, ComprobantesInputComponent, RangoComponent, SkeletonComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 920px; }
      .resumen { position: relative; padding: 18px 22px 22px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; }
      .resumen::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 6px;
        background: radial-gradient(circle at 6px 6px, var(--bg) 3px, transparent 3.5px) 0 0 / 12px 12px repeat-x; }
      .resumen h2 { margin: 0 0 12px; font-size: 12px; font-weight: 650; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); text-align: center; }
      .renglon { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; font-size: 15px; }
      .renglon .lbl { white-space: nowrap; }
      .renglon .lbl small { display: block; font-size: 12px; color: var(--text-muted); font-weight: 400; }
      .renglon .punteado { flex: 1; border-bottom: 1px dotted var(--border-strong); transform: translateY(-4px); }
      .renglon .val { font-family: var(--mono-font); font-size: 17px; font-weight: 600; white-space: nowrap; }
      .renglon.gastos .val { color: var(--danger); }
      .renglon.total { margin-top: 6px; padding-top: 12px; border-top: 3px double var(--text); font-weight: 650; }
      .renglon.total .val { font-size: 24px; font-weight: 700; color: var(--efectivo-texto); }
      .renglon.total.neg .val { color: var(--danger); }
      .barras { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
      .barras li { display: grid; grid-template-columns: minmax(0, 190px) minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 13px; }
      .barras .nombre { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .barras .pista { display: block; height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
      .barras .relleno { display: block; height: 100%; border-radius: 5px; background: var(--oro); }
      .barras .v { text-align: right; font-family: var(--mono-font); font-weight: 650; white-space: nowrap; }
      .gastos-lista { list-style: none; margin: 0; padding: 0; }
      .gasto { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 11px 0; border-bottom: var(--perfora); }
      .gasto:last-child { border-bottom: 0; }
      .gasto .t1 { display: block; font-size: 14px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gasto .t2 { display: block; font-size: 12px; color: var(--text-muted); }
      .gasto .monto { font-family: var(--mono-font); font-size: 14px; font-weight: 650; color: var(--danger); white-space: nowrap; }
      .gasto .lado { display: flex; gap: 6px; align-items: center; }
      .gasto.anulado .t1, .gasto.anulado .monto { text-decoration: line-through; color: var(--text-muted); }
      .gasto.anulado .t1, .gasto.anulado .monto, .gasto.anulado .foto { opacity: .6; }
      .etq-anulado { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 8px; background: var(--surface-2); color: var(--text-soft);
        font-size: 11px; font-weight: 650; text-decoration: none; vertical-align: 1px; }
      .foto { width: 36px; height: 36px; padding: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--surface-2); cursor: zoom-in; }
      .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .quitar { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 16px; }
      .quitar:hover { color: var(--danger); background: var(--danger-wash); }
      .metodos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .metodo { height: 42px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 14px; cursor: pointer; }
      .metodo.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
      @media (max-width: 640px) { .barras li { grid-template-columns: minmax(0, 120px) minmax(0, 1fr) auto; } .renglon.total .val { font-size: 21px; } }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ etiqueta() }}</p><h1>Gastos</h1></div>
        <button class="b b-pri" (click)="abrirForm()"><ion-icon name="add-circle-outline"></ion-icon>Registrar gasto</button>
      </div>

      <app-rango inicial="mes" (cambio)="cambiarRango($event)"></app-rango>

      <section class="resumen" aria-labelledby="t-res" [attr.aria-busy]="cargando()">
        <h2 id="t-res">Utilidad real</h2>
        <div class="renglon"><span class="lbl">Ganancia de la tienda<small>Pedidos entregados, sin la parte de los vendedores</small></span><span class="punteado"></span>
          <span class="val">{{ pesos(r()?.ganancia_tienda) }}</span></div>
        <div class="renglon gastos"><span class="lbl">Gastos<small>{{ vigentes() }} {{ vigentes() === 1 ? 'gasto' : 'gastos' }}</small></span><span class="punteado"></span>
          <span class="val">− {{ pesos(r()?.gastos) }}</span></div>
        <div class="renglon total" [class.neg]="(r()?.utilidad ?? 0) < 0"><span class="lbl">Utilidad real<small>{{ (r()?.utilidad ?? 0) < 0 ? 'Se gastó más de lo que se ganó' : 'Lo que de verdad queda' }}</small></span>
          <span class="punteado"></span><span class="val">{{ pesos(r()?.utilidad) }}</span></div>
      </section>

      @if (r()?.por_categoria?.length) {
        <section class="panel" aria-labelledby="t-cat">
          <div class="panel-head"><div><h2 id="t-cat">En qué se gastó</h2></div></div>
          <ul class="barras">
            @for (c of r()!.por_categoria; track c.categoria) {
              <li><span class="nombre">{{ categoria(c.categoria) }}</span><span class="pista"><span class="relleno" [style.width.%]="(c.total / maxCat()) * 100"></span></span>
                <span class="v">{{ pesos(c.total) }}</span></li>
            }
          </ul>
        </section>
      }

      <section class="panel" aria-labelledby="t-lista">
        <div class="panel-head"><div><h2 id="t-lista">Gastos del periodo</h2></div></div>
        @if (r()?.lista?.length) {
          <ul class="gastos-lista">
            @for (g of r()!.lista; track g.id) {
              <li class="gasto" [class.anulado]="g.anulado">
                <span style="min-width: 0">
                  <span class="t1">{{ g.descripcion }}</span>
                  <span class="t2">{{ dia(g.fecha) }} · {{ categoria(g.categoria) }} · {{ metodo(g.metodo) }}@if (g.creado_por_nombre) { · {{ g.creado_por_nombre }} }
                    @if (g.anulado) { <span class="etq-anulado">Anulado</span> }</span>
                </span>
                <span class="monto">− {{ pesos(g.valor) }}</span>
                <span class="lado">
                  @if (g.comprobantes.length) {
                    <button type="button" class="foto" (click)="verSoporte(g)" aria-label="Ver soporte">
                      @if (fotos()[g.comprobantes[0]]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                    </button>
                  }
                  @if (!g.anulado) {
                    <button type="button" class="quitar" (click)="anular(g)" [attr.aria-label]="'Anular gasto ' + g.descripcion" title="Anular"><ion-icon name="ban-outline"></ion-icon></button>
                  }
                </span>
              </li>
            }
          </ul>
        } @else if (cargando()) {
          <app-skeleton variante="filas" [cantidad]="5"></app-skeleton>
        } @else {
          <p class="vacio-txt">No hay gastos registrados en este periodo.</p>
        }
      </section>
    </div>

    @if (form()) {
      <button class="velo" aria-label="Cerrar" (click)="form.set(false)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-gasto">
        <div class="hoja-head"><h2 id="t-gasto">Registrar gasto</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="form.set(false)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="fila-campos">
            <div class="campo"><label for="gv">Valor</label><input id="gv" class="num" type="number" inputmode="numeric" min="0" step="1000" [(ngModel)]="valor" /></div>
            <div class="campo"><label for="gf">Fecha</label><input id="gf" type="date" [max]="hoy" [(ngModel)]="fecha" /></div>
          </div>
          <div class="campo"><label for="gc">Categoría</label>
            <select id="gc" [(ngModel)]="cat">
              @for (c of categorias; track c.id) { <option [value]="c.id">{{ c.label }}</option> }
            </select>
          </div>
          <div class="campo"><label for="gd">¿En qué se gastó?</label><input id="gd" maxlength="300" [(ngModel)]="descripcion" placeholder="Ej: Arriendo del local, octubre" /></div>
          <div class="campo"><span class="etq">¿Cómo se pagó?</span>
            <div class="metodos">
              @for (m of metodos; track m.id) {
                <button type="button" class="metodo" [class.on]="met() === m.id" (click)="met.set(m.id)">{{ m.label }}</button>
              }
            </div>
          </div>
          <app-comprobantes-input [obligatorio]="false" titulo="Factura o recibo (opcional)" pista="Foto de la factura, el recibo o el pantallazo del pago." [rutas]="soportes()"
            (cambio)="soportes.set($event)"></app-comprobantes-input>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="form.set(false)">Cancelar</button>
          <button class="b b-pri" (click)="guardar()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Registrar gasto' }}</button>
        </div>
      </div>
    }
  `,
})
export class GastosPage {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  r = signal<Resumen | null>(null);
  cargando = signal(true);
  etiqueta = signal('');
  fotos = signal<Record<string, string>>({});
  form = signal(false);
  ocupado = signal(false);
  error = signal('');
  maxCat = computed(() => Math.max(1, ...(this.r()?.por_categoria ?? []).map((c) => Number(c.total))));
  /** Gastos que suman (los anulados se muestran pero no cuentan) */
  vigentes = computed(() => (this.r()?.lista ?? []).filter((g) => !g.anulado).length);

  categorias = CATEGORIAS_GASTO;
  metodos = [
    { id: 'efectivo', label: 'Efectivo' },
    { id: 'transferencia', label: 'Transferencia' },
    { id: 'otro', label: 'Otro' },
  ];
  hoy = hoyColombiaISO();
  valor: number | null = null;
  fecha = this.hoy;
  cat = 'arriendo';
  descripcion = '';
  met = signal('efectivo');
  soportes = signal<string[]>([]);
  pesos = pesos;

  private rango: RangoFechas | null = null;
  private consulta = 0;

  constructor() {
    addIcons({ addCircleOutline, banOutline, closeOutline });
  }

  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    this.etiqueta.set(r.etiqueta);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    const n = ++this.consulta;
    const { data, error } = await this.sb.client.rpc('gastos_resumen', { p_desde: r.desde || '2020-01-01', p_hasta: r.hasta || this.hoy });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const res = data as Resumen;
    this.r.set(res);
    const faltan = (res?.lista ?? []).flatMap((g) => (g.comprobantes ?? []).slice(0, 1)).filter((f) => !this.fotos()[f]);
    if (faltan.length) {
      const urls = await urlsComprobantes(this.sb.client, faltan);
      this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
    }
  }

  abrirForm(): void {
    this.valor = null;
    this.fecha = this.hoy;
    this.descripcion = '';
    this.met.set('efectivo');
    this.soportes.set([]);
    this.error.set('');
    this.form.set(true);
  }

  async guardar(): Promise<void> {
    const v = Number(this.valor) || 0;
    if (v <= 0) return this.error.set('Escribe el valor del gasto.');
    if (!this.descripcion.trim()) return this.error.set('Escribe en qué se gastó.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('registrar_gasto', {
      p_fecha: this.fecha || this.hoy, p_categoria: this.cat, p_descripcion: this.descripcion.trim(), p_valor: v, p_metodo: this.met(), p_comprobantes: this.soportes(),
    });
    this.ocupado.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.toast.ok(`Gasto de ${pesos(v)} registrado`);
    this.form.set(false);
    await this.cargar();
  }

  async anular(g: Gasto): Promise<void> {
    const ok = await confirmar(`¿Anular el gasto "${g.descripcion}" de ${pesos(g.valor)}? Queda en la lista tachado y ya no suma.`, {
      titulo: 'Anular gasto', aceptar: 'Anular', peligro: true,
    });
    if (!ok) return;
    const { error } = await this.sb.client.rpc('anular_gasto', { p_id: g.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Gasto anulado');
    await this.cargar();
  }

  verSoporte(g: Gasto): void {
    void urlsComprobantes(this.sb.client, g.comprobantes).then((urls) =>
      this.visor.abrir(urls.map((url) => ({ url, titulo: `${g.descripcion} · ${pesos(g.valor)}` })), 0)
    );
  }

  categoria(id: string): string {
    return CATEGORIAS_GASTO.find((c) => c.id === id)?.label ?? id;
  }

  metodo(id: string): string {
    return this.metodos.find((m) => m.id === id)?.label ?? id;
  }

  dia(f: string): string {
    return diaCorto(f);
  }
}
