import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, walletOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { mensajeError, pesos } from '../../shared/formato';
import { confirmar } from '../../shared/dialogo';
import { formatoHoraCO } from '../../shared/fecha-colombia';
import { diaCorto } from '../../shared/rango/rango.component';
import { PesosDirective } from '../../shared/pesos/pesos.directive';

interface Movimiento { id: number; tipo: 'entrada' | 'salida'; concepto: string; valor: number; nota: string | null; comprobantes: string[]; quien: string | null; hora: string; mio: boolean }
interface Cierre {
  base: number; esperado: number; contado: number; diferencia: number; nota: string | null; quien: string | null; hora: string;
  recoger: number; entradas: number; salidas: number;
  entregado_at: string | null; entregado_por: string | null; recibido_at: string | null; recibido_por: string | null; recibido: number | null;
}
interface Caja {
  fecha: string; admin: boolean; ventas: number; total: number; efectivo: number; transferencia: number;
  base: number; entradas: number; salidas: number; movimientos: Movimiento[]; cierre: Cierre | null;
  por_recibir: { fecha: string; recoger: number; entregado_por: string | null; entregado_at: string }[];
}
interface Historial { fecha: string; base: number; efectivo: number; entradas: number; salidas: number; esperado: number; contado: number; diferencia: number; recoger: number; quien: string | null; entregado_por: string | null; recibido: number | null; recibido_at: string | null; nota: string | null }

const CONCEPTOS = {
  salida: ['Domicilio', 'Bolsas y empaques', 'Aseo', 'Almuerzo o refrigerio', 'Pago a proveedor', 'Transporte'],
  entrada: ['Cambio / sencillo', 'Abono de un cliente', 'Plata que dejó el admin'],
};

/**
 * Caja del local de un día. La base es fija (la pone el admin). Quien vende registra entradas y
 * salidas de caja (las salidas van a Gastos), cuenta el efectivo al cerrar, deja la base y entrega
 * el resto; el admin confirma que lo recibió.
 */
