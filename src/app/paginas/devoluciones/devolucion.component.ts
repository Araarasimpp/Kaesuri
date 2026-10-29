import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoFechaCO } from '../../shared/fecha-colombia';

type Tipo = 'devolucion' | 'cambio' | 'garantia';

/** Lo que devuelve pedido_para_devolucion: el pedido con sus productos y lo ya devuelto */
export interface PedidoDevolucion {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  estado: string;
  total: number;
  entregado_at: string | null;
  vendedor: string | null;
  items: ItemDevolucion[];
}
export interface ItemDevolucion {
  id: string;
  cantidad: number;
  precio: number;
  nombre: string;
  devueltas: number;
}

const MOTIVOS = [
  { id: 'defectuoso', label: 'Salió defectuoso' },
  { id: 'llego_danado', label: 'Llegó dañado' },
  { id: 'no_le_gusto', label: 'No le gustó' },
  { id: 'talla_color', label: 'Talla o color' },
  { id: 'incompleto', label: 'Llegó incompleto' },
  { id: 'otro', label: 'Otro motivo' },
];

/**
 * Hoja para registrar una devolución, un cambio o una garantía de un pedido entregado
 * (como en Jasta): qué productos y cuántos, por qué, si el producto vuelve al inventario
 * o se dañó, y (en una devolución) cuánto se le devuelve al cliente y si se le descuenta
 * la comisión al vendedor. Se abre con el pedido ya cargado, con su número o su id; sin
 * nada, primero pide el número del pedido.
 */
