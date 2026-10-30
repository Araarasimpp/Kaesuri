// Página de pedidos compartida por el admin (/admin/pedidos) y el despachador
// (/despachador/pedidos). Es la ÚNICA copia: las rutas de los dos roles cargan
// este mismo componente.
//
// Escala: los pedidos se piden por páginas de 50 al servidor, ya filtrados por
// estado, rótulo y búsqueda, y los productos vienen dentro de la misma consulta
// (sin listas largas de IDs en la URL). Así sigue funcionando con miles de pedidos.

import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { nombreConVariante } from '../../shared/variante';
import { EstadoPedido } from '../../shared/models/models';
import { RotuloService } from '../../shared/rotulo.service';
import { ImagenPreviewComponent } from '../../shared/imagen-preview/imagen-preview.component';
import { avisar, confirmar } from '../../shared/dialogo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ChatHojaComponent } from '../../shared/chat-pedido/chat-hoja.component';

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
  canal: 'domicilio' | 'local';
  observaciones: string | null;
  estado: EstadoPedido;
  total: number;
  domiciliario_id: string | null;
  rotulo_impreso_at: string | null;
  alistado_at: string | null;
  created_at: string;
  cuadre_id: string | null;
  /** Código del enlace público de seguimiento (/seguimiento/<código>) */
  seguimiento: string | null;
  /** Intentos de entrega que no se pudieron y el último motivo */
  novedades: number;
  ultima_novedad: string | null;
  productos: string;
  items: ItemFila[];
}

interface Domiciliario {
  id: string;
  nombre: string;
}

/**
 * "alistado" no es un estado del pedido en la base de datos: es un pedido
 * pendiente que ya se empacó (alistado_at). Tiene su propia pestaña para ver
 * qué falta por alistar y para imprimir los rótulos en el orden en que se alistaron.
 */
type FiltroEstado = 'todos' | EstadoPedido | 'alistado';
type FiltroRotulo = 'todos' | 'pendiente' | 'impreso';

const TAMANO_PAGINA = 50;
const COLUMNAS =
  'id, numero, canal, vendedor_id, cliente_nombre, cliente_telefono, direccion, barrio, observaciones, estado, total, domiciliario_id, rotulo_impreso_at, alistado_at, created_at, cuadre_id, seguimiento, novedades, ultima_novedad, ' +
  'pedido_items(cantidad, color, talla, producto:productos(nombre, imagen_url))';

