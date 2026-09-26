import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { Cuadre, MetodoPago } from '../../shared/models/models';
import { formatoFechaCO } from '../../shared/fecha-colombia';

type FiltroCuadre = 'todos' | 'pendiente' | 'confirmado';

interface PedidoDelCuadre {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
  valor_domicilio: number;
  metodo_pago: MetodoPago | null;
  comprobante_url: string | null;
}

@Component({
  selector: 'app-admin-cuadres',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cuadres.page.html',
  styleUrls: ['./cuadres.page.scss'],
})
export class AdminCuadresPage implements OnInit, OnDestroy {
  loading = true;
  cuadres: Cuadre[] = [];
  nombresPorId = new Map<string, string>();
  filtro: FiltroCuadre = 'pendiente';
  fechaFiltro: string = ''; // Formato 'YYYY-MM-DD' desde el <input type="date">
  confirmandoId: string | null = null;

  expandidoId: string | null = null;
  pedidosPorCuadre = new Map<string, PedidoDelCuadre[]>();
  cargandoDetalle = false;

  private canal: RealtimeChannel | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('admin-cuadres-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuadres' }, () =>
        this.cargarTodo()
      )
      .subscribe();
  }

  async cargarTodo(): Promise<void> {
    this.loading = true;

    const [cuadresRes, perfilesRes] = await Promise.all([
      this.supabase.client.from('cuadres').select('*').order('fecha', { ascending: false }),
      this.supabase.client.from('profiles').select('id, nombre'),
    ]);

    if (!cuadresRes.error && cuadresRes.data) {
      this.cuadres = cuadresRes.data as Cuadre[];
    }
    if (!perfilesRes.error && perfilesRes.data) {
      this.nombresPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.nombre]));
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  get filtrados(): Cuadre[] {
    return this.cuadres.filter((c) => {
      const cumpleEstado = this.filtro === 'todos' || c.estado === this.filtro;
      const cumpleFecha = !this.fechaFiltro || c.fecha === this.fechaFiltro;
      return cumpleEstado && cumpleFecha;
    });
  }

  get pendientesCount(): number {
    return this.cuadres.filter((c) => c.estado === 'pendiente').length;
  }

  limpiarFecha(): void {
    this.fechaFiltro = '';
  }

  nombreDomiciliario(id: string): string {
    return this.nombresPorId.get(id) ?? 'Desconocido';
  }

  async toggleDetalle(cuadre: Cuadre): Promise<void> {
    if (this.expandidoId === cuadre.id) {
      this.expandidoId = null;
      return;
    }

    this.expandidoId = cuadre.id;

    if (!this.pedidosPorCuadre.has(cuadre.id)) {
      this.cargandoDetalle = true;
      this.cdr.detectChanges();

      const { data, error } = await this.supabase.client
        .from('pedidos')
        .select('id, numero, cliente_nombre, total, valor_domicilio, metodo_pago, comprobante_url')
        .eq('cuadre_id', cuadre.id)
        .order('numero');

      if (!error && data) {
        this.pedidosPorCuadre.set(cuadre.id, data as PedidoDelCuadre[]);
      }
      this.cargandoDetalle = false;
    }

    this.cdr.detectChanges();
  }

  pedidosDe(cuadreId: string): PedidoDelCuadre[] {
    return this.pedidosPorCuadre.get(cuadreId) ?? [];
  }

  async verComprobante(pedido: PedidoDelCuadre): Promise<void> {
    if (!pedido.comprobante_url) return;

    const { data, error } = await this.supabase.client.storage
      .from('comprobantes')
      .createSignedUrl(pedido.comprobante_url, 60);

    if (!error && data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
    }
  }

  async confirmarCuadre(cuadre: Cuadre): Promise<void> {
    this.confirmandoId = cuadre.id;
    const user = await this.supabase.getCurrentUser();

    const { error } = await this.supabase.client
      .from('cuadres')
      .update({
        estado: 'confirmado',
        confirmado_at: new Date().toISOString(),
        confirmado_por: user?.id ?? null,
      })
      .eq('id', cuadre.id);

    this.confirmandoId = null;

    if (!error) {
      await this.cargarTodo();
    } else {
      this.cdr.detectChanges();
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
    return formatoFechaCO(fecha + 'T00:00:00-05:00', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}