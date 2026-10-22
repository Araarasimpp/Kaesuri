import { ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { MetodoPago } from '../../shared/models/models';
import { llevaComprobante } from '../../shared/pago';
import { ComprobantesInputComponent } from '../../shared/comprobantes/comprobantes-input.component';

interface PedidoResumen {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
}

@Component({
  selector: 'app-entregar-pedido',
  standalone: true,
  imports: [CommonModule, FormsModule, ComprobantesInputComponent],
  templateUrl: './entregar-pedido.component.html',
  styleUrls: ['./entregar-pedido.component.scss'],
})
export class EntregarPedidoComponent {
  @Input() pedido!: PedidoResumen;
  /** Pedido de otro negocio (Jasta): se muestra en el título */
  @Input() negocio: string | null = null;
  /**
   * Para pedidos de otro negocio: guarda la entrega allá en vez de en Kaesuri.
   * Recibe las rutas de las fotos ya subidas al bucket de comprobantes de Kaesuri.
   */
  @Input() alConfirmar?: (metodo: MetodoPago, efectivo: number, transferencia: number, comprobantes: string[]) => Promise<void>;
  @Output() cerrar = new EventEmitter<void>();
  @Output() entregado = new EventEmitter<void>();

  metodoPago: MetodoPago | null = null;
  /** Fotos del comprobante (pueden ser varias, como en Jasta): ya subidas al bucket privado */
  comprobantes: string[] = [];
  /** Pago mixto: cuánto recibió en efectivo; el resto es transferencia. */
  montoEfectivo: number | null = null;

  guardando = false;
  errorMsg = '';

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  get llevaComprobante(): boolean {
    return llevaComprobante(this.metodoPago);
  }

  get montoTransferencia(): number {
    return Math.max(this.pedido.total - (this.montoEfectivo ?? 0), 0);
  }

  cambiarComprobantes(rutas: string[]): void {
    this.comprobantes = rutas;
    this.errorMsg = '';
    this.cdr.detectChanges();
  }

  async onConfirmar(): Promise<void> {
    this.errorMsg = '';

    if (!this.metodoPago) {
      this.errorMsg = 'Selecciona el método de pago.';
      return;
    }

    if (this.metodoPago === 'mixto') {
      const efectivo = this.montoEfectivo ?? 0;
      if (efectivo <= 0 || efectivo >= this.pedido.total) {
        this.errorMsg = 'El efectivo debe ser mayor que 0 y menor que el total del pedido.';
        return;
      }
    }

    if (this.llevaComprobante && !this.comprobantes.length) {
      this.errorMsg = 'Adjunta la foto del comprobante de transferencia.';
      return;
    }

    this.guardando = true;

    try {
      const comprobantes = this.llevaComprobante ? this.comprobantes : [];

      if (this.alConfirmar) {
        const efectivo = this.metodoPago === 'efectivo' ? this.pedido.total : this.metodoPago === 'mixto' ? this.montoEfectivo ?? 0 : 0;
        try {
          await this.alConfirmar(this.metodoPago, efectivo, this.pedido.total - efectivo, comprobantes);
        } catch (e) {
          this.guardando = false;
          this.errorMsg = (e as Error)?.message || 'No se pudo confirmar la entrega. Intenta de nuevo.';
          this.cdr.detectChanges();
          return;
        }
        this.guardando = false;
        this.entregado.emit();
        return;
      }

      const { error } = await this.supabase.client.rpc('entregar_pedido', {
        p_pedido_id: this.pedido.id,
        p_metodo: this.metodoPago,
        p_comprobantes: comprobantes,
        p_efectivo: this.metodoPago === 'mixto' ? this.montoEfectivo : null,
      });

      this.guardando = false;

      if (error) {
        this.errorMsg = 'No se pudo confirmar la entrega. Intenta de nuevo.';
        this.cdr.detectChanges();
        return;
      }

      this.entregado.emit();
    } catch {
      this.guardando = false;
      this.errorMsg = 'No se pudo confirmar la entrega. Intenta de nuevo.';
      this.cdr.detectChanges();
    }
  }

  onCerrar(): void {
    this.cerrar.emit();
  }
}