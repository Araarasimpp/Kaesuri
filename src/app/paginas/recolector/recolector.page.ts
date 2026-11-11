import { Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addCircleOutline, bagHandleOutline, cashOutline, checkmarkOutline, closeOutline, walletOutline } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, UserRole, rolesDe } from '../../core/services/supabase.service';
import { confirmar } from '../../shared/dialogo';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { DiaComponent } from '../../shared/rango/dia.component';
import { RangoFechas, sumarDias } from '../../shared/rango/rango.component';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { mensajeError, numero, pesos, urlImagen, urlMini } from '../../shared/formato';
import { diaColombiaDe, formatoFechaCO, formatoHoraCO, hoyColombiaISO } from '../../shared/fecha-colombia';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { PesosDirective } from '../../shared/pesos/pesos.directive';

interface Pendiente { id: number; monto: number; nombre: string; de: string | null; recolector: string; fecha: string }
interface PorRecolector { id: string; nombre: string; base: number; compras: number; entregado: number; pendientes: number; saldo: number }
interface Movimiento {
  tipo: 'base' | 'compra' | 'entrega';
  id: number;
  fecha: string;
  valor: number;
  nombre: string | null;
  estado: 'pendiente' | 'aceptada' | 'rechazada' | null;
  quien: string | null;
  recolector: string;
  proveedor: string | null;
  producto: string | null;
  facturas: string[] | null;
  /** Entregas: el día al que pertenece la plata */
  dia?: string | null;
}
interface Resumen {
  base: number;
  compras: number;
  /** Lo que le entregó al admin de ese día (aunque lo haya recibido otro día) */
  entregado: number;
  /** Lo que falta por entregar de este día (base − compras − entregado de este día); null cuando son todos */
  saldo: number | null;
  /** Días anteriores que quedaron sin entregar */
  dias_sin_entregar?: { id: string; nombre: string; dia: string; falta: number }[];
  por_recolector: PorRecolector[];
  n_bases: number;
  n_compras: number;
  pendientes: Pendiente[];
  movimientos: Movimiento[];
  recolectores: { id: string; nombre: string }[];
}

/**
 * Panel del recolector: recibe bases de dinero durante el día (las manda el
 * admin y él las acepta, o las agrega él mismo diciendo de dónde vienen) y
 * registra cada compra con su valor, proveedor, producto y foto de la factura.
 * Cuadre = bases − compras (lo que debe tener en la mano).
 */
interface ProdCosto { id: string; nombre: string; sku: string | null; imagen_url: string | null; costo: number | null }
const normalP = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

