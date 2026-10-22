import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { callOutline, chatbubbleEllipsesOutline, logoWhatsapp, navigateOutline } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { nombreConVariante } from '../../shared/variante';
import { microsAsignado } from '../../shared/fecha-colombia';
import { EntregarPedidoComponent } from '../entregar-pedido/entregar-pedido.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { JastaService, PedidoJasta, ResumenJasta } from '../../core/services/jasta.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ChatHojaComponent } from '../../shared/chat-pedido/chat-hoja.component';
import { MetodoPago } from '../../shared/models/models';

interface PedidoRuta {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  valor_domicilio: number;
  total: number;
  observaciones: string | null;
  created_at: string;
  asignado_at: string | null;
  productos: string;
}

/** Una parada de la ruta: un pedido de Variedades JYB o uno de Jasta */
interface Parada {
  clave: string;
  /** Hora de asignación en microsegundos */
  cuando: number;
  kaesuri?: PedidoRuta;
  jasta?: PedidoJasta;
}

/** Lo que necesita la hoja de entregar para un pedido de Jasta */
interface EntregaJasta {
  resumen: { id: string; numero: number; cliente_nombre: string; total: number };
  guardar: (metodo: MetodoPago, efectivo: number, transferencia: number, comprobante: string | null) => Promise<void>;
}

@Component({
  selector: 'app-inicio-domiciliario',
  standalone: true,
  imports: [SkeletonComponent, CommonModule, IonIcon, EntregarPedidoComponent, ChatHojaComponent],
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
})
export class InicioDomiciliarioPage implements OnInit, OnDestroy {
  loading = true;
  pedidos: PedidoRuta[] = [];
  pedidoEntregando: PedidoRuta | null = null;