@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [SkeletonComponent, CommonModule, FormsModule, RouterLink, ImagenPreviewComponent, ChatHojaComponent],
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
  alistando = false;
  imagenAbierta: string | null = null;
  /** Posición (1°, 2°, ...) de cada pedido alistado según el orden en que se alistó. */
  ordenAlistado = new Map<string, number>();
  /** Alistados a los que todavía no se les imprime el rótulo. */
  alistadosSinRotulo = 0;

  private canal: RealtimeChannel | null = null;
  private temporizadorRecarga: ReturnType<typeof setTimeout> | null = null;
  private temporizadorBusqueda: ReturnType<typeof setTimeout> | null = null;
  private consultaActual = 0;

  readonly estados: { valor: FiltroEstado; etiqueta: string }[] = [
    { valor: 'pendiente', etiqueta: 'Pendiente' },
    { valor: 'alistado', etiqueta: 'Alistados' },
    { valor: 'en_ruta', etiqueta: 'En ruta' },
    { valor: 'entregado', etiqueta: 'Entregado' },
    { valor: 'cancelado', etiqueta: 'Cancelado' },
    { valor: 'todos', etiqueta: 'Todos' },
  ];

  /** Pedido con el chat abierto (también llega por ?chat=<pedido> desde un aviso) */
  chatId: string | null = null;
  avisos = inject(NotificacionesService);
  private route = inject(ActivatedRoute);
  private subParams?: { unsubscribe(): void };

  constructor(
    private supabase: SupabaseService,
    private rotulos: RotuloService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {
    this.rutaNuevo = router.url.startsWith('/despachador') ? '/despachador/pedidos/nuevo' : '/admin/pedidos/nuevo';
  }

  /** Solo el admin puede devolver una entrega a En ruta */
  esAdmin = false;

  async ngOnInit(): Promise<void> {
    void this.avisos.iniciar();
    void this.supabase.getCurrentProfile().then((p) => {
      this.esAdmin = !!p && rolesDe(p).includes('admin');
      this.cdr.detectChanges();
    });
    this.subParams = this.route.queryParamMap.subscribe((q) => {
      const id = q.get('chat');
      if (id) {
        this.chatId = id;
        this.cdr.detectChanges();
      }
    });
    await Promise.all([this.cargarPedidos(), this.cargarConteos(), this.cargarDomiciliarios()]);
    this.suscribirRealtime();
  }

  abrirChat(id: string): void {
    this.menuAbiertoId = null;
    this.chatId = id;
  }

  cerrarChat(): void {
    this.chatId = null;
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  ngOnDestroy(): void {
    this.subParams?.unsubscribe();
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

  /** Filtro de estado; "pendiente" y "alistado" separan los pendientes según si ya se alistaron. */
  private filtrarEstado(query: any, valor: FiltroEstado): any {
    if (valor === 'todos') return query;
    if (valor === 'pendiente') return query.eq('estado', 'pendiente').is('alistado_at', null);
    if (valor === 'alistado') return query.eq('estado', 'pendiente').not('alistado_at', 'is', null);
    return query.eq('estado', valor);
  }

  /** Los alistados se muestran en el orden en que se alistaron; el resto, del más nuevo al más viejo. */
  private ordenar(query: any): any {
    return this.filtroEstado === 'alistado'
      ? query.order('alistado_at', { ascending: true })
      : query.order('created_at', { ascending: false });
  }

  private aplicarFiltros(query: any, incluirEstado = true): any {
    if (incluirEstado) query = this.filtrarEstado(query, this.filtroEstado);
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

    const query = this.ordenar(
      this.aplicarFiltros(this.supabase.client.from('pedidos').select(COLUMNAS, { count: 'exact' }))
    ).range(0, cantidad - 1);

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
    const { data, error } = await this.ordenar(this.aplicarFiltros(this.supabase.client.from('pedidos').select(COLUMNAS)))
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
    const valores: FiltroEstado[] = ['pendiente', 'alistado', 'en_ruta', 'entregado', 'cancelado', 'todos'];
    const [resultados, alistados] = await Promise.all([
      Promise.all(
        valores.map((v) =>
          this.filtrarEstado(this.supabase.client.from('pedidos').select('id', { count: 'exact', head: true }), v)
        )
      ),
      // Lista liviana de todos los alistados en orden, para numerarlos (1°, 2°...)
      // aunque la búsqueda o la paginación solo muestren algunos.
      this.supabase.client
        .from('pedidos')
        .select('id, rotulo_impreso_at')
        .eq('estado', 'pendiente')
        .not('alistado_at', 'is', null)
        .order('alistado_at', { ascending: true }),
    ]);
    valores.forEach((v, i) => (this.conteos[v] = (resultados[i] as any).count ?? 0));
    const filas = (alistados.data ?? []) as { id: string; rotulo_impreso_at: string | null }[];
    this.ordenAlistado = new Map(filas.map((f, i) => [f.id, i + 1]));
    this.alistadosSinRotulo = filas.filter((f) => !f.rotulo_impreso_at).length;
    this.cdr.detectChanges();
  }

  private aFila(p: any): PedidoFila {
    const items: ItemFila[] = (p.pedido_items ?? []).map((i: any) => ({
      // Con color y talla: "Camiseta (Negro · Talla M)" (así sale también en el rótulo)
      nombre: nombreConVariante(i.producto?.nombre ?? 'Producto', i),
      cantidad: i.cantidad,
      imagen_url: i.producto?.imagen_url ?? null,
    }));
    const resto = { ...p };
    delete resto.pedido_items;
    return { ...resto, items, productos: items.map((i) => `${i.nombre} x${i.cantidad}`).join(', ') };
  }

  async cargarDomiciliarios(): Promise<void> {
    const { data, error } = await this.supabase.client.from('profiles').select('id, nombre, roles');

    if (!error && data) {
      this.nombresPorId = new Map(data.map((p: any) => [p.id, p.nombre]));
      this.domiciliarios = (data as any[])
        .filter((p) => p.roles?.includes('domiciliario'))
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

  esAlistado(p: PedidoFila): boolean {
    return p.estado === 'pendiente' && !!p.alistado_at;
  }

  etiquetaEstado(p: PedidoFila): string {
    if (this.esAlistado(p)) return 'Alistado';
    return this.estados.find((e) => e.valor === p.estado)?.etiqueta ?? p.estado;
  }

  claseEstado(p: PedidoFila): string {
    if (this.esAlistado(p)) return 'estado-alistado';
    const clases: Record<EstadoPedido, string> = {
      pendiente: 'estado-bajo',
      en_ruta: 'estado-info',
      entregado: 'estado-ok',
      cancelado: 'estado-agotado',
    };
    return clases[p.estado];
  }

  /** "1°", "2°"... según el orden en que se alistó; vacío si no está alistado. */
  ordinalAlistado(p: PedidoFila): string {
    const n = this.esAlistado(p) ? this.ordenAlistado.get(p.id) : undefined;
    return n ? `${n}°` : '';
  }

  /** Pedidos seleccionados que todavía se pueden alistar (pendientes sin alistar). */
  get seleccionadosPorAlistar(): PedidoFila[] {
    return this.pedidos.filter((p) => this.seleccionados.has(p.id) && p.estado === 'pendiente' && !p.alistado_at);
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

  // ---------- Alistamiento ----------

  /**
   * Marca pedidos como alistados. Van uno por uno, del más viejo al más nuevo,
   * para que el orden de alistamiento (lo pone el servidor) quede igual que el
   * orden en que se tomaron los pedidos.
   */
  async alistar(pedidos: PedidoFila[]): Promise<void> {
    if (!pedidos.length || this.alistando) return;
    this.alistando = true;
    this.menuAbiertoId = null;
    this.cdr.detectChanges();

    const enOrden = [...pedidos].sort((a, b) => a.created_at.localeCompare(b.created_at));
    let error: string | null = null;
    for (const p of enOrden) {
      const res = await this.supabase.client
        .from('pedidos')
        .update({ alistado_at: new Date().toISOString() })
        .eq('id', p.id)
        .eq('estado', 'pendiente')
        .is('alistado_at', null);
      if (res.error) {
        error = res.error.message;
        break;
      }
      this.seleccionados.delete(p.id);
    }

    this.alistando = false;
    if (error) avisar('No se pudo alistar: ' + error);
    await Promise.all([this.cargarPedidos(this.pedidos.length), this.cargarConteos()]);
  }

  async quitarAlistado(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    const { error } = await this.supabase.client
      .from('pedidos')
      .update({ alistado_at: null })
      .eq('id', pedido.id)
      .eq('estado', 'pendiente');
    if (error) avisar('No se pudo quitar de alistados: ' + error.message);
    await Promise.all([this.cargarPedidos(this.pedidos.length), this.cargarConteos()]);
  }

  /** Imprime los rótulos de TODOS los alistados que no lo tienen, en el orden en que se alistaron. */
  async imprimirAlistados(): Promise<void> {
    if (this.imprimiendo || !this.alistadosSinRotulo) return;
    this.imprimiendo = true;
    this.cdr.detectChanges();

    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select(COLUMNAS)
      .eq('estado', 'pendiente')
      .not('alistado_at', 'is', null)
      .is('rotulo_impreso_at', null)
      .order('alistado_at', { ascending: true });

    if (error || !data?.length) {
      this.imprimiendo = false;
      if (error) avisar('No se pudieron cargar los alistados: ' + error.message);
      await this.cargarConteos();
      return;
    }

    await this.imprimirEnOrden(data.map((p: any) => this.aFila(p)));
  }

  /** Imprime los rótulos de esos pedidos tal cual vienen ordenados y los marca como impresos. */
  private async imprimirEnOrden(pedidos: PedidoFila[]): Promise<void> {
    const ids = pedidos.map((p) => p.id);
    const items = pedidos.flatMap((p) =>
      (p.items ?? []).map((i) => ({ pedido_id: p.id, cantidad: i.cantidad, producto: { nombre: i.nombre } }))
    );

    const impreso = await this.rotulos.imprimir(pedidos, items);

    if (impreso) {
      // Se marca como impreso al abrir el diálogo de impresión (el navegador no
      // avisa de forma confiable si la persona lo canceló).
      await this.supabase.client.from('pedidos').update({ rotulo_impreso_at: new Date().toISOString() }).in('id', ids);
      this.seleccionados.clear();
    } else {
      avisar('No se pudo abrir la impresión. Intenta de nuevo.');
    }

    this.imprimiendo = false;
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

  /** Enlace público para que el cliente vea en qué va su pedido */
  enlaceSeguimiento(p: PedidoFila): string {
    return `${location.origin}/seguimiento/${p.seguimiento ?? ''}`;
  }

  /** Abre WhatsApp con el cliente y el enlace de seguimiento */
  enviarSeguimiento(p: PedidoFila): void {
    this.menuAbiertoId = null;
    const tel = (p.cliente_telefono ?? '').replace(/\D/g, '');
    const num = tel.length === 10 ? '57' + tel : tel;
    const nombre = (p.cliente_nombre ?? '').trim().split(/\s+/)[0];
    const texto = `Hola ${nombre}, aquí puedes ver en qué va tu pedido #${p.numero} de Variedades JYB: ${this.enlaceSeguimiento(p)}`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  }

  async copiarSeguimiento(p: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    try {
      await navigator.clipboard.writeText(this.enlaceSeguimiento(p));
      avisar('Ya puedes pegarlo en el chat con el cliente.', 'Enlace de seguimiento copiado');
    } catch {
      avisar(this.enlaceSeguimiento(p), 'Enlace de seguimiento');
    }
  }

  /** Entregado por error (p. ej. comprobante equivocado): vuelve a En ruta con el mismo domiciliario */
  async devolverEntrega(pedido: PedidoFila): Promise<void> {
    this.menuAbiertoId = null;
    const ok = await confirmar(
      `El pedido #${pedido.numero} de ${pedido.cliente_nombre} vuelve a En ruta con ${this.nombreDomiciliario(pedido.domiciliario_id)}, ` +
        'para que lo entregue de nuevo con el comprobante correcto. Se quita el pago que tenía registrado.',
      { titulo: 'Devolver entrega', aceptar: 'Devolver a En ruta', cancelar: 'Volver' }
    );
    if (!ok) return;
    const { error } = await this.supabase.client.rpc('devolver_entrega', { p_pedido: pedido.id });
    if (error) avisar(error.message, 'No se pudo devolver');
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

    // Los alistados salen primero y en el orden en que se alistaron; el resto
    // sigue en el orden de la tabla (sort es estable).
    const orden = (p: PedidoFila) =>
      (this.esAlistado(p) && this.ordenAlistado.get(p.id)) || Number.MAX_SAFE_INTEGER;
    const pedidosSeleccionados = this.pedidos
      .filter((p) => this.seleccionados.has(p.id))
      .sort((a, b) => orden(a) - orden(b));

    await this.imprimirEnOrden(pedidosSeleccionados);
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
