import { ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
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
import { EntregasHechasComponent } from '../entregas-hechas/entregas-hechas.component';
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
  guardar: (metodo: MetodoPago, efectivo: number, transferencia: number, comprobantes: string[]) => Promise<void>;
}

@Component({
  selector: 'app-inicio-domiciliario',
  standalone: true,
  imports: [SkeletonComponent, CommonModule, IonIcon, EntregarPedidoComponent, ChatHojaComponent, EntregasHechasComponent],
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

  /** Orden de la ruta que armó el domiciliario ('k:<uuid>' JYB, 'j:<id>' Jasta), guardado en este celular */
  orden: string[] = [];
  /** Tarjeta que se está moviendo */
  arrastrandoId: string | null = null;
  private usuarioId = '';
  @ViewChild(EntregasHechasComponent) hechas?: EntregasHechasComponent;

  constructor(private supabase: SupabaseService, private jastas: JastaService, private cdr: ChangeDetectorRef) {
    addIcons({ callOutline, chatbubbleEllipsesOutline, logoWhatsapp, navigateOutline });
  }

  async ngOnInit(): Promise<void> {
    void this.avisos.iniciar();
    document.addEventListener('touchmove', this.bloquearScroll, { passive: false });
    void this.supabase.getCurrentUser().then((u) => {
      this.usuarioId = u?.id ?? '';
      try {
        const guardado = JSON.parse(localStorage.getItem(this.claveOrden()) || '[]');
        if (Array.isArray(guardado)) this.orden = guardado.filter((x): x is string => typeof x === 'string');
      } catch {
        /* sin almacenamiento: orden de asignación */
      }
      this.cdr.detectChanges();
    });
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
    document.removeEventListener('touchmove', this.bloquearScroll);
    this.soltar();
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
    const pos = new Map(this.orden.map((clave, i) => [clave, i]));
    return [
      ...this.pedidos.map((p) => ({ clave: 'k:' + p.id, cuando: microsAsignado(p.asignado_at ?? p.created_at), kaesuri: p })),
      ...(this.jasta?.en_ruta ?? []).map((p) => ({ clave: 'j:' + p.id, cuando: microsAsignado(p.asignado_at), jasta: p })),
    ]
      .sort((a, b) => a.cuando - b.cuando)
      // El orden que armó el domiciliario (arrastrando) va primero; lo nuevo, después, en orden de asignación
      .map((p, i) => ({ p, k: pos.has(p.clave) ? pos.get(p.clave)! : 1e6 + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.p);
  }

  trackParada(_: number, p: Parada): string {
    return p.clave;
  }

  // ------------------------------------------------- Ordenar la ruta (arrastrar), como en Jasta
  private claveOrden(): string {
    return `jyb-ruta-${this.usuarioId}`;
  }
  private guardarOrden(): void {
    try {
      localStorage.setItem(this.claveOrden(), JSON.stringify(this.orden.slice(-300)));
    } catch {
      /* sin almacenamiento */
    }
  }
  private espera?: ReturnType<typeof setTimeout>;
  private el: HTMLElement | null = null;
  private xy = { x: 0, y: 0 };
  private agarre = 0;
  private dy = 0;
  private raf = 0;
  private scroller: HTMLElement | null = null;
  private indiceEsperado: number | null = null;

  /** Mientras se arrastra, el dedo mueve la tarjeta y no la página */
  private bloquearScroll = (e: TouchEvent): void => {
    if (this.arrastrandoId !== null) e.preventDefault();
  };

  /** Computador: mantener presionado ~0,4 s (sin mover el mouse) para empezar a mover la tarjeta */
  presionar(e: PointerEvent, id: string): void {
    if (e.pointerType !== 'mouse') return; // en el celular se usa tocar() (iPhone cancela los eventos de puntero)
    if (e.button !== 0) return;
    if ((e.target as Element | null)?.closest('button, a, input, textarea, .link-telefono, .link-direccion')) return;
    if (this.paradas.length < 2) return;
    const el = e.currentTarget as HTMLElement;
    const x0 = e.clientX, y0 = e.clientY;
    const mover0 = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) cancelar(); };
    const cancelar = () => {
      clearTimeout(this.espera);
      window.removeEventListener('pointermove', mover0);
      window.removeEventListener('pointerup', cancelar);
      window.removeEventListener('pointercancel', cancelar);
    };
    cancelar();
    window.addEventListener('pointermove', mover0);
    window.addEventListener('pointerup', cancelar);
    window.addEventListener('pointercancel', cancelar);
    this.espera = setTimeout(() => { cancelar(); this.empezar(el, id, x0, y0); }, 420);
  }

  /** Celular: mantener el dedo quieto ~0,4 s y luego moverlo (eventos táctiles: Safari cancela los de puntero) */
  tocar(e: TouchEvent, id: string): void {
    if (e.touches.length !== 1) return;
    if ((e.target as Element | null)?.closest('button, a, input, textarea, .link-telefono, .link-direccion')) return;
    if (this.paradas.length < 2) return;
    const el = e.currentTarget as HTMLElement;
    const t0 = e.touches[0];
    const x0 = t0.clientX, y0 = t0.clientY;
    let activo = false;
    const mover = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (!t) return;
      if (activo) {
        if (ev.cancelable) ev.preventDefault();
        this.xy = { x: t.clientX, y: t.clientY };
      } else if (Math.hypot(t.clientX - x0, t.clientY - y0) > 10) {
        terminar(); // el dedo se movió antes de tiempo: es scroll normal
      }
    };
    const fin = () => { const estaba = activo; terminar(); if (estaba) this.soltar(); };
    const terminar = () => {
      clearTimeout(this.espera);
      document.removeEventListener('touchmove', mover);
      document.removeEventListener('touchend', fin);
      document.removeEventListener('touchcancel', fin);
    };
    clearTimeout(this.espera);
    document.addEventListener('touchmove', mover, { passive: false });
    document.addEventListener('touchend', fin);
    document.addEventListener('touchcancel', fin);
    this.espera = setTimeout(() => { activo = true; this.empezar(el, id, x0, y0, true); }, 400);
  }

  private empezar(el: HTMLElement, id: string, x: number, y: number, tactil = false): void {
    this.el = el;
    this.xy = { x, y };
    this.dy = 0;
    this.agarre = y - el.getBoundingClientRect().top;
    this.indiceEsperado = null;
    this.arrastrandoId = id;
    this.cdr.detectChanges();
    navigator.vibrate?.(25);
    let p: HTMLElement | null = el.parentElement;
    while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    this.scroller = p ?? (document.scrollingElement as HTMLElement);
    if (!tactil) {
      window.addEventListener('pointermove', this.alMover);
      window.addEventListener('pointerup', this.soltar);
      window.addEventListener('pointercancel', this.soltar);
    }
    this.raf = requestAnimationFrame(this.cuadro);
  }

  private alMover = (ev: PointerEvent): void => {
    this.xy = { x: ev.clientX, y: ev.clientY };
  };

  /** Cada cuadro: desplaza la página si el dedo está en un borde y acomoda la tarjeta */
  private cuadro = (): void => {
    const el = this.el;
    if (!el) return;
    const y = this.xy.y;
    if (this.scroller) {
      if (y < 110) this.scroller.scrollTop -= Math.ceil((110 - y) / 8);
      else if (y > window.innerHeight - 150) this.scroller.scrollTop += Math.ceil((y - (window.innerHeight - 150)) / 8);
    }
    const natural = el.getBoundingClientRect().top - this.dy;
    this.dy = y - this.agarre - natural;
    el.style.transform = `translateY(${this.dy}px)`;
    const lista = [...(el.parentElement?.querySelectorAll<HTMLElement>(':scope > .pedido-card') ?? [])];
    const i = lista.indexOf(el);
    if (this.indiceEsperado !== null && i !== this.indiceEsperado) {
      this.raf = requestAnimationFrame(this.cuadro);
      return; // todavía no se re-dibujó el cambio anterior
    }
    this.indiceEsperado = null;
    // Cambia de puesto cuando el centro de la tarjeta pasa la mitad de la vecina
    const re = el.getBoundingClientRect();
    const centro = re.top + re.height / 2;
    const mitad = (c: HTMLElement | undefined) => { if (!c) return NaN; const r = c.getBoundingClientRect(); return r.top + r.height / 2; };
    let destino = -1;
    if (centro > mitad(lista[i + 1])) destino = i + 1;
    else if (centro < mitad(lista[i - 1])) destino = i - 1;
    if (destino >= 0 && destino !== i) {
      const ids = this.paradas.map((p) => p.clave);
      const id = this.arrastrandoId!;
      ids.splice(ids.indexOf(id), 1);
      ids.splice(destino, 0, id);
      this.orden = ids;
      this.indiceEsperado = destino;
      this.cdr.detectChanges();
      navigator.vibrate?.(8);
    }
    this.raf = requestAnimationFrame(this.cuadro);
  };

  private soltar = (): void => {
    window.removeEventListener('pointermove', this.alMover);
    window.removeEventListener('pointerup', this.soltar);
    window.removeEventListener('pointercancel', this.soltar);
    cancelAnimationFrame(this.raf);
    if (this.el) {
      this.el.style.transform = '';
      // El toque que suelta la tarjeta no debe activar un botón
      const tragar = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', tragar, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', tragar, { capture: true }), 350);
    }
    this.el = null;
    if (this.arrastrandoId !== null) {
      this.arrastrandoId = null;
      this.orden = this.paradas.map((p) => p.clave);
      this.guardarOrden();
      this.cdr.detectChanges();
    }
  };

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
      guardar: (metodo, efectivo, transferencia, comprobantes) => this.jastas.entregar(p.id, metodo, efectivo, transferencia, comprobantes),
    };
  }

  async onEntregadoJasta(): Promise<void> {
    this.entregandoJasta = null;
    await this.cargarJasta();
    void this.hechas?.cargar();
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
    void this.hechas?.cargar();
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}