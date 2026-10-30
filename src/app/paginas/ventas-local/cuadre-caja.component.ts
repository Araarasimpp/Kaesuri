import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, walletOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoHoraCO } from '../../shared/fecha-colombia';

interface Caja {
  fecha: string; ventas: number; total: number; efectivo: number; transferencia: number; base_sugerida: number;
  cierre: { base: number; esperado: number; contado: number; diferencia: number; nota: string | null; quien: string | null; hora: string } | null;
}

/**
 * Cuadre de la caja del local de un día: quien vende cuenta el efectivo y se compara con lo que
 * debería haber (base con la que abrió + efectivo de las ventas). Si falta o sobra, le llega un aviso al admin.
 */
@Component({
  selector: 'app-cuadre-caja',
  standalone: true,
  imports: [FormsModule, IonIcon],
  styles: [
    `
      .caja { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-top: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .caja ion-icon { font-size: 22px; color: var(--text-muted); flex-shrink: 0; }
      .caja .txt { flex: 1 1 200px; min-width: 0; font-size: 14px; }
      .caja .txt strong { display: block; }
      .caja .txt small { display: block; margin-top: 2px; color: var(--text-muted); font-size: 12.5px; }
      .caja.ok { border-color: color-mix(in srgb, var(--efectivo-texto) 40%, transparent); background: var(--ok-wash); }
      .caja.ok strong, .caja.ok ion-icon { color: var(--efectivo-texto); }
      .caja.falta { border-color: color-mix(in srgb, var(--danger) 40%, transparent); background: var(--danger-wash); }
      .caja.falta strong, .caja.falta ion-icon { color: var(--danger); }
      .caja.sobra { border-color: color-mix(in srgb, var(--oro-texto) 40%, transparent); background: var(--oro-wash); }
      .caja.sobra strong, .caja.sobra ion-icon { color: var(--oro-texto); }
      .cuenta { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); font-size: 14px; }
      .cuenta span:nth-child(even) { text-align: right; font-family: var(--mono-font); }
      .cuenta .fin { font-weight: 700; padding-top: 6px; border-top: 1px dashed var(--border-strong); }
      .resultado { padding: 12px 14px; border-radius: var(--radius); font-size: 15px; font-weight: 650; text-align: center; }
      .resultado.ok { background: var(--ok-wash); color: var(--efectivo-texto); }
      .resultado.falta { background: var(--danger-wash); color: var(--danger); }
      .resultado.sobra { background: var(--oro-wash); color: var(--oro-texto); }
      .num-grande { font-family: var(--mono-font); font-size: 20px !important; height: 52px !important; }
    `,
  ],
  template: `
    @if (caja(); as c) {
      <div class="caja" [class]="'caja ' + estado()">
        <ion-icon name="wallet-outline" aria-hidden="true"></ion-icon>
        <div class="txt">
          @if (c.cierre; as k) {
            <strong>{{ k.diferencia === 0 ? 'Caja cuadrada ✓' : k.diferencia < 0 ? 'Faltan ' + pesos(-k.diferencia) + ' en la caja' : 'Sobran ' + pesos(k.diferencia) + ' en la caja' }}</strong>
            <small>{{ k.quien || 'Alguien' }} contó {{ pesos(k.contado) }} a las {{ hora(k.hora) }} · debía haber {{ pesos(k.esperado) }}{{ k.nota ? ' · "' + k.nota + '"' : '' }}</small>
          } @else {
            <strong>Caja sin cuadrar</strong>
            <small>Efectivo de las ventas: {{ pesos(c.efectivo) }}. Al cerrar, cuenta el efectivo y anótalo.</small>
          }
        </div>
        <button class="b" [class.b-pri]="!c.cierre" (click)="abrir()">{{ c.cierre ? 'Volver a contar' : 'Cuadrar caja' }}</button>
      </div>
    }

    @if (abierta() && caja(); as c) {
      <button class="velo" aria-label="Cerrar" (click)="abierta.set(false)"></button>
      <aside class="hoja" role="dialog" aria-labelledby="t-caja">
        <div class="hoja-head">
          <h2 id="t-caja">Cuadrar caja</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="abierta.set(false)"><ion-icon name="close-outline"></ion-icon></button>
        </div>
        <div class="hoja-body">
          <div class="campo">
            <label for="cj-base">Base con la que abrió la caja</label>
            <input id="cj-base" class="num" type="text" inputmode="numeric" [ngModel]="base()" (ngModelChange)="base.set(aNumero($event))" placeholder="0" />
          </div>
          <div class="campo">
            <label for="cj-cont">Efectivo que contaste ahora</label>
            <input id="cj-cont" class="num num-grande" type="text" inputmode="numeric" [ngModel]="contado()" (ngModelChange)="contado.set(aNumero($event))" placeholder="Cuenta billetes y monedas" />
          </div>
          <div class="cuenta">
            <span>Base</span><span>{{ pesos(base() || 0) }}</span>
            <span>+ Efectivo de {{ c.ventas }} {{ c.ventas === 1 ? 'venta' : 'ventas' }}</span><span>{{ pesos(c.efectivo) }}</span>
            <span class="fin">Debe haber</span><span class="fin">{{ pesos(esperado()) }}</span>
          </div>
          @if (contado() !== null) {
            <p class="resultado" [class]="'resultado ' + estadoDe(diferencia())" role="status">
              {{ diferencia() === 0 ? 'Cuadra exacto ✓' : diferencia() < 0 ? 'Faltan ' + pesos(-diferencia()) : 'Sobran ' + pesos(diferencia()) }}
            </p>
          }
          <div class="campo">
            <label for="cj-nota">Nota {{ diferencia() !== 0 && contado() !== null ? '(cuéntale al admin qué pasó)' : '(opcional)' }}</label>
            <textarea id="cj-nota" rows="2" maxlength="300" [(ngModel)]="nota" placeholder="Ej: se pagó un domicilio de la caja"></textarea>
          </div>
          <p class="ayuda" style="margin: 0">Las transferencias ({{ pesos(c.transferencia) }}) no se cuentan aquí: no están en la caja.</p>
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="abierta.set(false)">Cancelar</button>
          <button class="b b-pri" (click)="guardar()" [disabled]="guardando() || contado() === null">{{ guardando() ? 'Guardando…' : 'Guardar cuadre' }}</button>
        </div>
      </aside>
    }
  `,
})
export class CuadreCajaComponent implements OnChanges {
  /** Día (YYYY-MM-DD, hora Colombia) */
  @Input({ required: true }) fecha!: string;
  /** Cambia cuando entra o se cancela una venta, para volver a leer el efectivo */
  @Input() version = 0;

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  caja = signal<Caja | null>(null);
  abierta = signal(false);
  guardando = signal(false);
  base = signal<number | null>(null);
  contado = signal<number | null>(null);
  nota = '';
  pesos = pesos;

