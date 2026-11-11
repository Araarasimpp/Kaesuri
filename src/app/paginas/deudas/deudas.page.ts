import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addCircleOutline, chevronDownOutline, chevronUpOutline, closeOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { PesosDirective } from '../../shared/pesos/pesos.directive';
import { urlsComprobantes } from '../../shared/comprobantes';
import { mensajeError, pesos } from '../../shared/formato';
import { confirmar } from '../../shared/dialogo';
import { formatoFechaCO, hoyColombiaISO } from '../../shared/fecha-colombia';

interface Item { producto_id: string; nombre: string; cantidad: number; costo: number; vendidas: number; quedan: number }
interface Abono { id: number; fecha: string; valor: number; metodo: string; comprobantes: string[]; nota: string | null; anulado: boolean; quien: string | null }
interface Deuda {
  id: number; proveedor: string; concepto: string | null; total: number; fecha: string; vence: string | null;
  estado: 'abierta' | 'pagada' | 'anulada'; compra_id: number | null; creado_por: string | null; contar_desde: string | null;
  abonado: number; saldo: number; costo_vendido: number | null; unidades: number | null; vendidas: number | null; por_apartar: number;
  items: Item[] | null; abonos: Abono[]; comprobantes: string[] | null;
}
interface CompraLibre { id: number; fecha: string; proveedor: string; total: number; productos: string | null }
type Filtro = 'abiertas' | 'pagadas' | 'todas';
interface ProdF { id: string; nombre: string; sku: string | null; costo: number | null }
interface LineaF { id: string; nombre: string; cantidad: number | null; costo: number | null }
const normalF = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
type Metodo = 'efectivo' | 'transferencia' | 'otro';

const METODOS: { id: Metodo; label: string }[] = [
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'otro', label: 'Otro' },
];

/**
 * Deudas con proveedores (mercancía fiada, préstamos, servicios). De la mercancía fiada se ve
 * cuántas unidades ya se vendieron y cuánto de su costo ya entró: eso es lo que conviene apartar
 * para abonarle al proveedor. Abonos parciales, "abonar lo vendido" y "pagar todo", con soporte.
 */
