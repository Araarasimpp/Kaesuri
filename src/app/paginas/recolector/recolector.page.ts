import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addCircleOutline, bagHandleOutline, checkmarkOutline, closeOutline, walletOutline } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, UserRole, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { DiaComponent } from '../../shared/rango/dia.component';
import { RangoFechas } from '../../shared/rango/rango.component';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { mensajeError, numero, pesos } from '../../shared/formato';
import { formatoFechaCO, formatoHoraCO } from '../../shared/fecha-colombia';

interface Pendiente { id: number; monto: number; nombre: string; de: string | null; recolector: string; fecha: string }
interface Movimiento {
  tipo: 'base' | 'compra';
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
}
interface Resumen {
  base: number;
  compras: number;
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
 * Cuadre = bases − compras (lo que debe tener en la mano). Como en Jasta.
 */
@Component({
  selector: 'app-recolector',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon, DiaComponent, ComprobantesInputComponent],
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
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
      .hoja-centro .hoja-body { gap: 14px; }
      .hoja-head h2 { margin: 0 auto 0 0; }
      .aviso-neg { margin: 0; font-size: 12.5px; color: var(--danger); }

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
          <button class="b" (click)="abrirBase()"><ion-icon name="add-circle-outline"></ion-icon>{{ admin() && !esRecolector() ? 'Enviar base' : 'Agregar base' }}</button>
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

      <section class="resumen" aria-labelledby="t-res" [attr.aria-busy]="cargando()">
        <h2 id="t-res">Resumen</h2>
        <div class="renglon"><span class="lbl">Base<small>{{ numero(r()?.n_bases) }} {{ r()?.n_bases === 1 ? 'base' : 'bases' }}</small></span><span class="punteado"></span>
          <span class="val">{{ pesos(r()?.base) }}</span></div>
        <div class="renglon compras"><span class="lbl">Compras<small>{{ numero(r()?.n_compras) }}</small></span><span class="punteado"></span>
          <span class="val">− {{ pesos(r()?.compras) }}</span></div>
        <div class="renglon total" [class.neg]="cuadre() < 0"><span class="lbl">Cuadre<small>{{ cuadre() < 0 ? 'Gastó más de la base' : 'Lo que debe tener en la mano' }}</small></span>
          <span class="punteado"></span><span class="val">{{ pesos(cuadre()) }}</span></div>
      </section>

      <section class="panel" aria-labelledby="t-movs">
        <div class="panel-head"><div><h2 id="t-movs">Movimientos del día</h2><p class="panel-sub">Bases que entraron y compras</p></div></div>
        @if (r()?.movimientos?.length) {
          <ul class="movs">
            @for (m of r()!.movimientos; track m.tipo + m.id) {
              <li class="mov">
                <span class="ico" [class]="'ico ' + m.tipo" aria-hidden="true"><ion-icon [name]="m.tipo === 'base' ? 'wallet-outline' : 'bag-handle-outline'"></ion-icon></span>
                <span style="min-width: 0">
                  @if (m.tipo === 'base') {
                    <span class="t1">{{ m.nombre }}</span>
                    <span class="t2">Base · {{ m.quien || '—' }} · {{ hora(m.fecha) }}@if (esAdmin() && !filtroRec) { · {{ m.recolector }} }</span>
                  } @else {
                    <span class="t1">{{ m.producto }}</span>
                    <span class="t2">{{ m.proveedor }} · {{ hora(m.fecha) }}@if (esAdmin() && !filtroRec) { · {{ m.recolector }} }</span>
                  }
                </span>
                <span class="der">
                  <span class="monto" [class.base]="m.tipo === 'base'" [class.compra]="m.tipo === 'compra'" [class.tachado]="m.tipo === 'base' && m.estado !== 'aceptada'">
                    {{ m.tipo === 'base' ? '+' : '−' }}{{ pesos(m.valor) }}</span>
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
          <p class="vacio-txt">{{ cargando() ? 'Cargando…' : 'Todavía no hay bases ni compras este día.' }}</p>
        }
      </section>
    </div>

    <!-- Agregar o enviar base -->
    @if (formBase()) {
      <button class="velo" aria-label="Cerrar" (click)="formBase.set(false)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-base">
        <div class="hoja-head"><h2 id="t-base">{{ admin() && !esRecolector() ? 'Enviar base' : 'Agregar base' }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="formBase.set(false)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          @if (admin() && !esRecolector()) {
            <div class="campo"><label for="br">Recolector</label>
              <select id="br" class="inp" [(ngModel)]="baseRec">
                @for (x of r()?.recolectores ?? []; track x.id) { <option [ngValue]="x.id">{{ x.nombre }}</option> }
              </select>
              @if (!(r()?.recolectores?.length)) { <p class="ayuda">No hay usuarios con el rol Recolector. Asígnalo en Usuarios.</p> }
            </div>
          }
          <div class="campo"><label for="bm">Valor</label><input id="bm" class="inp num" type="number" inputmode="numeric" min="0" step="1000" [(ngModel)]="baseMonto" /></div>
          <div class="campo"><label for="bn">Nombre de la base</label>
            <input id="bn" class="inp" maxlength="120" [(ngModel)]="baseNombre" placeholder="¿De dónde viene? Ej: caja del local, ventas de la mañana" /></div>
          @if (admin() && !esRecolector()) { <p class="ayuda" style="margin: 0">Le llega un aviso al recolector; se suma cuando la acepte.</p> }
          @if (errorForm()) { <p class="error" role="alert">{{ errorForm() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="formBase.set(false)">Cancelar</button>
          <button class="b b-ok" (click)="guardarBase()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : admin() && !esRecolector() ? 'Enviar base' : 'Agregar base' }}</button>
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
          <div class="campo"><label for="cv">Valor</label><input id="cv" class="inp num" type="number" inputmode="numeric" min="0" step="100" [(ngModel)]="compraValor" /></div>
          @if ((compraValor || 0) > cuadre() && cuadre() >= 0) { <p class="aviso-neg">Es más de lo que queda de base ({{ pesos(cuadre()) }}).</p> }
          <div class="campo"><label for="cp">Proveedor</label><input id="cp" class="inp" maxlength="120" [(ngModel)]="compraProveedor" placeholder="Ej: Distribuidora El Centro" /></div>
          <div class="campo"><label for="cd">Producto</label><input id="cd" class="inp" maxlength="200" [(ngModel)]="compraProducto" placeholder="Ej: 20 cables USB-C" /></div>
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

  private roles = computed<UserRole[]>(() => {
    const p = this.sb.perfil();
    return p ? rolesDe(p) : [];
  });
  /** Ve a todos los recolectores */
  esAdmin = computed(() => this.roles().includes('admin'));
  admin = this.esAdmin;
  soloLectura = computed(() => !this.roles().some((r) => r === 'admin' || r === 'recolector'));
  esRecolector = computed(() => this.roles().includes('recolector'));
  cuadre = computed(() => Number(this.r()?.base ?? 0) - Number(this.r()?.compras ?? 0));

  pesos = pesos;
  numero = numero;
  private dia = '';
  private consulta = 0;
  private canal: RealtimeChannel | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    addIcons({ addCircleOutline, bagHandleOutline, checkmarkOutline, closeOutline, walletOutline });
  }

  ngOnInit(): void {
    void this.sb.getCurrentProfile();
    // Una base enviada o aceptada (o una compra) aparece sola
    const recargar = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.cargar(), 500);
    };
    this.canal = this.sb.client
      .channel('recoleccion-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_bases' }, recargar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recoleccion_compras' }, recargar)
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

  // ---------- Bases ----------
  abrirBase(): void {
    this.baseMonto = null;
    this.baseNombre = '';
    this.baseRec = this.filtroRec ?? this.r()?.recolectores?.[0]?.id ?? null;
    this.errorForm.set('');
    this.formBase.set(true);
  }

  async guardarBase(): Promise<void> {
    const monto = Number(this.baseMonto) || 0;
    if (monto <= 0) return this.errorForm.set('Escribe el valor de la base.');
    if (!this.baseNombre.trim()) return this.errorForm.set('Ponle nombre a la base (de dónde viene).');
    const enviar = this.admin() && !this.esRecolector();
    if (enviar && !this.baseRec) return this.errorForm.set('Elige el recolector.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('recoleccion_agregar_base', {
      p_monto: monto, p_nombre: this.baseNombre.trim(), p_recolector: enviar ? this.baseRec : null,
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    this.toast.ok(enviar ? `Base de ${pesos(monto)} enviada: falta que la acepte` : `Base de ${pesos(monto)} sumada`);
    this.formBase.set(false);
    await this.cargar();
  }

  async responder(p: Pendiente, aceptar: boolean): Promise<void> {
    if (!aceptar && !confirm(`¿Rechazar la base de ${pesos(p.monto)} (${p.nombre})?`)) return;
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
    this.errorForm.set('');
    this.formCompra.set(true);
  }

  async guardarCompra(): Promise<void> {
    const valor = Number(this.compraValor) || 0;
    if (valor <= 0) return this.errorForm.set('Escribe el valor de la compra.');
    if (!this.compraProveedor.trim()) return this.errorForm.set('Escribe el proveedor.');
    if (!this.compraProducto.trim()) return this.errorForm.set('Escribe qué compraste.');
    if (!this.compraFacturas().length) return this.errorForm.set('Sube la foto de la factura.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('recoleccion_registrar_compra', {
      p_valor: valor, p_proveedor: this.compraProveedor.trim(), p_producto: this.compraProducto.trim(), p_facturas: this.compraFacturas(),
    });
    this.ocupado.set(false);
    if (error) return this.errorForm.set(mensajeError(error));
    this.toast.ok(`Compra de ${pesos(valor)} registrada`);
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
