import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { hoyColombiaISO, inicioDiaColombia, finDiaColombia } from '../../shared/fecha-colombia';

interface VendedorResumen {
  id: string;
  nombre: string;
  cantidadPedidos: number;
  totalVentas: number;
  totalComision: number;
  productos: { nombre: string; cantidad: number; monto: number }[];
}

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

  gananciaTotal = 0;
  ventasTotal = 0;
  cantidadPedidos = 0;

  vendedores: VendedorResumen[] = [];
  expandidoId: string | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const hoy = hoyColombiaISO();
    const [anio, mes] = hoy.split('-');
    this.desde = `${anio}-${mes}-01`;
    this.hasta = hoy;
    await this.cargarReporte();
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

    const [gananciaRes, pedidosRes, perfilesRes] = await Promise.all([
      this.supabase.client.rpc('ganancias_rango', { p_desde: this.desde, p_hasta: this.hasta }),
      this.supabase.client
        .from('pedidos')
        .select('id, vendedor_id, total, comision, created_at')
        .neq('estado', 'cancelado')
        .gte('created_at', inicio.toISOString())
        .lte('created_at', fin.toISOString()),
      this.supabase.client.from('profiles').select('id, nombre'),
    ]);

    this.gananciaTotal = Number(gananciaRes.data ?? 0);

    const pedidos = pedidosRes.data ?? [];
    const nombresPorId = new Map((perfilesRes.data ?? []).map((p: any) => [p.id, p.nombre]));

    this.ventasTotal = pedidos.reduce((s, p) => s + Number(p.total ?? 0), 0);
    this.cantidadPedidos = pedidos.length;

    // Agrupar por vendedor
    const porVendedor = new Map<string, VendedorResumen>();
    for (const p of pedidos) {
      const actual = porVendedor.get(p.vendedor_id) ?? {
        id: p.vendedor_id,
        nombre: nombresPorId.get(p.vendedor_id) ?? 'Vendedor',
        cantidadPedidos: 0,
        totalVentas: 0,
        totalComision: 0,
        productos: [],
      };
      actual.cantidadPedidos++;
      actual.totalVentas += Number(p.total ?? 0);
      actual.totalComision += Number(p.comision ?? 0);
      porVendedor.set(p.vendedor_id, actual);
    }

    // Traer los productos vendidos por cada vendedor en el rango
    if (pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, precio_unitario, producto:productos(nombre)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      const vendedorPorPedido = new Map(pedidos.map((p) => [p.id, p.vendedor_id]));

      for (const item of items ?? []) {
        const vendedorId = vendedorPorPedido.get((item as any).pedido_id);
        if (!vendedorId) continue;
        const resumen = porVendedor.get(vendedorId);
        if (!resumen) continue;

        const nombreProd = (item as any).producto?.nombre ?? 'Producto';
        const monto = (item as any).cantidad * (item as any).precio_unitario;
        const existente = resumen.productos.find((pr) => pr.nombre === nombreProd);
        if (existente) {
          existente.cantidad += (item as any).cantidad;
          existente.monto += monto;
        } else {
          resumen.productos.push({ nombre: nombreProd, cantidad: (item as any).cantidad, monto });
        }
      }
    }

    this.vendedores = Array.from(porVendedor.values()).sort(
      (a, b) => b.totalVentas - a.totalVentas
    );

    this.loading = false;
    this.cdr.detectChanges();
  }

  toggleVendedor(id: string): void {
    this.expandidoId = this.expandidoId === id ? null : id;
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}