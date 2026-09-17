import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';

interface PedidoResumen {
  id: string;
  cliente_nombre: string;
  total: number;
  estado: string;
  created_at: string;
}

interface ProductoBajo {
  id: string;
  nombre: string;
  stock: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit {
  loading = true;

  ventasHoy = 0;
  pedidosPendientes = 0;
  pedidosEntregadosHoy = 0;
  productosStockBajo: ProductoBajo[] = [];
  pedidosRecientes: PedidoResumen[] = [];

  constructor(private supabase: SupabaseService) {}

  async ngOnInit(): Promise<void> {
    await this.cargarReporte();
  }

  async cargarReporte(): Promise<void> {
    this.loading = true;

    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);

    const [ventasHoyRes, pendientesRes, entregadosHoyRes, stockBajoRes, recientesRes] =
      await Promise.all([
        this.supabase.client
          .from('pedidos')
          .select('total')
          .gte('created_at', inicioHoy.toISOString())
          .neq('estado', 'cancelado'),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente'),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'entregado')
          .gte('entregado_at', inicioHoy.toISOString()),
        this.supabase.client
          .from('productos')
          .select('id, nombre, stock')
          .lt('stock', 5)
          .order('stock', { ascending: true })
          .limit(5),
        this.supabase.client
          .from('pedidos')
          .select('id, cliente_nombre, total, estado, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

    this.ventasHoy = (ventasHoyRes.data ?? []).reduce(
      (sum, p) => sum + Number(p.total ?? 0),
      0
    );
    this.pedidosPendientes = pendientesRes.count ?? 0;
    this.pedidosEntregadosHoy = entregadosHoyRes.count ?? 0;
    this.productosStockBajo = (stockBajoRes.data ?? []) as ProductoBajo[];
    this.pedidosRecientes = (recientesRes.data ?? []) as PedidoResumen[];

    this.loading = false;
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  etiquetaEstado(estado: string): string {
    const etiquetas: Record<string, string> = {
      pendiente: 'Pendiente',
      en_ruta: 'En ruta',
      entregado: 'Entregado',
      cancelado: 'Cancelado',
    };
    return etiquetas[estado] ?? estado;
  }
}