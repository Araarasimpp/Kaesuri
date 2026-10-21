// src/app/core/services/notificaciones.service.ts
// Avisos dentro de la app para todos los roles. Los crea la base de datos
// (triggers en pedidos y cuadres + un aviso diario de cuadres atrasados), y aquí
// solo se leen, se escuchan en tiempo real y se marcan como leídos.
// Es un servicio único: aunque haya dos campanas en pantalla, comparten datos.
// Los avisos con la app cerrada los manda el push (ver push.service.ts).

import { Injectable, computed, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, UserRole, rolesDe } from './supabase.service';

export interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string | null;
  enlace: string | null;
  leida: boolean;
  created_at: string;
  /** Pedido del aviso (los de mensajes del chat lo traen) */
  pedido_id?: string | null;
}

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  readonly lista = signal<Notificacion[]>([]);
  readonly noLeidas = computed(() => this.lista().filter((n) => !n.leida).length);
  /** Pedidos con mensajes del chat sin leer (para el "!" en las tarjetas) */
  readonly pedidosConMensajes = computed(
    () => new Set(this.lista().filter((n) => !n.leida && n.tipo === 'mensaje' && n.pedido_id).map((n) => n.pedido_id!))
  );

  private usuarioId: string | null = null;
  private roles: UserRole[] = [];
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
    this.roles = rolesDe(perfil);

    const { data } = await this.supabase.client
      .from('notificaciones')
      .select('id, tipo, titulo, mensaje, enlace, leida, created_at, pedido_id')
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
    this.roles = [];
    this.lista.set([]);
  }

  async marcarLeida(n: Notificacion): Promise<void> {
    if (n.leida) return;
    this.lista.update((l) => l.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
    await this.supabase.client.from('notificaciones').update({ leida: true }).eq('id', n.id);
  }

  /** Al abrir el chat de un pedido, sus avisos de mensaje quedan leídos */
  async marcarMensajesLeidos(pedidoId: string): Promise<void> {
    if (!this.usuarioId || !this.lista().some((n) => !n.leida && n.tipo === 'mensaje' && n.pedido_id === pedidoId)) return;
    this.lista.update((l) => l.map((x) => (x.tipo === 'mensaje' && x.pedido_id === pedidoId ? { ...x, leida: true } : x)));
    await this.supabase.client
      .from('notificaciones')
      .update({ leida: true })
      .eq('usuario_id', this.usuarioId)
      .eq('tipo', 'mensaje')
      .eq('pedido_id', pedidoId);
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

  /**
   * Convierte el enlace guardado ("pedidos", "cuadres", "inicio") en una ruta.
   * Con varios roles se usa el área donde está la persona; si no, la de su rol principal.
   */
  rutaPara(n: Notificacion): string | null {
    const base: Record<UserRole, string> = {
      admin: '/admin',
      despachador: '/despachador',
      vendedor: '/vendedor',
      domiciliario: '/domiciliario',
      venta_local: '/local',
    };
    const aqui = (Object.keys(base) as UserRole[]).find((r) => base[r] === '/' + location.pathname.split('/')[1]);
    const rol = aqui && this.roles.includes(aqui) ? aqui : (Object.keys(base) as UserRole[]).find((r) => this.roles.includes(r));
    if (!rol) return null;
    const raiz = base[rol];
    // Mensaje del chat: abre el chat de ese pedido en la pantalla de pedidos del área
    if (n.enlace?.startsWith('chat:')) {
      const lista = rol === 'admin' || rol === 'despachador' ? raiz + '/pedidos' : raiz;
      return `${lista}?chat=${n.enlace.slice(5)}`;
    }
    if (rol === 'vendedor') return raiz;
    if (rol === 'domiciliario') return n.enlace === 'cuadres' ? raiz + '/cuadres' : raiz;
    if (n.enlace === 'pedidos' || n.enlace === 'cuadres') return `${raiz}/${n.enlace}`;
    return raiz;
  }
}
