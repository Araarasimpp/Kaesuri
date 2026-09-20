import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';
import { Cuadre, MetodoPago } from '../../shared/models/models';

interface PedidoSinCuadrar {
  id: string;
  numero: number;
  cliente_nombre: string;
  direccion: string;
  barrio: string | null;
  total: number;
  valor_domicilio: number;
  metodo_pago: MetodoPago | null;
  comprobante_url: string | null;
  entregado_at: string;
  productos: string;
}

@Component({
  selector: 'app-cuadres',
  standalone: true,
  imports: [CommonModule],
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
        .select(
          'id, numero, cliente_nombre, direccion, barrio, total, valor_domicilio, metodo_pago, comprobante_url, entregado_at'
        )
        .eq('domiciliario_id', user.id)
        .eq('estado', 'entregado')
        .is('cuadre_id', null)
        .gte('entregado_at', inicioHoy.toISOString())
        .order('entregado_at', { ascending: false }),
      this.supabase.client
        .from('cuadres')
        .select('*')
        .eq('domiciliario_id', user.id)
        .order('fecha', { ascending: false })
        .limit(20),
    ]);

    let pedidos = (pedidosRes.data as any[]) ?? [];

    if (pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, producto:productos(nombre)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      pedidos = pedidos.map((p) => ({
        ...p,
        productos: (items ?? [])
          .filter((i: any) => i.pedido_id === p.id)
          .map((i: any) => `${i.producto?.nombre ?? 'Producto'} x${i.cantidad}`)
          .join(', '),
      }));
    }

    this.pedidosHoy = pedidos as PedidoSinCuadrar[];

    if (!cuadresRes.error && cuadresRes.data) {
      this.historial = cuadresRes.data as Cuadre[];
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  // Lo que aportó ESTE pedido en efectivo (0 si fue por transferencia)
  efectivoDe(p: PedidoSinCuadrar): number {
    return p.metodo_pago === 'efectivo' ? p.total : 0;
  }

  transferenciaDe(p: PedidoSinCuadrar): number {
    return p.metodo_pago === 'transferencia' ? p.total : 0;
  }

  // Cuadre de este pedido en particular: lo que aportó en efectivo menos el
  // domicilio que te queda a ti. Si fue por transferencia, sale negativo:
  // significa que el negocio te debe ese domicilio.
  cuadreDe(p: PedidoSinCuadrar): number {
    return this.efectivoDe(p) - p.valor_domicilio;
  }

  get totalEfectivo(): number {
    return this.pedidosHoy.reduce((sum, p) => sum + this.efectivoDe(p), 0);
  }

  get totalTransferencia(): number {
    return this.pedidosHoy.reduce((sum, p) => sum + this.transferenciaDe(p), 0);
  }

  get totalDomicilios(): number {
    return this.pedidosHoy.reduce((sum, p) => sum + p.valor_domicilio, 0);
  }

  get totalCuadre(): number {
    return this.totalEfectivo - this.totalDomicilios;
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

  formatoHora(fecha: string): string {
    return new Date(fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  formatoFecha(fecha: string): string {
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}