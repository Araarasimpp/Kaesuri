import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ChatPedidoComponent } from './chat-pedido.component';
import { pesos } from '../formato';

/**
 * Hoja con el chat de un pedido (como la ventana de chat de Jasta).
 * Se abre desde las tarjetas y listas de pedidos, o desde un aviso de mensaje (?chat=<pedido>).
 */
@Component({
  selector: 'app-chat-hoja',
  standalone: true,
  host: { class: 'jt' },
  imports: [IonIcon, ChatPedidoComponent],
  styles: [
    `
      @media (max-width: 760px) { .hoja-chat { height: 92dvh; } }
      .chat-cab { display: flex; flex-direction: column; gap: 2px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--surface-2); }
      .chat-cab strong { font-size: 15.5px; font-weight: 650; }
      .chat-cab span { font-size: 13px; color: var(--text-soft); }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cerrar" (click)="cerrar.emit()"></button>
    <aside class="hoja hoja-chat" role="dialog" aria-labelledby="t-chat">
      <div class="hoja-head">
        <h2 id="t-chat">Chat @if (pedido(); as p) {<span class="guia guia-grande">#{{ p.numero }}</span>}</h2>
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
  pedido = signal<{ numero: number; cliente_nombre: string; total: number; barrio: string | null } | null>(null);
  pesos = pesos;

  constructor() {
    addIcons({ closeOutline });
  }

  async ngOnInit(): Promise<void> {
    const { data } = await this.sb.client
      .from('pedidos')
      .select('numero, cliente_nombre, total, barrio')
      .eq('id', this.pedidoId)
      .maybeSingle();
    if (data) this.pedido.set(data as { numero: number; cliente_nombre: string; total: number; barrio: string | null });
  }
}
