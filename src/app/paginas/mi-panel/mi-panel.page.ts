import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, bookOutline, chatbubbleEllipses, chatbubblesOutline, chevronForward } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js';
import { SupabaseService } from '../../core/services/supabase.service';
import { NotificacionesService } from '../../core/services/notificaciones.service';
import { ToastService } from '../../shared/toast/toast.service';
import { ChatHojaComponent } from '../../shared/chat-pedido/chat-hoja.component';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { EstadoPedido } from '../../shared/models/models';
import { mensajeError, numero, pesos } from '../../shared/formato';
import { diaColombiaDe, formatoFechaCO, formatoHoraCO, hoyColombiaISO } from '../../shared/fecha-colombia';
import { diaLargo, sumarDias } from '../../shared/rango/rango.component';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

interface Panel {
  ganancia: number;
  ventas: number;
  entregados: number;
  unidades: number;
  en_curso: number;
  ganancia_en_curso: number;
  cancelados: number;
  por_dia: { dia: string; ganancia: number }[];
}

interface Conversacion {
  pedido_id: string;
  numero: number;
  cliente_nombre: string;
  estado: EstadoPedido;
  total: number;
  domiciliario: string | null;
  domiciliario_foto: string | null;
  ultimo_texto: string | null;
  ultimo_autor: string | null;
  ultimo_mio: boolean | null;
  ultimo_at: string | null;
}

interface MiPedido {
  id: string;
  numero: number;
  created_at: string;
  estado: EstadoPedido;
  cliente_nombre: string;
  barrio: string | null;
  domiciliario: string | null;
  productos: string | null;
  total: number;
  ganancia_vendedor: number;
  total_filas: number;
}

type Atajo = 'hoy' | '7' | 'mes' | 'mes_pasado' | null;
type FiltroEstado = 'todos' | 'en_curso' | 'entregado' | 'cancelado';

const EN_CURSO: EstadoPedido[] = ['pendiente', 'en_ruta'];
const ETIQUETA: Record<EstadoPedido, string> = {
  pendiente: 'Pendiente', en_ruta: 'En ruta', entregado: 'Entregado', cancelado: 'Cancelado',
};
const POR_PAGINA = 20;

/**
 * Mi panel (vendedor), como en Jasta: sus ganancias en el rango que elija, sus
 * pedidos y las conversaciones con los domiciliarios, arriba en el celular y
 * fijas al lado en el computador.
 */
