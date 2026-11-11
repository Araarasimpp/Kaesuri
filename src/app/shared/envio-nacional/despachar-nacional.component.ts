import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ComprobantesInputComponent } from '../comprobantes/comprobantes-input.component';
import { PesosDirective } from '../pesos/pesos.directive';

/** Lo que necesita la hoja del pedido */
export interface PedidoNacional {
  id: string; numero: number; cliente_nombre: string; cliente_telefono: string | null; direccion: string; total: number;
  destino_ciudad: string | null; destino_departamento: string | null; destinatario_cedula: string | null;
}
import { mensajeError, pesos } from '../formato';
import { TRANSPORTADORAS } from './envio-nacional';

/**
 * Despachar un envío a otra ciudad: transportadora, número de guía, lo que costó el envío y el
 * comprobante del pago del cliente (siempre es pago anticipado). El pedido queda entregado.
 */
@Component({
  selector: 'app-despachar-nacional',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, ComprobantesInputComponent, PesosDirective],
  styles: [
    `
      .trans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
      .trans button { min-height: 40px; padding: 4px 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; font-size: 13px; cursor: pointer; }
      .trans button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .destino { margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13.5px; line-height: 1.45; }
      :host { display: contents; }
      .pagado { margin: 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--ok-wash); color: var(--efectivo-texto); font-size: 13.5px; }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cerrar" (click)="cerrar.emit()"></button>
    <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-nac">
      <div class="hoja-head"><h2 id="t-nac">Despachar por transportadora</h2></div>
      <div class="hoja-body">
        <p class="destino"><strong>{{ pedido.cliente_nombre }}</strong> · C.C. {{ pedido.destinatario_cedula || '—' }}<br />
          {{ pedido.direccion }}, {{ pedido.destino_ciudad }} ({{ pedido.destino_departamento }}) · {{ pedido.cliente_telefono }}<br />
          Total del pedido: <strong>{{ pesos(pedido.total) }}</strong></p>
        <div class="campo"><span class="etq">Transportadora</span>
          <div class="trans">
            @for (t of transportadoras; track t.nombre) {
              <button type="button" [class.on]="trans() === t.nombre" (click)="trans.set(t.nombre)">{{ t.nombre }}</button>
            }
          </div>
          @if (trans() === 'Otra') { <input class="inp" style="margin-top: 6px" maxlength="40" [(ngModel)]="otra" placeholder="¿Cuál?" aria-label="Nombre de la transportadora" /> }
        </div>
        <div class="fila-campos">
          <div class="campo"><label for="nac-g">Número de guía</label><input id="nac-g" inputmode="numeric" maxlength="40" [(ngModel)]="guia" placeholder="Sale en el tiquete" /></div>
          <div class="campo"><label for="nac-cost">Lo que pagaste del envío</label><input id="nac-cost" pesos [(ngModel)]="costo" placeholder="$ 0" /></div>
        </div>
        <app-comprobantes-input titulo="Comprobante del pago del cliente" pista="El pantallazo de la transferencia que te mandó antes de enviar."
            [rutas]="soportes()" (cambio)="soportes.set($event); error.set('')"></app-comprobantes-input>
        <p class="ayuda" style="margin: 0">Al guardar, el pedido queda entregado (ya salió del negocio), el vendedor recibe el aviso y el pago entra a Transferencias por revisar.</p>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </div>
      <div class="hoja-pie">
        <button class="b" (click)="cerrar.emit()">Cancelar</button>
        <button class="b b-ok" [disabled]="guardando()" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Guardar envío' }}</button>
      </div>
    </div>
  `,
})
export class DespacharNacionalComponent {
  @Input({ required: true }) pedido!: PedidoNacional;
  @Output() cerrar = new EventEmitter<void>();
  @Output() despachado = new EventEmitter<void>();
  private sb = inject(SupabaseService);

  transportadoras = TRANSPORTADORAS;
  trans = signal('Servientrega');
  otra = '';
  guia = '';
  costo: number | null = null;
  soportes = signal<string[]>([]);
  guardando = signal(false);
  error = signal('');
  pesos = pesos;

  async guardar(): Promise<void> {
    const trans = this.trans() === 'Otra' ? this.otra.trim() : this.trans();
    if (!trans) return this.error.set('Escribe el nombre de la transportadora.');
    if (this.guia.replace(/\s/g, '').length < 5) return this.error.set('Escribe el número de guía del tiquete.');
    if (!this.soportes().length) return this.error.set('Sube el comprobante del pago del cliente.');
    this.guardando.set(true);
    const { error } = await this.sb.client.rpc('despachar_nacional', {
      p_pedido: this.pedido.id, p_transportadora: trans, p_guia: this.guia.trim(),
      p_costo_envio: this.costo === null ? null : Number(this.costo), p_comprobantes: this.soportes(),
    });
    this.guardando.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.despachado.emit();
  }
}
