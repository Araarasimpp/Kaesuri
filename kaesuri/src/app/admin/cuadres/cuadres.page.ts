import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { Cuadre, MetodoPago } from '../../shared/models/models';
import { ImagenPreviewComponent } from '../../shared/imagen-preview/imagen-preview.component';
import { ETIQUETA_METODO, efectivoDe, llevaComprobante, transferenciaDe } from '../../shared/pago';
import { diaColombiaDe, formatoFechaCO, hoyColombiaISO } from '../../shared/fecha-colombia';

import { avisar, confirmar } from '../../shared/dialogo';
type FiltroCuadre = 'todos' | 'pendiente' | 'confirmado';

interface PedidoDelCuadre {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  total: number;
  valor_domicilio: number;
  metodo_pago: MetodoPago | null;
  monto_efectivo: number | null;
  monto_transferencia: number | null;
  comprobante_url: string | null;
}

/** Entregas de un domiciliario en un día que todavía no están en ningún cuadre. */
interface SinCerrar {
  domiciliarioId: string;
  fecha: string;
  pedidos: number;
  efectivo: number;
  transferencia: number;
  domicilios: number;
  aEntregar: number;
}

interface Domiciliario {
  id: string;
  nombre: string;
}

@Component({
  selector: 'app-admin-cuadres',
  standalone: true,
  imports: [CommonModule, FormsModule, ImagenPreviewComponent],
  templateUrl: './cuadres.page.html',
  styleUrls: ['./cuadres.page.scss'],
})
export class AdminCuadresPage implements OnInit, OnDestroy {
  loading = true;
  cuadres: Cuadre[] = [];
  domiciliarios: Domiciliario[] = [];
  nombresPorId = new Map<string, string>();
  filtro: FiltroCuadre = 'pendiente';
  fecha = hoyColombiaISO();
  domiciliarioId = 'todos';
  confirmandoId: string | null = null;

  expandidoId: string | null = null;
  pedidosPorCuadre = new Map<string, PedidoDelCuadre[]>();
  cargandoDetalle = false;
  readonly hoy = hoyColombiaISO();

  /** Lo que los domiciliarios llevan entregado y aún no han cerrado (en vivo). */
  sinCerrar: SinCerrar[] = [];
  /** Pedidos en ruta por domiciliario (todavía no entregados). */
  enRutaPorDom = new Map<string, number>();
  cerrandoClave: string | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;


