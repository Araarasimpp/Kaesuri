import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';

// Datos del negocio para el rótulo. Edítalos aquí, o si más adelante quieres
// cambiarlos desde la app sin tocar código, se puede mover a una tabla
// "configuracion" con una sola fila.
const NEGOCIO = {
  nombre: 'Kaesuri',
  telefonos: '300 000 0000',
  redes: '@kaesuri',
  garantia:
    'Todos nuestros productos cuentan con garantía. Guarda este documento ya que es el soporte para la garantía.',
};

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
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './pedidos.page.html',
  styleUrls: ['./pedidos.page.scss'],
})
export class PedidosPage implements OnInit, OnDestroy {
  loading = true;
  pedidos: PedidoFila[] = [];
  domiciliarios: Domiciliario[] = [];
  nombresPorId = new Map<string, string>();
  busqueda = '';
  filtroEstado: FiltroEstado = 'todos';
  filtroRotulo: FiltroRotulo = 'todos';
  guardandoId: string | null = null;
  seleccionados = new Set<string>();
  imprimiendo = false;

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
        'id, numero, vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones, estado, total, domiciliario_id, rotulo_impreso_at, created_at'
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
      .select('id, nombre, role');

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

    const ids = Array.from(this.seleccionados);

    // Traemos los items de cada pedido con el nombre del producto para el rótulo
    const { data: items, error } = await this.supabase.client
      .from('pedido_items')
      .select('pedido_id, cantidad, producto:productos(nombre)')
      .in('pedido_id', ids);

    if (error) {
      this.imprimiendo = false;
      this.cdr.detectChanges();
      return;
    }

    const pedidosSeleccionados = this.pedidos.filter((p) => this.seleccionados.has(p.id));
    const html = this.construirHtmlRotulos(pedidosSeleccionados, items ?? []);

    const ventana = window.open('', '_blank');
    if (ventana) {
      ventana.document.write(html);
      ventana.document.close();
      ventana.focus();
      setTimeout(() => ventana.print(), 300);
    }

    // Se marca como impreso apenas se abre la ventana de impresión
    // (no hay forma confiable de detectar si el usuario canceló el diálogo)
    await this.supabase.client
      .from('pedidos')
      .update({ rotulo_impreso_at: new Date().toISOString() })
      .in('id', ids);

    this.seleccionados.clear();
    this.imprimiendo = false;
    await this.cargarPedidos();
  }

  private construirHtmlRotulos(pedidos: PedidoFila[], items: any[]): string {
    const rotulos = pedidos
      .map((p) => {
        const productos = items
          .filter((i) => i.pedido_id === p.id)
          .map((i) => `${i.producto?.nombre ?? 'Producto'} x${i.cantidad}`)
          .join('<br>');

        const fecha = new Date(p.created_at);
        const fechaStr = `${String(fecha.getDate()).padStart(2, '0')} / ${String(
          fecha.getMonth() + 1
        ).padStart(2, '0')} / ${fecha.getFullYear()}`;

        return `
          <div class="rotulo">
            <div class="rotulo-header">
              <div class="marca">${NEGOCIO.nombre}</div>
              <div class="contacto">
                <div>${NEGOCIO.telefonos}</div>
                <div>${NEGOCIO.redes}</div>
              </div>
              <div class="fecha-box">${fechaStr}</div>
            </div>
            <div class="valor-cobrar">
              <span>VALOR A COBRAR:</span>
              <strong>${this.formatoMoneda(p.total)}</strong>
            </div>
            <table class="datos">
              <tr><td>Pedido:</td><td>#${p.numero}</td></tr>
              <tr><td>Nombre:</td><td>${p.cliente_nombre}</td></tr>
              <tr><td>Dirección:</td><td>${p.direccion}</td></tr>
              <tr><td>Barrio:</td><td>${p.barrio ?? '—'}</td></tr>
              <tr><td>Producto:</td><td>${productos || '—'}</td></tr>
              <tr><td>Celular:</td><td>${p.cliente_telefono ?? '—'}</td></tr>
              <tr><td>Observación:</td><td>${p.observaciones ?? '—'}</td></tr>
            </table>
            <p class="garantia">${NEGOCIO.garantia}</p>
          </div>
        `;
      })
      .join('');

    return `
      <html>
        <head>
          <title>Rótulos</title>
          <style>
            body { font-family: Arial, sans-serif; }
            .rotulo {
              width: 320px;
              border: 2px solid #000;
              border-radius: 14px;
              padding: 16px;
              margin: 0 auto 24px;
              page-break-after: always;
            }
            .rotulo-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px; }
            .marca { font-size: 20px; font-weight: bold; }
            .contacto { font-size: 11px; text-align: right; }
            .fecha-box { border: 1px solid #000; padding: 4px 8px; font-size: 11px; }
            .valor-cobrar { border: 1px solid #000; padding: 8px; margin-bottom: 10px; font-size: 14px; display: flex; justify-content: space-between; }
            .datos { width: 100%; font-size: 13px; border-collapse: collapse; }
            .datos td { padding: 3px 0; vertical-align: top; }
            .datos td:first-child { font-weight: bold; width: 90px; }
            .garantia { font-size: 10px; text-align: center; margin-top: 12px; border-top: 1px dashed #000; padding-top: 8px; }
          </style>
        </head>
        <body>${rotulos}</body>
      </html>
    `;
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