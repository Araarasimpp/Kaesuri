import { ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { MetodoPago } from '../../shared/models/models';

interface PedidoResumen {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
}

@Component({
  selector: 'app-entregar-pedido',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './entregar-pedido.component.html',
  styleUrls: ['./entregar-pedido.component.scss'],
})
export class EntregarPedidoComponent {
  @Input() pedido!: PedidoResumen;
  @Output() cerrar = new EventEmitter<void>();
  @Output() entregado = new EventEmitter<void>();

  metodoPago: MetodoPago | null = null;
  archivoComprobante: File | null = null;
  previewComprobante: string | null = null;

  guardando = false;
  errorMsg = '';

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  onArchivoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.archivoComprobante = file;
    this.previewComprobante = URL.createObjectURL(file);
  }

  async onConfirmar(): Promise<void> {
    this.errorMsg = '';

    if (!this.metodoPago) {
      this.errorMsg = 'Selecciona el método de pago.';
      return;
    }

    if (this.metodoPago === 'transferencia' && !this.archivoComprobante) {
      this.errorMsg = 'Adjunta la foto del comprobante de transferencia.';
      return;
    }

    this.guardando = true;

    try {
      let comprobanteUrl: string | null = null;

      if (this.archivoComprobante) {
        comprobanteUrl = await this.subirComprobante(this.archivoComprobante);
      }

      const { error } = await this.supabase.client
        .from('pedidos')
        .update({
          estado: 'entregado',
          entregado_at: new Date().toISOString(),
          metodo_pago: this.metodoPago,
          comprobante_url: comprobanteUrl,
        })
        .eq('id', this.pedido.id);

      this.guardando = false;

      if (error) {
        this.errorMsg = 'No se pudo confirmar la entrega. Intenta de nuevo.';
        this.cdr.detectChanges();
        return;
      }

      this.entregado.emit();
    } catch {
      this.guardando = false;
      this.errorMsg = 'No se pudo subir el comprobante. Intenta de nuevo.';
      this.cdr.detectChanges();
    }
  }

  private async subirComprobante(file: File): Promise<string> {
    const extension = file.name.split('.').pop();
    const ruta = `${this.pedido.id}-${Date.now()}.${extension}`;

    const { error } = await this.supabase.client.storage
      .from('comprobantes')
      .upload(ruta, file, { upsert: false });

    if (error) throw error;

    // El bucket es privado, así que se guarda solo la ruta interna;
    // la URL firmada (temporal) se genera al momento de querer VER la imagen,
    // no aquí, para no guardar una URL que expira.
    return ruta;
  }

  onCerrar(): void {
    this.cerrar.emit();
  }
}