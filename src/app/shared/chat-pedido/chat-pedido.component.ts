import { AfterViewInit, Component, ElementRef, EventEmitter, HostBinding, HostListener, Input, OnDestroy, OnInit, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, arrowUndo, cameraOutline, close, images, camera, mic, pause, play, send, trashOutline } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ToastService } from '../toast/toast.service';
import { mensajeError } from '../formato';
import { formatoFechaCO, formatoHoraCO } from '../fecha-colombia';
import { prepararFoto } from '../fotos';
import { VisorService } from '../visor/visor.service';

interface Mensaje {
  id: number;
  pedido_id: string;
  autor_id: string | null;
  autor_nombre: string;
  texto: string;
  created_at: string;
  responde_a?: number | null;
  tipo?: 'texto' | 'foto' | 'audio' | null;
  adjunto?: string | null;
  duracion?: number | null;
}

const CAMPOS = 'id, pedido_id, autor_id, autor_nombre, texto, created_at, responde_a, tipo, adjunto, duracion';
const PREFIJO_CHAT = 'sb://chat/';

/** Formato en que este celular puede grabar la nota de voz (el primero sirve en todos para oírla) */
function formatoAudio(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function minSeg(s: number): string {
  const t = Math.max(0, Math.round(s));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
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
 * (admin y despachador). Como WhatsApp, copiado de Jasta. Los mensajes llegan al instante (Realtime) y cada uno
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
      :host(.completo) .lista { flex: 1; max-height: none; padding: 12px 12px 8px; }
      :host(.completo) .abajo { padding: 6px 10px calc(8px + env(safe-area-inset-bottom)); }
      :host(.completo) .vacio { margin: auto 0; text-align: center; border: 0; }
      .lista { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; overflow-x: hidden; padding: 2px 0 6px; overscroll-behavior: contain; }
      .vacio { margin: 0; padding: 10px 12px; border: var(--perfora); border-radius: var(--radius); font-size: 13px; color: var(--text-soft); }
      .dia { display: flex; justify-content: center; margin: 4px 0; }
      .dia span { padding: 3px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font-size: 11.5px; color: var(--text-soft); }

      /* Cada mensaje: burbuja con la hora y los chulos adentro, como en WhatsApp */
      .fila { position: relative; display: flex; touch-action: pan-y; }
      .fila.mio { justify-content: flex-end; }
      .fila.sigue { margin-top: -5px; }
      .resp-ico { position: absolute; left: 4px; top: 50%; width: 28px; height: 28px; margin-top: -14px; border-radius: 50%; background: var(--surface-2);
        border: 1px solid var(--border); color: var(--text-soft); display: grid; place-items: center; font-size: 15px; opacity: 0; pointer-events: none; }
      .burbuja { position: relative; display: flow-root; max-width: 82%; padding: 7px 10px 6px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border);
        color: var(--text); font-size: 14.5px; line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; transition: transform .18s ease; }
      .burbuja.arrastra { transition: none; }
      .fila.mio .burbuja { background: var(--accent); border-color: var(--accent); color: var(--on-accent); cursor: pointer; }
      .fila:not(.sigue):not(.mio) .burbuja { border-top-left-radius: 6px; }
      .fila.mio:not(.sigue) .burbuja { border-top-right-radius: 6px; }
      .burbuja.flash { animation: flash 1.2s ease; }
      @keyframes flash { 0%, 60% { filter: brightness(1.35); } 100% { filter: none; } }
      .autor { display: block; margin-bottom: 1px; font-size: 12px; font-weight: 700; color: var(--accent); }
      .meta { float: right; display: inline-flex; align-items: center; gap: 3px; margin: 7px 0 -1px 10px; font-size: 10.5px; line-height: 1; color: var(--text-muted); white-space: nowrap; }
      .fila.mio .meta { color: color-mix(in srgb, var(--on-accent) 70%, transparent); }
      .chulos { display: inline-flex; width: 16px; height: 10px; }
      .chulos.leido { color: #7dd3fc; }
      .chulos svg { width: 100%; height: 100%; }

      /* Mensaje al que se responde, citado dentro de la burbuja */
      .cita { all: unset; box-sizing: border-box; display: block; width: 100%; margin-bottom: 5px; padding: 5px 8px; border-left: 3px solid var(--accent); border-radius: 8px;
        background: color-mix(in srgb, var(--text) 8%, transparent); font-size: 12.5px; line-height: 1.3; cursor: pointer; }
      .fila.mio .cita { border-left-color: var(--on-accent); background: color-mix(in srgb, #000 18%, transparent); }
      .cita b { display: block; font-weight: 700; color: var(--accent); }
      .fila.mio .cita b { color: var(--on-accent); }
      .cita span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; opacity: .85; white-space: normal; }

      /* Foto */
      .foto { all: unset; display: block; margin: -3px -6px 4px; border-radius: 12px; overflow: hidden; cursor: pointer; background: color-mix(in srgb, #000 15%, transparent); }
      .foto img, .foto .carga { display: block; width: min(240px, 62vw); height: 240px; object-fit: cover; }
      .foto .carga { animation: late 1.2s infinite ease-in-out; }
      @keyframes late { 50% { opacity: .5; } }

      /* Nota de voz */
      .audio { display: flex; align-items: center; gap: 8px; width: min(230px, 60vw); padding: 2px 0; }
      .audio .pp { all: unset; width: 34px; height: 34px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; font-size: 20px; cursor: pointer;
        background: color-mix(in srgb, currentColor 14%, transparent); }
      .audio .onda { position: relative; flex: 1; height: 26px; cursor: pointer; --c: color-mix(in srgb, currentColor 35%, transparent);
        background: repeating-linear-gradient(90deg, var(--c) 0 2px, transparent 2px 5px); -webkit-mask: linear-gradient(#000 0 0) center / 100% 60% no-repeat; mask: linear-gradient(#000 0 0) center / 100% 60% no-repeat; }
      .audio .onda i { position: absolute; inset: 0 auto 0 0; background: repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 5px); }
      .audio .dur { font-size: 11.5px; font-variant-numeric: tabular-nums; opacity: .85; min-width: 30px; text-align: right; }

      /* La otra persona está escribiendo (tres puntos) */
      .puntos { display: flex; gap: 4px; align-items: center; padding: 12px 13px; }
      .puntos i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-muted); animation: salta 1.2s infinite ease-in-out; }
      .puntos i:nth-child(2) { animation-delay: .15s; }
      .puntos i:nth-child(3) { animation-delay: .3s; }
      @keyframes salta { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-4px); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .puntos i, .foto .carga, .burbuja.flash, .grab .rojo { animation: none; } .burbuja { transition: none; } }
      .enviando { align-self: flex-end; font-size: 12px; color: var(--text-muted); }

      .detalle { align-self: flex-end; margin-top: -4px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
        font-size: 12px; color: var(--text-soft); display: flex; flex-direction: column; gap: 2px; text-align: left; }
      .detalle b { font-weight: 600; color: var(--text-2); }

      /* Barra de abajo: +, caja de texto redonda con la cámara y botón redondo (micrófono o enviar) */
      .abajo { display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
      .resp-bar { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 10px; border-left: 3px solid var(--accent); border-radius: 8px; background: var(--surface-2); font-size: 12.5px; line-height: 1.3; }
      .resp-bar div { flex: 1; min-width: 0; }
      .resp-bar b { display: block; color: var(--accent); font-weight: 700; }
      .resp-bar span { display: block; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ico { all: unset; width: 36px; height: 36px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; color: var(--text-soft); font-size: 24px; cursor: pointer; }
      .ico:disabled { opacity: .4; cursor: default; }
      .ico.gira ion-icon { transform: rotate(45deg); }
      .ico ion-icon { transition: transform .18s ease; }
      .escribir, .grab { display: flex; gap: 6px; align-items: flex-end; }
      .caja { flex: 1; min-width: 0; display: flex; align-items: flex-end; border: 1px solid var(--border); border-radius: 20px; background: var(--surface-2); padding-right: 2px; }
      .caja:focus-within { border-color: var(--accent); }
      .caja textarea { flex: 1; min-width: 0; min-height: 38px; max-height: 120px; padding: 9px 4px 9px 14px; resize: none; box-sizing: border-box; border: 0; background: none;
        color: var(--text); font: inherit; font-size: 16px; line-height: 1.25; outline: none; }
      .caja .ico { font-size: 21px; }
      .redondo { all: unset; width: 38px; height: 38px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; background: var(--accent); color: var(--on-accent); font-size: 19px; cursor: pointer; }
      .redondo:disabled { opacity: .45; cursor: default; }
      .grab { align-items: center; min-height: 38px; }
      .grab .t { flex: 1; display: flex; align-items: center; gap: 8px; font-size: 16px; font-variant-numeric: tabular-nums; color: var(--text); }
      .grab .rojo { width: 9px; height: 9px; border-radius: 50%; background: var(--danger); animation: late 1s infinite; }
      .grab .rojo.quieto { animation: none; opacity: .4; }
      .grab .ico.pausa { color: var(--danger); }

      /* Panel del +: fotos, cámara y los mensajes rápidos */
      .panel { display: flex; flex-direction: column; gap: 10px; padding: 8px 2px 4px; }
      .acciones { display: flex; gap: 18px; }
      .accion { all: unset; display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 12px; color: var(--text-soft); cursor: pointer; }
      .accion span { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border); font-size: 23px; color: var(--accent); }
      .panel small { font-size: 12px; font-weight: 650; color: var(--text-muted); }
      .rapidos { display: flex; gap: 6px; flex-wrap: wrap; }
      .rapido { min-height: 32px; padding: 4px 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface);
        color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
      @media (hover: hover) { .rapido:hover:not(:disabled) { border-color: var(--accent); color: var(--text); } }
      .rapido:disabled { opacity: .5; cursor: progress; }
      input[type=file] { display: none; }
    `,
  ],
  template: `
    <div class="lista" #lista aria-live="polite">
      @for (m of mensajes(); track m.id; let i = $index) {
        @if (diaNuevo(i)) { <div class="dia"><span>{{ dia(m.created_at) }}</span></div> }
        <div class="fila" [class.mio]="m.autor_id === yo()" [class.sigue]="sigue(i)" [attr.data-id]="m.id"
          (touchstart)="tocaIni($event, m)" (touchmove)="tocaMueve($event)" (touchend)="tocaFin()" (touchcancel)="tocaFin(true)" (dblclick)="responder(m)">
          <span class="resp-ico" aria-hidden="true" [style.opacity]="desliza()?.id === m.id ? desliza()!.dx / 56 : 0"><ion-icon name="arrow-undo"></ion-icon></span>
          <div class="burbuja" [class.flash]="resaltado() === m.id" [class.arrastra]="desliza()?.id === m.id"
            [style.transform]="desliza()?.id === m.id ? 'translateX(' + desliza()!.dx + 'px)' : null"
            (click)="m.autor_id === yo() && verDetalle(m.id)" [attr.title]="m.autor_id === yo() ? textoChulos(chulos(m)) : null">
            @if (m.autor_id !== yo() && grupo() && !sigue(i)) { <span class="autor">{{ corto(m.autor_nombre) }}</span> }
            @if (cita(m); as c) {
              <button type="button" class="cita" (click)="irA(c.id); $event.stopPropagation()"><b>{{ c.autor }}</b><span>{{ c.texto }}</span></button>
            }
            @if (m.tipo === 'foto') {
              <button type="button" class="foto" aria-label="Ver foto" (click)="verFoto(m); $event.stopPropagation()">
                @if (url(m); as u) { <img [src]="u" alt="Foto" loading="lazy" /> } @else { <span class="carga"></span> }
              </button>
            }
            @if (m.tipo === 'audio') {
              <div class="audio" (click)="$event.stopPropagation()">
                <button type="button" class="pp" [attr.aria-label]="sonando() === m.id ? 'Pausar nota de voz' : 'Oír nota de voz'" (click)="tocar(m)">
                  <ion-icon [name]="sonando() === m.id ? 'pause' : 'play'"></ion-icon>
                </button>
                <span class="onda" (click)="saltar($event, m)"><i [style.width.%]="actual() === m.id ? avance() * 100 : 0"></i></span>
                <span class="dur">{{ actual() === m.id && avance() > 0 ? minSeg(avance() * (m.duracion || 0)) : minSeg(m.duracion || 0) }}</span>
              </div>
            }
            @if (m.texto) { <span>{{ m.texto }}</span> }
            <span class="meta">
              <span>{{ hora(m.created_at) }}</span>
              @if (m.autor_id === yo()) {
                <span class="chulos" [class.leido]="chulos(m) === 'leido'" aria-hidden="true">
                  @if (chulos(m) === 'enviado') {
                    <svg viewBox="0 0 16 11"><path d="M11.07.65 4.9 7.43 2.4 5.05a.7.7 0 1 0-.97 1.02l3.03 2.88a.7.7 0 0 0 1-.04l6.65-7.3a.7.7 0 0 0-1.04-.96Z" fill="currentColor"/></svg>
                  } @else {
                    <svg viewBox="0 0 16 11"><path d="M11.07.65 4.9 7.43 2.4 5.05a.7.7 0 1 0-.97 1.02l3.03 2.88a.7.7 0 0 0 1-.04l6.65-7.3a.7.7 0 0 0-1.04-.96Zm3.5 0L8.4 7.43l-.6-.57-.96 1.05 1.1 1.04a.7.7 0 0 0 1-.04l6.65-7.3a.7.7 0 0 0-1.04-.96Z" fill="currentColor"/></svg>
                  }
                </span>
              }
            </span>
          </div>
        </div>
        @if (detalle() === m.id) {
          <div class="detalle">
            @for (l of quienes(m); track l.nombre) {
              <span><b>{{ l.nombre }}</b> · {{ l.texto }}</span>
            } @empty {
              <span>Todavía no le ha llegado a nadie</span>
            }
          </div>
        }
      } @empty {
        @if (!quienEscribe()) {
        <p class="vacio">{{ cargando() ? 'Cargando mensajes…' : 'Sin mensajes. Escribe aquí lo que el otro necesite saber de este pedido.' }}</p>
        }
      }
      @if (quienEscribe(); as q) {
        <div class="fila" aria-live="polite" [attr.aria-label]="q + ' está escribiendo'">
          <div class="burbuja puntos" aria-hidden="true"><i></i><i></i><i></i></div>
        </div>
      }
      @if (subiendo(); as que) { <span class="enviando">{{ que }}</span> }
    </div>

    <div class="abajo">
      @if (respondiendo(); as r) {
        <div class="resp-bar">
          <div><b>{{ r.autor_id === yo() ? 'Tú' : corto(r.autor_nombre) }}</b><span>{{ resumen(r) }}</span></div>
          <button type="button" class="ico" aria-label="No responder" (click)="respondiendo.set(null)"><ion-icon name="close"></ion-icon></button>
        </div>
      }
      @if (grabando()) {
        <div class="grab">
          <button type="button" class="ico" aria-label="Borrar la nota de voz" (click)="pararGrabacion(false)"><ion-icon name="trash-outline"></ion-icon></button>
          <span class="t"><span class="rojo" [class.quieto]="enPausa()"></span>{{ minSeg(segundos()) }}</span>
          <button type="button" class="ico pausa" [attr.aria-label]="enPausa() ? 'Seguir grabando' : 'Pausar'" (click)="pausar()"><ion-icon [name]="enPausa() ? 'mic' : 'pause'"></ion-icon></button>
          <button type="button" class="redondo" aria-label="Enviar nota de voz" (click)="pararGrabacion(true)"><ion-icon name="send"></ion-icon></button>
        </div>
      } @else {
        <form class="escribir" (ngSubmit)="enviar(texto)">
          <button type="button" class="ico" [class.gira]="panel()" [attr.aria-expanded]="panel()" aria-label="Fotos y mensajes rápidos" (click)="panel.set(!panel())"><ion-icon name="add"></ion-icon></button>
          <div class="caja">
            <textarea name="texto" rows="1" [(ngModel)]="texto" aria-label="Mensaje" placeholder="Mensaje"
              maxlength="1000" (keydown.enter)="enter($event)" (input)="tecleando($event)" (focus)="panel.set(false)"></textarea>
            @if (!texto.trim()) {
              <button type="button" class="ico" aria-label="Tomar una foto" [disabled]="!!subiendo()" (click)="camara.click()"><ion-icon name="camera-outline"></ion-icon></button>
            }
          </div>
          @if (texto.trim()) {
            <button type="submit" class="redondo" [disabled]="enviando()" aria-label="Enviar"><ion-icon name="send"></ion-icon></button>
          } @else {
            <button type="button" class="redondo" [disabled]="!!subiendo()" aria-label="Grabar nota de voz" (click)="grabar()"><ion-icon name="mic"></ion-icon></button>
          }
        </form>
      }
      <input #galeria type="file" accept="image/*,.heic,.heif" (change)="elegirFoto($event)" />
      <input #camara type="file" accept="image/*" capture="environment" (change)="elegirFoto($event)" />
      @if (panel() && !grabando()) {
        <div class="panel">
          <div class="acciones">
            <button type="button" class="accion" (click)="galeria.click()"><span><ion-icon name="images"></ion-icon></span>Fotos</button>
            <button type="button" class="accion" (click)="camara.click()"><span><ion-icon name="camera"></ion-icon></span>Cámara</button>
          </div>
          <small>Mensajes rápidos</small>
          <div class="rapidos">
            @for (r of rapidos(); track r) {
              <button type="button" class="rapido" [disabled]="enviando()" (click)="enviar(r)">{{ r }}</button>
            }
          </div>
        </div>
      }
    </div>
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
  private visor = inject(VisorService);
  minSeg = minSeg;

  mensajes = signal<Mensaje[]>([]);
  cargando = signal(true);
  enviando = signal(false);
  texto = '';
  yo = signal<string | null>(null);
  private miNombre = '';
  private soloDomiciliario = signal(false);
  rapidos = computed(() => (this.soloDomiciliario() ? RAPIDOS_DOMICILIARIO : RAPIDOS_TIENDA));

  lecturas = signal<Lectura[]>([]);
  /** Mensaje propio abierto con el detalle de entregado / leído */
  detalle = signal<number | null>(null);

  /** Panel del + (fotos, cámara y mensajes rápidos) */
  panel = signal(false);
  /** Mensaje al que se está respondiendo */
  respondiendo = signal<Mensaje | null>(null);
  /** Mensaje que se está deslizando para responder */
  desliza = signal<{ id: number; dx: number } | null>(null);
  resaltado = signal<number | null>(null);
  /** Texto mientras sube una foto o una nota de voz */
  subiendo = signal<string | null>(null);
  /** Enlaces firmados de fotos y notas de voz, por ruta */
  private urls = signal(new Map<string, string>());
  private porId = computed(() => new Map(this.mensajes().map((m) => [m.id, m])));
  /** Con más de una persona al otro lado se muestra el nombre de quien escribe */
  grupo = computed(() => new Set(this.mensajes().filter((m) => m.autor_id !== this.yo()).map((m) => m.autor_id)).size > 1);

  // Nota de voz: grabación
  grabando = signal(false);
  enPausa = signal(false);
  segundos = signal(0);
  private grabadora?: MediaRecorder;
  private trozos: Blob[] = [];
  private reloj?: ReturnType<typeof setInterval>;
  // Nota de voz: reproducción (una a la vez)
  private audio?: HTMLAudioElement;
  actual = signal<number | null>(null);
  sonando = signal<number | null>(null);
  avance = signal(0);
  private toque?: { m: Mensaje; x: number; y: number; activo: boolean };

  private canal: RealtimeChannel | null = null;
  private conectadoAntes = false;
  /** Canal aparte (solo broadcast) para avisar "está escribiendo…" */
  private canalEscribe: RealtimeChannel | null = null;
  quienEscribe = signal<string | null>(null);
  private timerEscribe?: ReturnType<typeof setTimeout>;
  private ultimoAviso = 0;
  private respaldo?: ReturnType<typeof setInterval>;

  constructor() {
    addIcons({ add, arrowUndo, cameraOutline, close, images, camera, mic, pause, play, send, trashOutline });
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
      // Al volver la conexión (el iPhone la corta en segundo plano) se trae lo que llegó mientras tanto
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
    this.soltarGrabacion();
    this.audio?.pause();
  }

  /** silencio: recargas automáticas (sin aviso de error si no hay señal) */
  async cargar(silencio = false): Promise<void> {
    const [{ data, error }, lect] = await Promise.all([
      this.sb.client
        .from('pedido_mensajes')
        .select(CAMPOS)
        .eq('pedido_id', this.pedidoId)
        .order('created_at', { ascending: false })
        .limit(300),
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
    const lista = ((data ?? []) as Mensaje[]).reverse();
    this.mensajes.set(lista);
    void this.firmar(lista);
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
    void this.firmar([m]);
    this.bajar();
  }

  /** Enter manda; Shift + Enter hace un salto de línea */
  enter(e: Event): void {
    const k = e as KeyboardEvent;
    if (k.shiftKey) return;
    k.preventDefault();
    void this.enviar(this.texto);
  }

  async enviar(texto: string, adjunto?: { tipo: 'foto' | 'audio'; ruta: string; duracion?: number }): Promise<boolean> {
    const t = texto.trim();
    if ((!t && !adjunto) || this.enviando()) return false;
    this.enviando.set(true);
    const { error } = await this.sb.client.rpc('enviar_mensaje2', {
      p_pedido: this.pedidoId,
      p_texto: t,
      p_responde: this.respondiendo()?.id ?? null,
      p_tipo: adjunto?.tipo ?? 'texto',
      p_adjunto: adjunto?.ruta ?? null,
      p_duracion: adjunto?.duracion ?? null,
    });
    this.enviando.set(false);
    if (error) {
      this.toast.error('No se pudo enviar: ' + mensajeError(error));
      return false;
    }
    if (t === this.texto.trim()) {
      this.texto = '';
      const ta = this.host.nativeElement.querySelector('textarea');
      if (ta) ta.style.height = '';
    }
    this.respondiendo.set(null);
    this.panel.set(false);
    this.avisarEscribiendo(false);
    // Por si Realtime tarda: se recarga la conversación
    await this.cargar();
    return true;
  }

  // ---------- Fotos y notas de voz ----------

  /** Pide los enlaces (1 hora) de las fotos y notas de voz que aún no se tienen */
  private async firmar(lista: Mensaje[]): Promise<void> {
    const faltan = [...new Set(lista.map((m) => m.adjunto).filter((a): a is string => !!a && a.startsWith(PREFIJO_CHAT) && !this.urls().has(a)))];
    if (!faltan.length) return;
    try {
      const { data } = await this.sb.client.storage.from('chat').createSignedUrls(faltan.map((a) => a.slice(PREFIJO_CHAT.length)), 3600);
      const mapa = new Map(this.urls());
      for (const f of data ?? []) if (f.path && f.signedUrl) mapa.set(PREFIJO_CHAT + f.path, f.signedUrl);
      this.urls.set(mapa);
    } catch {
      /* sin señal: se intenta de nuevo en la próxima recarga */
    }
  }

  url(m: Mensaje): string | null {
    return (m.adjunto && this.urls().get(m.adjunto)) || null;
  }

  private async subir(blob: Blob, tipo: string, ext: string): Promise<string> {
    const uid = this.yo();
    if (!uid) throw new Error('Tu sesión se cerró, vuelve a entrar');
    const ruta = `${this.pedidoId}/${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await this.sb.client.storage.from('chat').upload(ruta, blob, { contentType: tipo, upsert: false });
    if (error) throw error;
    return PREFIJO_CHAT + ruta;
  }

  async elegirFoto(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo || this.subiendo()) return;
    this.subiendo.set('Enviando foto…');
    this.bajar();
    try {
      const ruta = await this.subir(await prepararFoto(archivo, 1600), 'image/jpeg', 'jpg');
      await this.enviar(this.texto, { tipo: 'foto', ruta });
    } catch (e) {
      this.toast.error('No se pudo enviar la foto: ' + mensajeError(e));
    } finally {
      this.subiendo.set(null);
    }
  }

  verFoto(m: Mensaje): void {
    const fotos = this.mensajes().filter((x) => x.tipo === 'foto' && this.url(x));
    this.visor.abrir(fotos.map((x) => ({ url: this.url(x)!, titulo: `${this.corto(x.autor_nombre)} · ${this.hora(x.created_at)}` })), fotos.findIndex((x) => x.id === m.id));
  }

  async grabar(): Promise<void> {
    const tipo = formatoAudio();
    if (!tipo || !navigator.mediaDevices?.getUserMedia) return this.toast.error('Este celular no deja grabar notas de voz aquí.');
    let flujo: MediaStream;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return this.toast.error('Dale permiso al micrófono para grabar la nota de voz.');
    }
    this.audio?.pause();
    this.trozos = [];
    this.grabadora = new MediaRecorder(flujo, { mimeType: tipo });
    this.grabadora.ondataavailable = (e) => { if (e.data.size) this.trozos.push(e.data); };
    this.grabadora.start();
    this.segundos.set(0);
    this.enPausa.set(false);
    this.grabando.set(true);
    this.panel.set(false);
    this.reloj = setInterval(() => {
      if (this.enPausa()) return;
      this.segundos.update((s) => s + 1);
      if (this.segundos() >= 300) void this.pararGrabacion(true); // máximo 5 minutos
    }, 1000);
  }

  pausar(): void {
    const g = this.grabadora;
    if (!g) return;
    if (g.state === 'recording') { g.pause(); this.enPausa.set(true); }
    else if (g.state === 'paused') { g.resume(); this.enPausa.set(false); }
  }

  /** Termina la grabación; con enviar = false la bota */
  async pararGrabacion(enviar: boolean): Promise<void> {
    const g = this.grabadora;
    if (!g) return;
    const seg = this.segundos();
    const listo = new Promise<void>((ok) => (g.onstop = () => ok()));
    if (g.state !== 'inactive') g.stop();
    await listo;
    const tipo = g.mimeType.split(';')[0] || 'audio/mp4';
    const blob = new Blob(this.trozos, { type: tipo });
    this.soltarGrabacion();
    if (!enviar) return;
    if (seg < 1 || !blob.size) return this.toast.error('La nota de voz quedó muy corta.');
    this.subiendo.set('Enviando nota de voz…');
    this.bajar();
    try {
      const ext = tipo.includes('mp4') ? 'm4a' : tipo.includes('ogg') ? 'ogg' : 'webm';
      const ruta = await this.subir(blob, tipo, ext);
      await this.enviar('', { tipo: 'audio', ruta, duracion: seg });
    } catch (e) {
      this.toast.error('No se pudo enviar la nota de voz: ' + mensajeError(e));
    } finally {
      this.subiendo.set(null);
    }
  }

  private soltarGrabacion(): void {
    clearInterval(this.reloj);
    const g = this.grabadora;
    this.grabadora = undefined;
    if (g) {
      g.ondataavailable = null;
      if (g.state !== 'inactive') g.stop();
      g.stream.getTracks().forEach((t) => t.stop());
    }
    this.trozos = [];
    this.grabando.set(false);
    this.enPausa.set(false);
  }

  /** Oír o pausar una nota de voz */
  tocar(m: Mensaje): void {
    const u = this.url(m);
    if (!u) return void this.firmar([m]);
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.ontimeupdate = () => {
        const a = this.audio!;
        const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : this.porId().get(this.actual() ?? 0)?.duracion || 0;
        this.avance.set(total ? Math.min(1, a.currentTime / total) : 0);
      };
      this.audio.onended = () => { this.sonando.set(null); this.avance.set(0); };
      this.audio.onpause = () => this.sonando.set(null);
      this.audio.onerror = () => { if (this.actual() != null) this.toast.error('No se pudo oír la nota de voz.'); this.sonando.set(null); };
    }
    const a = this.audio;
    if (this.sonando() === m.id) return a.pause();
    if (this.actual() !== m.id) {
      a.src = u;
      this.actual.set(m.id);
      this.avance.set(0);
    }
    this.sonando.set(m.id);
    void a.play().catch(() => this.sonando.set(null));
  }

  /** Tocar la onda lleva a ese punto de la nota de voz */
  saltar(ev: MouseEvent, m: Mensaje): void {
    if (this.actual() !== m.id || !this.audio) return this.tocar(m);
    const caja = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const total = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : m.duracion || 0;
    if (total) this.audio.currentTime = Math.min(1, Math.max(0, (ev.clientX - caja.left) / caja.width)) * total;
  }

  // ---------- Responder (deslizando el mensaje a la derecha, o doble clic) ----------

  responder(m: Mensaje): void {
    this.respondiendo.set(m);
    this.panel.set(false);
    this.host.nativeElement.querySelector('textarea')?.focus({ preventScroll: true });
  }

  tocaIni(ev: TouchEvent, m: Mensaje): void {
    const t = ev.touches[0];
    this.toque = ev.touches.length === 1 ? { m, x: t.clientX, y: t.clientY, activo: false } : undefined;
  }

  tocaMueve(ev: TouchEvent): void {
    const q = this.toque;
    if (!q) return;
    const t = ev.touches[0];
    const dx = t.clientX - q.x;
    const dy = t.clientY - q.y;
    if (!q.activo) {
      // Si el dedo va hacia arriba o abajo es que está bajando por la conversación
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (this.toque = undefined);
      if (dx < 12) return;
      q.activo = true;
    }
    this.desliza.set({ id: q.m.id, dx: Math.min(72, Math.max(0, dx * 0.7)) });
  }

  tocaFin(cancelado = false): void {
    const d = this.desliza();
    const q = this.toque;
    this.toque = undefined;
    this.desliza.set(null);
    if (!cancelado && q && d && d.dx >= 56) {
      navigator.vibrate?.(10);
      this.responder(q.m);
    }
  }

  /** El mensaje citado (al que este responde) */
  cita(m: Mensaje): { id: number; autor: string; texto: string } | null {
    if (!m.responde_a) return null;
    const o = this.porId().get(m.responde_a);
    if (!o) return { id: m.responde_a, autor: 'Mensaje', texto: 'Mensaje anterior' };
    return { id: o.id, autor: o.autor_id === this.yo() ? 'Tú' : this.corto(o.autor_nombre), texto: this.resumen(o) };
  }

  resumen(m: Mensaje): string {
    if (m.tipo === 'foto') return '📷 Foto' + (m.texto ? ' · ' + m.texto : '');
    if (m.tipo === 'audio') return '🎤 Nota de voz · ' + minSeg(m.duracion || 0);
    return m.texto;
  }

  /** Lleva la conversación hasta un mensaje y lo resalta */
  irA(id: number): void {
    const el = this.lista?.nativeElement.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.resaltado.set(id);
    setTimeout(() => this.resaltado.set(null), 1300);
  }

  corto(nombre: string): string {
    return (nombre ?? '').trim().split(/\s+/).slice(0, 2).join(' ') || 'Alguien';
  }

  /** ¿Sigue al mensaje anterior de la misma persona? (van más pegados) */
  sigue(i: number): boolean {
    const l = this.mensajes();
    return i > 0 && l[i - 1].autor_id === l[i].autor_id && !this.diaNuevo(i);
  }

  diaNuevo(i: number): boolean {
    const l = this.mensajes();
    return i === 0 || this.clave(l[i - 1].created_at) !== this.clave(l[i].created_at);
  }

  private clave(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'numeric', year: 'numeric' });
  }

  dia(iso: string): string {
    const k = this.clave(iso);
    if (k === this.clave(new Date().toISOString())) return 'Hoy';
    if (k === this.clave(new Date(Date.now() - 86400000).toISOString())) return 'Ayer';
    return formatoFechaCO(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /** Al teclear se avisa a los demás (a lo sumo cada 2,5 s) */
  tecleando(ev?: Event): void {
    const ta = ev?.target as HTMLTextAreaElement | undefined;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
    }
    if (!this.texto.trim()) return this.avisarEscribiendo(false);
    if (Date.now() - this.ultimoAviso < 2500) return;
    this.avisarEscribiendo(true);
  }

  private avisarEscribiendo(escribiendo: boolean): void {
    if (!this.canalEscribe || !this.yo()) return;
    this.ultimoAviso = escribiendo ? Date.now() : 0;
    const nombre = this.miNombre.trim().split(/\s+/)[0] || 'Alguien';
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
    return formatoHoraCO(iso);
  }
}
