import { Injectable, inject } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, from, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { SupabaseService, UserRole, rolesDe } from './services/supabase.service';

/** Páginas de los clientes: no necesitan nada de la parte de adentro de la app */
const PUBLICA = /^\/(tienda|seguimiento|pago)(\/|$)/;
/** Área de la app → rol que la puede abrir */
const AREA_ROL: Record<string, UserRole> = {
  admin: 'admin', despachador: 'despachador', vendedor: 'vendedor', domiciliario: 'domiciliario', local: 'venta_local', recolector: 'recolector',
};

/**
 * Precarga las pantallas para que abran al instante, pero sin estorbar al arrancar (como en Jasta):
 * · espera a que la página cargue y el celular esté libre, y baja una pantalla a la vez;
 * · solo las áreas que la persona puede abrir según sus roles;
 * · nada en el catálogo, seguimiento o pedido de los clientes, ni con ahorro de datos o 2G.
 */
@Injectable({ providedIn: 'root' })
export class PrecargaDiferida implements PreloadingStrategy {
  private sb = inject(SupabaseService);
  private cola: Promise<unknown> = this.listo();

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (PUBLICA.test(location.pathname) || this.ahorroDeDatos()) return of(null);
    const path = route.path ?? '';
    if (/^(tienda|seguimiento|pago)/.test(path)) return of(null);
    return from(this.turno()).pipe(
      mergeMap(() => from(this.puede(path))),
      mergeMap((si) => (si ? load() : of(null))),
    );
  }

  /** Las áreas solo si la persona tiene ese rol; lo demás (pantallas de un área ya cargada, login) sí */
  private async puede(path: string): Promise<boolean> {
    const rol = AREA_ROL[path];
    if (!rol) return true;
    const p = await this.sb.getCurrentProfile().catch(() => null);
    return !!p && rolesDe(p).includes(rol);
  }

  /** Una pantalla a la vez, cada una cuando el celular está libre */
  private turno(): Promise<void> {
    const t = this.cola.then(() => new Promise<void>((ok) => this.libre(ok)));
    this.cola = t;
    return t;
  }

  /** Empieza 3 s después de que la página terminó de cargar */
  private listo(): Promise<void> {
    return new Promise((ok) => {
      const empezar = () => setTimeout(ok, 3000);
      if (document.readyState === 'complete') empezar();
      else window.addEventListener('load', empezar, { once: true });
    });
  }

  private libre(ok: () => void): void {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => ok(), { timeout: 2000 });
    else setTimeout(ok, 200);
  }

  private ahorroDeDatos(): boolean {
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ''));
  }
}
