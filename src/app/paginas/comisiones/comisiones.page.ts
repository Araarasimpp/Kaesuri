import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronDownOutline, chevronUpOutline, closeOutline, refreshOutline } from 'ionicons/icons';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { RangoComponent, RangoFechas, diaCorto } from '../../shared/rango/rango.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { confirmar } from '../../shared/dialogo';
import { mensajeError, pesos } from '../../shared/formato';
import { finDiaColombia, formatoFechaCO, formatoHoraCO, inicioDiaColombia } from '../../shared/fecha-colombia';

interface Pendiente { vendedor_id: string; nombre: string; pedidos: number; total: number; desde: string; hasta: string }
/** Pedido por cobrar; las devoluciones vienen como líneas con comisión negativa */
interface PedidoComision { id: string; numero: number; dia: string; cliente_nombre: string; total: number; comision: number }
interface Liquidacion {
  id: number;
  vendedor_id: string;
  vendedor: { nombre: string } | null;
  desde: string | null;
  hasta: string | null;
  cantidad_pedidos: number;
  total: number;
  metodo: 'efectivo' | 'transferencia' | 'otro';
  comprobantes: string[];
  nota: string | null;
  pagado_at: string;
  pagado_por_nombre: string | null;
  anulada: boolean;
}

const METODOS = [
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'otro', label: 'Otro' },
] as const;

/**
 * Comisiones de los vendedores (como en Jasta). El admin ve cuánto se le debe a cada uno
 * (pedidos entregados aún sin pagar, menos los descuentos por devolución), registra el pago
 * con su comprobante, ve el historial y puede anular un pago. El vendedor ve lo que tiene
 * por cobrar y los pagos que le han hecho.
 */
