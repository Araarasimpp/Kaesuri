import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { hoyColombiaISO, inicioDiaColombia, finDiaColombia, formatoFechaCO } from '../../shared/fecha-colombia';

interface FilaReporte {
  id: string;
  numero: number;
  estado: EstadoPedido;
  created_at: string;
  vendedorNombre: string;
  total: number;
  valorDomicilio: number;
  gananciaTienda: number;
  comision: number;
}

interface Vendedor {
  id: string;
  nombre: string;
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

  desde = '';
  hasta = '';
  vendedorId = 'todos';
  estado: FiltroEstado = 'todos';

  vendedores: Vendedor[] = [];
  filas: FilaReporte[] = [];

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'pendiente', etiqueta: 'Pendiente' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregado' },
    { valor: 'cancelado', etiqueta: 'Cancelado' },
  ];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const hoy = hoyColombiaISO();
    const [anio, mes] = hoy.split('-');
    this.desde = `${anio}-${mes}-01`;
    this.hasta = hoy;

    await this.cargarVendedores();
    await this.cargarReporte();
  }

  async cargarVendedores(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, nombre')
      .eq('role', 'vendedor')
      .order('nombre');

    if (!error && data) {
      this.vendedores = data as Vendedor[];
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

    let query = this.supabase.client
      .from('pedidos')
      .select('id, numero, estado, created_at, vendedor_id, total, valor_domicilio, comision')
      .gte('created_at', inicio.toISOString())
      .lte('created_at', fin.toISOString())
      .order('created_at', { ascending: false });

    if (this.vendedorId !== 'todos') {
      query = query.eq('vendedor_id', this.vendedorId);
    }
    if (this.estado !== 'todos') {
      query = query.eq('estado', this.estado);
    }

    const [pedidosRes, perfilesRes] = await Promise.all([
      query,
      this.supabase.client.from('profiles').select('id, nombre'),
    ]);

    const pedidos = pedidosRes.data ?? [];
    const nombresPorId = new Map((perfilesRes.data ?? []).map((p: any) => [p.id, p.nombre]));

    // Ganancia de tienda por pedido = suma de (precio - costo) * cantidad de sus items
    const gananciaPorPedido = new Map<string, number>();
    if (pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, precio_unitario, producto:productos(costo)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      for (const item of items ?? []) {
        const costo = (item as any).producto?.costo;
        const ganancia =
          (item as any).cantidad *
          ((item as any).precio_unitario - (costo != null ? costo : (item as any).precio_unitario));
        gananciaPorPedido.set(
          (item as any).pedido_id,
          (gananciaPorPedido.get((item as any).pedido_id) ?? 0) + ganancia
        );
      }
    }

    this.filas = pedidos.map((p) => ({
      id: p.id,
      numero: p.numero,
      estado: p.estado,
      created_at: p.created_at,
      vendedorNombre: nombresPorId.get(p.vendedor_id) ?? 'Vendedor',
      total: Number(p.total ?? 0),
      valorDomicilio: Number(p.valor_domicilio ?? 0),
      gananciaTienda: gananciaPorPedido.get(p.id) ?? 0,
      comision: Number(p.comision ?? 0),
    }));

    this.loading = false;
    this.cdr.detectChanges();
  }

  get totalPedido(): number {
    return this.filas.reduce((s, f) => s + f.total, 0);
  }

  get totalDomicilio(): number {
    return this.filas.reduce((s, f) => s + f.valorDomicilio, 0);
  }

  get totalGananciaTienda(): number {
    return this.filas.reduce((s, f) => s + f.gananciaTienda, 0);
  }

  get totalComision(): number {
    return this.filas.reduce((s, f) => s + f.comision, 0);
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