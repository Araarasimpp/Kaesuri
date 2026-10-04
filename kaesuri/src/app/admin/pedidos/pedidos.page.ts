// Página de pedidos compartida por el admin (/admin/pedidos) y el despachador
// (/despachador/pedidos). Es la ÚNICA copia: las rutas de los dos roles cargan
// este mismo componente.
//
// Escala: los pedidos se piden por páginas de 50 al servidor, ya filtrados por
// estado, rótulo y búsqueda, y los productos vienen dentro de la misma consulta
// (sin listas largas de IDs en la URL). Así sigue funcionando con miles de pedidos.

import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { EstadoPedido } from '../../shared/models/models';
import { RotuloService } from '../../shared/rotulo.service';
import { ImagenPreviewComponent } from '../../shared/imagen-preview/imagen-preview.component';
import { avisar, confirmar } from '../../shared/dialogo';

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

const TAMANO_PAGINA = 50;
const COLUMNAS =
  'id, numero, vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones, estado, total, domiciliario_id, rotulo_impreso_at, created_at, ' +
  'pedido_items(cantidad, producto:productos(nombre, imagen_url))';

@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ImagenPreviewComponent],
  templateUrl: './pedidos.page.html',
  styleUrls: ['./pedidos.page.scss'],
})
export class PedidosPage implements OnInit, OnDestroy {
  /** "/admin/pedidos/nuevo" o "/despachador/pedidos/nuevo" según quién esté usando la página. */
  readonly rutaNuevo: string;