@Component({
  selector: 'app-cuadre-caja',
  standalone: true,
  imports: [FormsModule, IonIcon, PesosDirective, ComprobantesInputComponent],
  styles: [
    `
      .caja { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .fila { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
      .fila ion-icon { font-size: 22px; color: var(--text-muted); flex-shrink: 0; }
      .txt { flex: 1 1 200px; min-width: 0; font-size: 14px; }
      .txt strong { display: block; }
      .txt small { display: block; margin-top: 2px; color: var(--text-muted); font-size: 12.5px; }
      .caja.ok { border-color: color-mix(in srgb, var(--efectivo-texto) 40%, transparent); background: var(--ok-wash); }
      .caja.ok .txt strong, .caja.ok ion-icon { color: var(--efectivo-texto); }
      .caja.falta { border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: var(--danger-wash); }
      .caja.falta .txt strong, .caja.falta ion-icon { color: var(--danger); }
      .caja.sobra { border-color: color-mix(in srgb, var(--oro-texto) 40%, transparent); background: var(--oro-wash); }
      .caja.sobra .txt strong, .caja.sobra ion-icon { color: var(--oro-texto); }
      .botones { display: flex; flex-wrap: wrap; gap: 8px; }
      .botones .b { flex: 1 1 140px; }
      .base-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-soft); }
      .base-chip strong { font-family: var(--mono-font); color: var(--text); }
      .link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; }
      .link.peligro { color: var(--danger); }
      .recoge { padding: 10px 12px; border-radius: var(--radius); background: var(--surface); border: 1px dashed var(--border-strong); font-size: 14px; line-height: 1.45; }
      .recoge strong { font-family: var(--mono-font); }
      .movs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .movs li { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; padding: 7px 0; border-top: 1px solid var(--border-soft); font-size: 13.5px; }
      .movs small { display: block; color: var(--text-muted); font-size: 12px; }
      .movs .v { font-family: var(--mono-font); white-space: nowrap; font-weight: 650; }
      .movs .v.salida { color: var(--danger); }
      .movs .v.entrada { color: var(--efectivo-texto); }
      .por-recibir { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding: 12px 14px; border-radius: var(--radius-lg); background: var(--oro-wash); border: 1px solid color-mix(in srgb, var(--oro-texto) 35%, transparent); }
      .por-recibir div { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; }
      .cuenta { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); font-size: 14px; }
      .cuenta span:nth-child(even) { text-align: right; font-family: var(--mono-font); }
      .cuenta .fin { font-weight: 700; padding-top: 6px; border-top: 1px dashed var(--border-strong); }
      .resultado { padding: 12px 14px; border-radius: var(--radius); font-size: 15px; font-weight: 650; text-align: center; }
      .resultado.ok { background: var(--ok-wash); color: var(--efectivo-texto); }
      .resultado.falta { background: var(--danger-wash); color: var(--danger); }
      .resultado.sobra { background: var(--oro-wash); color: var(--oro-texto); }
      .num-grande { font-family: var(--mono-font); font-size: 20px !important; height: 52px !important; }
      .tipos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .tipos button { height: 46px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; font-size: 14.5px; cursor: pointer; }
      .tipos button.on.salida { border-color: var(--danger); background: var(--danger-wash); color: var(--danger); font-weight: 700; }
      .tipos button.on.entrada { border-color: var(--efectivo-texto); background: var(--ok-wash); color: var(--efectivo-texto); font-weight: 700; }
      .rapidos { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
      .rapidos button { height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft); font: inherit; font-size: 13px; cursor: pointer; }
      .rapidos button.on { border-color: var(--accent); color: var(--accent); background: var(--accent-wash); }
      .hist { width: 100%; border-collapse: collapse; font-size: 13px; }
      .hist th, .hist td { padding: 7px 6px; border-bottom: 1px solid var(--border-soft); text-align: right; white-space: nowrap; }
      .hist th:first-child, .hist td:first-child { text-align: left; }
      .hist th { font-size: 11.5px; color: var(--text-muted); font-weight: 650; text-transform: uppercase; }
      .hist .neg { color: var(--danger); }
      .hist .pos { color: var(--oro-texto); }
      .tabla-scroll { overflow-x: auto; }
    `,
  ],
  template: `
    @if (caja(); as c) {
      @if (c.admin && c.por_recibir.length) {
        <div class="por-recibir" role="alert">
          <strong>Te entregaron plata de la caja</strong>
          @for (p of c.por_recibir; track p.fecha) {
            <div><span>{{ dia(p.fecha) }} · {{ p.entregado_por || 'Alguien' }} te entregó <strong>{{ pesos(p.recoger) }}</strong></span>
              <button class="b b-ok" (click)="recibir(p.fecha, p.recoger)">Recibí</button></div>
          }
        </div>
      }

      <div class="caja" [class]="'caja ' + estado()">
        <div class="fila">
          <ion-icon name="wallet-outline" aria-hidden="true"></ion-icon>
          <div class="txt">
            @if (c.cierre; as k) {
              <strong>{{ k.diferencia === 0 ? 'Caja cuadrada ✓' : k.diferencia < 0 ? 'Faltan ' + pesos(-k.diferencia) + ' en la caja' : 'Sobran ' + pesos(k.diferencia) + ' en la caja' }}</strong>
              <small>{{ k.quien || 'Alguien' }} contó {{ pesos(k.contado) }} a las {{ hora(k.hora) }} · debía haber {{ pesos(k.esperado) }}{{ k.nota ? ' · "' + k.nota + '"' : '' }}</small>
            } @else {
              <strong>Caja sin cuadrar</strong>
              <small>Efectivo de las ventas: {{ pesos(c.efectivo) }}{{ c.salidas ? ' · salidas ' + pesos(c.salidas) : '' }}{{ c.entradas ? ' · entradas ' + pesos(c.entradas) : '' }}. Al cerrar, cuenta el efectivo.</small>
            }
          </div>
          <span class="base-chip">Base fija <strong>{{ pesos(c.base) }}</strong>
            @if (c.admin) { <button class="link" (click)="abrirBase()">Cambiar</button> }</span>
        </div>

        @if (c.cierre; as k) {
          @if (movidoDespues()) { <p class="recoge" role="alert">Hubo movimientos de caja después del conteo: vuelve a contar para que cuadre.</p> }
          @if (k.recibido_at) {
            <p class="recoge">✓ {{ k.recibido_por || 'El admin' }} recibió <strong>{{ pesos(k.recibido ?? k.recoger) }}</strong>{{ k.entregado_por ? ' de ' + k.entregado_por : '' }}. En la caja quedó la base de {{ pesos(k.base) }}.</p>
          } @else if (k.entregado_at) {
            <p class="recoge">{{ k.entregado_por }} entregó <strong>{{ pesos(k.recoger) }}</strong> a las {{ hora(k.entregado_at) }}. Falta que el admin confirme que lo recibió.</p>
          } @else {
            <p class="recoge">@if (k.contado < k.base) { ⚠️ Lo contado no alcanza para la base de {{ pesos(k.base) }}: deja todo en la caja y avísale al admin. } @else { Deja <strong>{{ pesos(k.base) }}</strong> de base en la caja y recoge <strong>{{ pesos(k.recoger) }}</strong>. }</p>
          }
        }

        @if (c.movimientos.length) {
          <ul class="movs" aria-label="Movimientos de caja">
            @for (m of c.movimientos; track m.id) {
              <li>
                <span>{{ m.tipo === 'salida' ? 'Salida' : 'Entrada' }} · {{ m.concepto }}
                  <small>{{ hora(m.hora) }}{{ m.quien ? ' · ' + m.quien : '' }}{{ m.nota ? ' · ' + m.nota : '' }}
                    @if (m.comprobantes.length) { · <button class="link" (click)="verSoporte(m)">Ver recibo</button> }
                    @if (c.admin || (m.mio && !c.cierre?.entregado_at)) { · <button class="link peligro" (click)="borrarMov(m)">Borrar</button> }</small></span>
                <span class="v" [class]="'v ' + m.tipo">{{ m.tipo === 'salida' ? '−' : '+' }} {{ pesos(m.valor) }}</span>
              </li>
            }
          </ul>
        }

        <div class="botones">
          @if (!c.cierre?.recibido_at) {
            <button class="b" (click)="abrirMov()">Movimiento de caja</button>
            <button class="b" [class.b-pri]="!c.cierre" (click)="abrir()">{{ c.cierre ? 'Volver a contar' : 'Cuadrar caja' }}</button>
          }
          @if (c.cierre && !c.cierre.entregado_at && c.cierre.recoger > 0) {
            <button class="b b-ok" [disabled]="ocupado()" (click)="entregar()">Entregué {{ pesos(c.cierre.recoger) }}</button>
          }
          @if (c.admin && c.cierre && !c.cierre.recibido_at && c.cierre.entregado_at) {
            <button class="b b-ok" [disabled]="ocupado()" (click)="recibir(c.fecha, c.cierre.recoger)">Recibí {{ pesos(c.cierre.recoger) }}</button>
          }
        </div>
        @if (c.admin) { <button class="link" style="align-self: flex-start" (click)="abrirHistorial()">Ver historial de la caja</button> }
      </div>
    }

    <!-- Cuadrar -->
    @if (abierta() && caja(); as c) {
      <button class="velo" aria-label="Cerrar" (click)="abierta.set(false)"></button>
      <aside class="hoja" role="dialog" aria-labelledby="t-caja">
        <div class="hoja-head">
          <h2 id="t-caja">Cuadrar caja</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="abierta.set(false)"><ion-icon name="close-outline"></ion-icon></button>
        </div>
        <div class="hoja-body">
          <div class="campo">
            <label for="cj-cont">Efectivo que contaste ahora (todo, con la base)</label>
            <input id="cj-cont" pesos class="num-grande" [ngModel]="contado()" (ngModelChange)="contado.set($event)" placeholder="Cuenta billetes y monedas" />
          </div>
          <div class="cuenta">
            <span>Base fija</span><span>{{ pesos(c.base) }}</span>
            <span>+ Efectivo de {{ c.ventas }} {{ c.ventas === 1 ? 'venta' : 'ventas' }}</span><span>{{ pesos(c.efectivo) }}</span>
            @if (c.entradas) { <span>+ Entradas</span><span>{{ pesos(c.entradas) }}</span> }
            @if (c.salidas) { <span>− Salidas</span><span>− {{ pesos(c.salidas) }}</span> }
            <span class="fin">Debe haber</span><span class="fin">{{ pesos(esperado()) }}</span>
          </div>
          @if (contado() !== null) {
            <p class="resultado" [class]="'resultado ' + estadoDe(diferencia())" role="status">
              {{ diferencia() === 0 ? 'Cuadra exacto ✓' : diferencia() < 0 ? 'Faltan ' + pesos(-diferencia()) : 'Sobran ' + pesos(diferencia()) }}
            </p>
            <p class="recoge">@if ((contado() ?? 0) < c.base) { ⚠️ No alcanza para la base de {{ pesos(c.base) }}. } @else { Deja <strong>{{ pesos(c.base) }}</strong> de base y recoge <strong>{{ pesos((contado() ?? 0) - c.base) }}</strong>. }</p>
          }
          <div class="campo">
            <label for="cj-nota">Nota {{ diferencia() !== 0 && contado() !== null ? '(cuéntale al admin qué pasó)' : '(opcional)' }}</label>
            <textarea id="cj-nota" rows="2" maxlength="300" [(ngModel)]="nota" placeholder="Ej: un cliente pagó con un billete roto"></textarea>
          </div>
          <p class="ayuda" style="margin: 0">Las transferencias ({{ pesos(c.transferencia) }}) no se cuentan aquí: no están en la caja. Si pagaste algo con plata de la caja, regístralo antes en "Movimiento de caja".</p>
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="abierta.set(false)">Cancelar</button>
          <button class="b b-pri" (click)="guardar()" [disabled]="ocupado() || contado() === null">{{ ocupado() ? 'Guardando…' : 'Guardar cuadre' }}</button>
        </div>
      </aside>
    }

    <!-- Movimiento de caja -->
    @if (movAbierto()) {
      <button class="velo" aria-label="Cerrar" (click)="movAbierto.set(false)"></button>
      <aside class="hoja hoja-centro" role="dialog" aria-labelledby="t-mov">
        <div class="hoja-head">
          <h2 id="t-mov">Movimiento de caja</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="movAbierto.set(false)"><ion-icon name="close-outline"></ion-icon></button>
        </div>
        <div class="hoja-body">
          <div class="tipos" role="radiogroup" aria-label="Tipo">
            <button type="button" class="salida" [class.on]="tipo() === 'salida'" role="radio" [attr.aria-checked]="tipo() === 'salida'" (click)="tipo.set('salida'); concepto = ''">− Salida (gasto)</button>
            <button type="button" class="entrada" [class.on]="tipo() === 'entrada'" role="radio" [attr.aria-checked]="tipo() === 'entrada'" (click)="tipo.set('entrada'); concepto = ''">+ Entrada</button>
          </div>
          <p class="ayuda" style="margin: 0">{{ tipo() === 'salida' ? 'Plata que sacaste de la caja para pagar algo del negocio. Queda como gasto.' : 'Plata que entró a la caja y no es una venta.' }}</p>
          <div class="campo"><label for="mv-c">Concepto</label>
            <input id="mv-c" maxlength="80" [(ngModel)]="concepto" [placeholder]="tipo() === 'salida' ? 'Ej: Domicilio' : 'Ej: Cambio / sencillo'" />
            <div class="rapidos">@for (x of conceptos(); track x) { <button type="button" [class.on]="concepto === x" (click)="concepto = x">{{ x }}</button> }</div>
          </div>
          <div class="campo"><label for="mv-v">Valor</label><input id="mv-v" pesos class="num-grande" [(ngModel)]="valor" placeholder="$ 0" /></div>
          <div class="campo"><label for="mv-n">Nota (opcional)</label><input id="mv-n" maxlength="300" [(ngModel)]="notaMov" /></div>
          <app-comprobantes-input [obligatorio]="false" titulo="Foto del recibo (opcional)" pista="Si te dieron factura o recibo, tómale foto." [rutas]="soportes()" (cambio)="soportes.set($event)"></app-comprobantes-input>
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="movAbierto.set(false)">Cancelar</button>
          <button class="b b-pri" [disabled]="ocupado()" (click)="guardarMov()">{{ ocupado() ? 'Guardando…' : 'Registrar ' + (tipo() === 'salida' ? 'salida' : 'entrada') }}</button>
        </div>
      </aside>
    }

    <!-- Base fija (admin) -->
    @if (baseAbierta()) {
      <button class="velo" aria-label="Cerrar" (click)="baseAbierta.set(false)"></button>
      <aside class="hoja hoja-centro" role="dialog" aria-labelledby="t-base">
        <div class="hoja-head">
          <h2 id="t-base">Base de la caja</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="baseAbierta.set(false)"><ion-icon name="close-outline"></ion-icon></button>
        </div>
        <div class="hoja-body">
          <p class="ayuda" style="margin: 0">Es la plata que siempre se queda en la caja para dar vueltas. Es la misma todos los días y solo tú la puedes cambiar.</p>
          <div class="campo"><label for="bs-v">Base fija</label><input id="bs-v" pesos class="num-grande" [(ngModel)]="nuevaBase" placeholder="$ 0" /></div>
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="baseAbierta.set(false)">Cancelar</button>
          <button class="b b-pri" [disabled]="ocupado()" (click)="guardarBase()">Guardar</button>
        </div>
      </aside>
    }

    <!-- Historial (admin) -->
    @if (historial(); as h) {
      <button class="velo" aria-label="Cerrar" (click)="historial.set(null)"></button>
      <aside class="hoja" role="dialog" aria-labelledby="t-hist">
        <div class="hoja-head">
          <h2 id="t-hist">Historial de la caja</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="historial.set(null)"><ion-icon name="close-outline"></ion-icon></button>
        </div>
        <div class="hoja-body">
          <p class="ayuda" style="margin: 0">Últimos 30 días.</p>
          <div class="tabla-scroll">
            <table class="hist">
              <thead><tr><th>Día</th><th>Ventas ef.</th><th>Entradas</th><th>Salidas</th><th>Contado</th><th>Dif.</th><th>Recogido</th><th>Recibido</th></tr></thead>
              <tbody>
                @for (r of h; track r.fecha) {
                  <tr>
                    <td>{{ dia(r.fecha) }}</td><td>{{ pesos(r.efectivo) }}</td><td>{{ pesos(r.entradas) }}</td><td>{{ pesos(r.salidas) }}</td><td>{{ pesos(r.contado) }}</td>
                    <td [class.neg]="r.diferencia < 0" [class.pos]="r.diferencia > 0">{{ r.diferencia === 0 ? '✓' : pesos(r.diferencia) }}</td>
                    <td>{{ pesos(r.recoger) }}</td><td>{{ r.recibido_at ? pesos(r.recibido) : '—' }}</td>
                  </tr>
                } @empty { <tr><td colspan="8">Todavía no hay cuadres.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    }
  `,
})
export class CuadreCajaComponent implements OnChanges {
  /** Día (YYYY-MM-DD, hora Colombia) */
  @Input({ required: true }) fecha!: string;
  /** Cambia cuando entra o se cancela una venta, para volver a leer el efectivo */
  @Input() version = 0;

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  caja = signal<Caja | null>(null);
  abierta = signal(false);
  ocupado = signal(false);
  contado = signal<number | null>(null);
  nota = '';
  pesos = pesos;