@Component({
  selector: 'app-comisiones',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon, ComprobantesInputComponent, RangoComponent, SkeletonComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1000px; }
      .desde { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; color: var(--text-soft); }
      .desde input { width: auto; }
      .por-cobrar { display: flex; flex-direction: column; gap: 4px; padding: 18px 20px; border-radius: var(--radius-lg); background: var(--ok-wash); }
      .por-cobrar span { font-size: 12.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--efectivo-texto); }
      .por-cobrar strong { font-family: var(--mono-font); font-size: 30px; }
      .por-cobrar small { font-size: 13px; color: var(--text-soft); }
      .tarjeta .monto { font-family: var(--mono-font); font-size: 22px; font-weight: 700; }
      .mini { width: 100%; border-collapse: collapse; font-size: 13px; }
      .mini td { padding: 6px 4px; border-bottom: 1px solid var(--border-soft); }
      .mini td:last-child { text-align: right; font-family: var(--mono-font); white-space: nowrap; }
      .mini tr.devolucion td { color: var(--danger); }
      .metodos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .metodo { height: 42px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 14px; cursor: pointer; }
      .metodo.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .a-pagar { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 14px; border-radius: var(--radius); background: var(--ok-wash); }
      .a-pagar strong { font-family: var(--mono-font); font-size: 24px; }
      .hist-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
      .hist-head h2 { margin: 0; font-size: 15px; }
      tr.anulada td { opacity: .5; text-decoration: line-through; }
      .foto { width: 38px; height: 38px; padding: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--surface-2); cursor: zoom-in; }
      .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      td .t2 { display: block; font-size: 12px; color: var(--text-muted); text-decoration: none; }
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ esAdmin() ? 'Lo que se le debe a cada vendedor' : 'Tus comisiones' }}</p><h1>Comisiones</h1></div>
        <button class="b b-icono" aria-label="Actualizar" (click)="cargar()"><ion-icon name="refresh-outline"></ion-icon></button>
      </div>

      @if (esAdmin()) {
        <div class="desde">
          <span>Se cuentan las entregas desde</span>
          <input class="inp inp-chico" type="date" [(ngModel)]="desde" aria-label="Contar comisiones desde" />
          @if (desde !== desdeGuardado()) {
            <button class="b" (click)="guardarDesde()" [disabled]="ocupado()">Guardar</button>
          }
        </div>

        <h2 style="margin: 0; font-size: 15px">Por pagar</h2>
        @if (pendientes().length) {
          <div class="tarjetas">
            @for (c of pendientes(); track c.vendedor_id) {
              <article class="tarjeta">
                <div class="tarjeta-top">
                  <h3>{{ c.nombre }}</h3>
                  <span class="suave" style="font-size: 12px">{{ periodo(c.desde, c.hasta) }}</span>
                </div>
                <span class="monto">{{ pesos(c.total) }}</span>
                <p class="suave" style="margin: 0; font-size: 13px">{{ c.pedidos }} {{ c.pedidos === 1 ? 'pedido entregado' : 'pedidos entregados' }}</p>
                @if (abiertoV() === c.vendedor_id) {
                  <table class="mini">
                    @for (p of pedidosV(); track $index) {
                      <tr [class.devolucion]="esDevolucion(p)"><td class="suave">{{ dia(p.dia) }}</td><td>#{{ p.numero }} {{ p.cliente_nombre }}</td><td>{{ pesos(p.comision) }}</td></tr>
                    }
                  </table>
                }
                <div class="acciones">
                  <button class="b" (click)="verPedidos(c.vendedor_id)">
                    <ion-icon [name]="abiertoV() === c.vendedor_id ? 'chevron-up-outline' : 'chevron-down-outline'"></ion-icon>
                    {{ abiertoV() === c.vendedor_id ? 'Ocultar pedidos' : 'Ver pedidos' }}
                  </button>
                  <button class="b b-ok" (click)="abrirPago(c)">Registrar pago</button>
                </div>
              </article>
            }
          </div>
        } @else if (cargando()) {
          <app-skeleton variante="tarjetas" [cantidad]="2"></app-skeleton>
        } @else {
          <p class="vacio-txt">No hay comisiones pendientes por pagar.</p>
        }
      } @else {
        <div class="por-cobrar">
          <span>Por cobrar</span>
          <strong>{{ pesos(mio()?.total ?? 0) }}</strong>
          <small>{{ mio() ? mio()!.pedidos + (mio()!.pedidos === 1 ? ' pedido entregado' : ' pedidos entregados') + ' · ' + periodo(mio()!.desde, mio()!.hasta) : (cargando() ? 'Cargando…' : 'No tienes comisiones pendientes') }}</small>
        </div>
        @if (mio()) {
          <section class="panel">
            <div class="panel-head"><div><h2>Pedidos por cobrar</h2></div></div>
            <table class="mini">
              @for (p of pedidosV(); track $index) {
                <tr [class.devolucion]="esDevolucion(p)"><td class="suave">{{ dia(p.dia) }}</td><td>#{{ p.numero }} {{ p.cliente_nombre }}</td><td>{{ pesos(p.comision) }}</td></tr>
              }
            </table>
          </section>
        }
      }

      <div class="hist-head">
        <h2>{{ esAdmin() ? 'Pagos hechos' : 'Pagos que te han hecho' }}</h2>
        <app-rango inicial="mes" (cambio)="cambiarRango($event)"></app-rango>
      </div>
      <div class="tabla-wrap">
        <table class="tabla tarjetas-cel">
          <thead><tr><th>Fecha</th>@if (esAdmin()) {<th>Vendedor</th>}<th>Entregas</th><th class="der">Pedidos</th><th class="der">Total</th><th>Forma</th><th>Soporte</th>@if (esAdmin()) {<th></th>}</tr></thead>
          <tbody>
            @for (l of historial(); track l.id) {
              <tr [class.anulada]="l.anulada">
                <td class="suave" data-etq="Fecha">{{ cuando(l.pagado_at) }}<span class="t2">{{ l.pagado_por_nombre || '' }}</span></td>
                @if (esAdmin()) {<td data-etq="Vendedor">{{ l.vendedor?.nombre || '—' }}</td>}
                <td data-etq="Entregas">{{ periodo(l.desde, l.hasta) }}@if (l.nota) {<span class="t2">{{ l.nota }}</span>}</td>
                <td class="der num" data-etq="Pedidos">{{ l.cantidad_pedidos }}</td>
                <td class="der num" data-etq="Total"><strong>{{ pesos(l.total) }}</strong>@if (l.anulada) {<span class="t2">Anulado</span>}</td>
                <td data-etq="Forma">{{ metodo(l.metodo) }}</td>
                <td data-etq="Soporte">
                  @if (l.comprobantes.length) {
                    <button type="button" class="foto" (click)="verSoporte(l)" aria-label="Ver comprobante">
                      @if (fotos()[l.comprobantes[0]]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                    </button>
                  } @else { <span class="suave">—</span> }
                </td>
                @if (esAdmin()) {
                  <td data-etq="">@if (!l.anulada) {<button class="b" style="height: 32px; font-size: 12.5px" (click)="anular(l)">Anular</button>}</td>
                }
              </tr>
            } @empty {
              <tr><td [attr.colspan]="esAdmin() ? 8 : 6" class="suave">
                @if (cargandoHist()) { <app-skeleton variante="filas" [cantidad]="4"></app-skeleton> } @else { No hay pagos en este periodo. }
              </td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    @if (pagando(); as c) {
      <button class="velo" aria-label="Cerrar" (click)="pagando.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-pago">
        <div class="hoja-head"><h2 id="t-pago">Pagar a {{ c.nombre }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="pagando.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="campo"><label for="ph">Pagar las entregas hasta el</label>
            <input id="ph" type="date" [min]="c.desde" [max]="c.hasta" [(ngModel)]="pagoHasta" (ngModelChange)="hastaSel.set($event); error.set('')" /></div>
          <div class="a-pagar"><span>{{ aPagar().n }} {{ aPagar().n === 1 ? 'pedido' : 'pedidos' }}</span><strong>{{ pesos(aPagar().total) }}</strong></div>
          <div class="campo"><span class="etq">¿Cómo le pagaste?</span>
            <div class="metodos">
              @for (m of metodos; track m.id) {
                <button type="button" class="metodo" [class.on]="pagoMetodo() === m.id" (click)="pagoMetodo.set(m.id)">{{ m.label }}</button>
              }
            </div>
          </div>
          <app-comprobantes-input titulo="Comprobante del pago" pista="Pantallazo de la transferencia o foto del recibo firmado." [rutas]="pagoSoportes()"
            (cambio)="pagoSoportes.set($event); error.set('')"></app-comprobantes-input>
          <div class="campo"><label for="pn">Nota (opcional)</label><input id="pn" maxlength="200" [(ngModel)]="pagoNota" placeholder="Ej: semana del 20 al 26 de octubre" /></div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="pagando.set(null)">Cancelar</button>
          <button class="b b-ok" (click)="pagar()" [disabled]="ocupado() || !hayAlgo()">{{ ocupado() ? 'Guardando…' : 'Registrar pago de ' + pesos(aPagar().total) }}</button>
        </div>
      </div>
    }
  `,
})
export class ComisionesPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  pendientes = signal<Pendiente[]>([]);
  historial = signal<Liquidacion[]>([]);
  fotos = signal<Record<string, string>>({});
  cargando = signal(true);
  cargandoHist = signal(true);
  ocupado = signal(false);
  error = signal('');
  abiertoV = signal<string | null>(null);
  pedidosV = signal<PedidoComision[]>([]);
  desdeGuardado = signal('');
  desde = '';

  pagando = signal<Pendiente | null>(null);
  pagoHasta = '';
  pagoMetodo = signal<'efectivo' | 'transferencia' | 'otro'>('transferencia');
  pagoSoportes = signal<string[]>([]);
  pagoNota = '';
  private pedidosPago = signal<PedidoComision[]>([]);
  hastaSel = signal('');

  esAdmin = signal(false);
  private yo = signal<string | null>(null);
  mio = computed(() => this.pendientes().find((p) => p.vendedor_id === this.yo()) ?? null);
  /** Lo que entra en el pago: pedidos (y descuentos por devolución) hasta el día elegido */
  private incluidos = computed(() => {
    const h = this.hastaSel();
    return this.pedidosPago().filter((p) => !h || p.dia <= h);
  });
  aPagar = computed(() => {
    const lista = this.incluidos();
    return { n: lista.filter((p) => !this.esDevolucion(p)).length, total: lista.reduce((s, p) => s + Number(p.comision), 0) };
  });
  hayAlgo = computed(() => this.incluidos().length > 0);
  metodos = METODOS;
  pesos = pesos;
  private rango: RangoFechas | null = null;
  private listo: Promise<void>;

  constructor() {
    addIcons({ chevronDownOutline, chevronUpOutline, closeOutline, refreshOutline });
    // El rol se averigua antes de cargar (el historial puede pedirse primero desde app-rango)
    this.listo = this.sb.getCurrentProfile().then((p) => {
      this.yo.set(p?.id ?? null);
      this.esAdmin.set(!!p && rolesDe(p).includes('admin'));
    });
  }

  ngOnInit(): void {
    void this.listo.then(() => {
      void this.cargarPendientes();
      if (this.esAdmin()) {
        void this.sb.client.rpc('liquidar_desde').then(({ data }) => {
          this.desde = (data as string) ?? '';
          this.desdeGuardado.set(this.desde);
        });
      }
    });
  }

  async cargar(): Promise<void> {
    await Promise.all([this.cargarPendientes(), this.cargarHistorial()]);
  }

  private async cargarPendientes(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('liquidaciones_pendientes');
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.pendientes.set((data ?? []) as Pendiente[]);
    // El vendedor ve de una vez sus pedidos por cobrar
    const yo = this.yo();
    if (!this.esAdmin() && yo && this.mio()) this.pedidosV.set(await this.pedidosDe(yo));
    const abierto = this.abiertoV();
    if (this.esAdmin() && abierto) this.pedidosV.set(await this.pedidosDe(abierto));
  }

  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    void this.cargarHistorial();
  }

  private async cargarHistorial(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    let q = this.sb.client.from('liquidaciones').select('*, vendedor:profiles!liquidaciones_vendedor_id_fkey(nombre)');
    if (r.desde) q = q.gte('pagado_at', inicioDiaColombia(r.desde).toISOString());
    if (r.hasta) q = q.lte('pagado_at', finDiaColombia(r.hasta).toISOString());
    const { data, error } = await q.order('pagado_at', { ascending: false }).limit(200);
    this.cargandoHist.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const lista = (data ?? []) as unknown as Liquidacion[];
    this.historial.set(lista);
    const faltan = lista.flatMap((l) => (l.comprobantes ?? []).slice(0, 1)).filter((f) => !this.fotos()[f]);
    if (faltan.length) {
      const urls = await urlsComprobantes(this.sb.client, faltan);
      this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
    }
  }

  private async pedidosDe(vendedor: string, liquidacion: number | null = null): Promise<PedidoComision[]> {
    const { data, error } = await this.sb.client.rpc('liquidacion_pedidos', { p_vendedor: vendedor, p_liquidacion: liquidacion });
    if (error) {
      this.toast.error(mensajeError(error));
      return [];
    }
    return (data ?? []) as PedidoComision[];
  }

  async verPedidos(id: string): Promise<void> {
    if (this.abiertoV() === id) return this.abiertoV.set(null);
    this.pedidosV.set([]);
    this.abiertoV.set(id);
    this.pedidosV.set(await this.pedidosDe(id));
  }

  /** Línea de descuento por una devolución (comisión negativa) */
  esDevolucion(p: PedidoComision): boolean {
    return Number(p.comision) < 0 || p.cliente_nombre?.startsWith('Devolución');
  }

  async guardarDesde(): Promise<void> {
    if (!this.desde) return;
    const ok = await confirmar(`¿Contar comisiones de las entregas desde el ${diaCorto(this.desde)}? Lo entregado antes se toma como ya pagado.`, {
      titulo: 'Contar comisiones desde', aceptar: 'Guardar',
    });
    if (!ok) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('guardar_liquidar_desde', { p_dia: this.desde });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.desdeGuardado.set(this.desde);
    this.toast.ok('Listo: se cuentan las entregas desde el ' + diaCorto(this.desde));
    await this.cargarPendientes();
  }

  async abrirPago(c: Pendiente): Promise<void> {
    this.pagoHasta = c.hasta;
    this.hastaSel.set(c.hasta);
    this.pagoMetodo.set('transferencia');
    this.pagoSoportes.set([]);
    this.pagoNota = '';
    this.error.set('');
    this.pedidosPago.set([]);
    this.pagando.set(c);
    this.pedidosPago.set(await this.pedidosDe(c.vendedor_id));
  }

  async pagar(): Promise<void> {
    const c = this.pagando();
    if (!c) return;
    this.hastaSel.set(this.pagoHasta);
    const { n, total } = this.aPagar();
    if (!this.hayAlgo()) return this.error.set('No hay pedidos hasta ese día.');
    if (this.pagoMetodo() === 'transferencia' && !this.pagoSoportes().length) return this.error.set('Sube el comprobante de la transferencia.');
    const ok = await confirmar(`¿Registrar el pago de ${pesos(total)} a ${c.nombre}? (${n} ${n === 1 ? 'pedido' : 'pedidos'})`, {
      titulo: 'Registrar pago', aceptar: 'Registrar pago',
    });
    if (!ok) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('pagar_liquidacion', {
      p_vendedor: c.vendedor_id, p_hasta: this.pagoHasta, p_metodo: this.pagoMetodo(), p_comprobantes: this.pagoSoportes(), p_nota: this.pagoNota.trim(),
    });
    this.ocupado.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.toast.ok(`Pago de ${pesos(total)} a ${c.nombre} registrado`);
    this.pagando.set(null);
    this.abiertoV.set(null);
    await this.cargar();
  }

  async anular(l: Liquidacion): Promise<void> {
    const ok = await confirmar(
      `¿Anular el pago de ${pesos(l.total)} a ${l.vendedor?.nombre ?? 'el vendedor'}? Sus ${l.cantidad_pedidos} pedidos vuelven a quedar por pagar.`,
      { titulo: 'Anular pago', aceptar: 'Anular', peligro: true },
    );
    if (!ok) return;
    const { error } = await this.sb.client.rpc('anular_liquidacion', { p_id: l.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Pago anulado');
    await this.cargar();
  }

  verSoporte(l: Liquidacion): void {
    void urlsComprobantes(this.sb.client, l.comprobantes).then((urls) =>
      this.visor.abrir(urls.map((url, i) => ({ url, titulo: `Pago a ${l.vendedor?.nombre ?? ''} · ${pesos(l.total)}${urls.length > 1 ? ' · ' + (i + 1) : ''}` })), 0)
    );
  }

  periodo(desde: string | null, hasta: string | null): string {
    if (!desde) return '—';
    return !hasta || hasta === desde ? diaCorto(desde) : `${diaCorto(desde)} – ${diaCorto(hasta)}`;
  }

  dia(d: string): string {
    return diaCorto(d);
  }

  metodo(m: string): string {
    return METODOS.find((x) => x.id === m)?.label ?? m;
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