  loading = true;
  cargandoMas = false;
  pedidos: PedidoFila[] = [];
  totalFiltrados = 0;
  conteos: Record<string, number> = {};
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
  private temporizadorRecarga: ReturnType<typeof setTimeout> | null = null;
  private temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;
  private consultaActual = 0;

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
    private cdr: ChangeDetectorRef,
    router: Router
  ) {
    this.rutaNuevo = router.url.startsWith('/despachador') ? '/despachador/pedidos/nuevo' : '/admin/pedidos/nuevo';
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargarPedidos(), this.cargarConteos(), this.cargarDomiciliarios()]);
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) this.supabase.client.removeChannel(this.canal);
    if (this.temporizadorRecarga) clearTimeout(this.temporizadorRecarga);
    if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
  }

  /** Cuando alguien cambia un pedido, se refresca lo que está en pantalla (agrupando cambios seguidos). */
  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('pedidos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        if (this.temporizadorRecarga) clearTimeout(this.temporizadorRecarga);
        this.temporizadorRecarga = setTimeout(() => {
          this.cargarPedidos(Math.max(this.pedidos.length, TAMANO_PAGINA));
          this.cargarConteos();
        }, 700);
      })
      .subscribe();
  }

  // ---------- Consultas ----------

  private textoBusqueda(): string {
    // Se quitan caracteres que rompen el filtro de Supabase.
    return this.busqueda.trim().replace(/[,()%*\\]/g, ' ').trim();
  }

  private aplicarFiltros(query: any, incluirEstado = true): any {
    if (incluirEstado && this.filtroEstado !== 'todos') query = query.eq('estado', this.filtroEstado);
    if (this.filtroRotulo === 'pendiente') query = query.is('rotulo_impreso_at', null);
    if (this.filtroRotulo === 'impreso') query = query.not('rotulo_impreso_at', 'is', null);

    const q = this.textoBusqueda();
    if (q) {
      const condiciones = [`cliente_nombre.ilike.%${q}%`, `cliente_telefono.ilike.%${q}%`, `barrio.ilike.%${q}%`];
      const numero = q.replace(/^#/, '');
      if (/^\d+$/.test(numero)) condiciones.push(`numero.eq.${numero}`);
      query = query.or(condiciones.join(','));
    }
    return query;
  }

  /** Carga la primera página (o `cantidad` pedidos) con los filtros actuales. */
  async cargarPedidos(cantidad = TAMANO_PAGINA): Promise<void> {
    const consulta = ++this.consultaActual;
    this.loading = !this.pedidos.length;

    const query = this.aplicarFiltros(
      this.supabase.client.from('pedidos').select(COLUMNAS, { count: 'exact' })
    )
      .order('created_at', { ascending: false })
      .range(0, cantidad - 1);

    const { data, count, error } = await query;
    if (consulta !== this.consultaActual) return; // llegó una consulta más nueva

    if (!error) {
      this.pedidos = (data ?? []).map((p: any) => this.aFila(p));
      this.totalFiltrados = count ?? this.pedidos.length;
      const visibles = new Set(this.pedidos.map((p) => p.id));
      this.seleccionados.forEach((id) => {
        if (!visibles.has(id)) this.seleccionados.delete(id);
      });
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  async cargarMas(): Promise<void> {
    if (this.cargandoMas || this.pedidos.length >= this.totalFiltrados) return;
    this.cargandoMas = true;
    this.cdr.detectChanges();

    const desde = this.pedidos.length;
    const { data, error } = await this.aplicarFiltros(this.supabase.client.from('pedidos').select(COLUMNAS))
      .order('created_at', { ascending: false })
      .range(desde, desde + TAMANO_PAGINA - 1);

    if (!error && data) {
      const ya = new Set(this.pedidos.map((p) => p.id));
      this.pedidos = this.pedidos.concat(data.map((p: any) => this.aFila(p)).filter((p: PedidoFila) => !ya.has(p.id)));
    }
    this.cargandoMas = false;
    this.cdr.detectChanges();
  }

  /** Cuántos pedidos hay en cada pestaña (consultas livianas que solo cuentan). */
  async cargarConteos(): Promise<void> {
    const valores: FiltroEstado[] = ['pendiente', 'en_ruta', 'entregado', 'cancelado', 'todos'];
    const resultados = await Promise.all(
      valores.map((v) => {
        let query = this.supabase.client.from('pedidos').select('id', { count: 'exact', head: true });
        if (v !== 'todos') query = query.eq('estado', v);
        return query;
      })
    );
    valores.forEach((v, i) => (this.conteos[v] = resultados[i].count ?? 0));
    this.cdr.detectChanges();
  }

  private aFila(p: any): PedidoFila {
    const items: ItemFila[] = (p.pedido_items ?? []).map((i: any) => ({
      nombre: i.producto?.nombre ?? 'Producto',
      cantidad: i.cantidad,
      imagen_url: i.producto?.imagen_url ?? null,
    }));
    const resto = { ...p };
    delete resto.pedido_items;
    return { ...resto, items, productos: items.map((i) => `${i.nombre} x${i.cantidad}`).join(', ') };
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

  // ---------- Filtros ----------

  cambiarEstado(valor: FiltroEstado): void {
    this.filtroEstado = valor;
    this.seleccionados.clear();
    this.pedidos = [];
    this.cargarPedidos();
  }

  cambiarRotulo(): void {
    this.seleccionados.clear();
    this.cargarPedidos();
  }

  buscar(): void {
    if (this.temporizadorBusqueda) clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => this.cargarPedidos(), 350);
  }

  /** Se mantiene el nombre para no cambiar la plantilla: ya vienen filtrados del servidor. */
  get filtrados(): PedidoFila[] {
    return this.pedidos;
  }

  contarEstado(valor: FiltroEstado): number {
    return this.conteos[valor] ?? 0;
  }

  get hayMas(): boolean {
    return this.pedidos.length < this.totalFiltrados;
  }

  // ---------- Utilidades de vista ----------

  nombreVendedor(id: string): string {
    return this.nombresPorId.get(id) ?? 'Desconocido';
  }

  nombreDomiciliario(id: string | null): string {
    if (!id) return 'Sin asignar';
    return this.nombresPorId.get(id) ?? 'Sin asignar';
  }

  verImagen(url: string | null, evento?: Event): void {
    evento?.stopPropagation();
    if (url) this.imagenAbierta = url;
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

  // ---------- Acciones ----------

  async asignarDomiciliario(pedido: PedidoFila, domiciliarioId: string): Promise<void> {
    // Un pedido ya entregado (o cancelado) no se puede reasignar: eso
    // rompería el cuadre y el historial de quién lo entregó de verdad.
    if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
      await this.cargarPedidos(this.pedidos.length);
      return;
    }

    this.guardandoId = pedido.id;
    const { error } = await this.supabase.client
      .from('pedidos')
      .update({ domiciliario_id: domiciliarioId || null, estado: 'en_ruta' })
      .eq('id', pedido.id);
    this.guardandoId = null;

    if (error) avisar('No se pudo asignar el domiciliario: ' + error.message);
    await Promise.all([this.cargarPedidos(this.pedidos.length), this.cargarConteos()]);
  }

  toggleMenu(id: string): void {
    this.menuAbiertoId = this.menuAbiertoId === id ? null : id;
  }

  async cancelarPedido(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') return;

    const ok = await confirmar(
      `Se cancelará el pedido #${pedido.numero} de ${pedido.cliente_nombre} y se devolverá el stock de los productos.`,
      { titulo: 'Cancelar pedido', aceptar: 'Cancelar pedido', cancelar: 'Volver', peligro: true }
    );
    if (!ok) return;

    const { error } = await this.supabase.client.rpc('cancelar_pedido', { p_pedido_id: pedido.id });
    if (error) avisar(error.message, 'No se pudo cancelar');
    await Promise.all([this.cargarPedidos(this.pedidos.length), this.cargarConteos()]);
  }

  async eliminarPedido(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    if (pedido.estado === 'entregado') return;

    const ok = await confirmar(
      `Se eliminará el pedido #${pedido.numero} de ${pedido.cliente_nombre} y se devolverá el stock de los productos. Esta acción no se puede deshacer.`,
      { titulo: 'Eliminar pedido', aceptar: 'Eliminar', cancelar: 'Volver', peligro: true }
    );
    if (!ok) return;

    const { error } = await this.supabase.client.rpc('eliminar_pedido', { p_pedido_id: pedido.id });
    if (error) avisar(error.message, 'No se pudo eliminar');
    await Promise.all([this.cargarPedidos(this.pedidos.length), this.cargarConteos()]);
  }

  toggleSeleccion(id: string): void {
    if (this.seleccionados.has(id)) this.seleccionados.delete(id);
    else this.seleccionados.add(id);
  }

  toggleSeleccionarTodos(): void {
    if (this.seleccionados.size === this.pedidos.length) this.seleccionados.clear();
    else this.pedidos.forEach((p) => this.seleccionados.add(p.id));
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

    const impreso = await this.rotulos.imprimir(pedidosSeleccionados, items);

    if (impreso) {
      // Se marca como impreso al abrir el diálogo de impresión (el navegador no
      // avisa de forma confiable si la persona lo canceló).
      await this.supabase.client.from('pedidos').update({ rotulo_impreso_at: new Date().toISOString() }).in('id', ids);
      this.seleccionados.clear();
    } else {
      avisar('No se pudo abrir la impresión. Intenta de nuevo.');
    }

    this.imprimiendo = false;
    await this.cargarPedidos(this.pedidos.length);
  }

  formatoMoneda(valor: number): string {
    return (valor ?? 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }

  formatoFecha(fecha: string): string {
    return new Date(fecha).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    });
  }
}
