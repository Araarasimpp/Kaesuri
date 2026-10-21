import { Injectable, signal } from '@angular/core';

/** Mensajes cortos que aparecen abajo y se van solos */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly mensaje = signal<{ texto: string; mal: boolean } | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  ok(texto: string): void {
    this.mostrar(texto, false);
  }

  error(texto: string): void {
    this.mostrar(texto, true);
  }

  private mostrar(texto: string, mal: boolean): void {
    clearTimeout(this.timer);
    this.mensaje.set({ texto, mal });
    this.timer = setTimeout(() => this.mensaje.set(null), mal ? 5000 : 2800);
  }
}