  // Movimiento
  movAbierto = signal(false);
  tipo = signal<'salida' | 'entrada'>('salida');
  concepto = '';
  valor: number | null = null;
  notaMov = '';
  soportes = signal<string[]>([]);
  conceptos = computed(() => CONCEPTOS[this.tipo()]);
  // Base
  baseAbierta = signal(false);
  nuevaBase: number | null = null;
  // Historial
  historial = signal<Historial[] | null>(null);

  esperado = computed(() => {
    const c = this.caja();
    return c ? Number(c.base) + Number(c.efectivo) + Number(c.entradas) - Number(c.salidas) : 0;
  });
  diferencia = computed(() => (this.contado() ?? 0) - this.esperado());
  estado = computed(() => {
    const k = this.caja()?.cierre;
    return k ? this.estadoDe(Number(k.diferencia)) : '';
  });
  /** Se registraron entradas o salidas después de contar */
  movidoDespues = computed(() => {
    const c = this.caja();
    const k = c?.cierre;
    return !!k && !k.recibido_at && (Number(k.entradas) !== Number(c!.entradas) || Number(k.salidas) !== Number(c!.salidas));
  });

  constructor() {
    addIcons({ closeOutline, walletOutline });
  }

  ngOnChanges(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('caja_local', { p_fecha: this.fecha });
    if (error) return; // sin permiso o sin la función todavía: no se muestra
    const c = data as Caja;
    // Los números llegan como texto desde la base: se pasan a número
    if (c.cierre) for (const k of ['base', 'esperado', 'contado', 'diferencia', 'recoger', 'entradas', 'salidas'] as const) c.cierre[k] = Number(c.cierre[k]);
    this.caja.set(c);
  }

