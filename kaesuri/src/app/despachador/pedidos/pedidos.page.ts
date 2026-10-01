import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { RotuloService } from '../../shared/rotulo.service';
import { ImagenPreviewComponent } from '../../shared/imagen-preview/imagen-preview.component';

interface ItemFila {
  nombre: string;
  cantidad: number;
  imagen_url: string | null;
}

interface PedidoFila {
  id: string;
  numero: number;
  vendedor_id: string;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  observaciones: string | null;
  estado: EstadoPedido;
  total: number;
  domiciliario_id: string | null;
  rotulo_impreso_at: string | null;
  created_at: string;
  productos: string;
  items: ItemFila[];
}

interface Domiciliario {
  id: string;
  nombre: string;
}

type FiltroEstado = 'todos' | EstadoPedido;
type FiltroRotulo = 'todos' | 'pendiente' | 'impreso';

@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ImagenPreviewComponent],
  templateUrl: './pedidos.page.html',
  styleUrls: ['./pedidos.page.scss'],
})
export class PedidosPage implements OnInit, OnDestroy {
  /** Ruta del botón "Nuevo pedido" (el admin usa la suya). */
  readonly rutaNuevo = '/despachador/pedidos/nuevo';

  loading = true;
  pedidos: PedidoFila[] = [];
  domiciliarios: Domiciliario[] = [];
  nombresPorId = new Map<string, string>();
  busqueda = '';
  filtroEstado: FiltroEstado = 'pendiente';
  filtroRotulo: FiltroRotulo = 'todos';
  guardandoId: string | null = null;
  seleccionados = new Set<string>();
  menuAbiertoId: string | null = null;
  imprimiendo = false;
  imagenAbierta: string | null = null;

