import { AfterViewInit, Component, ElementRef, EventEmitter, HostBinding, HostListener, Input, OnDestroy, OnInit, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { sendOutline } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ToastService } from '../toast/toast.service';
import { mensajeError } from '../formato';
import { formatoFechaCO, formatoHoraCO } from '../fecha-colombia';

interface Mensaje {
  id: number;
  pedido_id: string;
  autor_id: string | null;
  autor_nombre: string;
  texto: string;
  created_at: string;
}

/** Hasta cuándo le llegaron y hasta cuándo leyó cada persona los mensajes del pedido */
interface Lectura {
  usuario_id: string;
  usuario_nombre: string | null;
  entregado_at: string | null;
  leido_at: string | null;
}

type Chulos = 'enviado' | 'entregado' | 'leido';

/** Milisegundos de una fecha de la base (llega con o sin "T" y con microsegundos, según la vía) */
function ms(iso: string): number {
  const t = iso.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00');
  return Date.parse(t);
}

/** ¿La marca a es igual o posterior al mensaje b? */
function despues(a: string | null | undefined, b: string): boolean {
  return !!a && ms(a) >= ms(b);
}

/** Mensajes frecuentes: se mandan con un toque (sobre todo en la calle) */
const RAPIDOS_DOMICILIARIO = [
  'Voy en camino',
  'Llego en 10 minutos',
  'El cliente no contesta',
  'La dirección está errada',
  'El cliente va a pagar por transferencia',
  'El cliente no está, hay que reprogramar',
];
const RAPIDOS_TIENDA = [
  'El cliente cambió la dirección',
  'Cobrar otro valor',
  'Entregar después de las 3 pm',
  'El cliente ya pagó por transferencia',
  'Llamar al cliente antes de llegar',
  '¿Cómo va este pedido?',
];

/**
 * Conversación de un pedido entre el vendedor, el domiciliario y la oficina
 * (admin y despachador). Copiado de Jasta. Los mensajes llegan al instante (Realtime) y cada uno
 * avisa a los demás (campana y aviso en el celular).
 */