@Component({
  selector: 'app-devolucion',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, ComprobantesInputComponent],
  styles: [
    `
      :host { display: contents; }
      .tipos, .estados { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .estados { grid-template-columns: 1fr 1fr; }
      .op { min-height: 44px; padding: 6px 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface);
        color: var(--text); font: inherit; font-size: 13.5px; font-weight: 550; cursor: pointer; text-align: center; line-height: 1.2; }
      .op small { display: block; font-size: 11.5px; font-weight: 450; color: var(--text-muted); }
      .op.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); }
      .motivos { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip { height: 34px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text);
        font: inherit; font-size: 13px; cursor: pointer; }
      .chip.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .items { display: flex; flex-direction: column; gap: 8px; }
      .item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--surface-2); }
      .item .nom { font-size: 13.5px; font-weight: 550; }
      .item small { display: block; font-size: 12px; color: var(--text-muted); }
      .paso { display: flex; align-items: center; gap: 6px; }
      .paso button { width: 32px; height: 32px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); font-size: 18px; cursor: pointer; }
      .paso button:disabled { opacity: .4; cursor: default; }
      .paso span { min-width: 22px; text-align: center; font-family: var(--mono-font); font-weight: 700; }
      .check { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; }
      .nota-com { margin: 0; font-size: 12.5px; color: var(--text-soft); }
      .resumen { margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13px; color: var(--text-soft); }
      .resumen strong { color: var(--text); font-size: 14px; }
      .buscar { display: flex; gap: 8px; }
      .buscar input { flex: 1; min-width: 0; }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cerrar" (click)="cerrar.emit()"></button>
    <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-dev">
      @if (pedidoS(); as p) {
        <div class="hoja-head"><h2 id="t-dev">Devolución o garantía · #{{ p.numero }}</h2></div>
        <div class="hoja-body">
          <p class="resumen"><strong>{{ p.cliente_nombre }}</strong> · {{ pesos(p.total) }}
            @if (p.entregado_at) { · entregado el {{ dia(p.entregado_at) }} }@if (p.vendedor) { · vendió {{ p.vendedor }} }</p>

          <div class="campo"><span class="etq">¿Qué pasó?</span>
            <div class="tipos">
              <button type="button" class="op" [class.on]="tipo() === 'devolucion'" (click)="elegirTipo('devolucion')">Devolución<small>Se le devuelve la plata</small></button>
              <button type="button" class="op" [class.on]="tipo() === 'cambio'" (click)="elegirTipo('cambio')">Cambio<small>Lo cambia por otro</small></button>
              <button type="button" class="op" [class.on]="tipo() === 'garantia'" (click)="elegirTipo('garantia')">Garantía<small>Falló y se responde</small></button>
            </div>
          </div>

          <div class="campo"><span class="etq">¿Qué productos?</span>
            <div class="items">
              @for (i of p.items; track i.id) {
                <div class="item">
                  <span><span class="nom">{{ i.nombre }}</span>
                    <small>Compró {{ i.cantidad }} · {{ pesos(i.precio) }} c/u@if (i.devueltas) { · ya devolvió {{ i.devueltas }} }</small></span>
                  <span class="paso">
                    <button type="button" (click)="cambiar(i, -1)" [disabled]="!cant()[i.id]" aria-label="Menos">−</button>
                    <span>{{ cant()[i.id] || 0 }}</span>
                    <button type="button" (click)="cambiar(i, 1)" [disabled]="(cant()[i.id] || 0) >= maximo(i)" aria-label="Más">+</button>
                  </span>
                </div>
              }
            </div>
          </div>

          <div class="campo"><span class="etq">Motivo</span>
            <div class="motivos">
              @for (m of motivos; track m.id) {
                <button type="button" class="chip" [class.on]="motivo() === m.id" (click)="motivo.set(m.id)">{{ m.label }}</button>
              }
            </div>
          </div>

          <div class="campo"><span class="etq">El producto que regresa</span>
            <div class="estados">
              <button type="button" class="op" [class.on]="estado() === 'vuelve_stock'" (click)="estado.set('vuelve_stock')">Está bien<small>Vuelve al inventario</small></button>
              <button type="button" class="op" [class.on]="estado() === 'danado'" (click)="estado.set('danado')">Está dañado<small>No se puede vender</small></button>
            </div>
          </div>

          @if (tipo() === 'devolucion') {
            <div class="fila-campos">
              <div class="campo"><label for="dv-re">Se le devuelve</label><input id="dv-re" class="num" type="number" inputmode="numeric" min="0" [(ngModel)]="reembolso" /></div>
              <div class="campo"><label for="dv-me">¿Cómo?</label>
                <select id="dv-me" [(ngModel)]="metodo"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="otro">Otro</option></select></div>
            </div>
            <p class="nota-com">Valor de lo que devuelve: {{ pesos(valorSel()) }}</p>
            @if (p.vendedor) {
              <label class="check"><input type="checkbox" [(ngModel)]="descontarComision" />
                <span>Descontarle a {{ p.vendedor }} su comisión de estas unidades en su próxima liquidación</span></label>
            }
          } @else {
            <label class="check"><input type="checkbox" [(ngModel)]="reemplazo" /> <span>Se le entregó otro igual (sale del inventario)</span></label>
          }

          @if (puedeFotos()) {
            @if (conFotos() || fotos().length) {
              <app-comprobantes-input titulo="Fotos" pista="Foto del producto o del comprobante del reembolso." [rutas]="fotos()"
                (cambio)="fotos.set($event)"></app-comprobantes-input>
            } @else {
              <button type="button" class="b" (click)="conFotos.set(true)">Agregar fotos (opcional)</button>
            }
          }
          <div class="campo"><label for="dv-no">Nota (opcional)</label><input id="dv-no" maxlength="300" [(ngModel)]="nota" placeholder="Ej: la pantalla no prende" /></div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          @if (!fijo()) { <button class="b" (click)="volver()">Otro pedido</button> } @else { <button class="b" (click)="cerrar.emit()">Cancelar</button> }
          <button class="b b-pri" (click)="guardar()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Registrar' }}</button>
        </div>
      } @else {
        <div class="hoja-head"><h2 id="t-dev">Registrar devolución</h2></div>
        <div class="hoja-body">
          @if (fijo()) {
            <p class="nota-com">{{ buscando() ? 'Cargando el pedido…' : '' }}</p>
          } @else {
            <div class="campo"><label for="dv-num">Número del pedido</label>
              <div class="buscar">
                <input id="dv-num" class="num" type="number" inputmode="numeric" min="1" placeholder="Ej: 1234" [(ngModel)]="numeroTxt" (keyup.enter)="buscar()" />
                <button class="b b-pri" (click)="buscar()" [disabled]="buscando()">{{ buscando() ? 'Buscando…' : 'Buscar' }}</button>
              </div>
            </div>
            <p class="nota-com">Solo se registran devoluciones, cambios y garantías de pedidos entregados.</p>
          }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="cerrar.emit()">Cancelar</button>
        </div>
      }
    </div>
  `,
})
export class DevolucionComponent implements OnInit {
  private sb = inject(SupabaseService);

  /** El pedido ya cargado con pedido_para_devolucion */
  @Input() pedido: PedidoDevolucion | null = null;
  /** O el número visible del pedido */
  @Input() numero: number | null = null;
  /** O el id (uuid) del pedido */
  @Input() pedidoId: string | null = null;
  @Output() cerrar = new EventEmitter<void>();
  @Output() registrado = new EventEmitter<void>();

  motivos = MOTIVOS;
  pedidoS = signal<PedidoDevolucion | null>(null);
  /** Se abrió para un pedido dado (no se puede cambiar de pedido) */
  fijo = signal(false);
  buscando = signal(false);
  numeroTxt: number | null = null;

  tipo = signal<Tipo>('devolucion');
  motivo = signal('defectuoso');
  estado = signal<'vuelve_stock' | 'danado'>('vuelve_stock');
  cant = signal<Record<string, number>>({});
  fotos = signal<string[]>([]);
  conFotos = signal(false);
  error = signal('');
  guardando = signal(false);
  reemplazo = true;
  descontarComision = true;
  metodo = 'efectivo';
  nota = '';
  reembolso: number | null = null;
  pesos = pesos;
  /** Solo el admin puede subir fotos al bucket de comprobantes */
  puedeFotos = signal(false);

