import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError } from '../../shared/formato';

/** Configuración → Datos para la DIAN: NIT y dirección del negocio (salen en los comprobantes de egreso) */
@Component({
  selector: 'app-datos-fiscales',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule],
  styles: [
    ':host { display: block; }',
    `
      .campos { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 0 12px; max-width: 620px; margin-top: 10px; }
      @media (max-width: 640px) { .campos { grid-template-columns: 1fr; } }
    `,
  ],
  template: `
    <h2>Datos para la DIAN</h2>
    <p class="ayuda">Salen en los comprobantes de egreso de los pagos de comisiones (Comisiones → Pagos hechos → PDF). La cédula de cada vendedor se pide la primera vez que descargas su comprobante.</p>
    <div class="campos">
      <div class="campo"><label for="df-nit">NIT del negocio</label><input id="df-nit" [(ngModel)]="nit" maxlength="30" placeholder="Ej: 901.234.567-8" /></div>
      <div class="campo"><label for="df-dir">Dirección</label><input id="df-dir" [(ngModel)]="direccion" maxlength="160" placeholder="Ej: Cra 10 #20-30" /></div>
    </div>
    <button class="b b-pri" (click)="guardar()" [disabled]="guardando()">{{ guardando() ? 'Guardando…' : 'Guardar datos' }}</button>
  `,
})
export class DatosFiscalesComponent implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  nit = '';
  direccion = '';
  guardando = signal(false);

  async ngOnInit(): Promise<void> {
    const { data } = await this.sb.client.from('configuracion').select('nit, direccion').eq('id', true).maybeSingle();
    const d = data as { nit: string | null; direccion: string | null } | null;
    this.nit = d?.nit ?? '';
    this.direccion = d?.direccion ?? '';
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    const { error } = await this.sb.client.rpc('guardar_datos_fiscales', { p_nit: this.nit, p_direccion: this.direccion });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Datos guardados');
  }
}