@Component({
  selector: 'app-chat-pedido',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon],
  styles: [
    `
      :host { display: block; }
      /* Ventana de chat aparte: los mensajes ocupan todo el alto y lo de escribir queda abajo */
      :host(.completo) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
      :host(.completo) .lista { flex: 1; max-height: none; padding: 16px 20px 8px; }
      :host(.completo) .rapidos { padding: 8px 20px; border-top: 1px solid var(--border-soft); }
      :host(.completo) .escribir { padding: 0 20px calc(12px + env(safe-area-inset-bottom)); }
      :host(.completo) .vacio { margin: auto 0; text-align: center; border: 0; }
      .lista { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; padding: 2px 0 6px; overscroll-behavior: contain; }
      .vacio { margin: 0; padding: 10px 12px; border: var(--perfora); border-radius: var(--radius); font-size: 13px; color: var(--text-soft); }
      .msg { max-width: 82%; align-self: flex-start; display: flex; flex-direction: column; gap: 2px; }
      .msg.mio { align-self: flex-end; align-items: flex-end; }
      .burbuja { padding: 8px 11px; border-radius: 10px 10px 10px 3px; background: var(--surface-2); border: 1px solid var(--border);
        font-size: 14px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
      .msg.mio .burbuja { border-radius: 10px 10px 3px 10px; background: var(--accent-wash); border-color: var(--accent-soft); }
      .meta { font-size: 11px; color: var(--text-muted); }
      /* La otra persona está escribiendo (tres puntos, como en WhatsApp) */
      .puntos { display: flex; gap: 4px; align-items: center; padding: 11px 13px; }
      .puntos i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); animation: salta 1.2s infinite ease-in-out; }
      .puntos i:nth-child(2) { animation-delay: .15s; }
      .puntos i:nth-child(3) { animation-delay: .3s; }
      @keyframes salta { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-4px); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .puntos i { animation: none; } }
      .meta .hora { font-family: var(--mono-font); }
      /* Chulos como en WhatsApp: uno gris enviado, dos grises entregado, dos azules leído */
      .meta { display: inline-flex; align-items: center; gap: 3px; }
      .chulos { display: inline-flex; width: 17px; height: 11px; color: var(--text-muted); }
      .chulos.leido { color: #53bdeb; }
      .chulos svg { width: 100%; height: 100%; }
      button.msg-mio { all: unset; display: contents; cursor: pointer; }
      .detalle { margin-top: 2px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface);
        font-size: 12px; color: var(--text-soft); display: flex; flex-direction: column; gap: 2px; text-align: left; }
      .detalle b { font-weight: 600; color: var(--text-2); }
      .rapidos { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 8px 0; }
      .rapidos::-webkit-scrollbar { display: none; }
      .rapido { flex-shrink: 0; height: 30px; padding: 0 11px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface);
        color: var(--text-2); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; }
      @media (hover: hover) { .rapido:hover:not(:disabled) { border-color: var(--accent); color: var(--text); } }
      .rapido:disabled { opacity: .5; cursor: progress; }
      .escribir { display: flex; gap: 8px; align-items: flex-end; }
      .escribir textarea { flex: 1; min-height: 40px; max-height: 120px; padding: 9px 11px; resize: none; box-sizing: border-box;
        border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text);
        font: inherit; font-size: 14px; line-height: 1.4; }
      .escribir textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
      .enviar { width: 40px; height: 40px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border: none;
        border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-size: 18px; cursor: pointer; }
      .enviar:disabled { opacity: .45; cursor: default; }
    `,
  ],
  template: `
    <div class="lista" #lista aria-live="polite">
      @for (m of mensajes(); track m.id) {
        <div class="msg" [class.mio]="m.autor_id === yo()">
          @if (m.autor_id === yo()) {
            <!-- Al tocar un mensaje propio se ve a quién le llegó y quién lo leyó -->
            <button type="button" class="msg-mio" (click)="verDetalle(m.id)" [attr.aria-expanded]="detalle() === m.id"
              [attr.aria-label]="'Mensaje: ' + m.texto + '. ' + textoChulos(chulos(m))">
              <div class="burbuja">{{ m.texto }}</div>
              <span class="meta">
                <span class="hora">{{ hora(m.created_at) }}</span>
                <span class="chulos" [class.leido]="chulos(m) === 'leido'" [attr.title]="textoChulos(chulos(m))" aria-hidden="true">
                  @if (chulos(m) === 'enviado') {
                    <svg viewBox="0 0 16 11"><path d="M11.07.65 4.9 7.43 2.4 5.05a.7.7 0 1 0-.97 1.02l3.03 2.88a.7.7 0 0 0 1-.04l6.65-7.3a.7.7 0 0 0-1.04-.96Z" fill="currentColor"/></svg>
                  } @else {
                    <svg viewBox="0 0 16 11"><path d="M11.07.65 4.9 7.43 2.4 5.05a.7.7 0 1 0-.97 1.02l3.03 2.88a.7.7 0 0 0 1-.04l6.65-7.3a.7.7 0 0 0-1.04-.96Zm3.5 0L8.4 7.43l-.6-.57-.96 1.05 1.1 1.04a.7.7 0 0 0 1-.04l6.65-7.3a.7.7 0 0 0-1.04-.96Z" fill="currentColor"/></svg>
                  }
                </span>
              </span>
            </button>
            @if (detalle() === m.id) {
              <div class="detalle">
                @for (l of quienes(m); track l.nombre) {
                  <span><b>{{ l.nombre }}</b> · {{ l.texto }}</span>
                } @empty {
                  <span>Todavía no le ha llegado a nadie</span>
                }
              </div>
            }
          } @else {
            <div class="burbuja">{{ m.texto }}</div>
            <span class="meta">{{ m.autor_nombre }} · <span class="hora">{{ hora(m.created_at) }}</span></span>
          }
        </div>
      } @empty {
        @if (!quienEscribe()) {
        <p class="vacio">{{ cargando() ? 'Cargando mensajes…' : 'Sin mensajes. Escribe aquí lo que el otro necesite saber de este pedido.' }}</p>
        }
      }
      @if (quienEscribe(); as q) {
        <div class="msg" aria-live="polite">
          <div class="burbuja puntos" aria-hidden="true"><i></i><i></i><i></i></div>
          <span class="meta">{{ q }} está escribiendo…</span>
        </div>
      }
    </div>

    <div class="rapidos" aria-label="Mensajes rápidos">
      @for (r of rapidos(); track r) {
        <button type="button" class="rapido" [disabled]="enviando()" (click)="enviar(r)">{{ r }}</button>
      }
    </div>

    <form class="escribir" (ngSubmit)="enviar(texto)">
      <textarea name="texto" rows="1" [(ngModel)]="texto" placeholder="Escribe un mensaje…" aria-label="Mensaje"
        maxlength="1000" (keydown.enter)="enter($event)" (input)="tecleando()"></textarea>
      <button type="submit" class="enviar" [disabled]="!texto.trim() || enviando()" aria-label="Enviar">
        <ion-icon name="send-outline"></ion-icon>
      </button>
    </form>
  `,
})
export class ChatPedidoComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input({ required: true }) pedidoId!: string;
  /** Lleva la vista hasta la conversación (al abrir desde un aviso de mensaje) */
  @Input() enfocar = false;
  /** Ocupa todo el alto disponible (ventana de chat aparte del pedido) */
  @Input() @HostBinding('class.completo') completo = false;
  @ViewChild('lista') lista?: ElementRef<HTMLElement>;
  /** Quién está escribiendo en este momento (para mostrarlo en la cabecera), o null */
  @Output() escribiendo = new EventEmitter<string | null>();

  private sb = inject(SupabaseService);
  private avisos = inject(NotificacionesService);
  private toast = inject(ToastService);
  private host = inject(ElementRef<HTMLElement>);

  mensajes = signal<Mensaje[]>([]);
  cargando = signal(true);
  enviando = signal(false);
  texto = '';
  yo = signal<string | null>(null);
  private soloDomiciliario = signal(false);
  rapidos = computed(() => (this.soloDomiciliario() ? RAPIDOS_DOMICILIARIO : RAPIDOS_TIENDA));

  lecturas = signal<Lectura[]>([]);
  /** Mensaje propio abierto con el detalle de entregado / leído */
  detalle = signal<number | null>(null);

  private canal: RealtimeChannel | null = null;
  /** Canal aparte (solo broadcast) para avisar "está escribiendo…" */
  private canalEscribe: RealtimeChannel | null = null;
  quienEscribe = signal<string | null>(null);
  private timerEscribe?: ReturnType<typeof setTimeout>;
  private ultimoAviso = 0;
  private respaldo?: ReturnType<typeof setInterval>;
  private conectadoAntes = false;
  private miNombre = '';

  constructor() {
    addIcons({ sendOutline });
  }

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((perfil) => {
      if (!perfil) return;
      const roles = rolesDe(perfil);
      this.yo.set(perfil.id);
      this.miNombre = perfil.nombre;
      this.soloDomiciliario.set(roles.includes('domiciliario') && !roles.some((r) => r !== 'domiciliario'));
    });
    void this.cargar();
    this.canal = this.sb.client
      .channel(`chat-${this.pedidoId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pedido_mensajes', filter: `pedido_id=eq.${this.pedidoId}` },
        (payload) => {
          const m = payload.new as Mensaje;
          this.agregar(m);
          void this.avisos.marcarMensajesLeidos(this.pedidoId);
          if (m.autor_id !== this.yo()) this.marcarLeido();
        }
      )
      // Los chulos de mis mensajes cambian al instante cuando al otro le llegan o los lee
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedido_chat_lecturas', filter: `pedido_id=eq.${this.pedidoId}` },
        (payload) => {
          const l = payload.new as Lectura;
          if (!l?.usuario_id) return;
          this.lecturas.update((lista) => [...lista.filter((x) => x.usuario_id !== l.usuario_id), l]);
        }
      )
      // Al volver la conexión (el iPhone la corta cuando la app queda en segundo plano)
      // se trae lo que llegó mientras tanto: Realtime no repite los mensajes perdidos
      .subscribe((estado) => {
        if (estado !== 'SUBSCRIBED') return;
        if (this.conectadoAntes) void this.cargar(true);
        this.conectadoAntes = true;
      });
    this.canalEscribe = this.sb.client
      .channel(`escribiendo-${this.pedidoId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'escribiendo' }, ({ payload }) => {
        const quien = payload as { id: unknown; nombre: string; escribiendo: boolean };
        if (quien.id === this.yo()) return;
        if (quien.escribiendo) this.mostrarEscribiendo(quien.nombre);
        else this.ocultarEscribiendo();
      })
      .subscribe();
    // Respaldo: mientras el chat está abierto y a la vista, se revisa cada 20 s
    this.respaldo = setInterval(() => {
      if (document.visibilityState === 'visible') void this.cargar(true);
    }, 20000);
  }

  ngAfterViewInit(): void {
    // En el computador queda listo para escribir (en el celular no se abre el teclado solo)
    if (this.completo) {
      if (matchMedia('(hover: hover)').matches) setTimeout(() => this.host.nativeElement.querySelector('textarea')?.focus({ preventScroll: true }), 300);
    } else if (this.enfocar) setTimeout(() => this.host.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
  }

  ngOnDestroy(): void {
    if (this.canal) this.sb.client.removeChannel(this.canal);
    if (this.canalEscribe) this.sb.client.removeChannel(this.canalEscribe);
    clearInterval(this.respaldo);
    clearTimeout(this.timerEscribe);
    this.escribiendo.emit(null);
  }

  /** silencio: recargas automáticas (sin aviso de error si no hay señal) */
  async cargar(silencio = false): Promise<void> {
    const [{ data, error }, lect] = await Promise.all([
      this.sb.client
        .from('pedido_mensajes')
        .select('id, pedido_id, autor_id, autor_nombre, texto, created_at')
        .eq('pedido_id', this.pedidoId)
        .order('created_at')
        .limit(200),
      this.sb.client
        .from('pedido_chat_lecturas')
        .select('usuario_id, usuario_nombre, entregado_at, leido_at')
        .eq('pedido_id', this.pedidoId),
    ]);
    if (lect.data) this.lecturas.set(lect.data as Lectura[]);
    this.cargando.set(false);
    if (error) {
      if (!silencio) this.toast.error('No se pudieron cargar los mensajes: ' + mensajeError(error));
      return;
    }
    const antes = this.mensajes().at(-1)?.id;
    const lista = (data ?? []) as Mensaje[];
    this.mensajes.set(lista);
    // Solo baja al final si hay algo nuevo (así no salta mientras se leen mensajes viejos)
    if (lista.at(-1)?.id !== antes) this.bajar();
    void this.avisos.marcarMensajesLeidos(this.pedidoId);
    this.marcarLeido();
  }

  /** Lo que llegó de los demás queda leído (solo con el chat a la vista) */
  private marcarLeido(): void {
    if (document.visibilityState !== 'visible') return;
    const yo = this.yo();
    const ultimo = [...this.mensajes()].reverse().find((m) => m.autor_id !== yo);
    if (!ultimo) return;
    const mia = this.lecturas().find((l) => l.usuario_id === yo);
    if (despues(mia?.leido_at, ultimo.created_at)) return;
    // (las consultas de Supabase solo salen al pedir el resultado: de ahí el then)
    void this.sb.client.rpc('chat_marcar', { p_pedido: this.pedidoId, p_leido: true }).then();
  }

  /** Enviado (un chulo), entregado (dos grises) o leído (dos azules) por alguien distinto de quien lo mandó */
  chulos(m: Mensaje): Chulos {
    let entregado = false;
    for (const l of this.lecturas()) {
      if (l.usuario_id === m.autor_id) continue;
      if (despues(l.leido_at, m.created_at)) return 'leido';
      if (despues(l.entregado_at, m.created_at)) entregado = true;
    }
    return entregado ? 'entregado' : 'enviado';
  }

  textoChulos(c: Chulos): string {
    return c === 'leido' ? 'Leído' : c === 'entregado' ? 'Entregado' : 'Enviado';
  }

  /** Quién lo leyó y a quién le llegó (detalle al tocar un mensaje propio) */
  quienes(m: Mensaje): { nombre: string; texto: string }[] {
    const out: { nombre: string; texto: string; orden: number }[] = [];
    for (const l of this.lecturas()) {
      if (l.usuario_id === m.autor_id) continue;
      const nombre = (l.usuario_nombre ?? 'Alguien').trim().split(/\s+/).slice(0, 2).join(' ');
      if (despues(l.leido_at, m.created_at)) out.push({ nombre, texto: 'leído ' + this.hora(l.leido_at!), orden: 0 });
      else if (despues(l.entregado_at, m.created_at)) out.push({ nombre, texto: 'le llegó ' + this.hora(l.entregado_at!), orden: 1 });
    }
    return out.sort((a, b) => a.orden - b.orden);
  }

  verDetalle(id: number): void {
    this.detalle.set(this.detalle() === id ? null : id);
  }

  private agregar(m: Mensaje): void {
    if (this.mensajes().some((x) => x.id === m.id)) return;
    // Quien escribía ya mandó su mensaje
    if (m.autor_id !== this.yo()) this.ocultarEscribiendo();
    this.mensajes.update((l) => [...l, m]);
    this.bajar();
  }

  /** Enter manda; Shift + Enter hace un salto de línea */
  enter(e: Event): void {
    const k = e as KeyboardEvent;
    if (k.shiftKey) return;
    k.preventDefault();
    void this.enviar(this.texto);
  }

  async enviar(texto: string): Promise<void> {
    const t = texto.trim();
    if (!t || this.enviando()) return;
    this.enviando.set(true);
    const { error } = await this.sb.client.rpc('enviar_mensaje', { p_pedido: this.pedidoId, p_texto: t });
    this.enviando.set(false);
    if (error) {
      this.toast.error('No se pudo enviar: ' + mensajeError(error));
      return;
    }
    if (t === this.texto.trim()) this.texto = '';
    this.avisarEscribiendo(false);
    // Por si Realtime tarda: se recarga la conversación
    await this.cargar();
  }

  /** Al teclear se avisa a los demás (a lo sumo cada 2,5 s) */
  tecleando(): void {
    if (!this.texto.trim()) return this.avisarEscribiendo(false);
    if (Date.now() - this.ultimoAviso < 2500) return;
    this.avisarEscribiendo(true);
  }

  private avisarEscribiendo(escribiendo: boolean): void {
    if (!this.canalEscribe || !this.yo()) return;
    this.ultimoAviso = escribiendo ? Date.now() : 0;
    const nombre = (this.miNombre).trim().split(/\s+/)[0] || 'Alguien';
    void this.canalEscribe.send({ type: 'broadcast', event: 'escribiendo', payload: { id: this.yo(), nombre, escribiendo } });
  }

  private mostrarEscribiendo(nombre: string): void {
    const yaEstaba = !!this.quienEscribe();
    this.quienEscribe.set(nombre);
    this.escribiendo.emit(nombre);
    if (!yaEstaba) this.bajar();
    // Si deja de llegar el aviso (dejó de escribir o se fue), se quita
    clearTimeout(this.timerEscribe);
    this.timerEscribe = setTimeout(() => this.ocultarEscribiendo(), 4500);
  }

  private ocultarEscribiendo(): void {
    clearTimeout(this.timerEscribe);
    if (!this.quienEscribe()) return;
    this.quienEscribe.set(null);
    this.escribiendo.emit(null);
  }

  /** Al volver a la app, al enfocar la ventana o al recuperar internet se trae lo nuevo */
  @HostListener('document:visibilitychange')
  @HostListener('window:focus')
  @HostListener('window:online')
  alVolver(): void {
    if (document.visibilityState === 'visible') void this.cargar(true);
  }

  private bajar(): void {
    setTimeout(() => {
      const el = this.lista?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  hora(iso: string): string {
    const hoy = formatoFechaCO(new Date().toISOString(), { day: 'numeric', month: 'numeric' });
    const dia = formatoFechaCO(iso, { day: 'numeric', month: 'numeric' });
    return dia === hoy ? formatoHoraCO(iso) : formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
