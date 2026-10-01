import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { inicioDiaColombia } from '../../shared/fecha-colombia';

interface PedidoResumen {
  id: string;
  numero: number;
  cliente_nombre: string;
  total: number;
  estado: string;
  created_at: string;
}

interface CuadrePendiente {
  id: string;
  domiciliario_id: string;
  total_a_entregar: number;
}

@Component({
  selector: 'app-inicio-despachador',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
})
export class InicioDespachadorPage implements OnInit {
  loading = true;

  ventasHoy = 0;
  pedidosPendientes = 0;
  pedidosEnRuta = 0;
  entregadosHoy = 0;

  pedidosRecientes: PedidoResumen[] = [];
  cuadresPendientes: CuadrePendiente[] = [];
  nombresPorId = new Map<string, string>();

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading = true;
    const inicioHoy = inicioDiaColombia();

    const [ventasRes, pendientesRes, enRutaRes, entregadosRes, recientesRes, cuadresRes, perfilesRes] =
      await Promise.all([
        this.supabase.client
          .from('pedidos')
          .select('total')
          .gte('created_at', inicioHoy.toISOString())
          .in('estado', ['en_ruta', 'entregado']),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'pendiente'),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'en_ruta'),
        this.supabase.client
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('estado', 'entregado')
          .gte('entregado_at', inicioHoy.toISOString()),
        this.supabase.client
          .from('pedidos')
          .select('id, numero, cliente_nombre, total, estado, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
        this.supabase.client
          .from('cuadres')
          .select('id, domiciliario_id, total_a_entregar')
          .eq('estado', 'pendiente')
          .order('fecha', { ascending: true }),
        this.supabase.client.from('profiles').select('id, nombre'),
      ]);

    this.ventasHoy = (ventasRes.data ?? []).reduce((s, p) => s + Number(p.total ?? 0), 0);
    this.pedidosPendientes = pendientesRes.count ?? 0;
    this.pedidosEnRuta = enRutaRes.count ?? 0;
    this.entregadosHoy = entregadosRes.count ?? 0;
    this.pedidosRecientes = (recientesRes.data as PedidoResumen[]) ?? [];
    this.cuadresPendientes = (cuadresRes.data as CuadrePendiente[]) ?? [];

    if (perfilesRes.data) {
      this.nombresPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.nombre]));
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  nombreDomiciliario(id: string): string {
    return this.nombresPorId.get(id) ?? 'Domiciliario';
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

  claseEstado(estado: string): string {
    const clases: Record<string, string> = {
      pendiente: 'badge-bajo',
      en_ruta: 'badge-info',
      entregado: 'badge-ok',
      cancelado: 'badge-coral',
    };
    return clases[estado] ?? '';
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}