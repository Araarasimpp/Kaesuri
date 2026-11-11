import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError } from '../../shared/formato';
import { DatosPago, TIPOS_CUENTA } from '../../shared/datos-pago/datos-pago';

/** Mi perfil → Datos para tus pagos: cédula y cuenta donde le pagan las comisiones. Privados: solo los ve el admin. */
@Component({
  selector: 'app-mis-datos-pago',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'jt' },
  styles: [':host { display: flex; flex-direction: column; gap: 12px; }'],
  template: `
    <h2>Datos para tus pagos</h2>
    <p class="ayuda" style="margin: 0">Con estos datos te pagan las comisiones y sale tu cédula en el comprobante de pago. Solo los ve el admin.</p>
    <div class="fila-campos">
      <div class="campo"><label for="dp-doc">Cédula</label><input id="dp-doc" inputmode="numeric" maxlength="30" [(ngModel)]="d.documento" placeholder="Ej: 1.036.456.789" /></div>
      <div class="campo"><label for="dp-tit">A nombre de</label><input id="dp-tit" maxlength="100" [(ngModel)]="d.titular" placeholder="Si la cuenta no está a tu nombre" /></div>
    </div>
    <div class="fila-campos">
      <div class="campo"><label for="dp-tipo">Tipo de cuenta</label>
        <select id="dp-tipo" [(ngModel)]="d.tipo_cuenta">
          <option [ngValue]="null">Elige…</option>
          @for (t of tipos; track t.id) { <option [ngValue]="t.id">{{ t.label }}</option> }
        </select></div>
      @if (d.tipo_cuenta !== 'nequi' && d.tipo_cuenta !== 'daviplata') {
        <div class="campo"><label for="dp-banco">Banco</label><input id="dp-banco" maxlength="60" [(ngModel)]="d.banco" placeholder="Ej: Bancolombia" /></div>
      }
      <div class="campo"><label for="dp-num">{{ d.tipo_cuenta === 'nequi' || d.tipo_cuenta === 'daviplata' ? 'Número de celular' : 'Número de cuenta' }}</label>
        <input id="dp-num" inputmode="numeric" maxlength="40" [(ngModel)]="d.numero_cuenta" /></div>
    </div>
    <div><button class="b b-pri" [disabled]="guardando()" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Guardar datos' }}</button></div>
  `,
})
export class MisDatosPagoComponent implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  d: DatosPago = {};
  tipos = TIPOS_CUENTA;
  guardando = signal(false);

  async ngOnInit(): Promise<void> {
    const { data } = await this.sb.client.rpc('mis_datos_pago');
    if (data) this.d = { tipo_cuenta: null, ...(data as DatosPago) };
  }

  async guardar(): Promise<void> {
    const billetera = this.d.tipo_cuenta === 'nequi' || this.d.tipo_cuenta === 'daviplata';
    if (this.d.numero_cuenta && !this.d.tipo_cuenta) return this.toast.error('Elige el tipo de cuenta.');
    this.guardando.set(true);
    const { error } = await this.sb.client.rpc('guardar_mis_datos_pago', {
      p_documento: this.d.documento ?? '', p_banco: billetera ? (this.d.tipo_cuenta === 'nequi' ? 'Nequi' : 'Daviplata') : this.d.banco ?? '',
      p_tipo: this.d.tipo_cuenta ?? '', p_numero: this.d.numero_cuenta ?? '', p_titular: this.d.titular ?? '',
    });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Datos guardados');
  }
}
