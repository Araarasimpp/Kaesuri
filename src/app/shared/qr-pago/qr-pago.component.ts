import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, copyOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { pesos } from '../formato';
import { CuentaPago, cargarCuentas } from './cuentas-pago';

interface WakeLock { release(): Promise<void> }

/**
 * QR de la cuenta del negocio en pantalla completa, para que el cliente lo escanee y pague por
 * transferencia. Muestra el valor a cobrar, el titular y el número (con copiar). Mientras está
 * abierto, la pantalla no se apaga.
 */
@Component({
  selector: 'app-qr-pago',
  standalone: true,
  imports: [IonIcon],
  styles: [
    `
      .fondo { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; gap: 14px; overflow-y: auto;
        padding: calc(14px + env(safe-area-inset-top)) 16px calc(18px + env(safe-area-inset-bottom)); background: #fff; color: #0f172a; }
      .cerrar { position: absolute; top: calc(10px + env(safe-area-inset-top)); right: 10px; width: 44px; height: 44px; display: grid; place-items: center;
        border: 0; border-radius: 50%; background: #f1f5f9; color: #0f172a; font-size: 24px; cursor: pointer; }
      .cobro { margin-top: 30px; text-align: center; }
      .cobro small { display: block; font-size: 14px; color: #475569; }
      .cobro strong { display: block; font-family: var(--mono-font); font-size: 40px; line-height: 1.1; letter-spacing: -.02em; }
      .cobro em { display: block; margin-top: 2px; font-style: normal; font-size: 13.5px; color: #64748b; }
      .cuentas { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .cuentas button { height: 40px; padding: 0 16px; border: 1.5px solid #cbd5e1; border-radius: 999px; background: #fff; color: #334155; font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; }
      .cuentas button.on { border-color: #0f172a; background: #0f172a; color: #fff; }
      .qr { width: min(78vw, 360px); aspect-ratio: 1; display: grid; place-items: center; border: 1px solid #e2e8f0; border-radius: 18px; background: #fff; overflow: hidden; }
      .qr img { width: 100%; height: 100%; object-fit: contain; }
      .qr .sin { padding: 20px; text-align: center; font-size: 14px; color: #64748b; }
      .datos { width: min(78vw, 360px); display: flex; flex-direction: column; gap: 6px; text-align: center; }
      .datos .banco { font-size: 18px; font-weight: 700; }
      .datos .titular { font-size: 14.5px; color: #475569; }
      .num { display: flex; align-items: center; justify-content: center; gap: 8px; font-family: var(--mono-font); font-size: 19px; font-weight: 700; }
      .num button { display: inline-flex; align-items: center; gap: 4px; height: 34px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #334155;
        font: 600 13px system-ui, sans-serif; cursor: pointer; }
      .nota { max-width: 360px; margin: 2px 0 0; padding: 10px 14px; border-radius: 12px; background: #fef9c3; color: #713f12; font-size: 13.5px; line-height: 1.45; text-align: center; }
    `,
  ],
  template: `
    <div class="fondo" role="dialog" aria-label="QR para pagar por transferencia">
      <button class="cerrar" aria-label="Cerrar" (click)="cerrar.emit()"><ion-icon name="close-outline"></ion-icon></button>
      @if (total !== null) {
        <div class="cobro"><small>{{ titulo || 'Valor a pagar' }}</small><strong>{{ pesos(total) }}</strong>@if (detalle) {<em>{{ detalle }}</em>}</div>
      } @else {
        <div class="cobro"><small>Paga por transferencia</small></div>
      }
      @if (cuentas().length > 1) {
        <div class="cuentas" role="group" aria-label="Cuenta">
          @for (c of cuentas(); track c.id) {
            <button [class.on]="actual()?.id === c.id" [attr.aria-pressed]="actual()?.id === c.id" (click)="elegida.set(c.id)">{{ c.nombre }}</button>
          }
        </div>
      }
      @if (actual(); as c) {
        <div class="qr">
          @if (c.qr_url) { <img [src]="c.qr_url" [alt]="'QR de ' + c.nombre" /> } @else { <p class="sin">Esta cuenta no tiene QR. Dale el número al cliente.</p> }
        </div>
        <div class="datos">
          <span class="banco">{{ c.nombre }}</span>
          @if (c.titular) { <span class="titular">A nombre de {{ c.titular }}</span> }
          @if (c.numero) { <span class="num">{{ c.numero }}<button type="button" (click)="copiar(c.numero)"><ion-icon name="copy-outline" aria-hidden="true"></ion-icon>Copiar</button></span> }
        </div>
        <p class="nota">Cuando el cliente pague, pídele el comprobante y súbelo al entregar.</p>
      } @else if (listo()) {
        <p class="nota">El admin todavía no ha puesto cuentas para recibir transferencias (Configuración → Cuentas para transferencias).</p>
      }
    </div>
  `,
})
export class QrPagoComponent implements OnInit, OnDestroy {
  /** Valor a cobrar (null = solo mostrar la cuenta) */
  @Input() total: number | null = null;
  @Input() titulo = '';
  @Input() detalle = '';
  @Output() cerrar = new EventEmitter<void>();

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private bloqueo: WakeLock | null = null;

  cuentas = signal<CuentaPago[]>([]);
  listo = signal(false);
  elegida = signal<number | null>(null);
  actual = computed<CuentaPago | null>(() => this.cuentas().find((c) => c.id === this.elegida()) ?? this.cuentas()[0] ?? null);
  pesos = pesos;

  async ngOnInit(): Promise<void> {
    void this.pantallaEncendida();
    this.cuentas.set(await cargarCuentas(this.sb.client));
    this.listo.set(true);
  }

  ngOnDestroy(): void {
    void this.bloqueo?.release().catch(() => undefined);
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    this.cerrar.emit();
  }

  /** Si la app vuelve a primer plano, el navegador suelta el bloqueo: se pide otra vez */
  @HostListener('document:visibilitychange')
  volver(): void {
    if (document.visibilityState === 'visible') void this.pantallaEncendida();
  }

  private async pantallaEncendida(): Promise<void> {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<WakeLock> } }).wakeLock;
      if (wl) this.bloqueo = await wl.request('screen');
    } catch { /* sin permiso o sin soporte: no pasa nada */ }
  }

  async copiar(n: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(n.replace(/[\s-]/g, ''));
      this.toast.ok('Número copiado');
    } catch {
      this.toast.error('No se pudo copiar');
    }
  }

  constructor() {
    addIcons({ closeOutline, copyOutline });
  }
}
