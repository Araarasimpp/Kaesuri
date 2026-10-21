import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ChatPedidoComponent } from './chat-pedido.component';
import { AvatarComponent } from '../avatar/avatar.component';
import { pesos } from '../formato';

interface Persona {
  nombre: string;
  avatar_url: string | null;
}

interface PedidoChat {
  numero: number;
  cliente_nombre: string;
  total: number;
  barrio: string | null;
  vendedor_id: string | null;
  domiciliario_id: string | null;
  vendedor: Persona | null;
  domiciliario: Persona | null;
}

interface Contacto {
  nombre: string;
  foto: string | null;
  rol: string;
}

/**
 * Hoja con el chat de un pedido (como la ventana de chat de Jasta).
 * Se abre desde las tarjetas y listas de pedidos, o desde un aviso de mensaje (?chat=<pedido>).
 */
@Component({
  selector: 'app-chat-hoja',
  standalone: true,
  host: { class: 'jt' },
  imports: [IonIcon, ChatPedidoComponent, AvatarComponent],
  styles: [
    `
      @media (max-width: 760px) { .hoja-chat { height: 92dvh; } }
      /* Cabecera como en WhatsApp: foto y nombre de con quién se habla */
      .hoja-chat .hoja-head { padding-left: 14px; gap: 8px; }
      .wa { display: flex; align-items: center; gap: 10px; min-width: 0; margin-right: auto; }
      .wa-fotos { display: flex; flex-shrink: 0; }
      .wa-fotos .foto { display: flex; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface); }
      .wa-fotos .foto + .foto { margin-left: -14px; }
      .wa-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .wa-txt strong { font-size: 16px; font-weight: 650; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wa-txt span { font-size: 12.5px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chat-cab { display: flex; flex-direction: column; gap: 2px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
      .chat-cab strong { font-size: 15.5px; font-weight: 650; }
      .chat-cab span { font-size: 13px; color: var(--text-soft); }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cerrar" (click)="cerrar.emit()"></button>
    <aside class="hoja hoja-chat" role="dialog" aria-labelledby="t-chat">
      <div class="hoja-head">
        <div class="wa">
          <span class="wa-fotos" aria-hidden="true">
            @for (c of contactos(); track c.nombre) {
              <span class="foto"><app-avatar [nombre]="c.nombre" [foto]="c.foto" [tam]="40"></app-avatar></span>
            }
          </span>
          <span class="wa-txt">
            <strong id="t-chat">{{ titulo() }}</strong>
            <span>{{ subtitulo() }}</span>
          </span>
        </div>
        <button class="b b-icono" aria-label="Cerrar" (click)="cerrar.emit()"><ion-icon name="close-outline"></ion-icon></button>
      </div>
      @if (pedido(); as p) {
        <div class="chat-cab">
          <strong>{{ p.cliente_nombre }}</strong>
          <span><span class="num">{{ pesos(p.total) }}</span>@if (p.barrio) { · {{ p.barrio }} }</span>
        </div>
      }
      <app-chat-pedido [pedidoId]="pedidoId" [completo]="true"></app-chat-pedido>
    </aside>
  `,
})
export class ChatHojaComponent implements OnInit {
  @Input({ required: true }) pedidoId!: string;
  @Output() cerrar = new EventEmitter<void>();

  private sb = inject(SupabaseService);
  pedido = signal<PedidoChat | null>(null);
  private yo = signal<string | null>(null);
  pesos = pesos;

  /** Con quién se habla (foto y nombre de la cabecera), según quién abre el chat */
  contactos = computed<Contacto[]>(() => {
    const p = this.pedido();
    if (!p) return [];
    const yo = this.yo();
    const vend = p.vendedor_id && p.vendedor ? { nombre: p.vendedor.nombre, foto: p.vendedor.avatar_url, rol: 'Vendedor' } : null;
    const dom = p.domiciliario_id && p.domiciliario ? { nombre: p.domiciliario.nombre, foto: p.domiciliario.avatar_url, rol: 'Domiciliario' } : null;
    let lista: (Contacto | null)[];
    if (yo === p.domiciliario_id && yo !== p.vendedor_id) lista = [vend];
    else if (yo === p.vendedor_id && yo !== p.domiciliario_id) lista = [dom];
    else lista = [vend, dom];
    const quedan = lista.filter((c): c is Contacto => !!c);
    return quedan.length ? quedan : [{ nombre: 'Variedades JYB', foto: null, rol: 'Sin domiciliario todavía' }];
  });

  titulo = computed(() => {
    const c = this.contactos();
    if (!c.length) return 'Chat';
    return c.length > 1 ? c.map((x) => x.nombre.trim().split(/\s+/)[0]).join(' y ') : c[0].nombre;
  });

  subtitulo = computed(() => {
    const c = this.contactos();
    const p = this.pedido();
    const quien = c.length > 1 ? 'Vendedor y domiciliario' : c[0]?.rol ?? '';
    return p ? `${quien} · Pedido #${p.numero}` : '';
  });

  constructor() {
    addIcons({ closeOutline });
  }

  async ngOnInit(): Promise<void> {
    void this.sb.getCurrentProfile().then((p) => this.yo.set(p?.id ?? null));
    const { data } = await this.sb.client
      .from('pedidos')
      .select(
        'numero, cliente_nombre, total, barrio, vendedor_id, domiciliario_id, ' +
          'vendedor:profiles!pedidos_vendedor_id_fkey(nombre, avatar_url), domiciliario:profiles!pedidos_domiciliario_id_fkey(nombre, avatar_url)'
      )
      .eq('id', this.pedidoId)
      .maybeSingle();
    if (data) this.pedido.set(data as unknown as PedidoChat);
  }
}
