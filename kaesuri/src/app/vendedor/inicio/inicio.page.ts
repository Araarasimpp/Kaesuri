import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { inicioDiaColombia, diaColombiaDe } from '../../shared/fecha-colombia';

interface PedidoPropio {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
  comision: number;
  estado: EstadoPedido;
  created_at: string;
}

interface BarraDia {
  label: string;
  monto: number;
  alturaPct: number;
  esHoy: boolean;
}

@Component({
  selector: 'app-inicio-vendedor',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
})
export class InicioPage implements OnInit {
  loading = true;

  ventasHoy = 0;
  comisionHoy = 0;
  pedidosEnRuta = 0;
  entregadosHoy = 0;

  ventasSemana: BarraDia[] = [];
  misPedidos: PedidoPropio[] = [];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarDashboard();
  }

  async cargarDashboard(): Promise<void> {
    this.loading = true;
    const user = await this.supabase.getCurrentUser();

    if (!user) {
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    const inicioHoy = inicioDiaColombia();
    const inicioSemana = new Date(inicioHoy);
    inicioSemana.setDate(inicioSemana.getDate() - 6);

    const [hoyRes, enRutaRes, entregadosHoyRes, semanaRes, misPedidosRes] = await Promise.all([
      this.supabase.client
        .from('pedidos')
        .select('total, comision')
        .eq('vendedor_id', user.id)
        .gte('created_at', inicioHoy.toISOString())
        .neq('estado', 'cancelado'),
      this.supabase.client
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('vendedor_id', user.id)
        .eq('estado', 'en_ruta'),
      this.supabase.client
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('vendedor_id', user.id)
        .eq('estado', 'entregado')
        .gte('entregado_at', inicioHoy.toISOString()),
      this.supabase.client
        .from('pedidos')
        .select('total, created_at')
        .eq('vendedor_id', user.id)
        .gte('created_at', inicioSemana.toISOString())
        .neq('estado', 'cancelado'),
      this.supabase.client
        .from('pedidos')
        .select('id, numero, cliente_nombre, total, comision, estado, created_at')
        .eq('vendedor_id', user.id)
        .in('estado', ['en_ruta', 'entregado'])
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    const filasHoy = hoyRes.data ?? [];
    this.ventasHoy = filasHoy.reduce((s, p) => s + Number(p.total ?? 0), 0);
    this.comisionHoy = filasHoy.reduce((s, p) => s + Number(p.comision ?? 0), 0);
    this.pedidosEnRuta = enRutaRes.count ?? 0;
    this.entregadosHoy = entregadosHoyRes.count ?? 0;
    this.ventasSemana = this.construirBarras(semanaRes.data ?? [], inicioSemana);
    this.misPedidos = (misPedidosRes.data as PedidoPropio[]) ?? [];

    this.loading = false;
    this.cdr.detectChanges();
  }

  private construirBarras(filas: any[], inicioSemana: Date): BarraDia[] {
    const dias = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const buckets: { fecha: string; label: string; esHoy: boolean; monto: number }[] = [];

    for (let i = 0; i < 7; i++) {
      const fecha = new Date(inicioSemana);
      fecha.setDate(fecha.getDate() + i);
      buckets.push({
        fecha: diaColombiaDe(fecha.toISOString()),
        label: dias[fecha.getDay()],
        esHoy: i === 6,
        monto: 0,
      });
    }

    for (const fila of filas) {
      const key = diaColombiaDe(fila.created_at);
      const bucket = buckets.find((b) => b.fecha === key);
      if (bucket) bucket.monto += Number(fila.total ?? 0);
    }

    const max = Math.max(...buckets.map((b) => b.monto), 1);

    return buckets.map((b) => ({
      label: b.label,
      monto: b.monto,
      esHoy: b.esHoy,
      alturaPct: Math.max(6, Math.round((b.monto / max) * 100)),
    }));
  }

  etiquetaEstado(estado: string): string {
    return estado === 'en_ruta' ? 'En ruta' : 'Entregado';
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}