import { AfterViewInit, Component, ElementRef, HostBinding, Input, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
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
      .meta .hora { font-family: var(--mono-font); }
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
          <div class="burbuja">{{ m.texto }}</div>
          <span class="meta">
            @if (m.autor_id !== yo()) { {{ m.autor_nombre }} · }<span class="hora">{{ hora(m.created_at) }}</span>
          </span>
        </div>
      } @empty {
        <p class="vacio">{{ cargando() ? 'Cargando mensajes…' : 'Sin mensajes. Escribe aquí lo que el otro necesite saber de este pedido.' }}</p>
      }
    </div>

    <div class="rapidos" aria-label="Mensajes rápidos">
      @for (r of rapidos(); track r) {
        <button type="button" class="rapido" [disabled]="enviando()" (click)="enviar(r)">{{ r }}</button>
      }
    </div>

    <form class="escribir" (ngSubmit)="enviar(texto)">
      <textarea name="texto" rows="1" [(ngModel)]="texto" placeholder="Escribe un mensaje…" aria-label="Mensaje"
        maxlength="1000" (keydown.enter)="enter($event)"></textarea>
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

  private canal: RealtimeChannel | null = null;

  constructor() {
    addIcons({ sendOutline });
  }

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((perfil) => {
      if (!perfil) return;
      const roles = rolesDe(perfil);
      this.yo.set(perfil.id);
      this.soloDomiciliario.set(roles.includes('domiciliario') && !roles.some((r) => r !== 'domiciliario'));
    });
    void this.cargar();
    this.canal = this.sb.client
      .channel(`chat-${this.pedidoId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pedido_mensajes', filter: `pedido_id=eq.${this.pedidoId}` },
        (payload) => {
          this.agregar(payload.new as Mensaje);
          void this.avisos.marcarMensajesLeidos(this.pedidoId);
        }
      )
      .subscribe();
  }

  ngAfterViewInit(): void {
    // En el computador queda listo para escribir (en el celular no se abre el teclado solo)
    if (this.completo) {
      if (matchMedia('(hover: hover)').matches) setTimeout(() => this.host.nativeElement.querySelector('textarea')?.focus({ preventScroll: true }), 300);
    } else if (this.enfocar) setTimeout(() => this.host.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
  }

  ngOnDestroy(): void {
    if (this.canal) this.sb.client.removeChannel(this.canal);
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client
      .from('pedido_mensajes')
      .select('id, pedido_id, autor_id, autor_nombre, texto, created_at')
      .eq('pedido_id', this.pedidoId)
      .order('created_at')
      .limit(200);
    this.cargando.set(false);
    if (error) {
      this.toast.error('No se pudieron cargar los mensajes: ' + mensajeError(error));
      return;
    }
    this.mensajes.set((data ?? []) as Mensaje[]);
    this.bajar();
    void this.avisos.marcarMensajesLeidos(this.pedidoId);
  }

  private agregar(m: Mensaje): void {
    if (this.mensajes().some((x) => x.id === m.id)) return;
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
    // Por si Realtime tarda: se recarga la conversación
    await this.cargar();
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