@Component({
  selector: 'app-recolector',
  standalone: true,
  imports: [PesosDirective, SkeletonComponent, FormsModule, IonIcon, DiaComponent, ComprobantesInputComponent],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 920px; }
      .head .acciones { display: flex; gap: 8px; flex-wrap: wrap; }
      .head .acciones ion-icon { font-size: 17px; }
      .filtros { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .filtros select { width: auto; min-width: 200px; }

      /* Resumen: tiquete con los tres renglones */
      .resumen { position: relative; padding: 18px 22px 22px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; }
      .resumen::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 6px;
        background: radial-gradient(circle at 6px 6px, var(--bg) 3px, transparent 3.5px) 0 0 / 12px 12px repeat-x; }
      .resumen h2 { margin: 0 0 12px; font-size: 12px; font-weight: 650; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); text-align: center; }
      .renglon { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; font-size: 15px; }
      .renglon::after { content: none; }
      .renglon .lbl { white-space: nowrap; }
      .renglon .lbl small { margin-left: 6px; font-size: 12px; color: var(--text-muted); }
      .renglon .punteado { flex: 1; border-bottom: 1px dotted var(--border-strong); transform: translateY(-4px); }
      .renglon .val { font-family: var(--mono-font); font-size: 17px; font-weight: 600; white-space: nowrap; }
      .renglon.compras .val { color: var(--danger); }
      .renglon.total { margin-top: 6px; padding-top: 12px; border-top: 3px double var(--text); font-size: 16px; font-weight: 650; }
      .renglon.total .val { font-size: 24px; font-weight: 700; }
      .renglon.total.neg .val { color: var(--danger); }
      .renglon.total .lbl small { display: block; margin: 2px 0 0; font-weight: 400; }

      /* Bases por aceptar */
      .pendientes { display: flex; flex-direction: column; gap: 10px; }
      .pend { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 14px; align-items: center; padding: 14px 16px; border-radius: var(--radius-lg);
        border: 1px solid color-mix(in srgb, var(--efectivo) 40%, var(--border)); background: var(--ok-wash); animation: entra 240ms ease both; }
      @keyframes entra { from { opacity: 0; transform: translateY(4px); } }
      .pend .txt strong { display: block; font-family: var(--mono-font); font-size: 20px; }
      .pend .txt span { display: block; font-size: 13.5px; font-weight: 550; }
      .pend .txt small { display: block; margin-top: 2px; font-size: 12px; color: var(--text-soft); }
      .pend .btns { display: flex; gap: 8px; }
      .pend .btns .b { height: 40px; }

      /* Movimientos */
      .movs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .mov { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 11px 0; border-bottom: var(--perfora); }
      .mov:last-child { border-bottom: 0; }
      .ico { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; font-size: 17px; }
      .ico.base { background: color-mix(in srgb, var(--st-entregado) 14%, transparent); color: var(--efectivo-texto); }
      .ico.compra { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
      .mov .t1 { display: block; font-size: 14px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mov .t2 { display: block; font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mov .der { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
      .mov .monto { font-family: var(--mono-font); font-size: 14px; font-weight: 650; white-space: nowrap; }
      .mov .monto.base { color: var(--efectivo-texto); }
      .mov .monto.compra { color: var(--danger); }
      .mov .monto.tachado { color: var(--text-muted); text-decoration: line-through; font-weight: 500; }
      .estado { font-size: 11px; font-weight: 650; padding: 1px 7px; border-radius: 8px; }
      .estado.pendiente { background: var(--oro-wash); color: var(--oro-texto); }
      .estado.rechazada { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
      .factura { width: 40px; height: 40px; padding: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--surface-2); cursor: zoom-in; }
      .factura img { width: 100%; height: 100%; object-fit: cover; display: block; }
      /* Una tarjeta por recolector */
      .recs { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
      .rec { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
        -webkit-backdrop-filter: blur(18px) saturate(150%); backdrop-filter: blur(18px) saturate(150%); }
      .rec-cab { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .rec-cab strong { font-size: 16px; }
      .rec-cab small { font-size: 11.5px; font-weight: 650; padding: 1px 8px; border-radius: 8px; background: var(--oro-wash); color: var(--oro-texto); }
      .rec dl { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; font-size: 13.5px; }
      .rec dt { color: var(--text-soft); }
      .rec dd { margin: 0; text-align: right; font-family: var(--mono-font); font-weight: 600; }
      .rec .debe { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--radius); background: var(--ok-wash); }
      .rec .debe.neg { background: var(--danger-wash); }
      .rec .debe.cero { background: var(--surface-2); }
      .rec .debe span { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
      .rec .debe strong { font-family: var(--mono-font); font-size: 22px; }
      .rec-acc { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .rec-acc .b { height: 40px; justify-content: center; }
      .renglon.entregado .val { color: var(--st-ruta-text); }
      .renglon.saldo { margin-top: 10px; padding: 12px 14px; border-radius: var(--radius); background: var(--ok-wash); }
      .renglon.saldo.neg { background: var(--danger-wash); }
      .renglon.saldo .val { font-size: 20px; font-weight: 700; }
      .renglon.saldo .lbl small { display: block; margin: 2px 0 0; }
      .renglon.saldo .lbl { white-space: normal; flex: 1; min-width: 0; }
      .renglon.saldo .punteado { display: none; }
      .ico.entrega { background: color-mix(in srgb, var(--st-ruta) 14%, transparent); color: var(--st-ruta-text); }
      .mov .monto.entrega { color: var(--st-ruta-text); }
      .atras-lista { list-style: none; margin: 0; padding: 0; }
      .atras-lista li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: var(--perfora); }
      .atras-lista li:last-child { border-bottom: 0; }
      .atras-txt strong { display: block; font-size: 14px; }
      .atras-txt small { display: block; font-size: 12px; color: var(--text-muted); }
      .atras-v { font-family: var(--mono-font); font-weight: 700; color: var(--st-pendiente-text); white-space: nowrap; }
      .atras-acc { display: flex; gap: 6px; }
      @media (max-width: 640px) { .atras-lista li { grid-template-columns: minmax(0, 1fr) auto; } .atras-acc { grid-column: 1 / -1; } .atras-acc .b { flex: 1; justify-content: center; } }
      .sub-dia { display: block; font-size: 12.5px; font-weight: 500; color: var(--text-muted); }
      .link-borrar { border: 0; background: none; padding: 0; color: var(--danger); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
      .hoja-centro .hoja-body { gap: 14px; }
      .hoja-head h2 { margin: 0 auto 0 0; }
      .aviso-neg { margin: 0; font-size: 12.5px; color: var(--danger); }
      .tipo-compra { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .tipo-compra button { min-height: 40px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; cursor: pointer; }
      .tipo-compra button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .buscar-prod { position: relative; }
      .sug-prod { position: absolute; left: 0; right: 0; top: 100%; z-index: 5; margin: 4px 0 0; padding: 4px; list-style: none; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: 0 6px 20px rgba(0,0,0,.12); max-height: 240px; overflow-y: auto; }
      .sug-prod button { width: 100%; display: flex; justify-content: space-between; gap: 8px; padding: 9px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
      .sug-prod small { color: var(--text-muted); white-space: nowrap; }
      .sug-prod button { align-items: center; }
      .prod-txt { flex: 1; min-width: 0; }
      .prod-foto { flex-shrink: 0; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; overflow: hidden; background: var(--surface-2); color: var(--text-muted); font-size: 18px; }
      .prod-foto img { width: 100%; height: 100%; object-fit: cover; }
      .prod-foto-g { width: 64px; height: 64px; border-radius: 14px; font-size: 24px; cursor: zoom-in; }
      .prod-sel { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); }
      .prod-sel small { display: block; font-size: 12.5px; color: var(--text-muted); }
      .b.chico { height: 32px; padding: 0 10px; font-size: 12.5px; }
      .total-inv { margin: 0; font-size: 14px; }
      .total-inv strong { font-family: var(--mono-font); }
      .aviso-costo { margin: 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--oro-wash); color: var(--oro-texto); font-size: 13px; }

      @media (max-width: 640px) {
        .head .acciones { width: 100%; }
        .head .acciones .b { flex: 1; justify-content: center; }
        .filtros select { width: 100%; }
        .pend { grid-template-columns: 1fr; }
        .pend .btns .b { flex: 1; justify-content: center; }
        .renglon.total .val { font-size: 21px; }
      }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ etiqueta() }}</p><h1>Recolector</h1></div>
        @if (!soloLectura()) {
        <div class="acciones">
          <button class="b" (click)="abrirBase()"><ion-icon name="add-circle-outline"></ion-icon>{{ admin() ? 'Enviar base' : 'Agregar base' }}</button>
          @if (esRecolector()) {
            <button class="b b-pri" (click)="abrirCompra()"><ion-icon name="bag-handle-outline"></ion-icon>Registrar compra</button>
          }
        </div>
        }
      </div>

      <div class="filtros">
        <app-dia (cambio)="cambiarDia($event)"></app-dia>
        @if (esAdmin() && (r()?.recolectores?.length ?? 0) > 0) {
          <select class="inp inp-chico" [(ngModel)]="filtroRec" (ngModelChange)="cargar()" aria-label="Recolector">
            <option [ngValue]="null">Todos los recolectores</option>
            @for (x of r()!.recolectores; track x.id) { <option [ngValue]="x.id">{{ x.nombre }}</option> }
          </select>
        }
      </div>

      @if (r()?.pendientes?.length) {
        <section class="pendientes" aria-label="Bases por aceptar">
          @for (p of r()!.pendientes; track p.id) {
            <div class="pend">
              <div class="txt">
                <strong>{{ pesos(p.monto) }}</strong>
                <span>{{ p.nombre }}</span>
                <small>Enviada por {{ p.de || 'admin' }} · {{ cuando(p.fecha) }}@if (esAdmin()) { · para {{ p.recolector }} }</small>
              </div>
              @if (esRecolector() && !admin()) {
                <div class="btns">
                  <button class="b" (click)="responder(p, false)" [disabled]="ocupado()"><ion-icon name="close-outline"></ion-icon>Rechazar</button>
                  <button class="b b-ok" (click)="responder(p, true)" [disabled]="ocupado()"><ion-icon name="checkmark-outline"></ion-icon>Aceptar</button>
                </div>
              } @else {
                <span class="estado pendiente">Esperando que la acepte</span>
              }
            </div>
          }
        </section>
      }

      @if (vistaTodos()) {
        <!-- Admin con "Todos": una tarjeta por recolector (cada uno con su base y su saldo) -->
        <section class="recs" aria-label="Recolectores" [attr.aria-busy]="cargando()">
          @for (x of r()?.por_recolector ?? []; track x.id) {
            <article class="rec">
              <div class="rec-cab"><strong>{{ x.nombre }}</strong>@if (x.pendientes) { <small>{{ x.pendientes }} por aceptar</small> }</div>
              <dl>
                <dt>Base del día</dt><dd>{{ pesos(x.base) }}</dd>
                <dt>Compras del día</dt><dd>− {{ pesos(x.compras) }}</dd>
                @if (+x.entregado) { <dt>Ya te entregó</dt><dd>− {{ pesos(x.entregado) }}</dd> }
              </dl>
              <div class="debe" [class.neg]="+x.saldo < 0" [class.cero]="+x.saldo === 0">
                <span>{{ +x.saldo < 0 ? 'Gastó de más este día' : +x.saldo === 0 ? 'Día cuadrado' : 'Falta por entregar' }}</span>
                <strong>{{ pesos(x.saldo) }}</strong>
              </div>
              <div class="rec-acc">
                <button class="b" (click)="verRecolector(x.id)">Ver detalle</button>
                @if (admin()) { <button class="b b-ok" [disabled]="+x.saldo <= 0" (click)="abrirRecibir(x)"><ion-icon name="cash-outline"></ion-icon>Recibir</button> }
              </div>
            </article>
          } @empty {
            @if (!cargando()) { <p class="vacio-txt">No hay usuarios con el rol Recolector. Asígnalo en Usuarios.</p> }
          }
        </section>
      } @else {
        <section class="resumen" aria-labelledby="t-res" [attr.aria-busy]="cargando()">
          <h2 id="t-res">Resumen</h2>
          <div class="renglon"><span class="lbl">Base<small>{{ numero(r()?.n_bases) }} {{ r()?.n_bases === 1 ? 'base' : 'bases' }}</small></span><span class="punteado"></span>
            <span class="val">{{ pesos(r()?.base) }}</span></div>
          <div class="renglon compras"><span class="lbl">Compras<small>{{ numero(r()?.n_compras) }}</small></span><span class="punteado"></span>
            <span class="val">− {{ pesos(r()?.compras) }}</span></div>
          <div class="renglon total" [class.neg]="cuadre() < 0"><span class="lbl">Cuadre del día<small>{{ cuadre() < 0 ? 'Gastó más de la base' : 'Lo que quedó de este día' }}</small></span>
            <span class="punteado"></span><span class="val">{{ pesos(cuadre()) }}</span></div>
          @if (+(r()?.entregado ?? 0)) {
            <div class="renglon entregado"><span class="lbl">Ya se le entregó al admin<small>De la plata de este día</small></span><span class="punteado"></span>
              <span class="val">− {{ pesos(r()?.entregado) }}</span></div>
          }
          @if (r()?.saldo !== null && r()?.saldo !== undefined) {
            <div class="renglon saldo" [class.neg]="+r()!.saldo! < 0"><span class="lbl">{{ +r()!.saldo! < 0 ? 'Entregó de más' : 'Falta por entregar' }}<small>Solo de este día: cada día cuadra por su cuenta</small></span>
              <span class="punteado"></span><span class="val">{{ pesos(r()!.saldo) }}</span></div>
          }
          @if (admin() && filtroRec && +(r()?.saldo ?? 0) > 0) {
            <button class="b b-ok" style="margin-top: 12px; width: 100%; justify-content: center" (click)="abrirRecibirSel()"><ion-icon name="cash-outline"></ion-icon>Recibir {{ pesos(r()!.saldo) }}</button>
          }
        </section>
      }

      @if (r()?.dias_sin_entregar?.length) {
        <section class="panel atras" aria-labelledby="t-atras">
          <div class="panel-head"><div><h2 id="t-atras">Días anteriores sin entregar</h2><p class="panel-sub">Cada día cuadra solo: lo que quedó pendiente se recibe en su propio día</p></div></div>
          <ul class="atras-lista">
            @for (a of r()!.dias_sin_entregar!; track a.id + a.dia) {
              <li>
                <span class="atras-txt"><strong>{{ mayus(diaTexto(a.dia)) }}</strong>@if (esAdmin() && !filtroRec) { <small>{{ a.nombre }}</small> }</span>
                <span class="atras-v">{{ pesos(a.falta) }}</span>
                <span class="atras-acc">
                  <button class="b chico" (click)="irADia(a.dia)">Ver día</button>
                  @if (admin()) { <button class="b b-ok chico" (click)="abrirRecibir({ id: a.id, nombre: a.nombre, saldo: a.falta }, a.dia)"><ion-icon name="cash-outline"></ion-icon>Recibir</button> }
                </span>
              </li>
            }
          </ul>
        </section>
      }

      <section class="panel" aria-labelledby="t-movs">
        <div class="panel-head"><div><h2 id="t-movs">Movimientos del día</h2><p class="panel-sub">Bases que entraron y compras</p></div></div>
        @if (r()?.movimientos?.length) {
          <ul class="movs">
            @for (m of r()!.movimientos; track m.tipo + m.id) {
              <li class="mov">
                <span class="ico" [class]="'ico ' + m.tipo" aria-hidden="true"><ion-icon [name]="m.tipo === 'base' ? 'wallet-outline' : m.tipo === 'entrega' ? 'cash-outline' : 'bag-handle-outline'"></ion-icon></span>
                <span style="min-width: 0">
                  @if (m.tipo === 'base') {
                    <span class="t1">{{ m.nombre }}</span>
                    <span class="t2">Base · {{ m.quien || '—' }} · {{ hora(m.fecha) }}@if (esAdmin() && !filtroRec) { · {{ m.recolector }} }</span>
                  } @else if (m.tipo === 'entrega') {
                    <span class="t1">Le entregó al admin{{ m.nombre ? ' · ' + m.nombre : '' }}</span>
                    <span class="t2">Recibió {{ m.quien || 'el admin' }} · {{ m.dia && m.dia !== diaDe(m.fecha) ? 'registrado ' + diaTexto(diaDe(m.fecha)) : hora(m.fecha) }}@if (esAdmin() && !filtroRec) { · {{ m.recolector }} }</span>
                  } @else {
                    <span class="t1">{{ m.producto }}</span>
                    <span class="t2">{{ m.proveedor }} · {{ hora(m.fecha) }}@if (esAdmin() && !filtroRec) { · {{ m.recolector }} }</span>
                  }
                </span>
                <span class="der">
                  <span class="monto" [class.base]="m.tipo === 'base'" [class.compra]="m.tipo === 'compra'" [class.entrega]="m.tipo === 'entrega'" [class.tachado]="m.tipo === 'base' && m.estado !== 'aceptada'">
                    {{ m.tipo === 'base' ? '+' : '−' }}{{ pesos(m.valor) }}</span>
                  @if (m.tipo === 'entrega' && admin()) { <button type="button" class="link-borrar" (click)="borrarEntrega(m)">Borrar</button> }
                  @if (m.tipo === 'compra' && puedeQuitarCompra()) { <button type="button" class="link-borrar" (click)="borrarCompra(m)">Quitar</button> }
                  @if (m.tipo === 'base' && m.estado !== 'aceptada') { <span class="estado" [class]="'estado ' + m.estado">{{ m.estado === 'pendiente' ? 'Por aceptar' : 'Rechazada' }}</span> }
                  @if (m.tipo === 'compra' && m.facturas?.length) {
                    <button type="button" class="factura" (click)="verFactura(m)" aria-label="Ver factura">
                      @if (fotos()[m.facturas![0]]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                    </button>
                  }
                </span>
              </li>
            }
          </ul>
        } @else {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="4"></app-skeleton> } @else { <p class="vacio-txt">{{ 'Todavía no hay bases ni compras este día.' }}</p> }
        }
      </section>
    </div>

    <!-- Agregar o enviar base -->
    @if (formBase()) {
      <button class="velo" aria-label="Cerrar" (click)="formBase.set(false)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-base">
        <div class="hoja-head"><h2 id="t-base">{{ enviaBase() ? 'Enviar base' : 'Agregar base' }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="formBase.set(false)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          @if (admin()) {
            <div class="campo"><label for="br">¿Para quién es la base?</label>
              <select id="br" class="inp" [(ngModel)]="baseRec" (ngModelChange)="baseRecSel.set($event)">
                @for (x of r()?.recolectores ?? []; track x.id) { <option [ngValue]="x.id">{{ x.nombre }}{{ x.id === miId() ? ' (yo)' : '' }}</option> }
              </select>
              @if (!(r()?.recolectores?.length)) { <p class="ayuda">No hay usuarios con el rol Recolector. Asígnalo en Usuarios.</p> }
            </div>
          }
          <div class="campo"><label for="bm">Valor</label><input pesos id="bm" class="inp num" [(ngModel)]="baseMonto" /></div>
          <div class="campo"><label for="bn">Nombre de la base</label>
            <input id="bn" class="inp" maxlength="120" [(ngModel)]="baseNombre" placeholder="¿De dónde viene? Ej: caja del local, ventas de la mañana" /></div>
          @if (enviaBase()) { <p class="ayuda" style="margin: 0">Le llega un aviso al recolector; se suma cuando la acepte.</p> }
          @if (errorForm()) { <p class="error" role="alert">{{ errorForm() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="formBase.set(false)">Cancelar</button>
          <button class="b b-ok" (click)="guardarBase()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : enviaBase() ? 'Enviar base' : 'Agregar base' }}</button>
        </div>
      </div>
    }

    <!-- Recibir la plata del recolector -->
    @if (recibirDe(); as x) {
      <button class="velo" aria-label="Cerrar" (click)="recibirDe.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-rec">
        <div class="hoja-head"><h2 id="t-rec">Recibir de {{ x.nombre }}<small class="sub-dia">{{ mayus(diaTexto(recibirDia)) }}</small></h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="recibirDe.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <p class="ayuda" style="margin: 0">Plata del <strong>{{ diaTexto(recibirDia) }}</strong>: le falta entregar <strong>{{ pesos(x.saldo) }}</strong> (base − compras − lo que ya te entregó de ese día).</p>
          <div class="campo"><label for="rv">¿Cuánto recibiste?</label><input pesos id="rv" class="inp num" [(ngModel)]="recibirValor" />
            <button type="button" class="b chico" style="margin-top: 6px; align-self: flex-start" (click)="recibirValor = +x.saldo">Todo · {{ pesos(x.saldo) }}</button></div>
          @if ((recibirValor || 0) > 0 && +recibirValor! !== +x.saldo) {
            <p class="aviso-costo">{{ +recibirValor! < +x.saldo ? 'Le quedan ' + pesos(+x.saldo - +recibirValor!) + ' por entregar.' : 'Te entregó ' + pesos(+recibirValor! - +x.saldo) + ' de más.' }}</p>
          }
          <div class="campo"><label for="rn">Nota (opcional)</label><input id="rn" class="inp" maxlength="300" [(ngModel)]="recibirNota" placeholder="Ej: en efectivo, al final del día" /></div>
          @if (errorForm()) { <p class="error" role="alert">{{ errorForm() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="recibirDe.set(null)">Cancelar</button>
          <button class="b b-ok" (click)="guardarRecibir()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Recibí ' + pesos(recibirValor || 0) }}</button>
        </div>
      </div>
    }

    <!-- Registrar compra -->
    @if (formCompra()) {
      <button class="velo" aria-label="Cerrar" (click)="formCompra.set(false)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-compra">
        <div class="hoja-head"><h2 id="t-compra">Registrar compra</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="formCompra.set(false)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="tipo-compra" role="group" aria-label="Qué compraste">
            <button type="button" [class.on]="deInventario()" (click)="deInventario.set(true)">Producto del inventario</button>
            <button type="button" [class.on]="!deInventario()" (click)="deInventario.set(false)">Otra cosa</button>
          </div>
          @if (deInventario()) {
            @if (prodSel(); as p) {
              <div class="prod-sel">
                <span class="prod-foto prod-foto-g" (click)="verFotoProd(p)">@if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" /> } @else { <ion-icon name="bag-handle-outline"></ion-icon> }</span>
                <span class="prod-txt"><strong>{{ p.nombre }}</strong><small>Costo actual: {{ p.costo ? pesos(p.costo) : 'sin costo' }}</small></span>
                <button type="button" class="b chico" (click)="prodSel.set(null)">Cambiar</button>
              </div>
              <div class="fila-campos">
                <div class="campo"><label for="cc">¿Cuántos compraste?</label><input id="cc" class="inp num" type="number" inputmode="numeric" min="1" [ngModel]="compraCant()" (ngModelChange)="compraCant.set(+$event || null)" /></div>
                <div class="campo"><label for="cu">¿Cuánto te costó cada uno?</label><input pesos id="cu" class="inp num" [ngModel]="compraCosto()" (ngModelChange)="compraCosto.set(+$event || null)" /></div>
              </div>
              @if (totalInv()) { <p class="total-inv">Total de la compra: <strong>{{ pesos(totalInv()) }}</strong></p> }
              @if (compraCosto() && p.costo && +compraCosto()! !== +p.costo) {
                <p class="aviso-costo">El costo de {{ p.nombre }} va a quedar en {{ pesos(compraCosto()!) }} (antes {{ pesos(p.costo) }}).</p>
              }
              @if (totalInv() > cuadre() && cuadre() >= 0) { <p class="aviso-neg">Es más de lo que queda de base ({{ pesos(cuadre()) }}).</p> }
            } @else {
              <div class="campo buscar-prod">
                <label for="cbp">Busca el producto que compraste</label>
                <input id="cbp" class="inp" autocomplete="off" [ngModel]="buscaProd()" (ngModelChange)="buscaProd.set($event)" placeholder="Nombre o SKU" />
                @if (sugerencias().length) {
                  <ul class="sug-prod">
                    @for (p of sugerencias(); track p.id) {
                      <li><button type="button" (click)="elegirProd(p)"><span class="prod-foto">@if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <ion-icon name="bag-handle-outline"></ion-icon> }</span><span class="prod-txt">{{ p.nombre }}</span><small>{{ p.costo ? pesos(p.costo) : '' }}</small></button></li>
                    }
                  </ul>
                } @else if (buscaProd().trim().length >= 2) { <small class="suave">No encontramos ese producto. Si no está en el inventario, elige "Otra cosa".</small> }
              </div>
            }
          } @else {
            <div class="campo"><label for="cv">Valor</label><input pesos id="cv" class="inp num" [(ngModel)]="compraValor" /></div>
            @if ((compraValor || 0) > cuadre() && cuadre() >= 0) { <p class="aviso-neg">Es más de lo que queda de base ({{ pesos(cuadre()) }}).</p> }
            <div class="campo"><label for="cd">¿Qué compraste?</label><input id="cd" class="inp" maxlength="200" [(ngModel)]="compraProducto" placeholder="Ej: bolsas, cinta" /></div>
          }
          <div class="campo"><label for="cp">Proveedor</label><input id="cp" class="inp" maxlength="120" [(ngModel)]="compraProveedor" placeholder="Ej: Distribuidora El Centro" /></div>
          <app-comprobantes-input titulo="Foto de la factura" pista="Foto de la factura o el recibo donde se vea el valor." [rutas]="compraFacturas()"
            (cambio)="compraFacturas.set($event); errorForm.set('')"></app-comprobantes-input>
          @if (errorForm()) { <p class="error" role="alert">{{ errorForm() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="formCompra.set(false)">Cancelar</button>
          <button class="b b-pri" (click)="guardarCompra()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Registrar compra' }}</button>
        </div>
      </div>
    }
  `,
})
export class RecolectorPage implements OnInit, OnDestroy {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  r = signal<Resumen | null>(null);
  cargando = signal(true);
  ocupado = signal(false);
  etiqueta = signal('');
  /** Fotos de las facturas (enlaces firmados) por ruta */
  fotos = signal<Record<string, string>>({});
  errorForm = signal('');
  formBase = signal(false);
  formCompra = signal(false);
  filtroRec: string | null = null;

  baseMonto: number | null = null;
  baseNombre = '';
  baseRec: string | null = null;
  compraValor: number | null = null;
  compraProveedor = '';
  compraProducto = '';
  compraFacturas = signal<string[]>([]);
  /** Compra de un producto del inventario: su costo se actualiza con lo que le costó */
  deInventario = signal(true);
  private prods = signal<ProdCosto[]>([]);
  buscaProd = signal('');
  prodSel = signal<ProdCosto | null>(null);
  compraCant = signal<number | null>(null);
  compraCosto = signal<number | null>(null);
  totalInv = computed(() => (Number(this.compraCant()) || 0) * (Number(this.compraCosto()) || 0));
  sugerencias = computed(() => {
    const t = normalP(this.buscaProd());
    if (t.length < 2) return [];
    return this.prods().filter((p) => normalP(p.nombre).includes(t) || normalP(p.sku ?? '').includes(t)).slice(0, 8);
  });

  /** Ve a todos los recolectores (cuadres también, pero solo para revisar) */
  private roles = computed<UserRole[]>(() => {
    const p = this.sb.perfil();
    return p ? rolesDe(p) : [];
  });
  /** Ve a todos los recolectores */
  esAdmin = computed(() => this.roles().includes('admin'));
  admin = this.esAdmin;
  /** Cuadres revisa el cuadre del recolector sin enviar bases ni registrar compras */
  soloLectura = computed(() => !this.roles().some((r) => r === 'admin' || r === 'recolector'));
  esRecolector = computed(() => this.roles().includes('recolector'));
  /** Lo que quedó del día: base − compras (lo entregado se resta aparte, en "Falta por entregar") */
  cuadre = computed(() => Number(this.r()?.base ?? 0) - Number(this.r()?.compras ?? 0));
  miId = computed(() => this.sb.perfil()?.id ?? null);
  baseRecSel = signal<string | null>(null);
  /** El admin manda la base a otro recolector (queda por aceptar); a sí mismo, se suma de una */
  enviaBase = computed(() => this.admin() && this.baseRecSel() !== this.miId());
  /** Admin (o cuadres) mirando a todos: una tarjeta por recolector en vez de sumarlos */
  vistaTodos = computed(() => this.esAdmin() && !this.filtroSel() && (this.r()?.por_recolector?.length ?? 0) > 0);
  private filtroSel = signal<string | null>(null);
  // Recibir
  recibirDe = signal<{ id: string; nombre: string; saldo: number } | null>(null);
  recibirValor: number | null = null;
  recibirNota = '';
  recibirDia = '';
  @ViewChild(DiaComponent) private diaCmp?: DiaComponent;

  pesos = pesos;
  numero = numero;
  private dia = '';
  private consulta = 0;
  private canal: RealtimeChannel | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    addIcons({ addCircleOutline, bagHandleOutline, cashOutline, checkmarkOutline, closeOutline, walletOutline });
  }

  ngOnInit(): void {
    // Una base enviada o aceptada (o una compra) aparece sola
    const recargar = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.cargar(), 500);
    };
    void this.sb.getCurrentProfile();
    this.canal = this.sb.client
      .channel('recoleccion-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_bases' }, recargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_compras' }, recargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_entregas' }, recargar)
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.canal) void this.sb.client.removeChannel(this.canal);
    clearTimeout(this.timer);
  }

  cambiarDia(r: RangoFechas): void {
    this.dia = r.desde;
    this.etiqueta.set(r.etiqueta);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    if (!this.dia) return;
    const n = ++this.consulta;
    this.filtroSel.set(this.filtroRec);
    const { data, error } = await this.sb.client.rpc('recoleccion_resumen', { p_desde: this.dia, p_hasta: this.dia, p_recolector: this.filtroRec });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const r = data as Resumen;
    this.r.set(r);
    // Miniaturas de las facturas (privadas: enlace firmado)
    const faltan = r.movimientos.flatMap((m) => m.facturas ?? []).filter((f) => !this.fotos()[f]);
    if (faltan.length) {
      const urls = await urlsComprobantes(this.sb.client, faltan);
      this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
    }
  }

  // ---------- Recibir ----------
  verRecolector(id: string): void {
    this.filtroRec = id;
    void this.cargar();
  }

  abrirRecibir(x: { id: string; nombre: string; saldo: number }, dia = this.dia): void {
    this.recibirDia = dia;
    this.recibirValor = Number(x.saldo) > 0 ? Number(x.saldo) : null;
    this.recibirNota = '';
    this.errorForm.set('');
    this.recibirDe.set({ id: x.id, nombre: x.nombre, saldo: Number(x.saldo) });
  }

  abrirRecibirSel(): void {
    const id = this.filtroRec;
    const nombre = this.r()?.recolectores.find((x) => x.id === id)?.nombre ?? 'el recolector';
    if (!id) return;
    this.abrirRecibir({ id, nombre, saldo: Number(this.r()?.saldo ?? 0) });
  }

  async guardarRecibir(): Promise<void> {
    const x = this.recibirDe();
    const v = Math.round(Number(this.recibirValor) || 0);
    if (!x) return;
    if (v <= 0) return this.errorForm.set('Escribe cuánto recibiste.');
    this.ocupado.set(true);
    const { data, error } = await this.sb.client.rpc('recoleccion_recibir', { p_recolector: x.id, p_valor: v, p_nota: this.recibirNota.trim(), p_dia: this.recibirDia || this.dia });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    const saldo = Number(data);
    this.toast.ok(`Recibiste ${pesos(v)} de ${x.nombre}` + (saldo > 0 ? ` · de ese día faltan ${pesos(saldo)}` : saldo === 0 ? ' · ese día quedó en cero ✓' : ''));
    this.recibirDe.set(null);
    await this.cargar();
  }

  /** "viernes 6 de nov" (o "hoy" / "ayer") */
  diaTexto(d: string): string {
    if (!d) return '';
    const hoy = hoyColombiaISO();
    if (d === hoy) return 'hoy';
    if (d === sumarDias(hoy, -1)) return 'ayer';
    return new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  mayus(t: string): string {
    return t ? t[0].toUpperCase() + t.slice(1) : t;
  }

  diaDe(iso: string): string {
    return diaColombiaDe(iso);
  }

  irADia(d: string): void {
    this.diaCmp?.poner(d);
  }

  readonly urlMini = urlMini;
  verFotoProd(p: ProdCosto): void {
    const u = urlImagen(p.imagen_url);
    if (u) this.visor.abrir([{ url: u, titulo: p.nombre }], 0);
  }
  /** El admin quita cualquier compra; el recolector las suyas de hoy (el servidor lo vuelve a revisar) */
  puedeQuitarCompra(): boolean {
    return this.admin() || (this.esRecolector() && this.dia === hoyColombiaISO());
  }

  async borrarCompra(m: Movimiento): Promise<void> {
    if (!(await confirmar(`¿Quitar la compra "${m.producto}" de ${pesos(m.valor)}? La plata vuelve a contar en la base.`, { aceptar: 'Sí', cancelar: 'Volver', peligro: true }))) return;
    const { error } = await this.sb.client.rpc('recoleccion_borrar_compra', { p_id: m.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Compra quitada');
    await this.cargar();
  }

  async borrarEntrega(m: Movimiento): Promise<void> {
    if (!(await confirmar(`¿Borrar lo recibido de ${m.recolector} (${pesos(m.valor)})? Vuelve a contar como plata que debe tener.`, { aceptar: 'Sí', cancelar: 'Volver', peligro: true }))) return;
    const { error } = await this.sb.client.rpc('recoleccion_borrar_entrega', { p_id: m.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Borrado');
    await this.cargar();
  }

  // ---------- Bases ----------
  abrirBase(): void {
    this.baseMonto = null;
    this.baseNombre = '';
    // El admin elige para quién es; por defecto el recolector que está mirando (o el primero que no sea él)
    const lista = this.r()?.recolectores ?? [];
    this.baseRec = this.filtroRec ?? lista.find((x) => x.id !== this.miId())?.id ?? lista[0]?.id ?? null;
    this.baseRecSel.set(this.admin() ? this.baseRec : this.miId());
    this.errorForm.set('');
    this.formBase.set(true);
  }

  async guardarBase(): Promise<void> {
    const monto = Number(this.baseMonto) || 0;
    if (monto <= 0) return this.errorForm.set('Escribe el valor de la base.');
    if (!this.baseNombre.trim()) return this.errorForm.set('Ponle nombre a la base (de dónde viene).');
    if (this.admin() && !this.baseRec) return this.errorForm.set('Elige para quién es la base.');
    const enviar = this.enviaBase();
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('recoleccion_agregar_base', {
      p_monto: monto, p_nombre: this.baseNombre.trim(), p_recolector: this.admin() ? this.baseRec : null,
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    this.toast.ok(enviar ? `Base de ${pesos(monto)} enviada: falta que la acepte` : `Base de ${pesos(monto)} sumada`);
    this.formBase.set(false);
    await this.cargar();
  }

  async responder(p: Pendiente, aceptar: boolean): Promise<void> {
    if (!aceptar && !(await confirmar(`¿Rechazar la base de ${pesos(p.monto)} (${p.nombre})?`, { aceptar: 'Rechazar', cancelar: 'Volver', peligro: true }))) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('recoleccion_responder_base', { p_base: p.id, p_aceptar: aceptar });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(aceptar ? `Base de ${pesos(p.monto)} sumada` : 'Base rechazada');
    await this.cargar();
  }

  // ---------- Compras ----------
  abrirCompra(): void {
    this.compraValor = null;
    this.compraProveedor = '';
    this.compraProducto = '';
    this.compraFacturas.set([]);
    this.deInventario.set(true);
    this.buscaProd.set('');
    this.prodSel.set(null);
    this.compraCant.set(null);
    this.compraCosto.set(null);
    this.errorForm.set('');
    this.formCompra.set(true);
    if (!this.prods().length) {
      void this.sb.client.rpc('recolector_productos').then(({ data }) => this.prods.set((data ?? []) as ProdCosto[]));
    }
  }

  elegirProd(p: ProdCosto): void {
    this.prodSel.set(p);
    this.buscaProd.set('');
    this.compraCant.set(1);
    this.compraCosto.set(p.costo ? Number(p.costo) : null);
    this.errorForm.set('');
  }

  async guardarCompra(): Promise<void> {
    if (this.deInventario()) return this.guardarCompraInventario();
    const valor = Number(this.compraValor) || 0;
    if (valor <= 0) return this.errorForm.set('Escribe el valor de la compra.');
    if (!this.compraProveedor.trim()) return this.errorForm.set('Escribe el proveedor.');
    if (!this.compraProducto.trim()) return this.errorForm.set('Escribe qué compraste.');
    if (!this.compraFacturas().length) return this.errorForm.set('Sube la foto de la factura.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('recoleccion_compra', {
      p_valor: valor, p_proveedor: this.compraProveedor.trim(), p_producto: this.compraProducto.trim(), p_facturas: this.compraFacturas(),
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    this.toast.ok(`Compra de ${pesos(valor)} registrada`);
    this.formCompra.set(false);
    await this.cargar();
  }

  private async guardarCompraInventario(): Promise<void> {
    const p = this.prodSel();
    if (!p) return this.errorForm.set('Busca y elige el producto que compraste.');
    const cant = Math.round(Number(this.compraCant()) || 0);
    const costo = Math.round(Number(this.compraCosto()) || 0);
    if (cant <= 0) return this.errorForm.set('Escribe cuántos compraste.');
    if (costo <= 0) return this.errorForm.set('Escribe cuánto te costó cada uno.');
    if (!this.compraProveedor.trim()) return this.errorForm.set('Escribe el proveedor.');
    if (!this.compraFacturas().length) return this.errorForm.set('Sube la foto de la factura.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('recoleccion_compra', {
      p_valor: cant * costo, p_proveedor: this.compraProveedor.trim(), p_producto: `${cant} × ${p.nombre}`, p_facturas: this.compraFacturas(),
      p_producto_id: p.id, p_cantidad: cant, p_costo: costo,
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    const cambio = Number(p.costo) !== costo;
    this.toast.ok(`Compra de ${pesos(cant * costo)} registrada${cambio ? ` · el costo de ${p.nombre} quedó en ${pesos(costo)}` : ''}`);
    if (cambio) this.prods.update((l) => l.map((x) => (x.id === p.id ? { ...x, costo } : x)));
    this.formCompra.set(false);
    await this.cargar();
  }

  verFactura(m: Movimiento): void {
    const fs = m.facturas ?? [];
    this.visor.abrir(fs.map((f, i) => ({ url: this.fotos()[f] ?? '', titulo: `Factura ${fs.length > 1 ? i + 1 + ' ' : ''}· ${m.producto} · ${pesos(m.valor)}` })), 0);
  }

  hora(iso: string): string {
    return formatoHoraCO(iso);
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
