import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircleOutline, callOutline, chatbubbleEllipsesOutline, logoWhatsapp, refreshOutline } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { ChatHojaComponent } from '../../shared/chat-pedido/chat-hoja.component';
import { RangoComponent, RangoFechas } from '../../shared/rango/rango.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoFechaCO, formatoHoraCO } from '../../shared/fecha-colombia';

interface Abierta {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  barrio: string | null;
  direccion: string | null;
  total: number;
  estado: string;
  novedades: number;
  ultima_novedad: string;
  novedad_at: string;
  vendedor: string | null;
  domiciliario: string | null;
  detalle: string | null;
}
interface Fila {
  id: number;
  pedido_id: string;
  numero: number;
  fecha: string;
  motivo_label: string;
  detalle: string | null;
  accion: 'reintentar' | 'devolver';
  autor: string | null;
  domiciliario: string | null;
  cliente_nombre: string;
  barrio: string | null;
  estado: string;
  vendedor: string | null;
}
interface Datos {
  abiertas: Abierta[];
  historial: Fila[];
  por_motivo: { motivo: string; n: number }[];
  por_domiciliario: { nombre: string; n: number }[];
}

const ESTADOS: Record<string, string> = { pendiente: 'En la tienda', en_ruta: 'En ruta', entregado: 'Entregado', cancelado: 'Cancelado' };

/**
 * Novedades de entrega (como en Jasta): los pedidos que el domiciliario no pudo entregar
 * (por qué y qué pasó con ellos). Arriba los que siguen sin entregarse; abajo el historial.
 * Admin y despachador ven todo; el vendedor y el domiciliario, lo suyo.
 */
