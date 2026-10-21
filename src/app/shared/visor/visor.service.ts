import { Injectable, signal } from '@angular/core';

export interface FotoVisor {
  url: string;
  titulo?: string;
}

/** Visor de fotos de la app: se abre desde cualquier pantalla sin salir de Jasta */
@Injectable({ providedIn: 'root' })
export class VisorService {
  readonly fotos = signal<FotoVisor[]>([]);
  readonly indice = signal(0);

  abrir(fotos: (FotoVisor | string | null | undefined)[], indice = 0): void {
    const lista = fotos
      .filter((f): f is FotoVisor | string => !!f)
      .map((f) => (typeof f === 'string' ? { url: f } : f))
      .filter((f) => !!f.url);
    if (!lista.length) return;
    this.fotos.set(lista);
    this.indice.set(Math.min(Math.max(indice, 0), lista.length - 1));
  }

  cerrar(): void {
    this.fotos.set([]);
  }
}