  esperado = computed(() => (this.base() || 0) + (this.caja()?.efectivo ?? 0));
  diferencia = computed(() => (this.contado() ?? 0) - this.esperado());
  estado = computed(() => {
    const k = this.caja()?.cierre;
    return k ? this.estadoDe(k.diferencia) : '';
  });

  constructor() {
    addIcons({ closeOutline, walletOutline });
  }

  ngOnChanges(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('caja_local', { p_fecha: this.fecha });
    if (error) return; // sin permiso o sin la función todavía: no se muestra
    this.caja.set(data as Caja);
  }

  abrir(): void {
    const c = this.caja();
    if (!c) return;
    this.base.set(c.cierre?.base ?? c.base_sugerida ?? 0);
    this.contado.set(c.cierre?.contado ?? null);
    this.nota = c.cierre?.nota ?? '';
    this.abierta.set(true);
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    const { data, error } = await this.sb.client.rpc('cuadrar_caja', {
      p_fecha: this.fecha, p_base: this.base() || 0, p_contado: this.contado(), p_nota: this.nota,
    });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const d = Number((data as { diferencia: number }).diferencia);
    this.toast.ok(d === 0 ? 'Caja cuadrada ✓' : d < 0 ? `Guardado: faltan ${pesos(-d)}` : `Guardado: sobran ${pesos(d)}`);
    this.abierta.set(false);
    await this.cargar();
  }

  estadoDe(d: number): string {
    return d === 0 ? 'ok' : d < 0 ? 'falta' : 'sobra';
  }

  aNumero(v: string): number | null {
    const n = String(v ?? '').replace(/\D/g, '');
    return n ? Number(n) : null;
  }

  hora(iso: string): string {
    return formatoHoraCO(iso);
  }
}