  valorSel = computed(() => (this.pedidoS()?.items ?? []).reduce((s, i) => s + (this.cant()[i.id] || 0) * Number(i.precio), 0));

  async ngOnInit(): Promise<void> {
    void this.sb.getCurrentProfile().then((p) => this.puedeFotos.set(!!p && rolesDe(p).includes('admin')));
    if (this.pedido) {
      this.fijo.set(true);
      return this.usar(this.pedido);
    }
    if (this.numero || this.pedidoId) {
      this.fijo.set(true);
      let n = this.numero;
      if (!n && this.pedidoId) {
        this.buscando.set(true);
        const { data, error } = await this.sb.client.from('pedidos').select('numero').eq('id', this.pedidoId).maybeSingle();
        this.buscando.set(false);
        if (error) return this.error.set(mensajeError(error));
        n = (data as { numero: number } | null)?.numero ?? null;
        if (!n) return this.error.set('No se encontró el pedido.');
      }
      await this.cargar(n!);
    }
  }

  async buscar(): Promise<void> {
    const n = Math.trunc(Number(this.numeroTxt));
    if (!n || n < 1) return this.error.set('Escribe el número del pedido.');
    await this.cargar(n);
  }

  private async cargar(n: number): Promise<void> {
    this.error.set('');
    this.buscando.set(true);
    const { data, error } = await this.sb.client.rpc('pedido_para_devolucion', { p_numero: n });
    this.buscando.set(false);
    if (error) return this.error.set(mensajeError(error));
    const p = data as PedidoDevolucion | null;
    if (!p) return this.error.set(`No existe el pedido #${n}.`);
    if (p.estado !== 'entregado') return this.error.set(`El pedido #${n} no está entregado: solo se registran devoluciones de pedidos entregados.`);
    if (!p.items?.length) return this.error.set(`El pedido #${n} no tiene productos.`);
    this.usar(p);
  }

  private usar(p: PedidoDevolucion): void {
    this.error.set('');
    this.pedidoS.set(p);
    this.tipo.set('devolucion');
    this.fotos.set([]);
    this.conFotos.set(false);
    // Con un solo producto (y algo por devolver), ya queda elegido
    const uno = p.items.length === 1 ? p.items[0] : null;
    this.cant.set(uno && this.maximo(uno) > 0 ? { [uno.id]: 1 } : {});
    this.reembolso = this.valorSel() || null;
  }

  /** Vuelve a pedir el número (para registrar la de otro pedido) */
  volver(): void {
    this.pedidoS.set(null);
    this.error.set('');
  }

  elegirTipo(t: Tipo): void {
    this.tipo.set(t);
    // En una devolución no se puede pasar de lo que falta por devolver
    const p = this.pedidoS();
    if (!p) return;
    this.cant.update((c) => Object.fromEntries(Object.entries(c).map(([id, n]) => {
      const i = p.items.find((x) => x.id === id);
      return [id, i ? Math.min(n, this.maximo(i)) : n];
    })));
  }

  maximo(i: ItemDevolucion): number {
    return this.tipo() === 'devolucion' ? Math.max(0, i.cantidad - (Number(i.devueltas) || 0)) : i.cantidad;
  }

  cambiar(i: ItemDevolucion, d: number): void {
    const antes = this.valorSel();
    const n = Math.min(this.maximo(i), Math.max(0, (this.cant()[i.id] || 0) + d));
    this.cant.update((c) => ({ ...c, [i.id]: n }));
    // El reembolso sigue el valor de lo elegido mientras no lo hayan cambiado a mano
    if (this.reembolso === null || this.reembolso === antes) this.reembolso = this.valorSel();
  }

  dia(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' });
  }

  async guardar(): Promise<void> {
    const p = this.pedidoS();
    if (!p) return;
    const items = Object.entries(this.cant()).filter(([, n]) => n > 0).map(([id, n]) => ({ item_id: id, cantidad: n }));
    if (!items.length) return this.error.set('Elige qué productos y cuántos.');
    const t = this.tipo();
    if (t === 'devolucion' && (this.reembolso ?? 0) > Number(p.total)) return this.error.set('El reembolso no puede ser mayor que el pedido.');
    this.error.set('');
    this.guardando.set(true);
    const { error } = await this.sb.client.rpc('registrar_devolucion', {
      p_pedido: p.id, p_items: items, p_tipo: t, p_motivo: this.motivo(), p_estado_producto: this.estado(),
      p_reemplazo: t !== 'devolucion' && this.reemplazo, p_reembolso: t === 'devolucion' ? Number(this.reembolso) || 0 : 0,
      p_metodo: this.metodo, p_descontar_comision: t === 'devolucion' && this.descontarComision, p_nota: this.nota.trim(), p_fotos: this.fotos(),
    });
    this.guardando.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.registrado.emit();
  }
}
