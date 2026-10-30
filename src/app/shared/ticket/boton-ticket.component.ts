import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { printOutline, ellipsisHorizontal } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { DatosNegocio, RotuloService } from '../rotulo.service';
import { mensajeError } from '../formato';
import { ImpresoraService } from './impresora.service';
import { VentaTicket, lineasTicket, ticketEscPos, ticketPng } from './ticket';
import { mostrarTicket } from './vista-ticket';

let negocioCache: Promise<DatosNegocio> | null = null;

/** Botón "Imprimir ticket" de una venta en el local, con sus opciones (ver ticket, RawBT, cambiar impresora) */
@Component({
  selector: 'app-boton-ticket',
  standalone: true,
  imports: [IonIcon],
  styles: [
    `
      :host { display: contents; }
      .grupo { flex: 1 1 100%; display: flex; gap: 6px; position: relative; }
      .grupo .b:first-child { flex: 1; }
      .grupo .b-icono { flex: 0 0 44px; }
      .menu { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 20; width: min(300px, calc(100vw - 32px)); padding: 8px; border: 1px solid var(--border);
        border-radius: var(--radius-lg); background: var(--surface); box-shadow: 0 12px 32px rgba(0, 0, 0, .16); display: flex; flex-direction: column; gap: 2px; }
      .menu button, .menu label { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 10px; border: 0; border-radius: 8px; background: none;
        color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
      .menu button:hover, .menu label:hover { background: var(--surface-2); }
      .menu small { display: block; margin-top: 2px; font-size: 12px; color: var(--text-muted); line-height: 1.35; }
      .menu input { margin-top: 3px; accent-color: var(--accent); }
    `,
  ],
  template: `
    <div class="grupo">
      <button type="button" class="b" [class.b-pri]="principal" (click)="imprimir()" [disabled]="ocupado()">
        <ion-icon name="print-outline"></ion-icon>{{ ocupado() ? 'Imprimiendo…' : 'Imprimir ticket' }}
      </button>
      <button type="button" class="b b-icono" aria-label="Opciones del ticket" [attr.aria-expanded]="menu()" (click)="menu.set(!menu())">
        <ion-icon name="ellipsis-horizontal"></ion-icon>
      </button>
      @if (menu()) {
        <div class="menu" role="menu">
          <button type="button" role="menuitem" (click)="ver()">
            <span>Ver ticket<small>Como imagen, para compartirlo (WhatsApp, AirPrint, la app de la impresora) o imprimirlo con el celular</small></span>
          </button>
          @if (imp.esAndroid) {
            <label>
              <input type="checkbox" [checked]="imp.usarRawbt()" (change)="imp.ponerRawbt($any($event.target).checked)" />
              <span>Imprimir con la app RawBT<small>Si la impresora no aparece al buscarla (Bluetooth clásico). Instala RawBT de Play Store y vincula ahí la impresora.</small></span>
            </label>
          }
          @if (imp.nombre(); as n) {
            <button type="button" role="menuitem" (click)="imp.olvidar(); menu.set(false)">
              <span>Cambiar de impresora<small>Ahora: {{ n }}</small></span>
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class BotonTicketComponent implements OnInit {
  /** La venta, por su id o por su número visible (se busca al tocar el botón) */
  @Input() pedidoId: string | null = null;
  @Input() numero: number | null = null;
  /** Botón principal (después de registrar la venta) */
  @Input() principal = false;

  imp = inject(ImpresoraService);
  private sb = inject(SupabaseService);
  private rotulos = inject(RotuloService);
  private toast = inject(ToastService);

  ocupado = signal(false);
  menu = signal(false);

  constructor() {
    addIcons({ printOutline, ellipsisHorizontal });
  }

  ngOnInit(): void {
    // Los datos del negocio se traen de una vez, para que al tocar el ticket salga sin esperar
    void this.negocio().catch(() => undefined);
  }

  private negocio(): Promise<DatosNegocio> {
    return (negocioCache ??= this.rotulos.cargarNegocio().catch((e) => { negocioCache = null; throw e; }));
  }

  /** La venta con sus productos y el código de seguimiento (para el QR de la garantía) */
  private async venta(): Promise<VentaTicket> {
    let q = this.sb.client
      .from('pedidos')
      .select('id, numero, created_at, estado, cliente_nombre, total, metodo_pago, monto_efectivo, monto_transferencia, ' +
        'vendedor:profiles!pedidos_vendedor_id_fkey(nombre), pedido_items(cantidad, precio_unitario, color, talla, productos(nombre))');
    q = this.pedidoId ? q.eq('id', this.pedidoId) : q.eq('numero', this.numero!);
    const { data, error } = await q.single();
    if (error || !data) throw new Error('No se encontró la venta');
    const v = data as unknown as VentaTicket & { id: string };
    const { data: codigo } = await this.sb.client.rpc('codigo_seguimiento', { p_pedido: v.id });
    return { ...v, seguimiento: (codigo as string | null) ?? null };
  }

  private async ticket() {
    const [negocio, venta] = await Promise.all([this.negocio(), this.venta()]);
    return { numero: venta.numero, lineas: lineasTicket(venta, negocio) };
  }

  async imprimir(): Promise<void> {
    // Sin Bluetooth en el navegador (iPhone, computador): se muestra el ticket para compartirlo o imprimirlo
    if (!this.imp.bluetooth && !(this.imp.esAndroid && this.imp.usarRawbt())) return this.ver();
    this.menu.set(false);
    this.ocupado.set(true);
    try {
      await this.imp.preparar();
      const como = await this.imp.imprimir(ticketEscPos((await this.ticket()).lineas));
      if (como === 'bluetooth') this.toast.ok(`Ticket enviado a ${this.imp.nombre() ?? 'la impresora'}`);
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  /** El ticket como imagen dentro de la app, para compartirlo o imprimirlo con el celular */
  async ver(): Promise<void> {
    this.menu.set(false);
    this.ocupado.set(true);
    try {
      const t = await this.ticket();
      mostrarTicket(await ticketPng(t.lineas), `ticket-venta-${t.numero}.png`);
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }
}
