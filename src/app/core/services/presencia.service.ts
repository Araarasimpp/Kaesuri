// src/app/core/services/presencia.service.ts
// Estado de cada persona, como en Discord: activo, ausente o desconectado.
// · Va por Realtime Presence (canal "presencia"): cada app abierta dice cómo está
//   y todas ven a todas. Al cerrar la app (o perder internet) se sale sola.
// · Ausente: la app quedó en segundo plano o lleva 5 minutos sin que la toquen.
//   También se puede elegir a mano en el menú de la cuenta (ausente o invisible).
// · Desconectado: no tiene la app abierta. Para "visto hace…" se guarda la última
//   vez que estuvo (tabla conexiones), a lo sumo cada 2 minutos.

import { Injectable, computed, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export type Estado = 'activo' | 'ausente' | 'desconectado';
/** Lo que la persona elige: automático, ausente o invisible (se ve desconectado) */
export type Preferencia = 'auto' | 'ausente' | 'invisible';

const INACTIVO_MS = 5 * 60 * 1000;
const CLAVE_PREF = 'jyb-estado';

@Injectable({ providedIn: 'root' })
export class PresenciaService {
  /** Estado en vivo de cada persona conectada (id → estado) */
  private readonly enLinea = signal<Map<string, Exclude<Estado, 'desconectado'>>>(new Map());
  /** Última vez vista (de la tabla conexiones), para quien está desconectado */
  private readonly vistos = signal<Map<string, string>>(new Map());
  readonly preferencia = signal<Preferencia>(this.leerPref());
  private readonly inactivo = signal(false);
  private readonly oculto = signal(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  /** Mi estado tal como lo ven los demás */
  readonly miEstado = computed<Estado>(() => {
    const p = this.preferencia();
    if (p === 'invisible') return 'desconectado';
    if (p === 'ausente' || this.inactivo() || this.oculto()) return 'ausente';
    return 'activo';
  });

  private yo: string | null = null;
  private canal: RealtimeChannel | null = null;
  private iniciando: Promise<void> | null = null;
  private timerInactivo?: ReturnType<typeof setTimeout>;
  private ultimaMarca = 0;
  private ultimoTrack = '';

  constructor(private sb: SupabaseService) {
    // Arranca solo al haber sesión (fuera del aviso de Auth: llamar a Supabase ahí adentro lo traba)
    this.sb.client.auth.onAuthStateChange((evento, sesion) => {
      if (evento === 'SIGNED_OUT') this.detener();
      else if (sesion) setTimeout(() => void this.iniciar());
    });
  }

  /** Solo se conecta una vez por sesión. */
  iniciar(): Promise<void> {
    if (!this.iniciando) this.iniciando = this.conectar();
    return this.iniciando;
  }

  estado(id: string | null | undefined): Estado {
    if (!id) return 'desconectado';
    if (id === this.yo) return this.miEstado();
    return this.enLinea().get(id) ?? 'desconectado';
  }

  /** "Activo", "Ausente" o "Desconectado · visto hace 2 h" */
  texto(id: string | null | undefined): string {
    const e = this.estado(id);
    if (e === 'activo') return 'Activo';
    if (e === 'ausente') return 'Ausente';
    const visto = id ? this.vistos().get(id) : undefined;
    return visto ? 'Desconectado · ' + haceCuanto(visto) : 'Desconectado';
  }

  /** Trae "visto por última vez" de estas personas (para mostrarlo cuando están desconectadas) */
  async cargarVistos(ids: (string | null | undefined)[]): Promise<void> {
    const faltan = [...new Set(ids.filter((x): x is string => !!x))];
    if (!faltan.length) return;
    const { data } = await this.sb.client.from('conexiones').select('usuario_id, visto_at').in('usuario_id', faltan);
    if (!data?.length) return;
    this.vistos.update((m) => {
      const n = new Map(m);
      for (const f of data as { usuario_id: string; visto_at: string }[]) n.set(f.usuario_id, f.visto_at);
      return n;
    });
  }

  elegir(p: Preferencia): void {
    this.preferencia.set(p);
    try {
      localStorage.setItem(CLAVE_PREF, p);
    } catch {
      /* sin almacenamiento */
    }
    void this.publicar();
  }

  private async conectar(): Promise<void> {
    const perfil = await this.sb.getCurrentProfile();
    if (!perfil) {
      this.iniciando = null;
      return;
    }
    this.yo = perfil.id;
    this.canal = this.sb.client.channel('presencia', { config: { presence: { key: perfil.id } } });
    this.canal
      .on('presence', { event: 'sync' }, () => this.leerCanal())
      .subscribe((estado) => {
        if (estado === 'SUBSCRIBED') {
          this.ultimoTrack = '';
          void this.publicar();
        }
      });

    for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
      window.addEventListener(ev, this.actividad, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', this.cambioVista);
    this.actividad();
  }

  private detener(): void {
    if (this.canal) this.sb.client.removeChannel(this.canal);
    this.canal = null;
    this.iniciando = null;
    this.yo = null;
    this.enLinea.set(new Map());
    clearTimeout(this.timerInactivo);
    for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
      window.removeEventListener(ev, this.actividad, { capture: true });
    }
    document.removeEventListener('visibilitychange', this.cambioVista);
  }

  /** Junta lo que dicen todas las apps abiertas (una persona puede tener varias: gana "activo") */
  private leerCanal(): void {
    if (!this.canal) return;
    const estado = this.canal.presenceState<{ estado: Estado }>();
    const m = new Map<string, Exclude<Estado, 'desconectado'>>();
    for (const [id, metas] of Object.entries(estado)) {
      const lista = metas.map((x) => x.estado);
      if (lista.includes('activo')) m.set(id, 'activo');
      else if (lista.includes('ausente')) m.set(id, 'ausente');
    }
    this.enLinea.set(m);
  }

  private actividad = (): void => {
    if (this.inactivo()) {
      this.inactivo.set(false);
      void this.publicar();
    }
    clearTimeout(this.timerInactivo);
    this.timerInactivo = setTimeout(() => {
      this.inactivo.set(true);
      void this.publicar();
    }, INACTIVO_MS);
    this.marcarVisto();
  };

  private cambioVista = (): void => {
    this.oculto.set(document.visibilityState === 'hidden');
    if (!this.oculto()) this.actividad();
    else this.marcarVisto(true);
    void this.publicar();
  };

  /** Le dice a los demás mi estado (invisible = no aparecer en el canal) */
  private async publicar(): Promise<void> {
    if (!this.canal) return;
    const e = this.miEstado();
    if (e === this.ultimoTrack) return;
    this.ultimoTrack = e;
    if (e === 'desconectado') await this.canal.untrack();
    else await this.canal.track({ estado: e });
  }

  private marcarVisto(ya = false): void {
    if (!this.yo || this.preferencia() === 'invisible') return;
    if (!ya && Date.now() - this.ultimaMarca < 120000) return;
    this.ultimaMarca = Date.now();
    void this.sb.client.rpc('marcar_conexion').then();
  }

  private leerPref(): Preferencia {
    try {
      const v = localStorage.getItem(CLAVE_PREF);
      return v === 'ausente' || v === 'invisible' ? v : 'auto';
    } catch {
      return 'auto';
    }
  }
}

/** "visto hace 5 min", "visto hace 3 h", "visto ayer", "visto el 12 de oct." */
export function haceCuanto(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'visto hace un momento';
  if (min < 60) return `visto hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `visto hace ${h} h`;
  if (h < 48) return 'visto ayer';
  return 'visto el ' + new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
}
