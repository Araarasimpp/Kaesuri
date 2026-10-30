import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addCircleOutline, closeOutline, searchOutline, trashOutline } from 'ionicons/icons';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { RangoComponent, RangoFechas, diaCorto } from '../../shared/rango/rango.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { confirmar } from '../../shared/dialogo';
import { mensajeError, numero, pesos, urlMini } from '../../shared/formato';
import { formatoFechaCO, formatoHoraCO, hoyColombiaISO } from '../../shared/fecha-colombia';

interface Prod {
  id: string;
  nombre: string;
  sku: string | null;
  imagen_url: string | null;
  categoria: string | null;
  stock: number;
  stock_minimo: number;
  costo: number | null;
  vendidos_30: number;
}
interface Movimiento { fecha: string; tipo: 'compra' | 'ajuste' | 'anulacion' | 'venta' | 'devolucion'; cantidad: number; detalle: string | null; autor: string | null; stock_despues: number | null }
interface Compra {
  id: number;
  fecha: string;
  proveedor: string;
  nota: string | null;
  total: number | null;
  comprobantes: string[];
  creado_por_nombre: string | null;
  anulada: boolean;
  items: { nombre: string; cantidad: number; costo: number | null }[] | null;
}
interface Sugerido { id: string; nombre: string; categoria: string | null; stock: number; vendidos_60: number; dias: number | null; sugerido: number; costo: number | null }
interface Linea { producto: Prod; cantidad: number | null; costo: number | null }
type Filtro = 'todos' | 'bajos' | 'agotados';

/**
 * Inventario (como en Jasta): cuánto hay de cada producto (con alertas de lo que se acaba),
 * conteos físicos que corrigen el stock, el historial de cada producto y las compras a
 * proveedores, que suben el stock solas. Admin y despachador; los costos, solo el admin.
 * En Variedades JYB todos los productos llevan inventario.
 */
