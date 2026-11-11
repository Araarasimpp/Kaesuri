import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';

/**
 * Cuántas transferencias presenciales faltan por revisar (como en Jasta). Se consulta cada minuto
 * mientras el área del admin está abierta (la franja vive ahí) y al volver a la app; cuando aparece
 * una nueva, el celular vibra y suena para que no se pase.
 */
@Injectable({ providedIn: 'root' })
export class TransferenciasAlertaService {
  private sb = inject(SupabaseService);
  readonly n = signal(0);
  readonly valor = signal(0);
  readonly desde = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;
  private anterior = -1;
  private activa = false;
  private alVolver = (): void => {
    if (document.visibilityState === 'visible') void this.refrescar();
  };

  /** Empieza a consultar (al entrar al área del admin) */
  iniciar(): void {
    if (this.activa) return;
    this.activa = true;
    void this.refrescar();
    this.timer = setInterval(() => void this.refrescar(), 60_000);
    document.addEventListener('visibilitychange', this.alVolver);
  }

  detener(): void {
    this.activa = false;
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.alVolver);
    this.n.set(0);
    this.anterior = -1;
  }

  async refrescar(): Promise<void> {
    if (!this.activa) return;
    const { data } = await this.sb.client.rpc('transferencias_pendientes');
    const d = (data ?? {}) as { n?: number; valor?: number; desde?: string | null };
    const n = Number(d.n) || 0;
    if (this.anterior >= 0 && n > this.anterior) this.sonar();
    this.anterior = n;
    this.n.set(n);
    this.valor.set(Number(d.valor) || 0);
    this.desde.set(d.desde ?? null);
  }

  /** Vibra y hace un pitido corto (si el navegador lo permite) */
  private sonar(): void {
    try {
      navigator.vibrate?.([300, 120, 300, 120, 300]);
    } catch { /* sin vibración */ }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.18, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.2);
      });
      setTimeout(() => void ctx.close(), 1500);
    } catch { /* sin sonido */ }
  }
}