@Component({
  selector: 'app-novedades',
  standalone: true,
  host: { class: 'jt' },
  imports: [IonIcon, ChatHojaComponent, RangoComponent, SkeletonComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1000px; }
      .abiertas { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
      .nov { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
        border-radius: var(--radius-lg); background: var(--surface); }
      .nov-top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; font-size: 15px; font-weight: 650; }
      .nov-top .num { font-size: 14px; white-space: nowrap; }
      .motivo { display: inline-flex; align-items: center; gap: 5px; align-self: flex-start; padding: 3px 9px; border-radius: 8px;
        background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); font-size: 12.5px; font-weight: 650; }
      .nov p { margin: 0; font-size: 13px; color: var(--text-soft); }
      .nov .det { color: var(--text); font-style: italic; }
      .estado { display: inline-block; padding: 1px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 650; background: var(--surface-2); color: var(--text-soft); }
      .estado.en_ruta { background: var(--accent-wash); color: var(--accent); }
      .estado.pendiente { background: var(--oro-wash); color: var(--oro-texto); }
      .estado.entregado { background: color-mix(in srgb, var(--st-entregado) 14%, transparent); color: var(--efectivo-texto); }
      .estado.cancelado { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--danger); }
      .nov .acc { display: flex; gap: 8px; flex-wrap: wrap; }
      .nov .acc .b { height: 36px; font-size: 13px; }
      .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .barras { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .barras li { display: grid; grid-template-columns: minmax(0, 150px) minmax(0, 1fr) 32px; gap: 10px; align-items: center; font-size: 13px; }
      .barras .nombre { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .barras .pista { display: block; height: 10px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
      .barras .relleno { display: block; height: 100%; border-radius: 5px; background: var(--danger); opacity: 0.75; }
      .barras .n { text-align: right; font-family: var(--mono-font); font-weight: 650; }
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
      .hist-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
      .hist-head h2 { margin: 0; font-size: 15px; }
      .hist { list-style: none; margin: 0; padding: 0; }
      .hist li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 11px 0; border-bottom: var(--perfora); cursor: pointer; }
      .hist li:last-child { border-bottom: 0; }
      .hist .t1 { font-size: 14px; font-weight: 550; }
      .hist .t2 { display: block; font-size: 12.5px; color: var(--text-muted); }
      .hist .der { text-align: right; font-size: 12.5px; color: var(--text-soft); }
      @media (max-width: 720px) { .stats { grid-template-columns: 1fr; } }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Lo que no se pudo entregar</p><h1>Novedades</h1></div>
        <button class="b b-icono" aria-label="Actualizar" (click)="cargar()"><ion-icon name="refresh-outline"></ion-icon></button>
      </div>

      <section class="panel" aria-labelledby="t-abiertas">
        <div class="panel-head"><div>
          <h2 id="t-abiertas">Sin resolver ({{ d()?.abiertas?.length ?? 0 }})</h2>
          <p class="panel-sub">Pedidos con novedad que todavía no se entregan ni se cancelan</p>
        </div></div>
        @if (d()?.abiertas?.length) {
          <div class="abiertas">
            @for (a of d()!.abiertas; track a.id) {
              <article class="nov">
                <div class="nov-top"><span>#{{ a.numero }} {{ a.cliente_nombre }}</span><span class="num">{{ pesos(a.total) }}</span></div>
                <span class="motivo"><ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>{{ a.ultima_novedad }}@if (a.novedades > 1) { · {{ a.novedades }} intentos }</span>
                @if (a.detalle) { <p class="det">"{{ a.detalle }}"</p> }
                <p>{{ a.barrio || 'Sin barrio' }} · {{ cuando(a.novedad_at) }}</p>
                <p><span class="estado" [class]="'estado ' + a.estado">{{ estado(a.estado) }}</span>
                  @if (a.domiciliario) { · {{ a.domiciliario }} } @if (a.vendedor) { · vendió {{ a.vendedor }} }</p>
                <div class="acc">
                  @if (a.cliente_telefono) {
                    <a class="b" [href]="'tel:' + a.cliente_telefono"><ion-icon name="call-outline"></ion-icon>Llamar</a>
                    <a class="b" [href]="whatsapp(a)" target="_blank" rel="noopener"><ion-icon name="logo-whatsapp"></ion-icon>WhatsApp</a>
                  }
                  <button class="b" (click)="chatId.set(a.id)"><ion-icon name="chatbubble-ellipses-outline"></ion-icon>Chat</button>
                </div>
              </article>
            }
          </div>
        } @else if (cargando()) {
          <app-skeleton variante="tarjetas" [cantidad]="2"></app-skeleton>
        } @else {
          <p class="vacio-txt">No hay pedidos con novedades pendientes.</p>
        }
      </section>

      <div class="hist-head">
        <h2>Historial</h2>
        <app-rango inicial="7" (cambio)="cambiarRango($event)"></app-rango>
      </div>

      @if (d()?.historial?.length) {
        <div class="stats">
          <section class="panel"><div class="panel-head"><div><h2>Por motivo</h2></div></div>
            <ul class="barras">
              @for (m of d()!.por_motivo; track m.motivo) {
                <li><span class="nombre">{{ m.motivo }}</span><span class="pista"><span class="relleno" [style.width.%]="(m.n / maxMotivo()) * 100"></span></span><span class="n">{{ m.n }}</span></li>
              }
            </ul>
          </section>
          @if (veTodo()) {
            <section class="panel"><div class="panel-head"><div><h2>Por domiciliario</h2></div></div>
              <ul class="barras">
                @for (m of d()!.por_domiciliario; track m.nombre) {
                  <li><span class="nombre">{{ m.nombre }}</span><span class="pista"><span class="relleno" [style.width.%]="(m.n / maxDom()) * 100"></span></span><span class="n">{{ m.n }}</span></li>
                }
              </ul>
            </section>
          }
        </div>
      }

      <section class="panel">
        @if (d()?.historial?.length) {
          <ul class="hist">
            @for (f of d()!.historial; track f.id) {
              <li (click)="chatId.set(f.pedido_id)">
                <span><span class="t1">#{{ f.numero }} {{ f.cliente_nombre }} · {{ f.motivo_label }}</span>
                  <span class="t2">{{ f.detalle ? f.detalle + ' · ' : '' }}{{ f.accion === 'devolver' ? 'Volvió a la tienda' : 'Siguió en ruta' }} · {{ f.domiciliario || f.autor || '—' }}</span></span>
                <span class="der">{{ cuando(f.fecha) }}<br /><span class="estado" [class]="'estado ' + f.estado">{{ estado(f.estado) }}</span></span>
              </li>
            }
          </ul>
        } @else if (!cargando()) {
          <p class="vacio-txt">No hubo novedades en este periodo.</p>
        }
      </section>
    </div>

    @if (chatId(); as id) {
      <app-chat-hoja [pedidoId]="id" (cerrar)="chatId.set(null)"></app-chat-hoja>
    }
  `,
})
export class NovedadesPage implements OnInit, OnDestroy {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  d = signal<Datos | null>(null);
  cargando = signal(true);
  chatId = signal<string | null>(null);
  veTodo = signal(false);
  maxMotivo = computed(() => Math.max(1, ...(this.d()?.por_motivo ?? []).map((m) => m.n)));
  maxDom = computed(() => Math.max(1, ...(this.d()?.por_domiciliario ?? []).map((m) => m.n)));
  pesos = pesos;

  private rango: RangoFechas | null = null;
  private consulta = 0;
  private canal: RealtimeChannel | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    addIcons({ alertCircleOutline, callOutline, chatbubbleEllipsesOutline, logoWhatsapp, refreshOutline });
  }

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((p) => this.veTodo.set(!!p && rolesDe(p).some((r) => r === 'admin' || r === 'despachador')));
    // Una novedad nueva (o el pedido que se entrega) cambia la lista
    this.canal = this.sb.client
      .channel('novedades-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos' }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.cargar(), 700);
      })
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.canal) this.sb.client.removeChannel(this.canal);
    clearTimeout(this.timer);
  }

  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    const n = ++this.consulta;
    const { data, error } = await this.sb.client.rpc('novedades', { p_desde: r.desde || '2020-01-01', p_hasta: r.hasta || r.desde });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.d.set(data as Datos);
  }

  estado(e: string): string {
    return ESTADOS[e] ?? e;
  }

  whatsapp(a: Abierta): string {
    const tel = (a.cliente_telefono ?? '').replace(/\D/g, '');
    const num = tel.length === 10 ? '57' + tel : tel;
    return `https://wa.me/${num}?text=${encodeURIComponent(`Hola ${a.cliente_nombre.split(' ')[0]}, te escribimos de Variedades JYB por tu pedido #${a.numero}.`)}`;
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