  abrir(): void {
    const c = this.caja();
    if (!c) return;
    this.contado.set(c.cierre && !this.movidoDespues() ? c.cierre.contado : null);
    this.nota = c.cierre?.nota ?? '';
    this.abierta.set(true);
  }

  async guardar(): Promise<void> {
    this.ocupado.set(true);
    const { data, error } = await this.sb.client.rpc('cuadrar_caja', { p_fecha: this.fecha, p_contado: this.contado(), p_nota: this.nota });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const r = data as { diferencia: number; recoger: number };
    const d = Number(r.diferencia);
    this.toast.ok((d === 0 ? 'Caja cuadrada ✓' : d < 0 ? `Faltan ${pesos(-d)}` : `Sobran ${pesos(d)}`) + ` · recoge ${pesos(r.recoger)}`);
    this.abierta.set(false);
    await this.cargar();
  }

  abrirMov(): void {
    this.tipo.set('salida');
    this.concepto = '';
    this.valor = null;
    this.notaMov = '';
    this.soportes.set([]);
    this.movAbierto.set(true);
  }

  async guardarMov(): Promise<void> {
    if (!this.concepto.trim()) return this.toast.error('Escribe el concepto');
    if (!(Number(this.valor) > 0)) return this.toast.error('Escribe el valor');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('caja_movimiento', {
      p_tipo: this.tipo(), p_concepto: this.concepto.trim(), p_valor: Number(this.valor), p_nota: this.notaMov.trim(),
      p_comprobantes: this.soportes(), p_fecha: this.fecha,
    });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`${this.tipo() === 'salida' ? 'Salida' : 'Entrada'} de ${pesos(Number(this.valor))} registrada`);
    this.movAbierto.set(false);
    await this.cargar();
  }

  async borrarMov(m: Movimiento): Promise<void> {
    if (!(await confirmar(`¿Borrar la ${m.tipo} "${m.concepto}" de ${pesos(m.valor)}?`, { peligro: true }))) return;
    const { error } = await this.sb.client.rpc('borrar_caja_movimiento', { p_id: m.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Movimiento borrado');
    await this.cargar();
  }

  verSoporte(m: Movimiento): void {
    void urlsComprobantes(this.sb.client, m.comprobantes).then((urls) =>
      this.visor.abrir(urls.map((url) => ({ url, titulo: `${m.concepto} · ${pesos(m.valor)}` })), 0));
  }

  async entregar(): Promise<void> {
    const k = this.caja()?.cierre;
    if (!k || !(await confirmar(`¿Confirmas que entregaste ${pesos(k.recoger)} y en la caja quedó la base de ${pesos(k.base)}?`, { aceptar: 'Sí, la entregué' }))) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('entregar_caja', { p_fecha: this.fecha });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Listo: el admin confirma que lo recibió');
    await this.cargar();
  }

  async recibir(fecha: string, valor: number): Promise<void> {
    const t = prompt(`¿Cuánto recibiste de la caja del ${this.dia(fecha)}?`, String(Math.round(Number(valor))));
    if (t === null) return;
    const v = Number(t.replace(/\D/g, ''));
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('recibir_caja', { p_fecha: fecha, p_valor: v });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(v === Math.round(Number(valor)) ? `Recibido ${pesos(v)} ✓` : `Recibido ${pesos(v)} (se esperaban ${pesos(valor)})`);
    await this.cargar();
  }

  abrirBase(): void {
    this.nuevaBase = Number(this.caja()?.base ?? 0) || null;
    this.baseAbierta.set(true);
  }

  async guardarBase(): Promise<void> {
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('fijar_base_caja', { p_valor: Number(this.nuevaBase) || 0 });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`Base fija: ${pesos(Number(this.nuevaBase) || 0)}`);
    this.baseAbierta.set(false);
    await this.cargar();
  }

  async abrirHistorial(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('caja_historial', { p_dias: 30 });
    if (error) return this.toast.error(mensajeError(error));
    this.historial.set(((data ?? []) as Historial[]).map((r) => ({ ...r, diferencia: Number(r.diferencia) })));
  }

  estadoDe(d: number): string {
    return d === 0 ? 'ok' : d < 0 ? 'falta' : 'sobra';
  }

  hora(iso: string): string {
    return formatoHoraCO(iso);
  }

  dia(d: string): string {
    return diaCorto(d);
  }
}
