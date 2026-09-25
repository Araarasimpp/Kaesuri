import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { inicioDiaColombia, diaColombiaDe } from '../../shared/fecha-colombia';


interface PedidoResumen {
  id: string;
  numero: number;
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

interface CuadrePendiente {
  id: string;
  domiciliario_id: string;
  total_a_entregar: number;
  fecha: string;
}

interface BarraDia {
  label: string;
  monto: number;
  alturaPct: number;
  esHoy: boolean;
}

interface DomiciliarioActivo {
  id: string;
  nombre: string;
  cantidad: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
})
export class DashboardPage implements OnInit {
  loading = true;

  ventasHoy = 0;
  gananciaHoy = 0;
  pedidosPendientes = 0;
  pedidosEnRuta = 0;

  cuadresPendientes: CuadrePendiente[] = [];
  productosStockBajo: ProductoBajo[] = [];
  pedidosRecientes: PedidoResumen[] = [];
  ventasSemana: BarraDia[] = [];
  domiciliariosActivos: DomiciliarioActivo[] = [];

  donutSegmentos: { estado: string; pct: number; color: string }[] = [];
  donutGradient = '';
  pctEntregado = 0;
  totalPedidosHoy = 0;

  private nombresPorId = new Map<string, string>();

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarReporte();
  }

  async cargarReporte(): Promise<void> {
    this.loading = true;

    const inicioHoy = inicioDiaColombia();
    const inicioSemana = new Date(inicioHoy);
    inicioSemana.setDate(inicioSemana.getDate() - 6);

    const [
      ventasHoyRes,
      gananciaRes,
      pendientesRes,
      enRutaRes,
      cuadresRes,
      stockBajoRes,
      recientesRes,
      semanaRes,
      enRutaListaRes,
      hoyEstadosRes,
      perfilesRes,
    ] = await Promise.all([
      this.supabase.client
        .from('pedidos')
        .select('total')
        .gte('created_at', inicioHoy.toISOString())
        .in('estado', ['en_ruta', 'entregado']),
      this.supabase.client.rpc('ganancias_hoy'),
      this.supabase.client
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente'),
      this.supabase.client
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'en_ruta'),
      this.supabase.client
        .from('cuadres')
        .select('id, domiciliario_id, total_a_entregar, fecha')
        .eq('estado', 'pendiente')
        .order('fecha', { ascending: true }),
      this.supabase.client
        .from('productos')
        .select('id, nombre, stock')
        .eq('activo', true)
        .lt('stock', 5)
        .order('stock', { ascending: true })
        .limit(5),
      this.supabase.client
        .from('pedidos')
        .select('id, numero, cliente_nombre, total, estado, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      this.supabase.client
        .from('pedidos')
        .select('total, created_at')
        .gte('created_at', inicioSemana.toISOString())
        .in('estado', ['en_ruta', 'entregado']),
      this.supabase.client
        .from('pedidos')
        .select('domiciliario_id')
        .eq('estado', 'en_ruta')
        .not('domiciliario_id', 'is', null),
      this.supabase.client
        .from('pedidos')
        .select('estado')
        .gte('created_at', inicioHoy.toISOString()),
      this.supabase.client.from('profiles').select('id, nombre'),
    ]);

    if (perfilesRes.data) {
      this.nombresPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.nombre]));
    }

    this.ventasHoy = (ventasHoyRes.data ?? []).reduce((s, p) => s + Number(p.total ?? 0), 0);
    this.gananciaHoy = Number(gananciaRes.data ?? 0);
    this.pedidosPendientes = pendientesRes.count ?? 0;
    this.pedidosEnRuta = enRutaRes.count ?? 0;
    this.cuadresPendientes = (cuadresRes.data as CuadrePendiente[]) ?? [];
    this.productosStockBajo = (stockBajoRes.data as ProductoBajo[]) ?? [];
    this.pedidosRecientes = (recientesRes.data as PedidoResumen[]) ?? [];

    this.ventasSemana = this.construirBarrasSemana(semanaRes.data ?? [], inicioSemana);
    this.domiciliariosActivos = this.construirDomiciliariosActivos(enRutaListaRes.data ?? []);
    this.construirDonut(hoyEstadosRes.data ?? []);

    this.loading = false;
    this.cdr.detectChanges();
  }

  private construirBarrasSemana(filas: any[], inicioSemana: Date): BarraDia[] {
    const dias = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const buckets: { fecha: string; label: string; esHoy: boolean; monto: number }[] = [];

    for (let i = 0; i < 7; i++) {
      const fecha = new Date(inicioSemana);
      fecha.setDate(fecha.getDate() + i);
      const key = diaColombiaDe(fecha.toISOString());
      buckets.push({
        fecha: key,
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

  private construirDomiciliariosActivos(filas: any[]): DomiciliarioActivo[] {
    const conteo = new Map<string, number>();
    for (const f of filas) {
      conteo.set(f.domiciliario_id, (conteo.get(f.domiciliario_id) ?? 0) + 1);
    }

    return Array.from(conteo.entries())
      .map(([id, cantidad]) => ({
        id,
        cantidad,
        nombre: this.nombresPorId.get(id) ?? 'Domiciliario',
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }

  private construirDonut(filas: any[]): void {
    this.totalPedidosHoy = filas.length;

    const conteo = { pendiente: 0, en_ruta: 0, entregado: 0, cancelado: 0 } as Record<
      string,
      number
    >;
    for (const f of filas) {
      conteo[f.estado] = (conteo[f.estado] ?? 0) + 1;
    }

    const colores: Record<string, string> = {
      entregado: 'var(--k-teal)',
      en_ruta: 'var(--k-amber)',
      pendiente: 'rgba(18, 21, 28, 0.18)',
      cancelado: 'var(--k-coral)',
    };

    if (this.totalPedidosHoy === 0) {
      this.donutGradient = 'var(--k-bg-alt)';
      this.pctEntregado = 0;
      this.donutSegmentos = [];
      return;
    }

    let acumulado = 0;
    const segmentosCss: string[] = [];
    this.donutSegmentos = [];

    for (const estado of ['entregado', 'en_ruta', 'pendiente', 'cancelado']) {
      const cantidad = conteo[estado] ?? 0;
      if (cantidad === 0) continue;
      const pct = Math.round((cantidad / this.totalPedidosHoy) * 100);
      const inicio = acumulado;
      acumulado += pct;
      segmentosCss.push(`${colores[estado]} ${inicio}% ${acumulado}%`);
      this.donutSegmentos.push({ estado, pct, color: colores[estado] });
    }

    this.donutGradient = `conic-gradient(${segmentosCss.join(', ')})`;
    this.pctEntregado = Math.round(((conteo['entregado'] ?? 0) / this.totalPedidosHoy) * 100);
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