@Component({
  selector: 'app-mi-panel',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, RouterLink, IonIcon, ChatHojaComponent, AvatarComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1100px; }
      .head .acciones { display: flex; gap: 8px; }
      .head .acciones ion-icon { font-size: 17px; }

      /* Rango de fechas */
      .rango { display: flex; gap: 10px 14px; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; }
      .fechas { display: flex; gap: 10px; align-items: flex-end; }
      .fechas label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-soft); }
      .fechas input { width: 150px; }
      .periodo-txt { margin: 0; width: 100%; font-size: 13px; color: var(--text-soft); }
      .periodo-txt::first-letter { text-transform: uppercase; }

      .kpis { transition: opacity 150ms; }
      .kpis.cargando { opacity: 0.55; }
      .kpi-valor.gana { color: var(--oro-texto); }

      /* Mensajes a la derecha (fijos) en computador; arriba en celular */
      .cols { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); grid-template-areas: 'main side'; gap: 16px; align-items: start; }
      .main { grid-area: main; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
      .side { grid-area: side; position: sticky; top: 12px; min-width: 0; }

      .chart { position: relative; height: 220px; transition: opacity 150ms; }
      .chart.cargando { opacity: 0.5; }
      .panel-foot { margin: 10px 0 0; font-size: 12px; color: var(--text-muted); }

      /* Conversaciones */
      .mensajes.con-nuevos { border-color: var(--oro); box-shadow: 0 0 0 3px var(--oro-wash); }
      .mensajes h2 { display: flex; align-items: center; gap: 8px; }
      .mensajes h2 ion-icon { font-size: 18px; color: var(--oro-texto); }
      .nuevos { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
        background: var(--danger); color: #fff; font-size: 11.5px; font-weight: 700; font-family: var(--mono-font); }
      .convs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-height: 520px; overflow-y: auto; margin-right: -8px; padding-right: 8px; }
      .conv { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; width: calc(100% + 16px); padding: 10px 8px;
        margin: 0 -8px; border: 0; border-bottom: var(--perfora); background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; border-radius: var(--radius); }
      li:last-child .conv { border-bottom: 0; }
      @media (hover: hover) { .conv:hover { background: var(--hover); } }
      .conv-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .conv-tit { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .conv-ped { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .conv-ult { font-size: 13px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .conv-ult.vacio-msg { color: var(--text-muted); font-style: italic; }
      .conv-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
      .conv.nuevo .conv-tit, .conv.nuevo .conv-ult { color: var(--text); }
      .conv.nuevo .conv-ult { font-weight: 600; }
      .punto-nuevo { width: 9px; height: 9px; border-radius: 50%; background: var(--danger); }
      .sin-msgs { margin: 0; padding: 10px 0 2px; font-size: 13.5px; line-height: 1.5; color: var(--text-soft); text-align: center; }
      .sin-msgs strong { display: block; color: var(--text); margin-bottom: 2px; }

      /* Mis pedidos */
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .pedidos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .ped { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; width: calc(100% + 16px); padding: 11px 8px; margin: 0 -8px;
        border: 0; border-bottom: var(--perfora); background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; border-radius: var(--radius); }
      li:last-child .ped { border-bottom: 0; }
      @media (hover: hover) { .ped:hover { background: var(--hover); } }
      .ped-cli { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ped-cli .num { color: var(--text-muted); font-weight: 500; font-size: 12.5px; margin-right: 6px; }
      .ped-prod { grid-column: 1; font-size: 12.5px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ped-fila { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }
      .ped-der { grid-column: 2; grid-row: 1 / span 2; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
      .ped-total { font-family: var(--mono-font); font-size: 13px; color: var(--text-soft); }
      .ped-gan { font-family: var(--mono-font); font-size: 14px; font-weight: 650; color: var(--oro-texto); }
      .ped-gan.pend { color: var(--text-muted); font-weight: 550; }
      .ped-gan.nula { color: var(--text-muted); text-decoration: line-through; font-weight: 500; }
      .est { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--text-soft); }
      .est[data-estado='entregado'] { color: var(--ok, #2e7d32); }
      .est[data-estado='cancelado'] { color: var(--danger); }
      .chip-seg { display: inline-flex; align-items: center; padding: 1px 8px; border: 1px solid var(--border-strong); border-radius: 999px; font-size: 11.5px; font-weight: 650; color: var(--accent); cursor: pointer; }
      .chip-mensaje { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 11px; border: 0;
        background: var(--danger); color: #fff; font-size: 11.5px; font-weight: 650; cursor: pointer; }
      .mas { display: flex; justify-content: center; padding-top: 12px; }
      .suave { color: var(--text-muted); }

      @media (max-width: 900px) {
        .cols { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'side' 'main'; }
        .side { position: static; }
        .convs { max-height: 340px; }
      }
      @media (max-width: 640px) {
        .head .acciones { width: 100%; }
        .head .acciones .b { flex: 1; justify-content: center; }
        .rango .segmented { width: 100%; }
        .fechas { width: 100%; display: grid; grid-template-columns: 1fr 1fr; }
        .fechas input { width: 100%; min-width: 0; }
        .chart { height: 180px; }
        .panel-head .chips { width: 100%; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
        .panel-head .chips .chip { flex: none; }
      }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ hoyLargo }}</p><h1>Hola, {{ primerNombre() }}</h1></div>
        <div class="acciones">
          <a class="b" routerLink="/vendedor/catalogo"><ion-icon name="book-outline"></ion-icon>Catálogo</a>
          <a class="b b-pri" routerLink="/vendedor/nuevo-pedido"><ion-icon name="add"></ion-icon>Nuevo pedido</a>
        </div>
      </div>

      <!-- Rango de las ganancias -->
      <div class="rango">
        <div class="segmented" role="group" aria-label="Periodo">
          @for (a of atajos; track a.id) {
            <button [class.on]="atajo() === a.id" [attr.aria-pressed]="atajo() === a.id" (click)="usarAtajo(a.id)">{{ a.label }}</button>
          }
        </div>
        <div class="fechas">
          <label>Desde<input class="inp inp-chico num" type="date" [(ngModel)]="desde" [max]="hoy" (change)="fechasAMano()" /></label>
          <label>Hasta<input class="inp inp-chico num" type="date" [(ngModel)]="hasta" [max]="hoy" (change)="fechasAMano()" /></label>
        </div>
        <p class="periodo-txt">{{ etiqueta() }}</p>
      </div>

      <div class="kpis" role="list" [class.cargando]="cargando()" [attr.aria-busy]="cargando()">
        <div class="kpi kpi-principal" role="listitem">
          <span class="kpi-label">Mi ganancia</span>
          <span class="kpi-valor num gana">{{ panel() ? pesos(panel()!.ganancia) : '…' }}</span>
          <span class="kpi-nota">Pedidos entregados</span>
        </div>
        <div class="kpi" role="listitem">
          <span class="kpi-label">Por ganar</span>
          <span class="kpi-valor num">{{ panel() ? pesos(panel()!.ganancia_en_curso) : '…' }}</span>
          <span class="kpi-nota num">{{ numero(panel()?.en_curso) }} {{ panel()?.en_curso === 1 ? 'pedido en curso' : 'pedidos en curso' }}</span>
        </div>
        <div class="kpi" role="listitem">
          <span class="kpi-label">Vendido</span>
          <span class="kpi-valor num">{{ panel() ? pesos(panel()!.ventas) : '…' }}</span>
          <span class="kpi-nota num">{{ numero(panel()?.unidades) }} unidades entregadas</span>
        </div>
        <div class="kpi" role="listitem">
          <span class="kpi-label">Entregados</span>
          <span class="kpi-valor num">{{ numero(panel()?.entregados) }}</span>
          <span class="kpi-nota num">{{ numero(panel()?.cancelados) }} {{ panel()?.cancelados === 1 ? 'cancelado' : 'cancelados' }}</span>
        </div>
      </div>

      <div class="cols">
        <!-- Mensajes con los domiciliarios -->
        <aside class="side">
          <section class="panel mensajes" [class.con-nuevos]="sinLeer() > 0" aria-labelledby="t-msgs">
            <div class="panel-head">
              <div>
                <h2 id="t-msgs"><ion-icon name="chatbubbles-outline" aria-hidden="true"></ion-icon>Mensajes
                  @if (sinLeer()) { <span class="nuevos" [attr.aria-label]="sinLeer() + ' sin leer'">{{ sinLeer() }}</span> }
                </h2>
                <p class="panel-sub">Con los domiciliarios de tus pedidos</p>
              </div>
            </div>
            @if (convs().length) {
              <ul class="convs">
                @for (c of convs(); track c.pedido_id) {
                  <li>
                    <button type="button" class="conv" [class.nuevo]="conMensajes().has(c.pedido_id)" (click)="abrir(c.pedido_id)">
                      <app-avatar [nombre]="c.domiciliario || '?'" [foto]="c.domiciliario_foto" [tam]="38"></app-avatar>
                      <span class="conv-txt">
                        <span class="conv-tit">{{ c.domiciliario || 'Sin domiciliario' }}</span>
                        @if (c.ultimo_texto) {
                          <span class="conv-ult">{{ c.ultimo_mio ? 'Tú: ' : c.ultimo_autor && c.ultimo_autor !== c.domiciliario ? c.ultimo_autor + ': ' : '' }}{{ c.ultimo_texto }}</span>
                        } @else {
                          <span class="conv-ult vacio-msg">En ruta · escríbele al domiciliario</span>
                        }
                        <span class="conv-ped">Pedido #{{ c.numero }} · {{ c.cliente_nombre }}</span>
                      </span>
                      <span class="conv-meta">
                        <span>{{ c.ultimo_at ? cuando(c.ultimo_at) : etiquetaEstado(c.estado) }}</span>
                        @if (conMensajes().has(c.pedido_id)) { <span class="punto-nuevo" aria-label="Mensaje nuevo"></span> }
                        @else { <ion-icon name="chevron-forward" aria-hidden="true"></ion-icon> }
                      </span>
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="sin-msgs"><strong>{{ cargandoConvs() ? 'Cargando…' : 'Sin conversaciones' }}</strong>
                @if (!cargandoConvs()) { Cuando un pedido tuyo salga a ruta o un domiciliario te escriba, la conversación aparece aquí. }</p>
            }
          </section>
        </aside>

        <div class="main">
          <!-- Ganancia por día -->
          <section class="panel" aria-labelledby="t-gan">
            <div class="panel-head">
              <div>
                <h2 id="t-gan">Mi ganancia</h2>
                <p class="panel-sub"><strong class="num">{{ pesos(panel()?.ganancia) }}</strong> · {{ etiqueta() }}</p>
              </div>
            </div>
            <div class="chart" [class.cargando]="cargando()">
              <canvas #lienzo role="img" [attr.aria-label]="'Gráfica de mi ganancia, ' + etiqueta()"></canvas>
            </div>
            <p class="panel-foot">Ganancia = tu comisión de los pedidos entregados (precio de venta − precio base), por el día en que se subieron.</p>
          </section>

          <!-- Mis pedidos -->
          <section class="panel" aria-labelledby="t-ped">
            <div class="panel-head">
              <div><h2 id="t-ped">Mis pedidos</h2><p class="panel-sub">{{ numero(totalPedidos()) }} en este periodo</p></div>
              <div class="chips" role="group" aria-label="Estado">
                @for (f of filtros; track f.id) {
                  <button class="chip" [class.on]="filtro() === f.id" (click)="cambiarFiltro(f.id)">{{ f.label }}</button>
                }
              </div>
            </div>
            @if (pedidos().length) {
              <ul class="pedidos">
                @for (p of pedidos(); track p.id) {
                  <li>
                    <button type="button" class="ped" (click)="abrir(p.id)">
                      <span class="ped-cli"><span class="num">#{{ p.numero }}</span>{{ p.cliente_nombre }}</span>
                      <span class="ped-der">
                        <span class="ped-gan" [class.pend]="esEnCurso(p.estado)" [class.nula]="p.estado === 'cancelado'"
                          [title]="p.estado === 'entregado' ? 'Tu ganancia' : p.estado === 'cancelado' ? 'Cancelado: no suma' : 'Por ganar cuando se entregue'">
                          {{ pesos(p.ganancia_vendedor) }}</span>
                        <span class="ped-total">{{ pesos(p.total) }}</span>
                      </span>
                      <span class="ped-prod">{{ p.productos }}</span>
                      <span class="ped-fila">
                        <span class="est" [attr.data-estado]="p.estado">{{ etiquetaEstado(p.estado) }}</span>
                        <span>·</span><span>{{ cuando(p.created_at) }}</span>
                        @if (p.domiciliario) { <span>·</span><span>{{ p.domiciliario }}</span> }
                        @if (p.estado !== 'cancelado') {
                          <span class="chip-seg" role="button" tabindex="0" title="Enlace para que el cliente vea en qué va su pedido"
                            (click)="compartirSeguimiento(p); $event.stopPropagation()" (keydown.enter)="compartirSeguimiento(p); $event.stopPropagation()">
                            Seguimiento</span>
                        }
                        @if (conMensajes().has(p.id)) {
                          <span class="chip-mensaje" role="button" tabindex="0" (click)="abrir(p.id); $event.stopPropagation()"
                            (keydown.enter)="abrir(p.id); $event.stopPropagation()">
                            <ion-icon name="chatbubble-ellipses" aria-hidden="true"></ion-icon>Mensaje nuevo</span>
                        }
                      </span>
                    </button>
                  </li>
                }
              </ul>
              @if (pedidos().length < totalPedidos()) {
                <div class="mas"><button class="b" (click)="cargarPedidos(true)" [disabled]="cargandoPedidos()">{{ cargandoPedidos() ? 'Cargando…' : 'Ver más' }}</button></div>
              }
            } @else {
              <p class="sin-msgs"><strong>{{ cargandoPedidos() ? 'Cargando…' : 'No hay pedidos' }}</strong>
                @if (!cargandoPedidos()) { No subiste pedidos {{ filtro() === 'todos' ? '' : 'con ese estado ' }}en este periodo. }</p>
            }
          </section>
        </div>
      </div>
    </div>

    @if (abierto(); as id) {
      <app-chat-hoja [pedidoId]="id" (cerrar)="cerrarDetalle()"></app-chat-hoja>
    }
  `,
})
export class MiPanelPage implements OnInit, OnDestroy {
  private sb = inject(SupabaseService);
  private avisos = inject(NotificacionesService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly hoy = hoyColombiaISO();
  readonly hoyLargo = diaLargo(this.hoy);
  readonly atajos: { id: Exclude<Atajo, null>; label: string }[] = [
    { id: 'hoy', label: 'Hoy' },
    { id: '7', label: '7 días' },
    { id: 'mes', label: 'Este mes' },
    { id: 'mes_pasado', label: 'Mes pasado' },
  ];
  readonly filtros: { id: FiltroEstado; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'en_curso', label: 'En curso' },
    { id: 'entregado', label: 'Entregados' },
    { id: 'cancelado', label: 'Cancelados' },
  ];

  atajo = signal<Atajo>('mes');
  desde = this.hoy.slice(0, 8) + '01';
  hasta = this.hoy;
  etiqueta = signal('');

  panel = signal<Panel | null>(null);
  cargando = signal(true);
  convs = signal<Conversacion[]>([]);
  cargandoConvs = signal(true);
  pedidos = signal<MiPedido[]>([]);
  totalPedidos = signal(0);
  cargandoPedidos = signal(true);
  filtro = signal<FiltroEstado>('todos');
  /** Pedido con el chat abierto (también llega por ?chat=<pedido> desde un aviso) */
  abierto = signal<string | null>(null);

  conMensajes = this.avisos.pedidosConMensajes;
  sinLeer = computed(() => this.conMensajes().size);
  private nombre = signal('');
  primerNombre = computed(() => this.nombre().trim().split(/\s+/)[0] || 'vendedor');

  pesos = pesos;
  numero = numero;

  @ViewChild('lienzo') set lienzo(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.refLienzo = ref;
    if (ref) queueMicrotask(() => this.dibujar());
  }
  private refLienzo?: ElementRef<HTMLCanvasElement>;
  private grafica: Chart | null = null;
  private barras: { etiqueta: string; titulo: string; ganancia: number }[] = [];
  private observadorTema: MutationObserver | null = null;
  private canal: RealtimeChannel | null = null;
  private subParams?: { unsubscribe(): void };
  private timer?: ReturnType<typeof setTimeout>;
  private consulta = 0;

  constructor() {
    addIcons({ add, bookOutline, chatbubbleEllipses, chatbubblesOutline, chevronForward });
    // Llega un mensaje nuevo (aviso) → se actualizan las conversaciones
    let antes = -1;
    effect(() => {
      const n = this.avisos.lista().filter((a) => a.tipo === 'mensaje').length;
      if (antes !== -1 && n !== antes) untracked(() => void this.cargarConvs());
      antes = n;
    });
  }

  ngOnInit(): void {
    void this.avisos.iniciar();
    void this.sb.getCurrentProfile().then((p) => this.nombre.set(p?.nombre ?? ''));
    this.subParams = this.route.queryParamMap.subscribe((q) => {
      const id = q.get('chat');
      if (id) this.abierto.set(id);
    });
    this.usarAtajo('mes');
    void this.cargarConvs();
    // Cambios en los pedidos (en ruta, entregado…) actualizan el panel, en una sola recarga
    this.canal = this.sb.client
      .channel('mi-panel-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.recargar(), 700);
      })
      .subscribe();
    this.observadorTema = new MutationObserver(() => {
      this.grafica?.destroy();
      this.grafica = null;
      this.dibujar();
    });
    this.observadorTema.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnDestroy(): void {
    this.subParams?.unsubscribe();
    if (this.canal) void this.sb.client.removeChannel(this.canal);
    this.observadorTema?.disconnect();
    this.grafica?.destroy();
    clearTimeout(this.timer);
  }

  // ---------------------------------------------------------------- Rango
  usarAtajo(a: Exclude<Atajo, null>): void {
    const hoy = this.hoy;
    const inicioMes = hoy.slice(0, 8) + '01';
    if (a === 'hoy') [this.desde, this.hasta] = [hoy, hoy];
    else if (a === '7') [this.desde, this.hasta] = [sumarDias(hoy, -6), hoy];
    else if (a === 'mes') [this.desde, this.hasta] = [inicioMes, hoy];
    else {
      const finPasado = sumarDias(inicioMes, -1);
      [this.desde, this.hasta] = [finPasado.slice(0, 8) + '01', finPasado];
    }
    this.atajo.set(a);
    this.aplicar();
  }

  fechasAMano(): void {
    if (!this.desde || !this.hasta) return;
    if (this.desde > this.hasta) [this.desde, this.hasta] = [this.hasta, this.desde];
    // Máximo 400 días (lo que acepta el servidor)
    if (sumarDias(this.desde, 400) < this.hasta) this.desde = sumarDias(this.hasta, -400);
    this.atajo.set(null);
    this.aplicar();
  }

  private aplicar(): void {
    this.etiqueta.set(this.desde === this.hasta ? diaLargo(this.desde) : `${diaLargo(this.desde)} – ${diaLargo(this.hasta)}`);
    void this.cargarPanel();
    void this.cargarPedidos();
  }

  recargar(): void {
    void this.cargarPanel();
    void this.cargarPedidos();
    void this.cargarConvs();
  }

  // ---------------------------------------------------------------- Datos
  private async cargarPanel(): Promise<void> {
    const n = ++this.consulta;
    const [d, h] = [this.desde, this.hasta];
    this.cargando.set(true);
    const { data, error } = await this.sb.client.rpc('mi_panel', { p_desde: d, p_hasta: h });
    if (n !== this.consulta) return; // cambió el rango mientras tanto
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const p = data as Panel;
    this.panel.set(p);
    this.armarBarras((p.por_dia ?? []).map((x) => ({ dia: x.dia, ganancia: Number(x.ganancia) })));
  }

  async cargarConvs(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('mis_conversaciones');
    this.cargandoConvs.set(false);
    if (error) return this.toast.error('No se pudieron cargar los mensajes: ' + mensajeError(error));
    // Las que tienen mensajes sin leer, primero
    const nuevos = this.conMensajes();
    const lista = (data ?? []) as Conversacion[];
    this.convs.set([...lista.filter((c) => nuevos.has(c.pedido_id)), ...lista.filter((c) => !nuevos.has(c.pedido_id))]);
  }

  async cargarPedidos(mas = false): Promise<void> {
    const desdeFila = mas ? this.pedidos().length : 0;
    const clave = `${this.desde}|${this.hasta}|${this.filtro()}`;
    this.cargandoPedidos.set(true);
    const { data, error } = await this.sb.client.rpc('mis_pedidos', {
      p_desde: this.desde, p_hasta: this.hasta, p_estado: this.filtro(), p_limite: POR_PAGINA, p_desde_fila: desdeFila,
    });
    if (clave !== `${this.desde}|${this.hasta}|${this.filtro()}`) return;
    this.cargandoPedidos.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const filas = (data ?? []) as MiPedido[];
    this.pedidos.set(mas ? [...this.pedidos(), ...filas] : filas);
    this.totalPedidos.set(filas.length ? Number(filas[0].total_filas) : mas ? this.totalPedidos() : 0);
  }

  cambiarFiltro(f: FiltroEstado): void {
    this.filtro.set(f);
    void this.cargarPedidos();
  }

  // ----------------------------------------------------------------- Chat
  /** Comparte (o copia) el enlace de seguimiento para mandárselo al cliente */
  async compartirSeguimiento(p: { id: string; numero: number; cliente_nombre: string }): Promise<void> {
    const { data, error } = await this.sb.client.rpc('codigo_seguimiento', { p_pedido: p.id });
    if (error || !data) return this.toast.error('No se pudo sacar el enlace de seguimiento');
    const url = `${location.origin}/seguimiento/${data}`;
    const nombre = p.cliente_nombre.trim().split(/\s+/)[0];
    const texto = `Hola ${nombre}, aquí puedes ver en qué va tu pedido #${p.numero} de Variedades JYB:`;
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: 'Seguimiento de tu pedido', text: texto, url });
        return;
      } catch {
        /* canceló o no se pudo: se copia */
      }
    }
    try {
      await navigator.clipboard.writeText(`${texto} ${url}`);
      this.toast.ok('Enlace copiado: pégalo en el chat con el cliente');
    } catch {
      this.toast.error(url);
    }
  }

  abrir(id: string): void {
    this.abierto.set(id);
    void this.router.navigate([], { queryParams: { chat: id }, replaceUrl: true });
  }

  cerrarDetalle(): void {
    this.abierto.set(null);
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    // Pudo haber escrito o leído mensajes
    void this.cargarConvs();
  }

  // -------------------------------------------------------------- Gráfica
  private armarBarras(dias: { dia: string; ganancia: number }[]): void {
    const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { timeZone: 'UTC', ...o });
    if (dias.length <= 45) {
      this.barras = dias.map((d) => ({
        etiqueta: d.dia === this.hoy ? 'Hoy' : dias.length <= 7 ? fmt(d.dia, { weekday: 'short' }) : fmt(d.dia, { day: 'numeric' }),
        titulo: fmt(d.dia, { weekday: 'long', day: 'numeric', month: 'long' }),
        ganancia: d.ganancia,
      }));
    } else {
      // Rangos largos: una barra por mes
      const meses = new Map<string, number>();
      for (const d of dias) meses.set(d.dia.slice(0, 7), (meses.get(d.dia.slice(0, 7)) ?? 0) + d.ganancia);
      this.barras = [...meses].map(([m, g]) => ({
        etiqueta: fmt(m + '-01', { month: 'short' }),
        titulo: fmt(m + '-01', { month: 'long', year: 'numeric' }),
        ganancia: g,
      }));
    }
    this.dibujar();
  }

  private css(nombre: string): string {
    return getComputedStyle(document.body).getPropertyValue(nombre).trim();
  }

  private dibujar(): void {
    const canvas = this.refLienzo?.nativeElement;
    if (!canvas) return;
    const barras = this.barras;
    const oro = this.css('--oro');
    const peligro = this.css('--danger');
    const texto = this.css('--text-muted');
    const linea = this.css('--border-soft');
    const fuente = this.css('--ui-font');
    const colores = barras.map((b) => (b.ganancia < 0 ? peligro : oro));
    if (this.grafica) {
      const g = this.grafica;
      g.data.labels = barras.map((b) => b.etiqueta);
      g.data.datasets[0].data = barras.map((b) => b.ganancia);
      (g.data.datasets[0] as unknown as { backgroundColor: string[] }).backgroundColor = colores;
      g.update();
      return;
    }
    this.grafica = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: barras.map((b) => b.etiqueta),
        datasets: [{ data: barras.map((b) => b.ganancia), backgroundColor: colores, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 36 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            padding: 10,
            titleFont: { family: fuente, weight: 600 },
            bodyFont: { family: fuente },
            callbacks: {
              title: (items) => this.barras[items[0].dataIndex]?.titulo ?? '',
              label: (item) => `Mi ganancia: ${pesos(this.barras[item.dataIndex]?.ganancia ?? 0)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: texto, font: { family: fuente, size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 } },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: linea },
            ticks: { color: texto, font: { family: fuente, size: 11 }, maxTicksLimit: 5, callback: (v) => this.monedaCorta(Number(v)) },
          },
        },
      },
    });
  }

  // -------------------------------------------------------------- Formatos
  private monedaCorta(v: number): string {
    const s = v < 0 ? '−' : '';
    const a = Math.abs(v);
    if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
    if (a >= 1_000) return `${s}$${Math.round(a / 1_000)} mil`;
    return `${s}$${a}`;
  }

  esEnCurso(e: EstadoPedido): boolean {
    return EN_CURSO.includes(e);
  }

  etiquetaEstado(e: EstadoPedido): string {
    return ETIQUETA[e] ?? e;
  }

  /** "8:32 p. m.", "ayer" o "12 oct" */
  cuando(iso: string): string {
    const dia = diaColombiaDe(iso);
    if (dia === this.hoy) return formatoHoraCO(iso);
    if (dia === sumarDias(this.hoy, -1)) return 'ayer';
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' });
  }
}
