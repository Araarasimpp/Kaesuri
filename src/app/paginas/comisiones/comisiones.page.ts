import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronDownOutline, chevronForwardOutline, chevronUpOutline, closeOutline, refreshOutline } from 'ionicons/icons';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { RangoComponent, RangoFechas, diaCorto } from '../../shared/rango/rango.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { confirmar } from '../../shared/dialogo';
import { mensajeError, pesos } from '../../shared/formato';
import { finDiaColombia, formatoFechaCO, formatoHoraCO, hoyColombiaISO, inicioDiaColombia } from '../../shared/fecha-colombia';
import { DatosComprobante, generarComprobanteEgreso, numeroComprobante } from '../../shared/comprobante-egreso';
import { DatosPago, resumenCuenta } from '../../shared/datos-pago/datos-pago';

interface Pendiente { vendedor_id: string; nombre: string; pedidos: number; total: number; desde: string | null; hasta: string | null; anteriores: number }

/** Suma días a una fecha YYYY-MM-DD */
function sumarDias(d: string, n: number): string {
  const f = new Date(d + 'T12:00:00Z');
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
}
/** La última semana completa de sábado a viernes (las comisiones se pagan así): termina el último viernes antes de hoy */
function semanaPasada(): { desde: string; hasta: string } {
  const hoy = hoyColombiaISO();
  const dow = new Date(hoy + 'T12:00:00Z').getUTCDay(); // 0 domingo … 5 viernes, 6 sábado
  const hasta = sumarDias(hoy, -(((dow - 5 + 7) % 7) || 7));
  return { desde: sumarDias(hasta, -6), hasta };
}
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
 * Comisiones de los vendedores (como en Jasta), por semana de sábado a viernes. El admin ve cuánto
 * se le debe a cada uno (pedidos creados en el periodo y ya entregados, aún sin pagar, menos los descuentos por devolución), registra el pago
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
      .periodo-com { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; gap: 8px; max-width: 560px; }
      .periodo-com label { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 11.5px; font-weight: 600; color: var(--text-muted); }
      .periodo-com .inp { height: 40px; width: 100%; min-width: 0; padding: 0 8px; font-size: 14px; }
      .periodo-com .b { height: 40px; }
      .periodo-com .b:not(.b-icono) { grid-column: 1 / -1; justify-self: start; }
      .cuenta-v { display: flex; flex-direction: column; gap: 3px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); font-size: 13.5px; }
      .cv-tit { font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); }
      .cv-num { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 650; }
      .cv-falta { color: var(--oro-texto); }
      .soporte-acc { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .b.chico { height: 32px; padding: 0 10px; font-size: 12.5px; }
      .antes { margin: 0; padding: 6px 10px; border-radius: var(--radius-sm); background: var(--oro-wash); color: var(--oro-texto); font-size: 12.5px; }
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
      .total-v { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 16px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); }
      .total-v span { font-size: 13px; color: var(--text-soft); }
      .total-v strong { font-family: var(--mono-font); font-size: 20px; }
      .det-monto { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 12px 14px; border-radius: var(--radius); background: var(--ok-wash); }
      .det-monto strong { font-family: var(--mono-font); font-size: 24px; }
      .det-datos { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 13.5px; }
      .det-datos dt { color: var(--text-muted); }
      .det-datos dd { margin: 0; }
      .det-fotos { display: flex; gap: 8px; flex-wrap: wrap; }
      .det-fotos .foto { width: 72px; height: 72px; }
      .sin-sop { margin: 0; padding: 8px 12px; border-radius: var(--radius-sm); background: var(--oro-wash); color: var(--oro-texto); font-size: 13px; }
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ esAdmin() ? 'Lo que se le debe a cada vendedor' : 'Tus comisiones' }}</p><h1>Comisiones</h1></div>
        <button class="b b-icono" aria-label="Actualizar" (click)="cargar()"><ion-icon name="refresh-outline"></ion-icon></button>
      </div>

      <div class="periodo-com">
        <button class="b b-icono" aria-label="Semana anterior" (click)="moverSemana(-7)"><ion-icon name="chevron-back-outline"></ion-icon></button>
        <label>Desde<input class="inp" type="date" [value]="desdeP()" [max]="hastaP()" (change)="cambiarPeriodo('desde', $any($event.target).value)" /></label>
        <label>Hasta<input class="inp" type="date" [value]="hastaP()" [min]="desdeP()" (change)="cambiarPeriodo('hasta', $any($event.target).value)" /></label>
        <button class="b b-icono" aria-label="Semana siguiente" (click)="moverSemana(7)"><ion-icon name="chevron-forward-outline"></ion-icon></button>
        @if (!esSemanaPasada()) { <button class="b" (click)="irSemanaPasada()">Semana pasada</button> }
      </div>
      <p class="ayuda" style="margin: -4px 0 0">Las comisiones se pagan por semana, de sábado a viernes. Aquí ves {{ esAdmin() ? 'lo que se le debe a cada uno' : 'lo que te deben' }} por los pedidos <strong>creados</strong> del {{ periodo(desdeP(), hastaP()) }} que ya se entregaron.</p>

      @if (esAdmin()) {
        <div class="desde">
          <span>Se cuentan los pedidos creados desde</span>
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
                <p class="suave" style="margin: 0; font-size: 13px">{{ c.pedidos }} {{ c.pedidos === 1 ? 'pedido creado' : 'pedidos creados' }} en estas fechas y ya entregados</p>
                @if (c.anteriores) { <p class="antes">Además tiene {{ pesos(c.anteriores) }} sin pagar de antes del {{ periodo(desdeP(), null) }}. Muévete a semanas anteriores con ◀ para pagarlas.</p> }
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
                  @if (c.total) { <button class="b b-ok" (click)="abrirPago(c)">Registrar pago</button> }
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
        @if (totalMio() !== null) {
          <div class="total-v">
            <span>En total te deben<br /><small>Todo lo entregado que aún no te han pagado, de cualquier semana</small></span>
            <strong>{{ pesos(totalMio()!) }}</strong>
          </div>
        }
        <div class="por-cobrar">
          <span>Por cobrar</span>
          <strong>{{ pesos(mio()?.total ?? 0) }}</strong>
          <small>{{ mio() ? mio()!.pedidos + (mio()!.pedidos === 1 ? ' pedido entregado' : ' pedidos entregados') + ' · ' + periodo(desdeP(), hastaP()) : (cargando() ? 'Cargando…' : 'No tienes comisiones pendientes en estas fechas') }}</small>
          @if (mio()?.anteriores) { <small>Además tienes {{ pesos(mio()!.anteriores) }} sin cobrar de antes del {{ periodo(desdeP(), null) }}.</small> }
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
                  <div class="soporte-acc">
                    @if (l.comprobantes.length) {
                      <button type="button" class="foto" (click)="verSoporte(l)" aria-label="Ver soporte del pago">
                        @if (fotos()[l.comprobantes[0]]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                      </button>
                    } @else if (esAdmin() && !l.anulada) {
                      <button type="button" class="b chico" (click)="abrirSoporte(l)">Subir soporte</button>
                    } @else { <span class="suave">—</span> }
                    <button type="button" class="b chico" (click)="verDetalle(l)">Ver pago</button>
                    <button type="button" class="b chico" [disabled]="generando() === l.id" (click)="descargarComprobante(l)"
                      [attr.aria-label]="'Descargar comprobante de egreso ' + numero(l.id)">{{ generando() === l.id ? 'Generando…' : numero(l.id) + ' · PDF' }}</button>
                  </div>
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

    @if (detalle(); as l) {
      <button class="velo" aria-label="Cerrar" (click)="cerrarDetalle()"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-det">
        <div class="hoja-head"><h2 id="t-det">Pago {{ numero(l.id) }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="cerrarDetalle()"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="det-monto"><span>{{ l.anulada ? 'Pago anulado' : (esAdmin() ? 'Pagado a ' + (l.vendedor?.nombre ?? '') : 'Te pagaron') }}</span><strong>{{ pesos(l.total) }}</strong></div>
          <dl class="det-datos">
            <dt>Fecha</dt><dd>{{ cuando(l.pagado_at) }}</dd>
            <dt>Pedidos del</dt><dd>{{ periodo(l.desde, l.hasta) }}</dd>
            <dt>Forma</dt><dd>{{ metodo(l.metodo) }}</dd>
            @if (l.pagado_por_nombre) { <dt>Pagó</dt><dd>{{ l.pagado_por_nombre }}</dd> }
            @if (l.nota) { <dt>Nota</dt><dd>{{ l.nota }}</dd> }
          </dl>
          <div class="campo"><span class="etq">Comprobante del pago</span>
            @if (l.comprobantes.length) {
              <div class="det-fotos">
                @for (f of l.comprobantes; track f; let i = $index) {
                  <button type="button" class="foto" (click)="verSoporte(l, i)" [attr.aria-label]="'Ver comprobante ' + (i + 1)">
                    @if (fotos()[f]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                  </button>
                }
              </div>
            } @else {
              <p class="sin-sop">{{ esAdmin() ? 'Este pago no tiene soporte todavía.' : 'Todavía no han subido el comprobante. Te llega un aviso cuando lo suban.' }}</p>
            }
          </div>
          <div class="campo"><span class="etq">{{ l.cantidad_pedidos }} {{ l.cantidad_pedidos === 1 ? 'pedido pagado' : 'pedidos pagados' }}</span>
            @if (pedidosDet().length) {
              <table class="mini">
                @for (p of pedidosDet(); track $index) {
                  <tr [class.devolucion]="esDevolucion(p)"><td class="suave">{{ dia(p.dia) }}</td><td>#{{ p.numero }} {{ p.cliente_nombre }}</td><td>{{ pesos(p.comision) }}</td></tr>
                }
              </table>
            } @else { <small class="suave">Cargando…</small> }
          </div>
        </div>
        <div class="hoja-pie">
          @if (esAdmin() && !l.anulada && !l.comprobantes.length) { <button class="b" (click)="cerrarDetalle(); abrirSoporte(l)">Subir soporte</button> }
          <button class="b b-pri" [disabled]="generando() === l.id" (click)="descargarComprobante(l)">{{ generando() === l.id ? 'Generando…' : 'Descargar PDF' }}</button>
        </div>
      </div>
    }

    @if (soporteDe(); as l) {
      <button class="velo" aria-label="Cerrar" (click)="soporteDe.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-sop">
        <div class="hoja-head"><h2 id="t-sop">Soporte del pago {{ numero(l.id) }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="soporteDe.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <p class="ayuda" style="margin: 0">{{ l.vendedor?.nombre }} · {{ pesos(l.total) }} · {{ metodo(l.metodo) }}. Sube el pantallazo de la transferencia o la foto del recibo firmado.</p>
          <app-comprobantes-input [obligatorio]="true" titulo="Soporte del pago" [rutas]="soporteFotos()" (cambio)="soporteFotos.set($event)"></app-comprobantes-input>
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="soporteDe.set(null)">Cancelar</button>
          <button class="b b-pri" (click)="guardarSoporte()" [disabled]="ocupado() || !soporteFotos().length">{{ ocupado() ? 'Guardando…' : 'Guardar soporte' }}</button>
        </div>
      </div>
    }

    @if (pagando(); as c) {
      <button class="velo" aria-label="Cerrar" (click)="pagando.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-pago">
        <div class="hoja-head"><h2 id="t-pago">Pagar a {{ c.nombre }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="pagando.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <p class="ayuda" style="margin: 0">Se pagan los pedidos del <strong>{{ periodo(desdeP(), hastaP()) }}</strong>.</p>
          <div class="cuenta-v">
            @if (cuentaV(); as dp) {
              @if (dp.numero_cuenta) {
                <span class="cv-tit">Cuenta de {{ c.nombre.split(' ')[0] }}</span>
                <span class="cv-num">{{ resumenCuenta(dp) }} <button type="button" class="b chico" (click)="copiar(dp.numero_cuenta!)">Copiar</button></span>
                @if (dp.titular) { <small>A nombre de {{ dp.titular }}</small> }
                @if (dp.documento) { <small>C.C. {{ dp.documento }}</small> }
              } @else {
                <span class="cv-falta">{{ c.nombre.split(' ')[0] }} no ha puesto su cuenta. Pídele que la agregue en Mi perfil → Datos para tus pagos.</span>
              }
            } @else { <small class="suave">Cargando la cuenta…</small> }
          </div>
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
          <div class="campo"><label for="pn">Nota (opcional)</label><input id="pn" maxlength="200" [(ngModel)]="pagoNota" placeholder="Ej: semana del 24 al 30 de octubre" /></div>
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
  private ruta = inject(ActivatedRoute);
  private router = inject(Router);

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
  /** Periodo de las comisiones: arranca en la última semana de sábado a viernes */
  desdeP = signal(semanaPasada().desde);
  hastaP = signal(semanaPasada().hasta);
  esSemanaPasada = computed(() => this.desdeP() === semanaPasada().desde && this.hastaP() === semanaPasada().hasta);
  private enPeriodo = (dia: string) => dia >= this.desdeP() && dia <= this.hastaP();
  /** Lo que entra en el pago: pedidos (y descuentos por devolución) del periodo */
  private incluidos = computed(() => this.pedidosPago().filter((p) => this.enPeriodo(p.dia)));
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
    addIcons({ chevronBackOutline, chevronDownOutline, chevronForwardOutline, chevronUpOutline, closeOutline, refreshOutline });
    // El rol se averigua antes de cargar (el historial puede pedirse primero desde app-rango)
    this.listo = this.sb.getCurrentProfile().then((p) => {
      this.yo.set(p?.id ?? null);
      this.esAdmin.set(!!p && rolesDe(p).includes('admin'));
    });
  }

  ngOnInit(): void {
    void this.listo.then(() => {
      void this.cargarPendientes();
      // Desde el aviso "Te pagaron…" se abre ese pago con su comprobante
      const pago = Number(this.ruta.snapshot.queryParamMap.get('pago'));
      if (pago) void this.abrirPagoPorId(pago);
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

  cambiarPeriodo(campo: 'desde' | 'hasta', v: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    if (campo === 'desde') {
      this.desdeP.set(v);
      if (v > this.hastaP()) this.hastaP.set(v);
    } else {
      this.hastaP.set(v);
      if (v < this.desdeP()) this.desdeP.set(v);
    }
    void this.cargarPendientes();
  }

  moverSemana(dias: number): void {
    this.desdeP.set(sumarDias(this.desdeP(), dias));
    this.hastaP.set(sumarDias(this.hastaP(), dias));
    void this.cargarPendientes();
  }

  irSemanaPasada(): void {
    this.desdeP.set(semanaPasada().desde);
    this.hastaP.set(semanaPasada().hasta);
    void this.cargarPendientes();
  }

  private async cargarPendientes(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('comisiones_periodo', { p_desde: this.desdeP(), p_hasta: this.hastaP() });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.pendientes.set((data ?? []) as Pendiente[]);
    // El vendedor ve de una vez sus pedidos por cobrar
    const yo = this.yo();
    if (!this.esAdmin() && yo) void this.cargarTotalMio();
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
    await this.cargarFotos(lista.flatMap((l) => (l.comprobantes ?? []).slice(0, 1)));
  }
  private async cargarFotos(rutas: string[]): Promise<void> {
    const faltan = rutas.filter((f) => !this.fotos()[f]);
    if (!faltan.length) return;
    const urls = await urlsComprobantes(this.sb.client, faltan);
    this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
  }

  /** Lo que se le debe a la vendedor sumando todas las semanas, hasta hoy */
  totalMio = signal<number | null>(null);
  private async cargarTotalMio(): Promise<void> {
    const { data } = await this.sb.client.rpc('comisiones_periodo', { p_desde: '2000-01-01', p_hasta: hoyColombiaISO() });
    const yo = ((data ?? []) as Pendiente[])[0];
    this.totalMio.set(yo ? Number(yo.total) + Number(yo.anteriores) : 0);
  }

  /** Detalle de un pago: comprobante adjunto y los pedidos que cubrió */
  detalle = signal<Liquidacion | null>(null);
  pedidosDet = signal<PedidoComision[]>([]);

  async verDetalle(l: Liquidacion): Promise<void> {
    this.pedidosDet.set([]);
    this.detalle.set(l);
    void this.cargarFotos(l.comprobantes);
    this.pedidosDet.set(await this.pedidosDe(l.vendedor_id, l.id));
  }

  cerrarDetalle(): void {
    this.detalle.set(null);
    if (this.ruta.snapshot.queryParamMap.has('pago')) void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  private async abrirPagoPorId(id: number): Promise<void> {
    const { data, error } = await this.sb.client.from('liquidaciones').select('*, vendedor:profiles!liquidaciones_vendedor_id_fkey(nombre)').eq('id', id).maybeSingle();
    if (error) return this.toast.error(mensajeError(error));
    if (data) await this.verDetalle(data as unknown as Liquidacion);
  }

  private async pedidosDe(vendedor: string, liquidacion: number | null = null): Promise<PedidoComision[]> {
    const { data, error } = await this.sb.client.rpc('liquidacion_pedidos', { p_vendedor: vendedor, p_liquidacion: liquidacion });
    if (error) {
      this.toast.error(mensajeError(error));
      return [];
    }
    // Los pendientes se muestran solo los del periodo elegido
    const lista = (data ?? []) as PedidoComision[];
    return liquidacion === null ? lista.filter((p) => this.enPeriodo(p.dia)) : lista;
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
    const ok = await confirmar(`¿Contar comisiones de los pedidos creados desde el ${diaCorto(this.desde)}? Lo de antes se toma como ya pagado.`, {
      titulo: 'Contar comisiones desde', aceptar: 'Guardar',
    });
    if (!ok) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('guardar_liquidar_desde', { p_dia: this.desde });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.desdeGuardado.set(this.desde);
    this.toast.ok('Listo: se cuentan los pedidos creados desde el ' + diaCorto(this.desde));
    await this.cargarPendientes();
  }

  async abrirPago(c: Pendiente): Promise<void> {
    this.pagoHasta = this.hastaP();
    this.hastaSel.set(this.hastaP());
    this.pagoMetodo.set('transferencia');
    this.pagoSoportes.set([]);
    const f = (d: string) => formatoFechaCO(d + 'T12:00:00-05:00', { day: 'numeric', month: 'long' });
    this.pagoNota = `Semana del ${f(this.desdeP())} al ${f(this.hastaP())}`;
    this.error.set('');
    this.pedidosPago.set([]);
    this.cuentaV.set(null);
    this.pagando.set(c);
    void this.sb.client.rpc('datos_pago_de', { p_usuario: c.vendedor_id }).then(({ data }) => this.cuentaV.set((data ?? {}) as DatosPago));
    this.pedidosPago.set(await this.pedidosDe(c.vendedor_id));
  }

  async pagar(): Promise<void> {
    const c = this.pagando();
    if (!c) return;
    this.hastaSel.set(this.pagoHasta);
    const { n, total } = this.aPagar();
    if (!this.hayAlgo()) return this.error.set('No hay pedidos por pagar en estas fechas.');
    if (this.pagoMetodo() === 'transferencia' && !this.pagoSoportes().length) return this.error.set('Sube el comprobante de la transferencia.');
    const ok = await confirmar(`¿Registrar el pago de ${pesos(total)} a ${c.nombre}? (${n} ${n === 1 ? 'pedido' : 'pedidos'})`, {
      titulo: 'Registrar pago', aceptar: 'Registrar pago',
    });
    if (!ok) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('pagar_comisiones', {
      p_vendedor: c.vendedor_id, p_desde: this.desdeP(), p_hasta: this.hastaP(), p_metodo: this.pagoMetodo(), p_comprobantes: this.pagoSoportes(), p_nota: this.pagoNota.trim(),
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

  /** Comprobante de egreso en PDF (para la contabilidad y la DIAN) */
  generando = signal<number | null>(null);
  soporteDe = signal<Liquidacion | null>(null);
  soporteFotos = signal<string[]>([]);
  numero = numeroComprobante;

  async descargarComprobante(l: Liquidacion): Promise<void> {
    this.generando.set(l.id);
    try {
      const { data, error } = await this.sb.client.rpc('comprobante_liquidacion', { p_id: l.id });
      if (error) throw error;
      const d = data as DatosComprobante & { comprobantes: string[] };
      // Sin cédula el comprobante no sirve ante la DIAN: el admin la puede poner ahí mismo
      if (this.esAdmin() && d.vendedor && !d.vendedor.documento) {
        const doc = prompt(`Cédula de ${d.vendedor.nombre} (sale en el comprobante; se guarda para los próximos):`)?.trim();
        if (doc) {
          const r = await this.sb.client.rpc('guardar_documento', { p_usuario: l.vendedor_id, p_documento: doc });
          if (!r.error) d.vendedor.documento = doc;
        }
      }
      const soportes = d.comprobantes?.length ? (await urlsComprobantes(this.sb.client, d.comprobantes)).filter(Boolean) : [];
      const archivo = await generarComprobanteEgreso(d, soportes);
      const url = URL.createObjectURL(archivo);
      const a = document.createElement('a');
      a.href = url;
      a.download = archivo.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!d.negocio?.nit) this.toast.error('Falta el NIT del negocio: ponlo en Configuración para que salga en el comprobante.');
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.generando.set(null);
    }
  }

  /** Cuenta del vendedor a la que se le está pagando */
  cuentaV = signal<DatosPago | null>(null);
  resumenCuenta = resumenCuenta;

  async copiar(t: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(t.replace(/[\s-]/g, ''));
      this.toast.ok('Número copiado');
    } catch {
      this.toast.error('No se pudo copiar');
    }
  }

  abrirSoporte(l: Liquidacion): void {
    this.soporteFotos.set([]);
    this.soporteDe.set(l);
  }

  async guardarSoporte(): Promise<void> {
    const l = this.soporteDe();
    if (!l) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('agregar_soporte_liquidacion', { p_id: l.id, p_comprobantes: this.soporteFotos() });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Soporte guardado');
    this.soporteDe.set(null);
    await this.cargarHistorial();
    const d = this.detalle();
    if (d?.id === l.id) this.detalle.set(this.historial().find((x) => x.id === l.id) ?? d);
  }

  verSoporte(l: Liquidacion, inicio = 0): void {
    void urlsComprobantes(this.sb.client, l.comprobantes).then((urls) =>
      this.visor.abrir(urls.map((url, i) => ({ url, titulo: `Pago a ${l.vendedor?.nombre ?? ''} · ${pesos(l.total)}${urls.length > 1 ? ' · ' + (i + 1) : ''}` })), inicio)
    );
  }

  /** Fechas exactas (sin "hoy" ni "ayer"): ej. "sáb 24 oct – vie 30 oct" */
  periodo(desde: string | null, hasta: string | null): string {
    if (!desde) return '—';
    const f = (d: string) => formatoFechaCO(d + 'T12:00:00-05:00', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
    return !hasta || hasta === desde ? f(desde) : `${f(desde)} – ${f(hasta)}`;
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
