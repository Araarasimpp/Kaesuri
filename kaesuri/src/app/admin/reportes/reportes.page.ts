import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as XLSX from 'xlsx';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { hoyColombiaISO, inicioDiaColombia, finDiaColombia, formatoFechaCO } from '../../shared/fecha-colombia';

interface FilaReporte {
  pedidoId: string;
  numero: number;
  estado: EstadoPedido;
  created_at: string;
  vendedorNombre: string;
  total: number;
  valorDomicilio: number;
  comision: number;
  productoNombre: string;
  costo: number | null;
  precioVenta: number;
  cantidad: number;
  gananciaItem: number;
}

interface Vendedor {
  id: string;
  nombre: string;
  role?: string;
}

type FiltroEstado = 'todos' | EstadoPedido;

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reportes.page.html',
  styleUrls: ['./reportes.page.scss'],
})
export class ReportesPage implements OnInit {
  loading = true;
  descargando = false;

  desde = '';
  hasta = '';
  vendedorId = 'todos';
  estado: FiltroEstado = 'todos';

  vendedores: Vendedor[] = [];
  filas: FilaReporte[] = [];

  // Totales a nivel de PEDIDO (no se duplican aunque el pedido tenga varias filas de producto)
  private pedidosUnicos: { total: number; valorDomicilio: number; comision: number }[] = [];

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'pendiente', etiqueta: 'Pendiente' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregado' },
    { valor: 'cancelado', etiqueta: 'Cancelado' },
  ];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    // Por defecto el reporte muestra el día de hoy (hora Colombia).
    const hoy = hoyColombiaISO();
    this.desde = hoy;
    this.hasta = hoy;

    await this.cargarVendedores();
    await this.cargarReporte();
  }

  irHoy(): void {
    const hoy = hoyColombiaISO();
    this.desde = hoy;
    this.hasta = hoy;
    this.cargarReporte();
  }

  async cargarVendedores(): Promise<void> {
    // Los administradores y despachadores también crean pedidos, así que
    // aparecen en el filtro junto a los vendedores (con su rol entre paréntesis).
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, nombre, role')
      .in('role', ['vendedor', 'admin', 'despachador'])
      .order('nombre');

    if (!error && data) {
      const orden: Record<string, number> = { vendedor: 0, despachador: 1, admin: 2 };
      const etiqueta: Record<string, string> = { admin: 'Admin', despachador: 'Despachador' };
      this.vendedores = (data as Vendedor[])
        .sort((a, b) => (orden[a.role ?? ''] ?? 9) - (orden[b.role ?? ''] ?? 9) || a.nombre.localeCompare(b.nombre))
        .map((v) => ({
          ...v,
          nombre: etiqueta[v.role ?? ''] ? `${v.nombre} (${etiqueta[v.role ?? '']})` : v.nombre,
        }));
    }
  }


  irEsteMes(): void {
    const hoy = hoyColombiaISO();
    const [anio, mes] = hoy.split('-');
    this.desde = `${anio}-${mes}-01`;
    this.hasta = hoy;
    this.cargarReporte();
  }

  irMesAnterior(): void {
    const hoy = new Date(hoyColombiaISO() + 'T00:00:00-05:00');
    const primerDiaMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDiaMesAnterior = new Date(primerDiaMesActual.getTime() - 86400000);
    const primerDiaMesAnterior = new Date(
      ultimoDiaMesAnterior.getFullYear(),
      ultimoDiaMesAnterior.getMonth(),
      1
    );

    this.desde = primerDiaMesAnterior.toISOString().slice(0, 10);
    this.hasta = ultimoDiaMesAnterior.toISOString().slice(0, 10);
    this.cargarReporte();
  }

  async cargarReporte(): Promise<void> {
    if (!this.desde || !this.hasta) return;
    this.loading = true;

    const inicio = inicioDiaColombia(this.desde);
    const fin = finDiaColombia(this.hasta);

    const [pedidos, perfilesRes] = await Promise.all([
      this.traerPedidosConItems(inicio, fin),
      this.supabase.client.from('profiles').select('id, nombre'),
    ]);

    const nombresPorId = new Map((perfilesRes.data ?? []).map((p: any) => [p.id, p.nombre]));

    this.pedidosUnicos = pedidos.map((p: any) => ({
      total: Number(p.total ?? 0),
      valorDomicilio: Number(p.valor_domicilio ?? 0),
      comision: Number(p.comision ?? 0),
    }));

    const filasNuevas: FilaReporte[] = [];
    for (const p of pedidos) {
      for (const item of p.pedido_items ?? []) {
        const costo = item.producto?.costo ?? null;
        const precioVenta = item.precio_unitario;
        const precioBase = item.precio_base;
        const cantidad = item.cantidad;
        // Ganancia de la TIENDA = precio_base - costo (no precio_unitario,
        // que ya trae la comisión del vendedor mezclada adentro).
        const gananciaItem = cantidad * (precioBase - (costo != null ? costo : precioBase));

        filasNuevas.push({
          pedidoId: p.id,
          numero: p.numero,
          estado: p.estado,
          created_at: p.created_at,
          vendedorNombre: nombresPorId.get(p.vendedor_id) ?? 'Vendedor',
          total: Number(p.total ?? 0),
          valorDomicilio: Number(p.valor_domicilio ?? 0),
          comision: Number(p.comision ?? 0),
          productoNombre: item.producto?.nombre ?? 'Producto',
          costo,
          precioVenta,
          cantidad,
          gananciaItem,
        });
      }
    }

    this.filas = filasNuevas;
    this.loading = false;
    this.cdr.detectChanges();
  }

  /** Trae los pedidos del rango con sus productos, en bloques de 1000 (límite de Supabase). */
  private async traerPedidosConItems(inicio: Date, fin: Date): Promise<any[]> {
    const todos: any[] = [];
    const bloque = 1000;
    for (let desde = 0; ; desde += bloque) {
      let query = this.supabase.client
        .from('pedidos')
        .select(
          'id, numero, estado, created_at, vendedor_id, total, valor_domicilio, comision, pedido_items(cantidad, precio_unitario, precio_base, producto:productos(nombre, costo))'
        )
        .gte('created_at', inicio.toISOString())
        .lte('created_at', fin.toISOString())
        .order('created_at', { ascending: false })
        .range(desde, desde + bloque - 1);
      if (this.vendedorId !== 'todos') query = query.eq('vendedor_id', this.vendedorId);
      if (this.estado !== 'todos') query = query.eq('estado', this.estado);

      const { data, error } = await query;
      if (error || !data) break;
      todos.push(...data);
      if (data.length < bloque) break;
    }
    return todos;
  }


  get totalPedido(): number {
    return this.pedidosUnicos.reduce((s, p) => s + p.total, 0);
  }

  get totalDomicilio(): number {
    return this.pedidosUnicos.reduce((s, p) => s + p.valorDomicilio, 0);
  }

  get totalComision(): number {
    return this.pedidosUnicos.reduce((s, p) => s + p.comision, 0);
  }

  get totalGananciaTienda(): number {
    return this.filas.reduce((s, f) => s + f.gananciaItem, 0);
  }

  get totalCantidad(): number {
    return this.filas.reduce((s, f) => s + f.cantidad, 0);
  }

  descargarExcel(): void {
    if (!this.filas.length) return;
    this.descargando = true;

    const datos = this.filas.map((f) => ({
      Pedido: f.numero,
      Estado: this.etiquetaEstado(f.estado),
      Fecha: formatoFechaCO(f.created_at, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      Vendedor: f.vendedorNombre,
      Producto: f.productoNombre,
      Costo: f.costo ?? '',
      'Precio venta': f.precioVenta,
      Cantidad: f.cantidad,
      'Ganancia tienda': f.gananciaItem,
      'Total pedido': f.total,
      Domicilio: f.valorDomicilio,
      'Ganancia vendedor': f.comision,
    }));

    datos.push({
      Pedido: '' as any,
      Estado: '' as any,
      Fecha: '' as any,
      Vendedor: '' as any,
      Producto: 'TOTALES',
      Costo: '' as any,
      'Precio venta': '' as any,
      Cantidad: this.totalCantidad,
      'Ganancia tienda': this.totalGananciaTienda,
      'Total pedido': this.totalPedido,
      Domicilio: this.totalDomicilio,
      'Ganancia vendedor': this.totalComision,
    });

    const hoja = XLSX.utils.json_to_sheet(datos);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Reporte');
    XLSX.writeFile(libro, `reporte_${this.desde}_a_${this.hasta}.xlsx`);

    this.descargando = false;
  }

  etiquetaEstado(estado: EstadoPedido): string {
    return this.estados.find((e) => e.valor === estado)?.etiqueta ?? estado;
  }

  claseEstado(estado: EstadoPedido): string {
    const clases: Record<EstadoPedido, string> = {
      pendiente: 'badge-bajo',
      en_ruta: 'badge-info',
      entregado: 'badge-ok',
      cancelado: 'badge-coral',
    };
    return clases[estado];
  }

  formatoFecha(fecha: string): string {
    return formatoFechaCO(fecha, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}