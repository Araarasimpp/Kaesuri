import { Injectable, signal } from '@angular/core';

/*
 * Cuentas de clientes de la tienda (como en Jasta): todavía APAGADAS en Kaesuri.
 * Para prenderlas hay que correr la sección de cuentas de clientes de PENDIENTE_correr_en_supabase.sql
 * (cuentas sin permisos de adentro y lecturas solo para el equipo). Mientras tanto la tienda funciona
 * sin cuenta: perfil siempre vacío y sin tarjetas.
 */
export interface ClienteDireccion { id: number; etiqueta: string; direccion: string; barrio: string; indicaciones: string | null; principal: boolean }
export interface ClienteTarjeta { id: number; marca: string | null; ultimos4: string | null; exp_mes: string | null; exp_anio: string | null }
export interface ConfigTarjeta { public_key: string; terminos: string | null; datos: string | null; activo: boolean }
export interface TarjetaNueva { numero: string; titular: string; mes: string; anio: string; cvc: string }
export interface TokenTarjeta { id: string; brand: string; last_four: string; exp_month: string; exp_year: string; card_holder: string }
export interface ClientePerfil {
  id: number; nombre: string; email: string | null; prefijo: string; telefono: string | null; tipo_doc: string; documento: string | null;
  avatar_url?: string | null; desde: string; direcciones: ClienteDireccion[]; tarjetas?: ClienteTarjeta[]; favoritos?: string[];
}

@Injectable({ providedIn: 'root' })
export class ClienteService {
  /** Cuentas de clientes prendidas */
  readonly activo = false;
  readonly perfil = signal<ClientePerfil | null>(null);
  readonly listo = signal(true);

  async cargar(): Promise<void> { /* apagado */ }
  async configTarjeta(): Promise<ConfigTarjeta | null> { return null; }
  async tokenizar(_t: TarjetaNueva): Promise<TokenTarjeta> { throw new Error('El pago con tarjeta no está disponible.'); }
  async pagarConTarjeta(_b: { codigo: string; cuotas: number; tarjeta_id?: number; token?: string; guardar?: boolean; tarjeta?: Record<string, string> }):
    Promise<{ estado: string; mensaje: string | null; pagado: boolean; guardada?: boolean }> { throw new Error('El pago con tarjeta no está disponible.'); }
  async favorito(_productoId: string, _on: boolean): Promise<string[] | null> { return null; }
  async guardarDatos(_d: { nombre: string; prefijo: string; telefono: string; tipo_doc: string; documento: string }) { return { error: null }; }
  async guardarDireccion(_d: { id: number | null; etiqueta: string; direccion: string; barrio: string; indicaciones: string; principal: boolean }) { return { error: null }; }
}
