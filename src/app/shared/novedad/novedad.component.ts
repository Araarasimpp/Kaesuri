import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { mensajeError } from '../formato';

export const MOTIVOS_NOVEDAD = [
  { id: 'no_contesta', label: 'No contesta' },
  { id: 'no_estaba', label: 'No estaba' },
  { id: 'direccion', label: 'Dirección errada' },
  { id: 'sin_dinero', label: 'No tenía la plata' },
  { id: 'rechazo', label: 'No lo quiso recibir' },
  { id: 'reprogramar', label: 'Pidió otro día' },
  { id: 'otro', label: 'Otro motivo' },
] as const;

/**
 * Hoja para cuando no se pudo entregar (copiada de Jasta): el domiciliario dice por qué y qué pasa con el
 * pedido (lo sigue llevando para intentar otra vez, o lo devuelve a la tienda).
 * Al vendedor y a quien despacha les llega el aviso.
 */
@Component({
  selector: 'app-novedad',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule],
  styles: [
    `
      .motivos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .op { min-height: 44px; padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface);
        color: var(--text); font-size: 14px; font-weight: 500; cursor: pointer; text-align: center; }
      .op.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .acciones { display: grid; grid-template-columns: 1fr; gap: 8px; }
      .accion { display: flex; flex-direction: column; gap: 2px; padding: 11px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
        background: var(--surface); color: var(--text); text-align: left; cursor: pointer; }
      .accion strong { font-size: 14px; }
      .accion small { font-size: 12.5px; color: var(--text-soft); }
      .accion.on { border-color: var(--accent); background: var(--accent-wash); }
      .cliente { margin: 0; font-size: 14px; color: var(--text-soft); }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cerrar" (click)="cerrar.emit()"></button>
    <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-novedad">
      <div class="hoja-head">
        <h2 id="t-novedad">No se pudo entregar #{{ pedido.numero }}</h2>
      </div>
      <div class="hoja-body">
        <p class="cliente">{{ pedido.cliente_nombre }}{{ pedido.barrio ? ' · ' + pedido.barrio : '' }}</p>
        <div class="campo">
          <span class="etq">¿Qué pasó?</span>
          <div class="motivos">
            @for (m of motivos; track m.id) {
              <button type="button" class="op" [class.on]="motivo() === m.id" (click)="motivo.set(m.id); error.set('')">{{ m.label }}</button>
            }
          </div>
        </div>
        <div class="campo">
          <label for="nov-det">{{ motivo() === 'otro' ? 'Cuenta qué pasó' : 'Detalle (opcional)' }}</label>
          <textarea id="nov-det" rows="2" maxlength="500" [(ngModel)]="detalle" placeholder="Ej: llamé 3 veces y no contestó; el portero dice que no vive ahí"></textarea>
        </div>
        <div class="campo">
          <span class="etq">¿Qué haces con el pedido?</span>
          <div class="acciones">
            <button type="button" class="accion" [class.on]="accion() === 'reintentar'" (click)="accion.set('reintentar')">
              <strong>Lo sigo llevando</strong><small>Queda en tu ruta para intentarlo otra vez</small>
            </button>
            <button type="button" class="accion" [class.on]="accion() === 'devolver'" (click)="accion.set('devolver')">
              <strong>Lo devuelvo a la tienda</strong><small>Sale de tu ruta y vuelve a la tienda como alistado</small>
            </button>
          </div>
        </div>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </div>
      <div class="hoja-pie">
        <button class="b" (click)="cerrar.emit()">Cancelar</button>
        <button class="b b-pri" [disabled]="guardando()" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Reportar novedad' }}</button>
      </div>
    </div>
  `,
})
export class NovedadComponent {
  private sb = inject(SupabaseService);

  @Input({ required: true }) pedido!: { id: string; numero: number; cliente_nombre: string; barrio: string | null };
  @Output() cerrar = new EventEmitter<void>();
  @Output() reportado = new EventEmitter<'reintentar' | 'devolver'>();

  motivos = MOTIVOS_NOVEDAD;
  motivo = signal<string | null>(null);
  accion = signal<'reintentar' | 'devolver'>('reintentar');
  detalle = '';
  error = signal('');
  guardando = signal(false);

  async guardar(): Promise<void> {
    const m = this.motivo();
    if (!m) return this.error.set('Elige qué pasó.');
    if (m === 'otro' && !this.detalle.trim()) return this.error.set('Cuenta qué pasó.');
    this.guardando.set(true);
    try {
      const { error } = await this.sb.client.rpc('reportar_novedad', { p_pedido: this.pedido.id, p_motivo: m, p_detalle: this.detalle.trim(), p_accion: this.accion() });
      if (error) throw error;
      this.reportado.emit(this.accion());
    } catch (e) {
      this.error.set(mensajeError(e));
    } finally {
      this.guardando.set(false);
    }
  }
}