  /** Pedidos de Jasta (null = todavía no se sabe o no reparte allá) */
  jasta: ResumenJasta | null = null;
  entregandoJasta: EntregaJasta | null = null;
  /** Pedido con el chat abierto (también llega por ?chat=<pedido> desde un aviso) */
  chatId: string | null = null;
  avisos = inject(NotificacionesService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private subParams?: { unsubscribe(): void };

  private canal: RealtimeChannel | null = null;
  /** Además de los avisos en vivo, se consulta Jasta cada minuto por si se pierde la conexión */
  private relojJasta?: ReturnType<typeof setInterval>;
  private canalJasta: string | null = null;
  private dejarJasta?: () => void;
  private timerJasta?: ReturnType<typeof setTimeout>;

  constructor(private supabase: SupabaseService, private jastas: JastaService, private cdr: ChangeDetectorRef) {
    addIcons({ callOutline, chatbubbleEllipsesOutline, logoWhatsapp, navigateOutline });
  }

  async ngOnInit(): Promise<void> {
    void this.avisos.iniciar();
    this.subParams = this.route.queryParamMap.subscribe((q) => {
      const id = q.get('chat');
      if (id) {
        this.chatId = id;
        this.cdr.detectChanges();
      }
    });
    void this.cargarJasta();
    await this.cargarPedidos();
    this.suscribirRealtime();
    this.relojJasta = setInterval(() => void this.cargarJasta(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
    this.subParams?.unsubscribe();
    clearInterval(this.relojJasta);
    clearTimeout(this.timerJasta);
    this.dejarJasta?.();
  }

  abrirChat(id: string): void {
    this.chatId = id;
  }

  cerrarChat(): void {
    this.chatId = null;
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  /**
   * Pedidos de los dos negocios en una sola ruta, en el orden en que se los asignaron.
   * Por Telegram la hora de asignación es la de la foto del rótulo, así que queda en el
   * mismo orden en que se mandaron las fotos (de Jasta y de Variedades JYB mezcladas).
   */
  get paradas(): Parada[] {
    return [
      ...this.pedidos.map((p) => ({ clave: 'k:' + p.id, cuando: microsAsignado(p.asignado_at ?? p.created_at), kaesuri: p })),
      ...(this.jasta?.en_ruta ?? []).map((p) => ({ clave: 'j:' + p.id, cuando: microsAsignado(p.asignado_at), jasta: p })),
    ].sort((a, b) => a.cuando - b.cuando);
  }

  trackParada(_: number, p: Parada): string {
    return p.clave;
  }

  /** Si falla (sin señal, por ejemplo) se dejan los pedidos de Jasta que ya se veían */
  async cargarJasta(): Promise<void> {
    try {
      const r = await this.jastas.resumen();
      this.jasta = r;
      this.escucharJasta(r.vinculado ? r.canal ?? null : null);
      this.cdr.detectChanges();
    } catch {
      /* se reintenta en el próximo minuto */
    }
  }

  /** Cuando Jasta avisa un cambio, se vuelve a pedir lo de allá */
  private escucharJasta(canal: string | null): void {
    if (canal === this.canalJasta) return;
    this.dejarJasta?.();
    this.dejarJasta = undefined;
    this.canalJasta = canal;
    if (!canal) return;
    this.dejarJasta = this.jastas.escuchar(canal, () => {
      clearTimeout(this.timerJasta);
      this.timerJasta = setTimeout(() => void this.cargarJasta(), 600);
    });
  }

  abrirEntregaJasta(p: PedidoJasta): void {
    this.entregandoJasta = {
      resumen: { id: 'jasta-' + p.id, numero: p.id, cliente_nombre: p.cliente_nombre, total: Number(p.total) },
      guardar: (metodo, efectivo, transferencia, comprobante) =>
        this.jastas.entregar(p.id, metodo, efectivo, transferencia, comprobante ? [comprobante] : []),
    };
  }

  async onEntregadoJasta(): Promise<void> {
    this.entregandoJasta = null;
    await this.cargarJasta();
  }

  productosJasta(p: PedidoJasta): string[] {
    return p.items.map((i) => {
      const variante = [i.color, i.talla].filter(Boolean).join(' · ');
      return `${i.nombre}${variante ? ' (' + variante + ')' : ''} — Cantidad: ${i.cantidad}`;
    });
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('mis-pedidos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () =>
        this.cargarPedidos()
      )
      .subscribe();
  }

  async cargarPedidos(): Promise<void> {
    this.loading = true;
    const user = await this.supabase.getCurrentUser();

    if (!user) {
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select(
        'id, numero, cliente_nombre, cliente_telefono, direccion, barrio, valor_domicilio, total, observaciones, created_at, asignado_at'
      )
      .eq('domiciliario_id', user.id)
      .eq('estado', 'en_ruta')
      .order('asignado_at', { ascending: true, nullsFirst: true });

    let pedidos = (data as any[]) ?? [];

    if (!error && pedidos.length) {
      const { data: items } = await this.supabase.client
        .from('pedido_items')
        .select('pedido_id, cantidad, color, talla, producto:productos(nombre)')
        .in(
          'pedido_id',
          pedidos.map((p) => p.id)
        );

      pedidos = pedidos.map((p) => ({
        ...p,
        productos: (items ?? [])
          .filter((i: any) => i.pedido_id === p.id)
          .map((i: any) => `${nombreConVariante(i.producto?.nombre ?? 'Producto', i)} — Cantidad: ${i.cantidad}`)
          .join('\n'),
      }));
    }

    this.pedidos = pedidos as PedidoRuta[];
    this.loading = false;
    this.cdr.detectChanges();
  }

  // ---------- Botones de acción ----------

  llamar(pedido: { cliente_telefono: string | null }): void {
    if (!pedido.cliente_telefono) return;
    window.open(`tel:${pedido.cliente_telefono}`, '_self');
  }

  whatsapp(pedido: { cliente_telefono: string | null }): void {
    if (!pedido.cliente_telefono) return;
    const numero = this.normalizarTelefono(pedido.cliente_telefono);
    window.open(`https://wa.me/${numero}`, '_blank');
  }

  navegar(pedido: { direccion: string | null; barrio: string | null }): void {
    const destino = encodeURIComponent(`${pedido.direccion ?? ''}, ${pedido.barrio ?? ''}`);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${destino}`, '_blank');
  }

  private normalizarTelefono(telefono: string): string {
    const soloNumeros = telefono.replace(/\D/g, '');
    return soloNumeros.length > 10 ? soloNumeros : `57${soloNumeros}`;
  }

  // ---------- Marcar entregado (modal, como ya lo teníamos) ----------

  abrirEntrega(pedido: PedidoRuta): void {
    this.pedidoEntregando = pedido;
  }

  cerrarEntrega(): void {
    this.pedidoEntregando = null;
  }

  async onEntregado(): Promise<void> {
    this.pedidoEntregando = null;
    await this.cargarPedidos();
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}