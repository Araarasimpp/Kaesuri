import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { Cuadre, MetodoPago } from '../../shared/models/models';

interface PedidoSinCuadrar {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
  valor_domicilio: number;
  metodo_pago: MetodoPago | null;
  comprobante_url: string | null;
}

@Component({
  selector: 'app-cuadres',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './cuadres.page.html',
  styleUrls: ['./cuadres.page.scss'],
})
export class CuadresPage implements OnInit {
  loading = true;
  pedidosHoy: PedidoSinCuadrar[] = [];
  historial: Cuadre[] = [];
  cerrando = false;
  errorMsg = '';

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
  }

  async cargarTodo(): Promise<void> {
    this.loading = true;
    const user = await this.supabase.getCurrentUser();

    if (!user) {
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);

    const [pedidosRes, cuadresRes] = await Promise.all([
      this.supabase.client
        .from('pedidos')
        .select('id, numero, cliente_nombre, total, valor_domicilio, metodo_pago, comprobante_url')
        .eq('domiciliario_id', user.id)
        .eq('estado', 'entregado')
        .is('cuadre_id', null)
        .gte('entregado_at', inicioHoy.toISOString()),
      this.supabase.client
        .from('cuadres')
        .select('*')
        .eq('domiciliario_id', user.id)
        .order('fecha', { ascending: false })
        .limit(20),
    ]);

    if (!pedidosRes.error && pedidosRes.data) {
      this.pedidosHoy = pedidosRes.data as PedidoSinCuadrar[];
    }
    if (!cuadresRes.error && cuadresRes.data) {
      this.historial = cuadresRes.data as Cuadre[];
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  neto(p: PedidoSinCuadrar): number {
    return p.total - p.valor_domicilio;
  }

  get totalDomicilios(): number {
    return this.pedidosHoy.reduce((sum, p) => sum + p.valor_domicilio, 0);
  }

  get totalEfectivo(): number {
    return this.pedidosHoy
      .filter((p) => p.metodo_pago === 'efectivo')
      .reduce((sum, p) => sum + this.neto(p), 0);
  }

  get totalTransferencia(): number {
    return this.pedidosHoy
      .filter((p) => p.metodo_pago === 'transferencia')
      .reduce((sum, p) => sum + this.neto(p), 0);
  }

  get totalGeneral(): number {
    return this.pedidosHoy.reduce((sum, p) => sum + p.total, 0);
  }

  async cerrarCuadre(): Promise<void> {
    this.errorMsg = '';
    const confirmado = confirm(
      `¿Cerrar el cuadre de hoy con ${this.pedidosHoy.length} pedido(s)? No podrás agregar más pedidos a este cuadre después.`
    );
    if (!confirmado) return;

    this.cerrando = true;
    const { error } = await this.supabase.client.rpc('cerrar_cuadre');
    this.cerrando = false;

    if (error) {
      this.errorMsg = error.message;
      this.cdr.detectChanges();
      return;
    }

    await this.cargarTodo();
  }

  async verComprobante(p: PedidoSinCuadrar): Promise<void> {
    if (!p.comprobante_url) return;
    const { data, error } = await this.supabase.client.storage
      .from('comprobantes')
      .createSignedUrl(p.comprobante_url, 60);

    if (!error && data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
    }
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  formatoFecha(fecha: string): string {
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}