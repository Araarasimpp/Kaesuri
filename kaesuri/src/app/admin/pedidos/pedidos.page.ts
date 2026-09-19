import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';

interface PedidoFila {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  estado: EstadoPedido;
  total: number;
  domiciliario_id: string | null;
  created_at: string;
}

interface Domiciliario {
  id: string;
  nombre: string;
}

type FiltroEstado = 'todos' | EstadoPedido;

@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './pedidos.page.html',
  styleUrls: ['./pedidos.page.scss'],
})
export class PedidosPage implements OnInit, OnDestroy {
  loading = true;
  pedidos: PedidoFila[] = [];
  domiciliarios: Domiciliario[] = [];
  busqueda = '';
  filtroEstado: FiltroEstado = 'todos';
  guardandoId: string | null = null;

  private canal: RealtimeChannel | null = null;

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'pendiente', etiqueta: 'Pendiente' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregado' },
    { valor: 'cancelado', etiqueta: 'Cancelado' },
  ];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargarPedidos(), this.cargarDomiciliarios()]);
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('pedidos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos' },
        () => this.cargarPedidos()
      )
      .subscribe();
  }

  async cargarPedidos(): Promise<void> {
    this.loading = true;
    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select(
        'id, numero, cliente_nombre, cliente_telefono, direccion, barrio, estado, total, domiciliario_id, created_at'
      )
      .order('created_at', { ascending: false });

    if (!error && data) {
      this.pedidos = data as PedidoFila[];
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  async cargarDomiciliarios(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, nombre')
      .eq('role', 'domiciliario')
      .order('nombre');

    if (!error && data) {
      this.domiciliarios = data as Domiciliario[];
    }
    this.cdr.detectChanges();
  }

  get filtrados(): PedidoFila[] {
    let lista = this.pedidos;

    if (this.filtroEstado !== 'todos') {
      lista = lista.filter((p) => p.estado === this.filtroEstado);
    }

    if (this.busqueda.trim()) {
      const q = this.busqueda.trim().toLowerCase();
      lista = lista.filter((p) => p.cliente_nombre.toLowerCase().includes(q));
    }

    return lista;
  }

  async asignarDomiciliario(pedido: PedidoFila, domiciliarioId: string): Promise<void> {
    this.guardandoId = pedido.id;

    const { error } = await this.supabase.client
      .from('pedidos')
      .update({ domiciliario_id: domiciliarioId || null, estado: 'en_ruta' })
      .eq('id', pedido.id);

    this.guardandoId = null;

    if (!error) {
      await this.cargarPedidos();
    } else {
      this.cdr.detectChanges();
    }
  }

  nombreDomiciliario(id: string | null): string {
    if (!id) return 'Sin asignar';
    return this.domiciliarios.find((d) => d.id === id)?.nombre ?? 'Sin asignar';
  }

  etiquetaEstado(estado: EstadoPedido): string {
    return this.estados.find((e) => e.valor === estado)?.etiqueta ?? estado;
  }

  claseEstado(estado: EstadoPedido): string {
    const clases: Record<EstadoPedido, string> = {
      pendiente: 'estado-bajo',
      en_ruta: 'estado-info',
      entregado: 'estado-ok',
      cancelado: 'estado-agotado',
    };
    return clases[estado];
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  formatoFecha(fecha: string): string {
    return new Date(fecha).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}