@Component({
  selector: 'app-deudas',
  standalone: true,
  imports: [FormsModule, RouterLink, IonIcon, ComprobantesInputComponent, SkeletonComponent, PesosDirective],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 900px; }
      .resumen { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .res { display: flex; flex-direction: column; gap: 3px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .res small { font-size: 11.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }
      .res strong { font-family: var(--mono-font); font-size: 20px; }
      .res span { font-size: 12.5px; color: var(--text-soft); }
      .res.clave { background: var(--oro-wash); border-color: transparent; }
      .res.clave small, .res.clave strong { color: var(--oro-texto); }
      .res.mal strong { color: var(--danger); }
      @media (max-width: 640px) { .resumen { grid-template-columns: 1fr 1fr; } .res.clave { grid-column: 1 / -1; } }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chips button { height: 34px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft); font: inherit; font-size: 13.5px; cursor: pointer; }
      .chips button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .lista { display: flex; flex-direction: column; gap: 12px; }
      .deuda { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .deuda.pagada { opacity: .75; }
      .top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
      .top h3 { margin: 0; font-size: 16px; }
      .top p { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }
      .estado { flex-shrink: 0; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: var(--surface-2); color: var(--text-soft); white-space: nowrap; }
      .estado.vencida { background: var(--danger-wash); color: var(--danger); }
      .estado.pronto { background: var(--oro-wash); color: var(--oro-texto); }
      .estado.pagada { background: var(--ok-wash); color: var(--efectivo-texto); }
      .saldo { display: flex; flex-direction: column; gap: 2px; }
      .saldo strong { font-family: var(--mono-font); font-size: 24px; }
      .saldo span { font-size: 13px; color: var(--text-soft); }
      .barra { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
      .barra i { display: block; height: 8px; border-radius: inherit; background: var(--efectivo-texto); }
      .barra.venta i { background: var(--accent); }
      .vendido { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); font-size: 13.5px; }
      .vendido .fila { display: flex; justify-content: space-between; gap: 10px; }
      .vendido .num { font-family: var(--mono-font); font-weight: 650; }
      .apartar { color: var(--oro-texto); font-weight: 700; }
      .docs { display: flex; gap: 8px; flex-wrap: wrap; }
      .docs .b { height: 36px; font-size: 13.5px; }
      .items { width: 100%; border-collapse: collapse; font-size: 13px; }
      .items th { text-align: left; font-size: 11px; color: var(--text-muted); font-weight: 650; padding: 4px; border-bottom: 1px solid var(--border); }
      .items td { padding: 6px 4px; border-bottom: var(--perfora); }
      .items .der { text-align: right; font-family: var(--mono-font); }
      @media (max-width: 520px) { .items .costo { display: none; } .items { font-size: 12.5px; } }
      .acciones { display: flex; gap: 8px; flex-wrap: wrap; }
      .acciones .b { flex: 1 1 140px; }
      .abonos { list-style: none; margin: 0; padding: 0; font-size: 13px; }
      .abonos li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: var(--perfora); }
      .abonos li.anulado { opacity: .5; text-decoration: line-through; }
      .abonos small { display: block; color: var(--text-muted); font-size: 12px; }
      .abonos .der { display: flex; align-items: center; gap: 8px; font-family: var(--mono-font); font-weight: 650; white-space: nowrap; }
      .link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-size: 13px; cursor: pointer; }
      .link.peligro { color: var(--danger); }
      .vacio-txt { margin: 0; padding: 24px 0; text-align: center; color: var(--text-soft); }
      .metodos { display: flex; gap: 6px; }
      .metodos button { flex: 1; height: 40px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; cursor: pointer; }
      .metodos button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .atajos { display: flex; gap: 6px; flex-wrap: wrap; }
      .atajos button { height: 32px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft); font: inherit; font-size: 12.5px; cursor: pointer; }
      .tipo-deuda { display: flex; gap: 6px; }
      .tipo-deuda button { flex: 1; min-height: 40px; padding: 4px 6px; line-height: 1.2; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; cursor: pointer; }
      .f-buscar { position: relative; }
      .f-sug { position: absolute; left: 0; right: 0; top: 100%; z-index: 5; margin: 4px 0 0; padding: 4px; list-style: none; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--sombra, 0 6px 20px rgba(0,0,0,.12)); max-height: 240px; overflow-y: auto; }
      .f-sug button { width: 100%; display: flex; justify-content: space-between; gap: 8px; padding: 9px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
      .f-sug button:hover { background: var(--surface-2); }
      .f-sug small { color: var(--text-muted); white-space: nowrap; }
      .f-lineas { display: flex; flex-direction: column; gap: 6px; }
      .f-linea { display: grid; grid-template-columns: minmax(0, 1fr) 64px 104px 32px; gap: 6px; align-items: center; }
      .f-linea .nom { font-size: 13.5px; line-height: 1.25; overflow-wrap: anywhere; }
      .f-linea input { height: 38px; padding: 0 8px; font-size: 14px; min-width: 0; }
      .f-linea .quitar { height: 32px; border: 0; border-radius: var(--radius-sm); background: var(--danger-wash); color: var(--danger); cursor: pointer; }
      .f-total { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13.5px; }
      .f-total strong { font-family: var(--mono-font); font-size: 18px; }
      .check { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; line-height: 1.35; cursor: pointer; }
      .check input { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
      .pie-deuda { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .tipo-deuda button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .compras { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
      .compras button { width: 100%; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
      .compras button.on { border-color: var(--accent); background: var(--accent-wash); }
      .compras small { color: var(--text-muted); font-size: 12px; }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Lo que el negocio le debe a proveedores</p><h1>Deudas</h1></div>
        <button class="b b-pri" (click)="abrirNueva()"><ion-icon name="add-circle-outline"></ion-icon>Nueva deuda</button>
      </div>

      <div class="resumen">
        <div class="res"><small>Se debe</small><strong>{{ pesos(totales().saldo) }}</strong><span>{{ totales().abiertas }} {{ totales().abiertas === 1 ? 'deuda abierta' : 'deudas abiertas' }}</span></div>
        <div class="res" [class.mal]="totales().vencidas > 0"><small>Vencidas</small><strong>{{ totales().vencidas }}</strong><span>{{ totales().vencidas ? pesos(totales().saldoVencido) + ' por pagar' : 'Ninguna' }}</span></div>
        <div class="res clave"><small>Ya vendido, por abonar</small><strong>{{ pesos(totales().porApartar) }}</strong><span>Costo de la mercancía fiada que ya se vendió y no se ha abonado</span></div>
      </div>

      <div class="chips" role="group" aria-label="Qué deudas ver">
        @for (f of filtros; track f.id) { <button [class.on]="filtro() === f.id" (click)="cambiarFiltro(f.id)">{{ f.label }}</button> }
      </div>

      <div class="lista">
        @for (d of deudas(); track d.id) {
          <article class="deuda" [class.pagada]="d.estado === 'pagada'">
            <div class="top">
              <div>
                <h3>{{ d.proveedor }}</h3>
                <p>{{ d.concepto || (d.compra_id || d.unidades ? 'Mercancía fiada' : 'Deuda') }} · desde el {{ fecha(d.fecha) }}{{ d.compra_id ? ' · compra #' + d.compra_id : '' }}</p>
                @if (d.unidades && (d.contar_desde || !d.compra_id)) { <p>Ventas contadas desde el {{ fecha(d.contar_desde || d.fecha) }}</p> }
              </div>
              <span class="estado" [class]="'estado ' + estadoClase(d)">{{ estadoTexto(d) }}</span>
            </div>

            <div class="saldo">
              <strong>{{ pesos(d.saldo) }}</strong>
              <span>{{ d.estado === 'pagada' ? 'Pagada' : 'Por pagar' }} de {{ pesos(d.total) }} · abonado {{ pesos(d.abonado) }}</span>
            </div>
            <div class="barra" role="progressbar" [attr.aria-valuenow]="pct(d.abonado, d.total)" aria-valuemin="0" aria-valuemax="100" aria-label="Lo abonado">
              <i [style.width.%]="pct(d.abonado, d.total)"></i></div>

            @if (d.unidades) {
              <div class="vendido">
                <div class="fila"><span>Mercancía vendida</span><span class="num">{{ d.vendidas }} de {{ d.unidades }} unidades</span></div>
                <div class="barra venta"><i [style.width.%]="pct(d.vendidas ?? 0, d.unidades)"></i></div>
                <div class="fila"><span>Costo de lo vendido</span><span class="num">{{ pesos(d.costo_vendido) }}</span></div>
                @if (d.estado === 'abierta') {
                  <div class="fila apartar"><span>Aparta y abona</span><span class="num">{{ pesos(d.por_apartar) }}</span></div>
                }
              </div>
            }

            @if (d.estado !== 'anulada') {
              <div class="docs">
                @if (d.unidades) {
                  <button type="button" class="b" (click)="alternar(d.id)" [attr.aria-expanded]="abierta() === d.id">{{ abierta() === d.id ? 'Ocultar productos' : 'Ver productos (' + (d.items?.length ?? 0) + ')' }}</button>
                }
                @if (d.comprobantes?.length) {
                  <button type="button" class="b" (click)="verFactura(d)">Ver factura{{ d.comprobantes!.length > 1 ? ' (' + d.comprobantes!.length + ' fotos)' : '' }}</button>
                } @else {
                  <button type="button" class="b" (click)="abrirEditar(d)">Agregar foto de la factura</button>
                }
              </div>
            @if (d.unidades && abierta() === d.id) {
              <table class="items">
                <thead><tr><th>Producto</th><th class="der">Compradas</th><th class="der">Vendidas</th><th class="der">Quedan</th><th class="der costo">Costo c/u</th></tr></thead>
                <tbody>
                  @for (i of d.items ?? []; track i.producto_id) {
                    <tr><td>{{ i.nombre }}</td><td class="der">{{ i.cantidad }}</td><td class="der">{{ i.vendidas }}</td><td class="der">{{ i.quedan }}</td><td class="der costo">{{ pesos(i.costo) }}</td></tr>
                  }
                </tbody>
              </table>
            }
            }

            @if (d.estado === 'abierta') {
              <div class="acciones">
                <button class="b" (click)="abrirAbono(d, null)">Abonar</button>
                @if (d.por_apartar > 0 && d.por_apartar < d.saldo) {
                  <button class="b" (click)="abrirAbono(d, d.por_apartar)">Abonar lo vendido · {{ pesos(d.por_apartar) }}</button>
                }
                <button class="b b-ok" (click)="abrirAbono(d, d.saldo)">Pagar todo · {{ pesos(d.saldo) }}</button>
              </div>
            }

            @if (d.abonos.length) {
              <ul class="abonos">
                @for (a of d.abonos; track a.id) {
                  <li [class.anulado]="a.anulado">
                    <div>{{ fecha(a.fecha) }} · {{ metodo(a.metodo) }}@if (a.comprobantes.length) { · <button type="button" class="link" (click)="verSoporte(a)">ver soporte</button>}
                      <small>{{ a.quien || '' }}{{ a.nota ? ' · ' + a.nota : '' }}{{ a.anulado ? ' · anulado' : '' }}</small></div>
                    <span class="der">{{ pesos(a.valor) }}@if (!a.anulado) { <button type="button" class="link peligro" (click)="anularAbono(a)">Anular</button>}</span>
                  </li>
                }
              </ul>
            }
            @if (d.estado !== 'anulada') {
              <div class="pie-deuda">
                <button type="button" class="link" (click)="abrirEditar(d)">Editar (fecha, valor, proveedor)</button>
                <button type="button" class="link peligro" (click)="eliminarDeuda(d)">Eliminar</button>
              </div>
            }
          </article>
        } @empty {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="3"></app-skeleton> }
          @else { <p class="vacio-txt">{{ filtro() === 'abiertas' ? 'No hay deudas abiertas. Para registrar mercancía fiada, márcala como "Fiado" al registrar la compra en Inventario, o toca Nueva deuda.' : 'No hay deudas aquí.' }}</p> }
        }
      </div>
      <p class="ayuda" style="margin: 0">¿Cómo se sabe lo vendido? Se cuentan las unidades de cada producto entregadas después de la compra, descontando el stock que ya había antes (se vende primero lo viejo). Para que sea exacto, registra la mercancía en <a routerLink="/admin/inventario">Inventario</a>.</p>
    </div>

    @if (abonando(); as d) {
      <button class="velo" aria-label="Cerrar" (click)="abonando.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-abono">
        <div class="hoja-head"><h2 id="t-abono">Abonar a {{ d.proveedor }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="abonando.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <p class="ayuda" style="margin: 0">Saldo: <strong>{{ pesos(d.saldo) }}</strong> de {{ pesos(d.total) }}.</p>
          <div class="campo"><label for="ab-v">Valor del abono</label><input id="ab-v" pesos [(ngModel)]="valor" placeholder="$ 0" /></div>
          <div class="atajos">
            @if (d.por_apartar > 0) { <button type="button" (click)="valor = d.por_apartar">Lo vendido · {{ pesos(d.por_apartar) }}</button> }
            <button type="button" (click)="valor = mitad(d.saldo)">La mitad · {{ pesos(mitad(d.saldo)) }}</button>
            <button type="button" (click)="valor = d.saldo">Todo · {{ pesos(d.saldo) }}</button>
          </div>
          <div class="campo"><span class="etq">¿Cómo le pagaste?</span>
            <div class="metodos">@for (m of metodos; track m.id) { <button type="button" [class.on]="metodoSel() === m.id" (click)="metodoSel.set(m.id)">{{ m.label }}</button> }</div>
          </div>
          <div class="campo"><label for="ab-f">Fecha</label><input id="ab-f" type="date" [max]="hoy" [(ngModel)]="fechaAbono" /></div>
          <app-comprobantes-input titulo="Soporte del abono" pista="Pantallazo de la transferencia o foto del recibo." [rutas]="soportes()" (cambio)="soportes.set($event)"></app-comprobantes-input>
          <div class="campo"><label for="ab-n">Nota (opcional)</label><input id="ab-n" maxlength="300" [(ngModel)]="nota" placeholder="Ej: abono de la semana" /></div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="abonando.set(null)">Cancelar</button>
          <button class="b b-ok" (click)="guardarAbono()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : (valor || 0) >= d.saldo ? 'Pagar todo · ' + pesos(d.saldo) : 'Abonar ' + pesos(valor || 0) }}</button>
        </div>
      </div>
    }

    @if (editando(); as d) {
      <button class="velo" aria-label="Cerrar" (click)="editando.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-edit">
        <div class="hoja-head"><h2 id="t-edit">Editar deuda</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="editando.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="campo"><label for="ed-p">¿A quién se le debe?</label><input id="ed-p" maxlength="120" [(ngModel)]="eProveedor" /></div>
          <div class="campo"><label for="ed-c">Concepto</label><input id="ed-c" maxlength="300" [(ngModel)]="eConcepto" /></div>
          <div class="campo"><label for="ed-t">Valor total</label><input id="ed-t" pesos [(ngModel)]="eTotal" />
            @if (+d.abonado) { <small class="suave">Ya le has abonado {{ pesos(d.abonado) }}: no puede ser menos que eso.</small> }</div>
          <div class="fila-campos">
            <div class="campo"><label for="ed-f">Fecha</label><input id="ed-f" type="date" [max]="hoy" [(ngModel)]="eFecha" /></div>
            <div class="campo"><label for="ed-v">Vence (opcional)</label><input id="ed-v" type="date" [(ngModel)]="eVence" /></div>
          </div>
          @if (d.unidades) {
            <div class="campo"><label for="ed-cd">Contar lo vendido desde</label><input id="ed-cd" type="date" [max]="hoy" [(ngModel)]="eContar" />
              <small class="suave">{{ d.compra_id ? 'Vacío: desde que se registró la compra en Inventario.' : 'Vacío: desde la fecha de la deuda.' }} Se cuentan las unidades entregadas desde ese día, hasta la cantidad comprada.</small></div>
          }
          <app-comprobantes-input [obligatorio]="false" titulo="Foto de la factura" [rutas]="eFactura()" (cambio)="eFactura.set($event)"></app-comprobantes-input>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="editando.set(null)">Cancelar</button>
          <button class="b b-pri" (click)="guardarEdicion()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Guardar cambios' }}</button>
        </div>
      </div>
    }

    @if (nueva()) {
      <button class="velo" aria-label="Cerrar" (click)="nueva.set(false)"></button>
      <div class="hoja" role="dialog" aria-labelledby="t-nueva">
        <div class="hoja-head"><h2 id="t-nueva">Nueva deuda</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="nueva.set(false)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="tipo-deuda" role="group" aria-label="Tipo de deuda">
            <button type="button" [class.on]="tipoNueva() === 'factura'" (click)="cambiarTipo('factura')">Factura nueva</button>
            <button type="button" [class.on]="tipoNueva() === 'compra'" (click)="cambiarTipo('compra')">Compra ya registrada</button>
            <button type="button" [class.on]="tipoNueva() === 'otra'" (click)="cambiarTipo('otra')">Otra deuda</button>
          </div>
          @if (tipoNueva() === 'factura') {
            <p class="ayuda" style="margin: 0">Agrega todos los productos de la factura con su cantidad y costo. Sirve también para compras de otras fechas: pon abajo la fecha de la factura y la app cuenta lo vendido desde ese día.</p>
            <div class="campo f-buscar">
              <label for="nd-b">Agregar producto</label>
              <input id="nd-b" [ngModel]="buscaF()" (ngModelChange)="buscaF.set($event)" placeholder="Escribe el nombre o el SKU" autocomplete="off" />
              @if (sugerenciasF().length) {
                <ul class="f-sug">
                  @for (p of sugerenciasF(); track p.id) {
                    <li><button type="button" (click)="agregarF(p)"><span>{{ p.nombre }}</span><small>{{ p.costo ? 'costo ' + pesos(p.costo) : '' }}</small></button></li>
                  }
                </ul>
              }
            </div>
            @if (lineasF().length) {
              <div class="f-lineas">
                @for (l of lineasF(); track l.id; let i = $index) {
                  <div class="f-linea">
                    <span class="nom">{{ l.nombre }}</span>
                    <input class="num" type="number" inputmode="numeric" min="1" [(ngModel)]="l.cantidad" (ngModelChange)="tocarF()" aria-label="Cantidad" placeholder="Cant." />
                    <input pesos class="num" [(ngModel)]="l.costo" (ngModelChange)="tocarF()" aria-label="Costo por unidad" placeholder="Costo c/u" />
                    <button type="button" class="quitar" (click)="quitarF(i)" aria-label="Quitar">✕</button>
                  </div>
                }
              </div>
              <div class="f-total"><span>{{ lineasF().length }} {{ lineasF().length === 1 ? 'producto' : 'productos' }} · {{ unidadesF() }} unidades</span><strong>{{ pesos(totalF()) }}</strong></div>
            } @else {
              <p class="vacio-txt" style="padding: 6px 0">Todavía no has agregado productos.</p>
            }
            <label class="check"><input type="checkbox" [ngModel]="sumarInv()" (ngModelChange)="sumarInv.set($event)" />
              Sumar estas unidades al inventario (mercancía que acaba de llegar)</label>
            @if (!sumarInv()) {
              <p class="ayuda" style="margin: 0">No se toca el inventario. Lo vendido se cuenta desde la fecha de la factura: todas las unidades de esos productos entregadas desde ese día, hasta la cantidad que compraste.</p>
            }
            <app-comprobantes-input [obligatorio]="false" titulo="Foto de la factura (opcional)" [rutas]="facturaF()" (cambio)="facturaF.set($event)"></app-comprobantes-input>
          }
          @if (tipoNueva() === 'compra') {
            <p class="ayuda" style="margin: 0">Elige la compra que registraste en Inventario. Así la app cuenta cuánto de esa mercancía ya se vendió.</p>
            <ul class="compras">
              @for (c of comprasLibres(); track c.id) {
                <li><button type="button" [class.on]="compraSel()?.id === c.id" (click)="elegirCompra(c)">
                  <strong>{{ c.proveedor }} · {{ pesos(c.total) }}</strong><small>{{ fecha(c.fecha) }} · {{ c.productos || '' }}</small></button></li>
              } @empty {
                <li><p class="vacio-txt" style="padding: 10px 0">No hay compras sin deuda. Primero registra la compra en <a routerLink="/admin/inventario" (click)="nueva.set(false)">Inventario → Registrar compra</a> (ahí mismo puedes marcarla como Fiado).</p></li>
              }
            </ul>
          }
          <div class="campo"><label for="nd-p">¿A quién se le debe?</label><input id="nd-p" maxlength="120" [(ngModel)]="nProveedor" placeholder="Ej: Importadora XYZ" /></div>
          <div class="campo"><label for="nd-c">Concepto</label><input id="nd-c" maxlength="300" [(ngModel)]="nConcepto" [placeholder]="tipoNueva() === 'otra' ? 'Ej: préstamo, arriendo atrasado' : 'Mercancía fiada'" /></div>
          <div class="fila-campos">
            @if (tipoNueva() !== 'factura') {
              <div class="campo"><label for="nd-t">Valor total</label><input id="nd-t" pesos [(ngModel)]="nTotal" placeholder="$ 0" /></div>
            }
            <div class="campo"><label for="nd-f">Fecha {{ tipoNueva() === 'otra' ? 'de la deuda' : 'de la factura' }}</label><input id="nd-f" type="date" [max]="hoy" [ngModel]="nFecha" (ngModelChange)="cambiarFechaN($event)" /></div>
            <div class="campo"><label for="nd-v">Vence (opcional)</label><input id="nd-v" type="date" [(ngModel)]="nVence" /></div>
          </div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="nueva.set(false)">Cancelar</button>
          <button class="b b-pri" (click)="crear()" [disabled]="ocupado() || (tipoNueva() === 'compra' && !compraSel()) || (tipoNueva() === 'factura' && !lineasF().length)">{{ ocupado() ? 'Guardando…' : 'Registrar deuda' }}</button>
        </div>
      </div>
    }
  `,
})
export class DeudasPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  filtros: { id: Filtro; label: string }[] = [
    { id: 'abiertas', label: 'Por pagar' },
    { id: 'pagadas', label: 'Pagadas' },
    { id: 'todas', label: 'Todas' },
  ];
  metodos = METODOS;
  filtro = signal<Filtro>('abiertas');
  deudas = signal<Deuda[]>([]);
  cargando = signal(true);
  ocupado = signal(false);
  error = signal('');
  abierta = signal<number | null>(null);
  readonly hoy = hoyColombiaISO();
  pesos = pesos;

  // Abono
  abonando = signal<Deuda | null>(null);
  valor: number | null = null;
  metodoSel = signal<Metodo>('transferencia');
  fechaAbono = this.hoy;
  soportes = signal<string[]>([]);
  nota = '';

  // Nueva deuda
  nueva = signal(false);
  tipoNueva = signal<'factura' | 'compra' | 'otra'>('factura');
  nFecha = this.hoy;
  // Factura nueva con varios productos
  private prodsF = signal<ProdF[]>([]);
  buscaF = signal('');
  lineasF = signal<LineaF[]>([]);
  facturaF = signal<string[]>([]);
  private versionF = signal(0);
  sugerenciasF = computed(() => {
    const t = normalF(this.buscaF());
    if (t.length < 2) return [];
    const ya = new Set(this.lineasF().map((l) => l.id));
    return this.prodsF().filter((p) => !ya.has(p.id) && (normalF(p.nombre).includes(t) || normalF(p.sku ?? '').includes(t))).slice(0, 8);
  });
  totalF = computed(() => {
    this.versionF();
    return this.lineasF().reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0);
  });
  unidadesF = computed(() => {
    this.versionF();
    return this.lineasF().reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
  });
  // Editar
  editando = signal<Deuda | null>(null);
  eProveedor = '';
  eConcepto = '';
  eTotal: number | null = null;
  eFecha = '';
  eVence = '';
  eContar = '';
  eFactura = signal<string[]>([]);
  sumarInv = signal(true);
  comprasLibres = signal<CompraLibre[]>([]);
  compraSel = signal<CompraLibre | null>(null);
  nProveedor = '';
  nConcepto = '';
  nTotal: number | null = null;
  nVence = '';

  totales = computed(() => {
    const ab = this.deudas().filter((d) => d.estado === 'abierta');
    const venc = ab.filter((d) => d.vence && d.vence < this.hoy);
    return {
      abiertas: ab.length,
      saldo: ab.reduce((s, d) => s + Number(d.saldo), 0),
      vencidas: venc.length,
      saldoVencido: venc.reduce((s, d) => s + Number(d.saldo), 0),
      porApartar: ab.reduce((s, d) => s + Number(d.por_apartar || 0), 0),
    };
  });

  constructor() {
    addIcons({ addCircleOutline, chevronDownOutline, chevronUpOutline, closeOutline });
  }

  ngOnInit(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('deudas_lista', { p_estado: this.filtro() });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.deudas.set((data ?? []) as Deuda[]);
  }

  cambiarFiltro(f: Filtro): void {
    this.filtro.set(f);
    this.cargando.set(true);
    this.deudas.set([]);
    void this.cargar();
  }

  alternar(id: number): void {
    this.abierta.set(this.abierta() === id ? null : id);
  }

  pct(a: number, b: number | null): number {
    return b ? Math.min(100, Math.round((Number(a) / Number(b)) * 100)) : 0;
  }

  mitad(n: number): number {
    return Math.round(Number(n) / 2 / 100) * 100;
  }

  fecha(d: string): string {
    return formatoFechaCO(d + 'T12:00:00-05:00', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  metodo(m: string): string {
    return METODOS.find((x) => x.id === m)?.label ?? m;
  }

  private diasPara(d: string): number {
    return Math.round((new Date(d + 'T12:00:00Z').getTime() - new Date(this.hoy + 'T12:00:00Z').getTime()) / 864e5);
  }

  estadoClase(d: Deuda): string {
    if (d.estado === 'pagada') return 'pagada';
    if (!d.vence) return '';
    const n = this.diasPara(d.vence);
    return n < 0 ? 'vencida' : n <= 3 ? 'pronto' : '';
  }

  estadoTexto(d: Deuda): string {
    if (d.estado === 'pagada') return 'Pagada ✓';
    if (d.estado === 'anulada') return 'Anulada';
    if (!d.vence) return 'Sin fecha';
    const n = this.diasPara(d.vence);
    if (n < 0) return `Vencida hace ${-n} ${n === -1 ? 'día' : 'días'}`;
    if (n === 0) return 'Vence hoy';
    return n === 1 ? 'Vence mañana' : `Vence en ${n} días`;
  }

  abrirAbono(d: Deuda, valor: number | null): void {
    this.valor = valor;
    this.metodoSel.set('transferencia');
    this.fechaAbono = this.hoy;
    this.soportes.set([]);
    this.nota = valor !== null && valor === d.por_apartar && valor < d.saldo ? 'Abono de lo vendido' : '';
    this.error.set('');
    this.abonando.set(d);
  }

  async guardarAbono(): Promise<void> {
    const d = this.abonando();
    if (!d) return;
    const v = Math.round(Number(this.valor) || 0);
    if (v <= 0) return this.error.set('Escribe el valor del abono.');
    if (v > Number(d.saldo)) return this.error.set(`Es más de lo que se debe (saldo ${pesos(d.saldo)}).`);
    this.ocupado.set(true);
    const { data, error } = await this.sb.client.rpc('abonar_deuda', {
      p_deuda: d.id, p_valor: v, p_metodo: this.metodoSel(), p_comprobantes: this.soportes(), p_nota: this.nota.trim(), p_fecha: this.fechaAbono || this.hoy,
    });
    this.ocupado.set(false);
    if (error) return this.error.set(mensajeError(error));
    const r = data as { saldo: number; pagada: boolean };
    this.toast.ok(r.pagada ? `Deuda con ${d.proveedor} pagada ✓` : `Abono de ${pesos(v)} registrado · queda ${pesos(r.saldo)}`);
    this.abonando.set(null);
    await this.cargar();
  }

  async anularAbono(a: Abono): Promise<void> {
    if (!(await confirmar(`¿Anular el abono de ${pesos(a.valor)} del ${this.fecha(a.fecha)}? Vuelve a sumar a lo que se debe.`, { peligro: true }))) return;
    const { error } = await this.sb.client.rpc('anular_abono', { p_abono: a.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Abono anulado');
    await this.cargar();
  }

  /** Para deudas subidas por error: se borra del todo con sus abonos (la compra de Inventario queda) */
  async eliminarDeuda(d: Deuda): Promise<void> {
    const abonos = d.abonos.filter((a) => !a.anulado).length;
    const msg = `¿Eliminar la deuda con ${d.proveedor} (${pesos(d.total)})?${abonos ? ` También se borran sus ${abonos} abonos.` : ''}${d.compra_id ? ' La compra de Inventario no se toca.' : ''} No se puede deshacer.`;
    if (!(await confirmar(msg, { peligro: true }))) return;
    const { error } = await this.sb.client.rpc('eliminar_deuda', { p_deuda: d.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Deuda eliminada');
    await this.cargar();
  }

  async abrirNueva(): Promise<void> {
    this.error.set('');
    this.tipoNueva.set('factura');
    this.compraSel.set(null);
    this.nFecha = this.hoy;
    this.sumarInv.set(true);
    this.buscaF.set('');
    this.lineasF.set([]);
    this.facturaF.set([]);
    this.nProveedor = '';
    this.nConcepto = '';
    this.nTotal = null;
    this.nVence = '';
    this.nueva.set(true);
    const { data } = await this.sb.client.rpc('compras_sin_deuda');
    this.comprasLibres.set((data ?? []) as CompraLibre[]);
    if (!this.prodsF().length) {
      const r = await this.sb.client.rpc('inventario');
      this.prodsF.set((r.data ?? []) as ProdF[]);
    }
  }

  /** Una factura de otro día casi siempre ya está en el local: por defecto no se suma al inventario */
  cambiarFechaN(v: string): void {
    this.nFecha = v;
    if (v && v < this.hoy) this.sumarInv.set(false);
  }

  cambiarTipo(t: 'factura' | 'compra' | 'otra'): void {
    this.tipoNueva.set(t);
    this.error.set('');
    if (t !== 'compra') this.compraSel.set(null);
  }

  agregarF(p: ProdF): void {
    this.lineasF.update((l) => [...l, { id: p.id, nombre: p.nombre, cantidad: null, costo: p.costo ?? null }]);
    this.buscaF.set('');
    setTimeout(() => document.getElementById('nd-b')?.focus(), 0);
  }

  quitarF(i: number): void {
    this.lineasF.update((l) => l.filter((_, j) => j !== i));
  }

  tocarF(): void {
    this.versionF.update((v) => v + 1);
  }

  abrirEditar(d: Deuda): void {
    this.error.set('');
    this.eProveedor = d.proveedor;
    this.eConcepto = d.concepto ?? '';
    this.eTotal = Number(d.total);
    this.eFecha = d.fecha;
    this.eVence = d.vence ?? '';
    this.eContar = d.contar_desde ?? '';
    this.eFactura.set([...(d.comprobantes ?? [])]);
    this.editando.set(d);
  }

  async guardarEdicion(): Promise<void> {
    const d = this.editando();
    if (!d) return;
    if (!this.eProveedor.trim()) return this.error.set('Escribe a quién se le debe.');
    if (!(Number(this.eTotal) > 0)) return this.error.set('Escribe el valor de la deuda.');
    if (!this.eFecha) return this.error.set('Escribe la fecha.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('editar_deuda', {
      p_deuda: d.id, p_proveedor: this.eProveedor.trim(), p_concepto: this.eConcepto.trim(), p_total: Number(this.eTotal),
      p_fecha: this.eFecha, p_vence: this.eVence || null, p_contar_desde: this.eContar || null,
    });
    let errorFoto: unknown = null;
    if (!error && this.eFactura().join('|') !== (d.comprobantes ?? []).join('|')) {
      errorFoto = (await this.sb.client.rpc('deuda_factura', { p_deuda: d.id, p_comprobantes: this.eFactura() })).error;
    }
    this.ocupado.set(false);
    if (error || errorFoto) return this.error.set(mensajeError(error || errorFoto));
    this.toast.ok('Deuda actualizada');
    this.editando.set(null);
    await this.cargar();
  }

  elegirCompra(c: CompraLibre): void {
    this.compraSel.set(c);
    this.nProveedor = c.proveedor;
    this.nFecha = c.fecha;
    this.nTotal = Number(c.total);
    if (!this.nConcepto) this.nConcepto = 'Mercancía fiada';
  }

  async crear(): Promise<void> {
    if (!this.nProveedor.trim()) return this.error.set('Escribe a quién se le debe.');
    const fecha = this.nFecha || this.hoy;
    let compra: number | null = this.tipoNueva() === 'compra' ? this.compraSel()?.id ?? null : null;
    let total = Number(this.nTotal);
    if (this.tipoNueva() === 'factura') {
      const lineas = this.lineasF();
      if (!lineas.length) return this.error.set('Agrega los productos de la factura.');
      if (lineas.some((l) => !(Number(l.cantidad) > 0))) return this.error.set('Escribe la cantidad de cada producto.');
      if (lineas.some((l) => !(Number(l.costo) > 0))) return this.error.set('Escribe el costo de cada producto.');
      total = this.totalF();
      if (!this.sumarInv()) {
        // Compra de otra fecha: la deuda lleva sus productos y cuenta lo vendido desde la fecha de la factura
        this.ocupado.set(true);
        const r0 = await this.sb.client.rpc('crear_deuda', {
          p_proveedor: this.nProveedor.trim(), p_concepto: this.nConcepto.trim() || 'Mercancía fiada', p_total: total, p_fecha: fecha,
          p_vence: this.nVence || null, p_items: lineas.map((l) => ({ producto_id: l.id, cantidad: Math.round(Number(l.cantidad)), costo: Number(l.costo) })),
          p_contar_desde: fecha,
        });
        // La foto de la factura queda guardada en la deuda
        let fotoMal = false;
        if (!r0.error && r0.data && this.facturaF().length) {
          fotoMal = !!(await this.sb.client.rpc('deuda_factura', { p_deuda: r0.data as number, p_comprobantes: this.facturaF() })).error;
        }
        this.ocupado.set(false);
        if (r0.error) return this.error.set(mensajeError(r0.error));
        if (fotoMal) this.toast.error('La deuda quedó registrada, pero la foto no se guardó. Agrégala desde Editar.');
        else this.toast.ok(`Deuda con ${this.nProveedor.trim()} registrada`);
        this.nueva.set(false);
        if (this.filtro() !== 'abiertas') this.filtro.set('abiertas');
        await this.cargar();
        return;
      }
      this.ocupado.set(true);
      const r = await this.sb.client.rpc('registrar_compra', {
        p_fecha: fecha, p_proveedor: this.nProveedor.trim(), p_nota: this.nConcepto.trim() || 'Mercancía fiada',
        p_items: lineas.map((l) => ({ producto_id: l.id, cantidad: Math.round(Number(l.cantidad)), costo: Number(l.costo) })),
        p_comprobantes: this.facturaF(), p_actualizar_costo: true,
      });
      if (r.error) {
        this.ocupado.set(false);
        return this.error.set(mensajeError(r.error));
      }
      compra = r.data as number;
      if (!compra) {
        this.ocupado.set(false);
        return this.error.set('No se pudo registrar la compra. Intenta otra vez.');
      }
    } else if (!(total > 0)) {
      return this.error.set('Escribe el valor de la deuda.');
    }
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('crear_deuda', {
      p_proveedor: this.nProveedor.trim(), p_concepto: this.nConcepto.trim() || (compra ? 'Mercancía fiada' : ''), p_total: total, p_fecha: fecha,
      p_vence: this.nVence || null, p_compra: compra,
      ...(this.tipoNueva() === 'factura' && fecha < this.hoy ? { p_contar_desde: fecha } : {}),
    });
    this.ocupado.set(false);
    if (error) {
      if (this.tipoNueva() === 'factura') {
        // La compra ya entró: no se debe repetir la factura, solo crear la deuda desde esa compra
        this.toast.error('La compra quedó registrada en Inventario, pero no se pudo crear la deuda: ' + mensajeError(error) + '. Créala con "Compra ya registrada".');
        this.nueva.set(false);
        return;
      }
      return this.error.set(mensajeError(error));
    }
    this.toast.ok(`Deuda con ${this.nProveedor.trim()} registrada`);
    this.nueva.set(false);
    if (this.filtro() !== 'abiertas') this.filtro.set('abiertas');
    await this.cargar();
  }

  verFactura(d: Deuda): void {
    void urlsComprobantes(this.sb.client, d.comprobantes ?? []).then((urls) =>
      this.visor.abrir(urls.map((url) => ({ url, titulo: `Factura · ${d.proveedor} · ${this.fecha(d.fecha)}` })), 0));
  }

  verSoporte(a: Abono): void {
    void urlsComprobantes(this.sb.client, a.comprobantes).then((urls) =>
      this.visor.abrir(urls.map((url) => ({ url, titulo: `Abono · ${pesos(a.valor)} · ${this.fecha(a.fecha)}` })), 0));
  }
}