  private canal: RealtimeChannel | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('admin-cuadres-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuadres' }, () => this.programarRecarga())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => this.programarRecarga())
      .subscribe();
  }

  private programarRecarga(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.pedidosPorCuadre.clear();
      this.cargarTodo();
    }, 400);
  }

  async cargarTodo(): Promise<void> {
    if (!this.cuadres.length) this.loading = true;

    const [cuadresRes, perfilesRes, abiertosRes] = await Promise.all([
      this.supabase.client.from('cuadres').select('*').order('fecha', { ascending: false }),
      this.supabase.client.from('profiles').select('id, nombre, role'),
      this.supabase.client
        .from('pedidos')
        .select('domiciliario_id, estado, entregado_at, total, metodo_pago, monto_efectivo, monto_transferencia, valor_domicilio')
        .in('estado', ['entregado', 'en_ruta'])
        .is('cuadre_id', null)
        .not('domiciliario_id', 'is', null),
    ]);
    if (!abiertosRes.error && abiertosRes.data) {
      this.calcularSinCerrar(abiertosRes.data as any[]);
    }


    if (!cuadresRes.error && cuadresRes.data) {
      this.cuadres = cuadresRes.data as Cuadre[];
    }
    if (!perfilesRes.error && perfilesRes.data) {
      this.nombresPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.nombre]));
      this.domiciliarios = (perfilesRes.data as any[])
        .filter((p) => p.role === 'domiciliario')
        .map((p) => ({ id: p.id, nombre: p.nombre }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }

    this.loading = false;
    this.cdr.detectChanges();
  }
  private calcularSinCerrar(filas: any[]): void {
    const grupos = new Map<string, SinCerrar>();
    const enRuta = new Map<string, number>();
    for (const p of filas) {
      if (p.estado === 'en_ruta') {
        enRuta.set(p.domiciliario_id, (enRuta.get(p.domiciliario_id) ?? 0) + 1);
        continue;
      }
      if (!p.entregado_at) continue;
      const fecha = diaColombiaDe(p.entregado_at);
      const clave = p.domiciliario_id + '|' + fecha;
      const g = grupos.get(clave) ?? {
        domiciliarioId: p.domiciliario_id, fecha, pedidos: 0, efectivo: 0, transferencia: 0, domicilios: 0, aEntregar: 0,
      };
      g.pedidos++;
      g.efectivo += efectivoDe(p);
      g.transferencia += transferenciaDe(p);
      g.domicilios += Number(p.valor_domicilio) || 0;
      g.aEntregar = g.efectivo - g.domicilios;
      grupos.set(clave, g);
    }
    this.enRutaPorDom = enRuta;
    this.sinCerrar = Array.from(grupos.values()).sort(
      (a, b) =>
        b.fecha.localeCompare(a.fecha) ||
        this.nombreDomiciliario(a.domiciliarioId).localeCompare(this.nombreDomiciliario(b.domiciliarioId))
    );
  }

  get sinCerrarFiltrados(): SinCerrar[] {
    return this.sinCerrar.filter((g) => this.domiciliarioId === 'todos' || g.domiciliarioId === this.domiciliarioId);
  }

  claveDe(g: SinCerrar): string {
    return g.domiciliarioId + '|' + g.fecha;
  }

  /** Cierra el cuadre en nombre del domiciliario (cuando él no lo hizo). */
  async cerrarPorDomiciliario(g: SinCerrar): Promise<void> {
    const nombre = this.nombreDomiciliario(g.domiciliarioId);
    const enRuta = g.fecha === this.hoy ? this.enRutaPorDom.get(g.domiciliarioId) ?? 0 : 0;
    const aviso = enRuta
      ? `\n\nTodavía tiene ${enRuta} ${enRuta === 1 ? 'pedido' : 'pedidos'} en ruta; esos quedarán para otro cuadre.`
      : '';
    const ok = await confirmar(
      `Se cerrará el cuadre de ${nombre} del ${this.formatoFecha(g.fecha)}. Debe entregar ${this.formatoMoneda(g.aEntregar)}.${aviso}`,
      { titulo: 'Cerrar cuadre', aceptar: 'Cerrar cuadre' }
    );
    if (!ok) return;

    this.cerrandoClave = this.claveDe(g);
    this.cdr.detectChanges();
    const { error } = await this.supabase.client.rpc('cerrar_cuadre', { p_fecha: g.fecha, p_domiciliario: g.domiciliarioId });
    this.cerrandoClave = null;
    if (error) {
      avisar(error.message, 'No se pudo cerrar');
    } else {
      this.filtro = 'pendiente';
      this.fecha = g.fecha;
    }
    await this.cargarTodo();
  }

  /** Quién cerró el cuadre, si no fue el propio domiciliario. */
  cerradoPor(c: Cuadre): string | null {
    const por = c.cerrado_por;
    if (por === undefined || por === c.domiciliario_id) return null;
    if (por === null) return 'Cierre automático';
    return 'Cerró ' + (this.nombresPorId.get(por) ?? 'la oficina');
  }

  /** Cuadres pendientes que el filtro de fecha está ocultando. */
  get pendientesOtrosDias(): number {
    if (!this.fecha) return 0;
    return this.cuadres.filter(
      (c) =>
        c.estado === 'pendiente' &&
        c.fecha !== this.fecha &&
        (this.domiciliarioId === 'todos' || c.domiciliario_id === this.domiciliarioId)
    ).length;
  }

  verPendientesOtrosDias(): void {
    this.fecha = '';
    this.filtro = 'pendiente';
  }


  get filtrados(): Cuadre[] {
    return this.cuadres.filter((c) => {
      if (this.filtro !== 'todos' && c.estado !== this.filtro) return false;
      if (this.domiciliarioId !== 'todos' && c.domiciliario_id !== this.domiciliarioId) return false;
      if (this.fecha && c.fecha !== this.fecha) return false;
      return true;
    });
  }

  get pendientesCount(): number {
    return this.cuadres.filter((c) => c.estado === 'pendiente').length;
  }

  nombreDomiciliario(id: string): string {
    return this.nombresPorId.get(id) ?? 'Desconocido';
  }

  async toggleDetalle(cuadre: Cuadre): Promise<void> {
    if (this.expandidoId === cuadre.id) {
      this.expandidoId = null;
      return;
    }

    this.expandidoId = cuadre.id;

    if (!this.pedidosPorCuadre.has(cuadre.id)) {
      this.cargandoDetalle = true;
      this.cdr.detectChanges();

      const { data, error } = await this.supabase.client
        .from('pedidos')
        .select(
          'id, numero, cliente_nombre, cliente_telefono, direccion, total, valor_domicilio, metodo_pago, monto_efectivo, monto_transferencia, comprobante_url'
        )
        .eq('cuadre_id', cuadre.id)
        .order('numero');

      if (!error && data) {
        this.pedidosPorCuadre.set(cuadre.id, data as PedidoDelCuadre[]);
      }
      this.cargandoDetalle = false;
    }

    this.cdr.detectChanges();
  }

  pedidosDe(cuadreId: string): PedidoDelCuadre[] {
    return this.pedidosPorCuadre.get(cuadreId) ?? [];
  }

  efectivoDe(p: PedidoDelCuadre): number {
    return efectivoDe(p);
  }

  transferenciaDe(p: PedidoDelCuadre): number {
    return transferenciaDe(p);
  }

  llevaComprobante(p: PedidoDelCuadre): boolean {
    return llevaComprobante(p.metodo_pago);
  }

  etiquetaMetodo(p: PedidoDelCuadre): string {
    return ETIQUETA_METODO[p.metodo_pago ?? 'efectivo'];
  }

  previewUrl: string | null = null;

  async verComprobante(pedido: PedidoDelCuadre): Promise<void> {
    if (!pedido.comprobante_url) return;

    const { data, error } = await this.supabase.client.storage
      .from('comprobantes')
      .createSignedUrl(pedido.comprobante_url, 60);

    if (!error && data?.signedUrl) {
      this.previewUrl = data.signedUrl;
      this.cdr.detectChanges();
    }
  }

  cerrarPreview(): void {
    this.previewUrl = null;
  }

  async confirmarCuadre(cuadre: Cuadre): Promise<void> {
    const ok = await confirmar(
      `Vas a marcar como recibido el cuadre de ${this.nombreDomiciliario(cuadre.domiciliario_id)} por ${this.formatoMoneda(cuadre.total_a_entregar)}.`,
      { titulo: 'Recibir cuadre', aceptar: 'Sí, lo recibí' }
    );
    if (!ok) return;

    this.confirmandoId = cuadre.id;
    const user = await this.supabase.getCurrentUser();

    const { error } = await this.supabase.client
      .from('cuadres')
      .update({
        estado: 'confirmado',
        confirmado_at: new Date().toISOString(),
        confirmado_por: user?.id ?? null,
      })
      .eq('id', cuadre.id);

    this.confirmandoId = null;

    if (!error) {
      await this.cargarTodo();
    } else {
      this.cdr.detectChanges();
    }
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
  horaCorta(iso?: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  }


  formatoFecha(fecha: string): string {
    return formatoFechaCO(fecha + 'T00:00:00-05:00', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}