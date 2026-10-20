import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { SupabaseService } from './supabase.service';
import { MetodoPago } from '../../shared/models/models';

/** Pedido en ruta de Jasta (otra base: los ids son números) */
export interface PedidoJasta {
  id: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string | null;
  barrio: string | null;
  valor_domicilio: number;
  total: number;
  observaciones: string | null;
  asignado_at: string | null;
  vendedora: string | null;
  items: { nombre: string; cantidad: number; color: string | null; talla: string | null; total: number }[];
}

/** Pedido de Jasta que ya entregó y todavía no está en un cuadre confirmado */
export interface EntregadoJasta {
  id: number;
  cliente_nombre: string;
  barrio: string | null;
  total: number;
  valor_domicilio: number;
  tipo_recaudo: MetodoPago | null;
  efectivo: number;
  transferencia: number;
  entregado_at: string;
  cuadre: 'por_cuadrar' | 'por_confirmar' | 'cuadrado';
}

export interface ResumenJasta {
  vinculado: boolean;
  /** Canal de avisos en vivo de Jasta para este domiciliario */
  canal?: string;
  en_ruta?: PedidoJasta[];
  por_cuadrar?: { pedidos: number; efectivo: number; transferencia: number; domicilios: number; desde: string | null };
  por_confirmar?: { id: number; cerrado_at: string; cantidad_pedidos: number; total_a_entregar: number }[];
}

/**
 * Pedidos de Jasta para el domiciliario que también reparte allá (como mensajero).
 * Se reconoce por el correo con el que entra a las dos apps; los cuadres siguen separados.
 * Es el espejo de lo que hace Jasta con los pedidos de Variedades JYB.
 */
@Injectable({ providedIn: 'root' })
export class JastaService {
  /** Conexión a Jasta solo para recibir avisos en vivo (sin sesión: los datos llegan por la función) */
  private avisos?: SupabaseClient;

  constructor(private supabase: SupabaseService) {}

  private async llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
    const { data } = await this.supabase.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Tu sesión se cerró, vuelve a entrar');
    const r = await fetch(environment.jastaPuenteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(cuerpo),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error || 'Jasta no responde, intenta de nuevo');
    return json as T;
  }

  resumen(): Promise<ResumenJasta> {
    return this.llamar<ResumenJasta>({ accion: 'resumen' });
  }

  /** comprobantes: rutas en el bucket de comprobantes de Kaesuri; la función las copia a Jasta */
  async entregar(pedidoId: number, tipo: MetodoPago, efectivo: number, transferencia: number, comprobantes: string[]): Promise<void> {
    await this.llamar({ accion: 'entregar', pedido_id: pedidoId, tipo, efectivo, transferencia, comprobantes });
  }

  async cerrarCuadre(): Promise<void> {
    await this.llamar({ accion: 'cerrar_cuadre' });
  }

  entregadas(desde: string | null, hasta: string | null): Promise<EntregadoJasta[]> {
    return this.llamar<EntregadoJasta[]>({ accion: 'entregadas', desde, hasta });
  }

  /** Avisa cada vez que cambia un pedido o un cuadre de este domiciliario en Jasta */
  escuchar(canal: string, cb: () => void): () => void {
    this.avisos ??= createClient(environment.jastaUrl, environment.jastaKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'jasta-avisos' },
    });
    const c = this.avisos.channel(canal).on('broadcast', { event: 'cambio' }, () => cb()).subscribe();
    return () => void this.avisos?.removeChannel(c);
  }
}