@Component({
  selector: 'app-inventario',
  standalone: true,
  host: { class: 'jt' },
  imports: [SkeletonComponent, FormsModule, IonIcon, ComprobantesInputComponent, RangoComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1000px; }
      .controles { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      button.kpi { border: 0; background: var(--surface); font: inherit; color: inherit; text-align: left; align-items: flex-start; cursor: pointer; }
      .buscar { position: relative; flex: 1; min-width: 200px; }
      .buscar ion-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
      .buscar input { width: 100%; padding-left: 36px; }
      .lista { list-style: none; margin: 0; padding: 0; }
      .fila { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: var(--perfora); }
      .fila:last-child { border-bottom: 0; }
      .foto { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; background: var(--surface-2); display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
      .nom { display: block; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sub { display: block; font-size: 12px; color: var(--text-muted); }
      .stock { min-width: 64px; text-align: center; padding: 5px 10px; border-radius: 999px; font-family: var(--mono-font); font-size: 15px; font-weight: 700;
        background: var(--ok-wash); color: var(--efectivo-texto); }
      .stock.bajo { background: var(--oro-wash); color: var(--oro-texto); }
      .stock.agotado { background: var(--danger-wash); color: var(--danger); }
      .acc { display: flex; gap: 6px; }
      .acc .b { height: 34px; font-size: 13px; }
      .mas-btn { margin: 10px auto 0; display: block; }
      .movs { list-style: none; margin: 0; padding: 0; }
      .movs li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 9px 0; border-bottom: var(--perfora); font-size: 13.5px; }
      .movs li:last-child { border-bottom: 0; }
      .movs .cant { font-family: var(--mono-font); font-weight: 700; text-align: right; }
      .movs .cant.mas { color: var(--efectivo-texto); }
      .movs .cant.menos { color: var(--danger); }
      .movs small { display: block; color: var(--text-muted); font-size: 12px; }
      .compra { padding: 12px 0; border-bottom: var(--perfora); }
      .compra:last-child { border-bottom: 0; }
      .compra.anulada { opacity: .5; }
      .compra-top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
      .compra-top strong { font-size: 14.5px; }
      .compra-top .num { font-weight: 700; white-space: nowrap; }
      .compra p { margin: 3px 0 0; font-size: 13px; color: var(--text-soft); }
      .compra .pie { display: flex; gap: 8px; align-items: center; margin-top: 6px; font-size: 12px; color: var(--text-muted); }
      .compra .pie .b { height: 30px; font-size: 12.5px; margin-left: auto; }
      .mini-foto { width: 34px; height: 34px; padding: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--surface-2); cursor: zoom-in; }
      .mini-foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .lineas { display: flex; flex-direction: column; gap: 8px; }
      .linea { display: grid; grid-template-columns: minmax(0, 1fr) 80px 110px 32px; gap: 8px; align-items: center; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--surface-2); }
      .linea.sin-costo { grid-template-columns: minmax(0, 1fr) 90px 32px; }
      .linea .nom { font-size: 13.5px; }
      .linea input { height: 36px; padding: 0 8px; }
      .sugerencias { list-style: none; margin: 4px 0 0; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); max-height: 220px; overflow-y: auto; }
      .sugerencias button { all: unset; box-sizing: border-box; display: flex; width: 100%; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13.5px; }
      .sugerencias button:hover { background: var(--hover); }
      .sugerencias small { color: var(--text-muted); }
      .total-compra { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); }
      .total-compra strong { font-family: var(--mono-font); font-size: 20px; }
      .check { display: flex; gap: 8px; align-items: center; font-size: 13.5px; }
      .semanas { display: flex; gap: 6px; flex-wrap: wrap; }
      .semanas button { height: 34px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft);
        font: inherit; font-size: 13px; cursor: pointer; }
      .semanas button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .sug { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: var(--perfora); }
      .sug:last-child { border-bottom: 0; }
      .sug .nom { white-space: normal; }
      .pedir { flex-shrink: 0; padding: 5px 12px; border-radius: 999px; background: var(--accent-wash); color: var(--accent); font-weight: 700; font-size: 13.5px; white-space: nowrap; }
      .pedir.urgente { background: var(--danger-wash); color: var(--danger); }
      .total-sug { margin: 0; font-size: 14px; color: var(--text-soft); }
      .acc-sug { display: flex; gap: 8px; flex-wrap: wrap; }
      .acc-sug .b { flex: 1 1 160px; }
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
      .quitar { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; }
      .quitar:hover { color: var(--danger); background: var(--danger-wash); }
      @media (max-width: 640px) {
        .fila { grid-template-columns: 40px minmax(0, 1fr) auto; }
        .fila .acc { grid-column: 2 / -1; }
        .linea { grid-template-columns: minmax(0, 1fr) 64px 92px 32px; }
      }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Stock, conteos y compras a proveedores</p><h1>Inventario</h1></div>
        <button class="b b-pri" (click)="abrirCompra()"><ion-icon name="add-circle-outline"></ion-icon>Registrar compra</button>
      </div>

      <div class="segmented" role="tablist">
        <button [class.on]="vista() === 'stock'" (click)="vista.set('stock')">Stock</button>
        <button [class.on]="vista() === 'comprar'" (click)="verComprar()">Qué comprar</button>
        <button [class.on]="vista() === 'compras'" (click)="vista.set('compras')">Compras</button>
      </div>

      @if (vista() === 'stock') {
        <div class="kpis" role="list">
          <button class="kpi" role="listitem" (click)="filtro.set('todos')"><span class="kpi-label">Productos</span><span class="kpi-valor num">{{ numero(productos().length) }}</span>
            <span class="kpi-nota">Activos</span></button>
          <button class="kpi" role="listitem" (click)="filtro.set('bajos')"><span class="kpi-label">Por acabarse</span><span class="kpi-valor num">{{ numero(resumen().bajos) }}</span>
            <span class="kpi-nota">En el mínimo o menos</span></button>
          <button class="kpi" role="listitem" (click)="filtro.set('agotados')"><span class="kpi-label">Agotados</span><span class="kpi-valor num">{{ numero(resumen().agotados) }}</span>
            <span class="kpi-nota">Sin unidades</span></button>
          @if (esAdmin()) {
            <div class="kpi" role="listitem"><span class="kpi-label">Valor del inventario</span><span class="kpi-valor num">{{ pesos(resumen().valor) }}</span>
              <span class="kpi-nota">{{ numero(resumen().unidades) }} unidades a precio de compra</span></div>
          } @else {
            <div class="kpi" role="listitem"><span class="kpi-label">Unidades</span><span class="kpi-valor num">{{ numero(resumen().unidades) }}</span>
              <span class="kpi-nota">En bodega</span></div>
          }
        </div>

        <div class="controles">
          <div class="buscar"><ion-icon name="search-outline"></ion-icon><input class="inp" type="search" [(ngModel)]="texto" placeholder="Buscar producto o SKU" aria-label="Buscar producto" /></div>
          <div class="segmented">
            <button [class.on]="filtro() === 'todos'" (click)="filtro.set('todos')">Todos</button>
            <button [class.on]="filtro() === 'bajos'" (click)="filtro.set('bajos')">Por acabarse</button>
            <button [class.on]="filtro() === 'agotados'" (click)="filtro.set('agotados')">Agotados</button>
          </div>
        </div>

        <section class="panel">
          @if (visibles().length) {
            <ul class="lista">
              @for (p of visibles().slice(0, limite()); track p.id) {
                <li class="fila">
                  @if (urlMini(p.imagen_url); as u) { <img class="foto" [src]="u" alt="" loading="lazy" /> } @else { <span class="foto">{{ p.nombre.charAt(0) }}</span> }
                  <span style="min-width: 0">
                    <span class="nom">{{ p.nombre }}</span>
                    <span class="sub">{{ p.sku ? p.sku + ' · ' : '' }}{{ p.vendidos_30 }} vendidos en 30 días · mínimo {{ p.stock_minimo }}@if (esAdmin() && p.costo) { · costo {{ pesos(p.costo) }} }</span>
                  </span>
                  <span [class]="'stock ' + nivel(p)">{{ p.stock }}</span>
                  <span class="acc">
                    <button class="b" (click)="abrirConteo(p)">Contar</button>
                    <button class="b" (click)="abrirHistorial(p)">Historial</button>
                  </span>
                </li>
              }
            </ul>
            @if (visibles().length > limite()) {
              <button class="b mas-btn" (click)="limite.set(limite() + 60)">Ver más ({{ visibles().length - limite() }})</button>
            }
          } @else {
            @if (cargando()) { <app-skeleton variante="filas" [cantidad]="6"></app-skeleton> } @else { <p class="vacio-txt">No hay productos con este filtro.</p> }
          }
        </section>
      } @else if (vista() === 'comprar') {
        <section class="panel">
          <div class="panel-head"><div><h2>Qué comprar</h2>
            <p class="panel-sub">Lo que se va a acabar según lo que se vende (últimos 60 días), para tener inventario de {{ semanas() }} semanas. Los lunes llega esta lista en un aviso.</p></div></div>
          <div class="semanas" role="group" aria-label="Para cuántas semanas">
            @for (n of [2, 3, 4, 6]; track n) {
              <button [class.on]="semanas() === n" (click)="semanas.set(n); cargarSugeridos()">{{ n }} semanas</button>
            }
          </div>
          @if (cargandoSug()) {
            <app-skeleton variante="filas" [cantidad]="5"></app-skeleton>
          } @else {
            <ul class="lista">
              @for (x of sugeridos(); track x.id) {
                <li class="sug">
                  <div style="min-width: 0">
                    <span class="nom">{{ x.nombre }}</span>
                    <span class="sub">Quedan {{ numero(x.stock < 0 ? 0 : x.stock) }} · se venden ~{{ porSemana(x) }} por semana{{ x.dias !== null ? ' · alcanza para ' + (x.dias === 0 ? 'nada' : '~' + x.dias + (x.dias === 1 ? ' día' : ' días')) : '' }}</span>
                  </div>
                  <span class="pedir" [class.urgente]="x.dias !== null && x.dias <= 7">Pedir {{ numero(x.sugerido) }}</span>
                </li>
              } @empty {
                <li><p class="vacio-txt">Nada por comprar: lo que hay alcanza para {{ semanas() }} semanas.</p></li>
              }
            </ul>
            @if (sugeridos().length) {
              @if (esAdmin() && costoSugerido() > 0) { <p class="total-sug">Costo aproximado: <strong class="num">{{ pesos(costoSugerido()) }}</strong></p> }
              <div class="acc-sug">
                <button class="b" (click)="copiarLista()">Copiar lista</button>
                <button class="b b-pri" (click)="comprarSugeridos()">Registrar esta compra</button>
              </div>
            }
          }
        </section>
      } @else {
        <app-rango inicial="mes" (cambio)="cambiarRango($event)"></app-rango>
        <section class="panel">
          <div class="panel-head"><div><h2>Compras a proveedores</h2>
            @if (esAdmin() && compras().length) { <p class="panel-sub">{{ compras().length }} compras · {{ pesos(totalCompras()) }}</p> }</div></div>
          @for (c of compras(); track c.id) {
            <div class="compra" [class.anulada]="c.anulada">
              <div class="compra-top"><strong>{{ c.proveedor }}</strong>@if (c.total !== null) { <span class="num">{{ pesos(c.total) }}</span> }</div>
              <p>{{ resumenItems(c) }}</p>
              @if (c.nota) { <p>{{ c.nota }}</p> }
              <div class="pie">
                <span>{{ dia(c.fecha) }} · {{ c.creado_por_nombre || '—' }}@if (c.anulada) { · Anulada }</span>
                @if (c.comprobantes.length) {
                  <button type="button" class="mini-foto" (click)="verFactura(c)" aria-label="Ver factura">
                    @if (fotos()[c.comprobantes[0]]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                  </button>
                }
                @if (esAdmin() && !c.anulada) { <button class="b" (click)="anular(c)">Anular</button> }
              </div>
            </div>
          } @empty {
            <p class="vacio-txt">No hay compras registradas en este periodo.</p>
          }
        </section>
      }
    </div>

    <!-- Conteo físico -->
    @if (contando(); as p) {
      <button class="velo" aria-label="Cerrar" (click)="contando.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-conteo">
        <div class="hoja-head"><h2 id="t-conteo">Contar</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="contando.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <p style="margin: 0; font-size: 14px"><strong>{{ p.nombre }}</strong><br /><span class="suave">El sistema dice que hay {{ p.stock }}</span></p>
          <div class="fila-campos">
            <div class="campo"><label for="ic">¿Cuántos hay?</label><input id="ic" class="num" type="number" inputmode="numeric" min="0" [(ngModel)]="contado" /></div>
            <div class="campo"><label for="im">Avisar cuando queden</label><input id="im" class="num" type="number" inputmode="numeric" min="0" [(ngModel)]="minimo" /></div>
          </div>
          @if (contado !== null && contado !== p.stock) {
            <p class="ayuda" style="margin: 0">Diferencia: {{ contado - p.stock > 0 ? '+' : '' }}{{ contado - p.stock }}</p>
            <div class="campo"><label for="imo">Motivo (opcional)</label><input id="imo" maxlength="200" [(ngModel)]="motivo" placeholder="Ej: conteo semanal, producto dañado, regalo" /></div>
          }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="contando.set(null)">Cancelar</button>
          <button class="b b-pri" (click)="guardarConteo()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </div>
    }

    <!-- Historial de un producto -->
    @if (historialDe(); as p) {
      <button class="velo" aria-label="Cerrar" (click)="historialDe.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-hist">
        <div class="hoja-head"><h2 id="t-hist">{{ p.nombre }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="historialDe.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <p class="suave" style="margin: 0; font-size: 13px">Hay {{ p.stock }} · compras, conteos, devoluciones y ventas</p>
          <ul class="movs">
            @for (m of movimientos(); track $index) {
              <li>
                <span>{{ tipoMov(m.tipo) }}@if (m.detalle) { · {{ m.detalle }} }<small>{{ cuando(m.fecha) }}{{ m.autor ? ' · ' + m.autor : '' }}{{ m.stock_despues !== null ? ' · quedaron ' + m.stock_despues : '' }}</small></span>
                <span class="cant" [class.mas]="m.cantidad > 0" [class.menos]="m.cantidad < 0">{{ m.cantidad > 0 ? '+' : '' }}{{ m.cantidad }}</span>
              </li>
            } @empty {
              <li>@if (cargandoMov()) { <app-skeleton variante="filas" [cantidad]="3"></app-skeleton> } @else { <span class="suave">Sin movimientos todavía.</span> }</li>
            }
          </ul>
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
          <div class="fila-campos">
            <div class="campo"><label for="cp">Proveedor</label><input id="cp" maxlength="120" [(ngModel)]="proveedor" placeholder="Ej: Importadora El Centro" /></div>
            <div class="campo"><label for="cf">Fecha</label><input id="cf" type="date" [max]="hoy" [(ngModel)]="fechaCompra" /></div>
          </div>
          <div class="campo">
            <label for="cb">Agregar producto</label>
            <input id="cb" [(ngModel)]="buscaProd" placeholder="Escribe el nombre o el SKU" autocomplete="off" />
            @if (sugerencias().length) {
              <ul class="sugerencias">
                @for (p of sugerencias(); track p.id) {
                  <li><button type="button" (click)="agregar(p)"><span>{{ p.nombre }}</span><small>hay {{ p.stock }}</small></button></li>
                }
              </ul>
            }
          </div>
          @if (lineas().length) {
            <div class="lineas">
              @for (l of lineas(); track l.producto.id; let i = $index) {
                <div class="linea" [class.sin-costo]="!esAdmin()">
                  <span class="nom">{{ l.producto.nombre }}</span>
                  <input class="num" type="number" inputmode="numeric" min="1" [(ngModel)]="l.cantidad" (ngModelChange)="tocar()" aria-label="Cantidad" placeholder="Cant." />
                  @if (esAdmin()) { <input class="num" type="number" inputmode="numeric" min="0" [(ngModel)]="l.costo" (ngModelChange)="tocar()" aria-label="Costo por unidad" placeholder="Costo c/u" /> }
                  <button type="button" class="quitar" (click)="quitarLinea(i)" aria-label="Quitar"><ion-icon name="trash-outline"></ion-icon></button>
                </div>
              }
            </div>
            @if (esAdmin()) {
              <div class="total-compra"><span>{{ unidades() }} unidades</span><strong>{{ pesos(totalForm()) }}</strong></div>
              <label class="check"><input type="checkbox" [(ngModel)]="actualizarCosto" /> Actualizar el precio de compra de estos productos con este costo</label>
            }
          }
          @if (esAdmin()) {
            <app-comprobantes-input [obligatorio]="false" titulo="Factura (opcional)" pista="Foto de la factura o la remisión del proveedor." [rutas]="facturas()"
              (cambio)="facturas.set($event)"></app-comprobantes-input>
          }
          <div class="campo"><label for="cn">Nota (opcional)</label><input id="cn" maxlength="200" [(ngModel)]="nota" /></div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="formCompra.set(false)">Cancelar</button>
          <button class="b b-pri" (click)="guardarCompra()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Registrar compra' }}</button>
        </div>
      </div>
    }
  `,
})
export class InventarioPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private visor = inject(VisorService);

  vista = signal<'stock' | 'comprar' | 'compras'>('stock');
  sugeridos = signal<Sugerido[]>([]);
  cargandoSug = signal(false);
  semanas = signal(3);
  private sugCargados = false;
  costoSugerido = computed(() => this.sugeridos().reduce((t, x) => t + x.sugerido * (Number(x.costo) || 0), 0));
  productos = signal<Prod[]>([]);
  cargando = signal(true);
  filtro = signal<Filtro>('todos');
  textoS = signal('');
  limite = signal(60);
  compras = signal<Compra[]>([]);
  fotos = signal<Record<string, string>>({});
  ocupado = signal(false);
  error = signal('');

  contando = signal<Prod | null>(null);
  contado: number | null = null;
  minimo: number | null = null;
  motivo = '';

  historialDe = signal<Prod | null>(null);
  movimientos = signal<Movimiento[]>([]);
  cargandoMov = signal(false);

  formCompra = signal(false);
  proveedor = '';
  fechaCompra = hoyColombiaISO();
  nota = '';
  actualizarCosto = true;
  facturas = signal<string[]>([]);
  lineas = signal<Linea[]>([]);
  private buscaS = signal('');
  private version = signal(0);

  esAdmin = signal(false);
  hoy = hoyColombiaISO();
  pesos = pesos;
  numero = numero;
  urlMini = urlMini;
  private rango: RangoFechas | null = null;

  get texto(): string {
    return this.textoS();
  }
  set texto(v: string) {
    this.textoS.set(v);
    this.limite.set(60);
  }
  get buscaProd(): string {
    return this.buscaS();
  }
  set buscaProd(v: string) {
    this.buscaS.set(v);
  }

  resumen = computed(() => {
    const lista = this.productos();
    return {
      bajos: lista.filter((p) => p.stock > 0 && p.stock <= p.stock_minimo).length,
      agotados: lista.filter((p) => p.stock <= 0).length,
      unidades: lista.reduce((s, p) => s + Math.max(0, p.stock), 0),
      valor: lista.reduce((s, p) => s + Math.max(0, p.stock) * Number(p.costo ?? 0), 0),
    };
  });

  visibles = computed(() => {
    const t = normal(this.textoS());
    const f = this.filtro();
    return this.productos()
      .filter((p) => {
        if (f === 'bajos') return p.stock > 0 && p.stock <= p.stock_minimo;
        if (f === 'agotados') return p.stock <= 0;
        return true;
      })
      .filter((p) => !t || normal(p.nombre).includes(t) || normal(p.sku ?? '').includes(t))
      // Lo que se acaba primero; luego lo que más se vende
      .sort((a, b) => this.urgencia(a) - this.urgencia(b) || b.vendidos_30 - a.vendidos_30);
  });

  sugerencias = computed(() => {
    const t = normal(this.buscaS());
    if (t.length < 2) return [];
    const ya = new Set(this.lineas().map((l) => l.producto.id));
    return this.productos().filter((p) => !ya.has(p.id) && (normal(p.nombre).includes(t) || normal(p.sku ?? '').includes(t))).slice(0, 8);
  });

  totalForm = computed(() => {
    this.version();
    return this.lineas().reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0);
  });
  unidades = computed(() => {
    this.version();
    return this.lineas().reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
  });
  totalCompras = computed(() => this.compras().filter((c) => !c.anulada).reduce((s, c) => s + Number(c.total ?? 0), 0));

  constructor() {
    addIcons({ addCircleOutline, closeOutline, searchOutline, trashOutline });
  }

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((p) => this.esAdmin.set(!!p && rolesDe(p).includes('admin')));
    void this.cargar();
    // Desde el aviso de los lunes se abre directo "Qué comprar"
    if (this.route.snapshot.queryParamMap.get('ver') === 'comprar') this.verComprar();
  }

  verComprar(): void {
    this.vista.set('comprar');
    if (!this.sugCargados) void this.cargarSugeridos();
  }

  async cargarSugeridos(): Promise<void> {
    this.sugCargados = true;
    this.cargandoSug.set(true);
    const { data, error } = await this.sb.client.rpc('compras_sugeridas', { p_dias: this.semanas() * 7 });
    this.cargandoSug.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.sugeridos.set((data ?? []) as Sugerido[]);
  }

  porSemana(x: Sugerido): string {
    const n = (x.vendidos_60 / 60) * 7;
    return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace('.', ',').replace(',0', '');
  }

  async copiarLista(): Promise<void> {
    const texto = `Pedido · ${formatoFechaCO(new Date().toISOString(), { day: 'numeric', month: 'long' })}\n\n`
      + this.sugeridos().map((x) => `• ${x.nombre}: ${x.sugerido}`).join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      this.toast.ok('Lista copiada: pégala en WhatsApp al proveedor');
    } catch {
      this.toast.error('No se pudo copiar la lista');
    }
  }

  /** Abre "Registrar compra" con lo sugerido ya puesto (se ajusta lo que de verdad llegó) */
  comprarSugeridos(): void {
    this.abrirCompra();
    const porId = new Map(this.productos().map((p) => [p.id, p]));
    this.lineas.set(this.sugeridos().flatMap((x) => {
      const p = porId.get(x.id);
      return p ? [{ producto: p, cantidad: x.sugerido, costo: p.costo ?? null }] : [];
    }));
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('inventario');
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.productos.set((data ?? []) as Prod[]);
  }

  private urgencia(p: Prod): number {
    if (p.stock <= 0) return 0;
    return p.stock <= p.stock_minimo ? 1 : 2;
  }

  nivel(p: Prod): string {
    if (p.stock <= 0) return 'agotado';
    return p.stock <= p.stock_minimo ? 'bajo' : '';
  }

  // ---------- Conteo ----------
  abrirConteo(p: Prod): void {
    this.contado = p.stock;
    this.minimo = p.stock_minimo;
    this.motivo = '';
    this.error.set('');
    this.contando.set(p);
  }

  async guardarConteo(): Promise<void> {
    const p = this.contando();
    if (!p) return;
    if (this.contado === null || this.contado < 0) return this.error.set('Escribe cuántos hay.');
    this.ocupado.set(true);
    const r1 = await this.sb.client.rpc('ajustar_stock', { p_producto: p.id, p_contado: Math.round(this.contado), p_motivo: this.motivo.trim() });
    const r2 = this.minimo !== p.stock_minimo
      ? await this.sb.client.rpc('guardar_stock_minimo', { p_producto: p.id, p_minimo: Math.max(0, Math.round(this.minimo ?? 0)) })
      : { error: null };
    this.ocupado.set(false);
    const error = r1.error ?? r2.error;
    if (error) return this.error.set(mensajeError(error));
    this.toast.ok(`${p.nombre}: quedan ${Math.round(this.contado)}`);
    this.contando.set(null);
    await this.cargar();
  }

  // ---------- Historial ----------
  async abrirHistorial(p: Prod): Promise<void> {
    this.movimientos.set([]);
    this.historialDe.set(p);
    this.cargandoMov.set(true);
    const { data, error } = await this.sb.client.rpc('movimientos_producto', { p_producto: p.id });
    this.cargandoMov.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.movimientos.set((data ?? []) as Movimiento[]);
  }

  tipoMov(t: string): string {
    return ({ compra: 'Compra', ajuste: 'Conteo', anulacion: 'Compra anulada', venta: 'Venta', devolucion: 'Devolución' } as Record<string, string>)[t] ?? t;
  }

  // ---------- Compras ----------
  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    void this.cargarCompras();
  }

  private async cargarCompras(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    const { data, error } = await this.sb.client.rpc('compras_lista', { p_desde: r.desde || '2020-01-01', p_hasta: r.hasta || this.hoy });
    if (error) return this.toast.error(mensajeError(error));
    const lista = (data ?? []) as Compra[];
    this.compras.set(lista);
    const faltan = lista.flatMap((c) => c.comprobantes.slice(0, 1)).filter((f) => !this.fotos()[f]);
    if (faltan.length) {
      const urls = await urlsComprobantes(this.sb.client, faltan);
      this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
    }
  }

  abrirCompra(): void {
    this.proveedor = '';
    this.fechaCompra = this.hoy;
    this.nota = '';
    this.buscaS.set('');
    this.lineas.set([]);
    this.facturas.set([]);
    this.actualizarCosto = true;
    this.error.set('');
    this.formCompra.set(true);
  }

  agregar(p: Prod): void {
    this.lineas.update((l) => [...l, { producto: p, cantidad: null, costo: p.costo ?? null }]);
    this.buscaS.set('');
  }

  quitarLinea(i: number): void {
    this.lineas.update((l) => l.filter((_, j) => j !== i));
  }

  tocar(): void {
    this.version.update((v) => v + 1);
  }

  async guardarCompra(): Promise<void> {
    if (!this.proveedor.trim()) return this.error.set('Escribe el proveedor.');
    const lineas = this.lineas();
    if (!lineas.length) return this.error.set('Agrega al menos un producto.');
    if (lineas.some((l) => !l.cantidad || l.cantidad <= 0)) return this.error.set('Escribe la cantidad de cada producto.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('registrar_compra', {
      p_fecha: this.fechaCompra || this.hoy,
      p_proveedor: this.proveedor.trim(),
      p_nota: this.nota.trim(),
      // Si no es admin, la base de datos ignora el costo y usa el del producto
      p_items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: Math.round(Number(l.cantidad)), costo: Number(l.costo) || 0 })),
      p_comprobantes: this.facturas(),
      p_actualizar_costo: this.esAdmin() && this.actualizarCosto,
    });
    this.ocupado.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.toast.ok(`Compra registrada: +${this.unidades()} unidades`);
    this.formCompra.set(false);
    await Promise.all([this.cargar(), this.cargarCompras()]);
  }

  async anular(c: Compra): Promise<void> {
    const ok = await confirmar(`¿Anular la compra a ${c.proveedor}? Se le restan al inventario las unidades que sumó.`,
      { titulo: 'Anular compra', aceptar: 'Anular', peligro: true });
    if (!ok) return;
    const { error } = await this.sb.client.rpc('anular_compra', { p_id: c.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Compra anulada');
    await Promise.all([this.cargar(), this.cargarCompras()]);
  }

  verFactura(c: Compra): void {
    void urlsComprobantes(this.sb.client, c.comprobantes).then((urls) =>
      this.visor.abrir(urls.map((url) => ({ url, titulo: `Factura · ${c.proveedor}` })), 0)
    );
  }

  resumenItems(c: Compra): string {
    const items = c.items ?? [];
    const n = items.reduce((s, i) => s + i.cantidad, 0);
    const nombres = items.slice(0, 3).map((i) => `${i.cantidad} ${i.nombre}`).join(', ');
    return `${nombres}${items.length > 3 ? ` y ${items.length - 3} más` : ''} · ${n} unidades`;
  }

  dia(f: string): string {
    return diaCorto(f);
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}

function normal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
