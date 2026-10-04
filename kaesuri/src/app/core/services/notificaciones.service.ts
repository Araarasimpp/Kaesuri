// src/app/core/services/notificaciones.service.ts
// Avisos dentro de la app para todos los roles. Los crea la base de datos
// (triggers en pedidos y cuadres + un aviso diario de cuadres atrasados), y aquí
// solo se leen, se escuchan en tiempo real y se marcan como leídos.
// Es un servicio único: aunque haya dos campanas en pantalla, comparten datos.
// Los avisos con la app cerrada los manda el push (ver push.service.ts).

import { Injectable, computed, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, UserRole } from './supabase.service';

export interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  enlace: string | null;
  leida: boolean;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  readonly lista = signal<Notificacion[]>([]);
  readonly noLeidas = computed(() => this.lista().filter((n) => !n.leida).length);

  private usuarioId: string | null = null;
  private rol: UserRole | null = null;
  private canal: RealtimeChannel | null = null;
  private iniciando: Promise<void> | null = null;

  constructor(private supabase: SupabaseService) {
    this.supabase.client.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT') this.detener();
    });
  }

  /** Lo llaman las campanas al aparecer. Solo se conecta una vez por sesión. */
  iniciar(): Promise<void> {
    if (!this.iniciando) this.iniciando = this.conectar();
    return this.iniciando;
  }

  private async conectar(): Promise<void> {
    const perfil = await this.supabase.getCurrentProfile();
    if (!perfil) {
      this.iniciando = null;
      return;
    }
    this.usuarioId = perfil.id;
    this.rol = perfil.role;

    const { data } = await this.supabase.client
      .from('notificaciones')
      .select('id, tipo, titulo, mensaje, enlace, leida, created_at')
      .eq('usuario_id', perfil.id)
      .order('created_at', { ascending: false })
      .limit(40);
    this.lista.set((data as Notificacion[]) ?? []);

    this.canal = this.supabase.client
      .channel('notificaciones-' + perfil.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `usuario_id=eq.${perfil.id}` },
        (payload) => {
          const nueva = payload.new as Notificacion;
          this.lista.update((l) => [nueva, ...l.filter((n) => n.id !== nueva.id)].slice(0, 40));
        }
      )
      .subscribe();
  }

  private detener(): void {
    if (this.canal) this.supabase.client.removeChannel(this.canal);
    this.canal = null;
    this.iniciando = null;
    this.usuarioId = null;
    this.rol = null;
    this.lista.set([]);
  }

  async marcarLeida(n: Notificacion): Promise<void> {
    if (n.leida) return;
    this.lista.update((l) => l.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
    await this.supabase.client.from('notificaciones').update({ leida: true }).eq('id', n.id);
  }

  async marcarTodas(): Promise<void> {
    if (!this.usuarioId || !this.noLeidas()) return;
    this.lista.update((l) => l.map((x) => ({ ...x, leida: true })));
    await this.supabase.client
      .from('notificaciones')
      .update({ leida: true })
      .eq('usuario_id', this.usuarioId)
      .eq('leida', false);
  }

  /** Convierte el enlace guardado ("pedidos", "cuadres", "inicio") en la ruta del rol actual. */
  rutaPara(n: Notificacion): string | null {
    const base: Record<UserRole, string> = {
      admin: '/admin',
      despachador: '/despachador',
      vendedor: '/vendedor',
      domiciliario: '/domiciliario',
    };
    if (!this.rol) return null;
    const raiz = base[this.rol];
    if (this.rol === 'vendedor') return raiz;
    if (this.rol === 'domiciliario') return n.enlace === 'cuadres' ? raiz + '/cuadres' : raiz;
    if (n.enlace === 'pedidos' || n.enlace === 'cuadres') return `${raiz}/${n.enlace}`;
    return raiz;
  }
}