  private canal: RealtimeChannel | null = null;

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'pendiente', etiqueta: 'Pendiente' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregado' },
    { valor: 'cancelado', etiqueta: 'Cancelado' },
    { valor: 'todos', etiqueta: 'Todos' },
  ];

  constructor(
    private supabase: SupabaseService,
    private rotulos: RotuloService,
    private cdr: ChangeDetectorRef
  ) {}

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => this.cargarPedidos())
      .subscribe();
  }

  async cargarPedidos(): Promise<void> {
    this.loading = !this.pedidos.length;
    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select(
        'id, numero, vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones, estado, total, domiciliario_id, rotulo_impreso_at, created_at'
      )
      .order('created_at', { ascending: false });

    let pedidos = (data as any[]) ?? [];

    if (!error && pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, producto:productos(nombre, imagen_url)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      pedidos = pedidos.map((p) => {
        const propios: ItemFila[] = (items ?? [])
          .filter((i: any) => i.pedido_id === p.id)
          .map((i: any) => ({
            nombre: i.producto?.nombre ?? 'Producto',
            cantidad: i.cantidad,
            imagen_url: i.producto?.imagen_url ?? null,
          }));
        return {
          ...p,
          items: propios,
          productos: propios.map((i) => `${i.nombre} x${i.cantidad}`).join(', '),
        };
      });
    }

    this.pedidos = pedidos as PedidoFila[];
    this.loading = false;
    this.cdr.detectChanges();
  }

  async cargarDomiciliarios(): Promise<void> {
    const { data, error } = await this.supabase.client.from('profiles').select('id, nombre, role');

    if (!error && data) {
      this.nombresPorId = new Map(data.map((p: any) => [p.id, p.nombre]));
      this.domiciliarios = (data as any[])
        .filter((p) => p.role === 'domiciliario')
        .map((p) => ({ id: p.id, nombre: p.nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
    this.cdr.detectChanges();
  }

  nombreVendedor(id: string): string {
    return this.nombresPorId.get(id) ?? 'Desconocido';
  }

  contarEstado(valor: FiltroEstado): number {
    if (valor === 'todos') return this.pedidos.length;
    return this.pedidos.filter((p) => p.estado === valor).length;
  }

  get filtrados(): PedidoFila[] {
    let lista = this.pedidos;

    if (this.filtroEstado !== 'todos') {
      lista = lista.filter((p) => p.estado === this.filtroEstado);
    }

    if (this.filtroRotulo === 'pendiente') {
      lista = lista.filter((p) => !p.rotulo_impreso_at);
    } else if (this.filtroRotulo === 'impreso') {
      lista = lista.filter((p) => !!p.rotulo_impreso_at);
    }

    if (this.busqueda.trim()) {
      const q = this.busqueda.trim().toLowerCase();
      lista = lista.filter(
        (p) => p.cliente_nombre.toLowerCase().includes(q) || (p.productos ?? '').toLowerCase().includes(q)
      );
    }

    return lista;
  }

  verImagen(url: string | null, evento?: Event): void {
    evento?.stopPropagation();
    if (url) this.imagenAbierta = url;
  }

  async asignarDomiciliario(pedido: PedidoFila, domiciliarioId: string): Promise<void> {
    // Un pedido ya entregado (o cancelado) no se puede reasignar: eso
    // rompería el cuadre y el historial de quién lo entregó de verdad.
    if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
      await this.cargarPedidos();
      return;
    }

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

  toggleMenu(id: string): void {
    this.menuAbiertoId = this.menuAbiertoId === id ? null : id;
  }

  async cancelarPedido(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') return;

    const confirmado = confirm(
      `¿Cancelar el pedido #${pedido.numero} de ${pedido.cliente_nombre}? Se devolverá el stock de los productos.`
    );
    if (!confirmado) return;

    const { error } = await this.supabase.client.rpc('cancelar_pedido', { p_pedido_id: pedido.id });

    if (!error) {
      await this.cargarPedidos();
    } else {
      alert(error.message);
      this.cdr.detectChanges();
    }
  }

  async eliminarPedido(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    if (pedido.estado === 'entregado') return;

    const confirmado = confirm(
      `¿Eliminar el pedido #${pedido.numero} de ${pedido.cliente_nombre}? Se devolverá el stock de los productos. Esta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    const { error } = await this.supabase.client.rpc('eliminar_pedido', { p_pedido_id: pedido.id });

    if (!error) {
      await this.cargarPedidos();
    } else {
      alert(error.message);
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

  toggleSeleccion(id: string): void {
    if (this.seleccionados.has(id)) {
      this.seleccionados.delete(id);
    } else {
      this.seleccionados.add(id);
    }
  }

  toggleSeleccionarTodos(): void {
    if (this.seleccionados.size === this.filtrados.length) {
      this.seleccionados.clear();
    } else {
      this.filtrados.forEach((p) => this.seleccionados.add(p.id));
    }
  }

  async imprimirRotulos(): Promise<void> {
    if (this.seleccionados.size === 0) return;
    this.imprimiendo = true;
    this.cdr.detectChanges();

    const ids = Array.from(this.seleccionados);
    const pedidosSeleccionados = this.pedidos.filter((p) => this.seleccionados.has(p.id));
    const items = pedidosSeleccionados.flatMap((p) =>
      (p.items ?? []).map((i) => ({ pedido_id: p.id, cantidad: i.cantidad, producto: { nombre: i.nombre } }))
    );

    const abierto = await this.rotulos.imprimir(pedidosSeleccionados, items);

    if (abierto) {
      // Se marca como impreso apenas se abre la ventana de impresión
      // (no hay forma confiable de detectar si el usuario canceló el diálogo)
      await this.supabase.client
        .from('pedidos')
        .update({ rotulo_impreso_at: new Date().toISOString() })
        .in('id', ids);
      this.seleccionados.clear();
    } else {
      alert('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para esta página e intenta de nuevo.');
    }

    this.imprimiendo = false;
    await this.cargarPedidos();
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
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
