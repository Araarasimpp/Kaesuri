import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { environment } from '../../../environments/environment';

export interface ClienteDireccion {
  id: number;
  etiqueta: string;
  direccion: string;
  barrio: string;
  indicaciones: string | null;
  principal: boolean;
}
export interface CompraItem { producto_id: string | null; nombre: string; cantidad: number; precio: number; color: string | null; talla: string | null; imagen_url: string | null; mi_resena?: number | null }
export interface CompraAyuda { motivo: string; mensaje: string | null; estado: string; fecha: string; respuesta?: string | null; resuelta_por?: string | null }
export interface Compra {
  fecha: string;
  codigo: string | null;
  /** Página pública para ver el pedido: /pago/:codigo (tienda) o /seguimiento/:codigo */
  ruta: 'pago' | 'seguimiento';
  pedido: number | null;
  estado: 'por_pagar' | 'por_confirmar' | 'por_alistar' | 'alistado' | 'despachado' | 'entregado' | 'cancelado';
  total: number;
  domicilio: number | null;
  confirmado_at: string | null;
  alistado_at: string | null;
  enviado_at: string | null;
  entregado_at: string | null;
  direccion: string | null;
  barrio: string | null;
  pago: string | null;
  pago_estado: string | null;
  canal: string;
  items: CompraItem[] | null;
  /** Código de seguimiento del pedido (para calificar); null si todavía no está confirmado */
  seguimiento?: string | null;
  /** Estrellas que le dio a la entrega (null si no ha calificado) */
  calif?: number | null;
  /** WhatsApp de la vendedora del pedido (o de la tienda) */
  whatsapp?: string | null;
  ayudas?: CompraAyuda[];
}
export interface ClienteTarjeta { id: number; marca: string | null; ultimos4: string | null; exp_mes: string | null; exp_anio: string | null }
export interface ConfigTarjeta { public_key: string; terminos: string | null; datos: string | null; activo: boolean }
export interface TarjetaNueva { numero: string; titular: string; mes: string; anio: string; cvc: string }
export interface TokenTarjeta { id: string; brand: string; last_four: string; exp_month: string; exp_year: string; card_holder: string }

export interface ClientePerfil {
  id: number;
  nombre: string;
  email: string | null;
  prefijo: string;
  telefono: string | null;
  tipo_doc: string;
  documento: string | null;
  avatar_url?: string | null;
  desde: string;
  direcciones: ClienteDireccion[];
  tarjetas?: ClienteTarjeta[];
  /** Ids de los productos favoritos (el corazón), los más recientes primero */
  favoritos?: string[];
}
export interface Favorito { id: string; nombre: string; precio: number; imagen_url: string | null; agotado: boolean }

/**
 * Cuenta del cliente de la tienda (como en las tiendas en línea): sus datos y sus direcciones.
 * Los clientes no son del equipo: no tienen fila en usuarios y no ven nada de adentro.
 */
@Injectable({ providedIn: 'root' })
export class ClienteService {
  private sb = inject(SupabaseService);
  /**
   * Cuentas de clientes prendidas. En Kaesuri quedan APAGADAS hasta correr la sección 17 de
   * PENDIENTE_correr_en_supabase.sql (registro de clientes sin permisos de adentro y lecturas solo
   * para el equipo). Apagadas: la tienda funciona sin cuenta y /tienda/cuenta no deja registrarse.
   */
  readonly activo = false;
  /** Sesión actual (la de Supabase Auth) */
  readonly sesion = signal<Session | null>(null);
  private lista!: Promise<void>;
  readonly perfil = signal<ClientePerfil | null>(null);
  /** Ya se sabe si hay cliente o no */
  readonly listo = signal(false);
  private consulta = 0;

  constructor() {
    this.lista = this.sb.client.auth.getSession().then(({ data }) => this.sesion.set(data.session)).catch(() => undefined);
    this.sb.client.auth.onAuthStateChange((_e, s) => this.sesion.set(s));
    // Cada vez que cambia la sesión (entra, sale o cambia de cuenta) se vuelve a leer el perfil
    effect(() => {
      const uid = this.activo ? this.sesion()?.user.id ?? null : null;
      untracked(() => void this.cargar(uid));
    });
  }

  private destino(ruta: string): string {
    return new URL(ruta, location.origin).href;
  }

  /** Espera a saber si hay sesión */
  asegurar(): Promise<void> {
    return this.lista;
  }

  async cargar(uid = this.sesion()?.user.id ?? null): Promise<void> {
    const n = ++this.consulta;
    if (!uid) {
      this.perfil.set(null);
      this.listo.set(true);
      return;
    }
    const { data, error } = await this.sb.client.rpc('cliente_yo');
    if (n !== this.consulta) return;
    if (!error) this.perfil.set((data as ClientePerfil | null) ?? null);
    this.listo.set(true);
  }

  registrar(d: { nombre: string; email: string; password: string; prefijo: string; telefono: string }, captchaToken?: string) {
    return this.sb.client.auth.signUp({
      email: d.email.trim().toLowerCase(),
      password: d.password,
      options: {
        data: { tipo: 'cliente', nombre: d.nombre.trim(), prefijo: d.prefijo, telefono: d.telefono },
        emailRedirectTo: this.destino('/tienda/cuenta'),
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
  }

  reenviarConfirmacion(email: string, captchaToken?: string) {
    return this.sb.client.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: this.destino('/tienda/cuenta'), ...(captchaToken ? { captchaToken } : {}) },
    });
  }

  /** Código de 6 números del correo (si la plantilla del correo lo trae) */
  verificarCodigo(email: string, token: string, tipo: 'signup' | 'recovery') {
    return this.sb.client.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: tipo });
  }

  entrar(email: string, password: string, captchaToken?: string) {
    return this.sb.client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password, ...(captchaToken ? { options: { captchaToken } } : {}) });
  }

  recuperar(email: string, captchaToken?: string) {
    return this.sb.client.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: this.destino('/tienda/cuenta?nueva=1'),
      ...(captchaToken ? { captchaToken } : {}),
    });
  }

  cambiarClave(password: string) {
    return this.sb.client.auth.updateUser({ password });
  }

  async guardarDatos(d: { nombre: string; prefijo: string; telefono: string; tipo_doc: string; documento: string }) {
    const r = await this.sb.client.rpc('cliente_guardar', {
      p_nombre: d.nombre, p_prefijo: d.prefijo, p_telefono: d.telefono, p_tipo_doc: d.tipo_doc, p_documento: d.documento,
    });
    if (!r.error) this.perfil.set(r.data as ClientePerfil);
    return r;
  }

  async guardarDireccion(d: { id: number | null; etiqueta: string; direccion: string; barrio: string; indicaciones: string; principal: boolean }) {
    const r = await this.sb.client.rpc('cliente_guardar_direccion', {
      p_id: d.id, p_etiqueta: d.etiqueta, p_direccion: d.direccion, p_barrio: d.barrio, p_indicaciones: d.indicaciones, p_principal: d.principal,
    });
    if (!r.error) this.perfil.set(r.data as ClientePerfil);
    return r;
  }

  async quitarDireccion(id: number) {
    const r = await this.sb.client.rpc('cliente_quitar_direccion', { p_id: id });
    if (!r.error) this.perfil.set(r.data as ClientePerfil);
    return r;
  }

  /** Sus compras (las más recientes primero) */
  async compras(): Promise<Compra[]> {
    const { data, error } = await this.sb.client.rpc('cliente_compras');
    if (error) throw error;
    return (data as Compra[]) ?? [];
  }

  /** Calificar la compra: la entrega (una vez) y cada producto (se puede cambiar) */
  async calificar(c: Compra, entrega: { estrellas: number; comentario: string } | null, productos: { producto_id: string; estrellas: number; comentario: string }[]): Promise<void> {
    if (!c.seguimiento) throw new Error('Este pedido todavía no se puede calificar');
    if (entrega && !c.calif) {
      const r = await this.sb.client.rpc('calificar_entrega', { p_codigo: c.seguimiento, p_estrellas: entrega.estrellas, p_comentario: entrega.comentario });
      if (r.error && !/ya calificaste/i.test(r.error.message)) throw r.error;
    }
    if (productos.length) {
      const r = await this.sb.client.rpc('calificar_productos', { p_codigo: c.seguimiento, p_resenas: productos });
      if (r.error) throw r.error;
    }
  }

  /** Pedir ayuda con un pedido: le llega al equipo (admin y la vendedora) */
  async pedirAyuda(c: Compra, motivo: string, mensaje: string): Promise<void> {
    const { error } = await this.sb.client.rpc('cliente_pedir_ayuda', { p_codigo: c.codigo, p_ruta: c.ruta, p_motivo: motivo, p_mensaje: mensaje });
    if (error) throw error;
  }

  /** Volver a comprar: deja los productos listos para que la tienda los ponga en el carrito */
  volverAComprar(c: Compra): void {
    const items = (c.items ?? []).filter((i) => i.producto_id).map((i) => ({ producto_id: i.producto_id!, cantidad: i.cantidad, color: i.color, talla: i.talla }));
    try { sessionStorage.setItem('tienda-repetir', JSON.stringify({ items })); } catch { /* sin almacenamiento */ }
  }

  // ---------------------------------------------------------------- Tarjetas (Wompi)
  private config?: Promise<ConfigTarjeta | null>;
  /** Llave pública de Wompi y si el pago con tarjeta está activo (se pide una vez) */
  configTarjeta(): Promise<ConfigTarjeta | null> {
    // El pago con tarjeta (Wompi) todavía no está en Kaesuri: no hay llaves
    this.config ??= Promise.resolve(null);
    return this.config;
  }

  /** El número de la tarjeta va directo del celular a Wompi; a Variedades JYB solo llega el token */
  async tokenizar(t: TarjetaNueva): Promise<TokenTarjeta> {
    const cfg = await this.configTarjeta();
    if (!cfg?.public_key) throw new Error('El pago con tarjeta no está disponible ahora.');
    const r = await fetch('https://production.wompi.co/v1/tokens/cards', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.public_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: t.numero.replace(/\D/g, ''), cvc: t.cvc, exp_month: t.mes.padStart(2, '0'), exp_year: t.anio.slice(-2), card_holder: t.titular.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.status !== 'CREATED' || !j?.data?.id) throw new Error('Revisa los datos de la tarjeta (número, vencimiento y código de seguridad).');
    return j.data as TokenTarjeta;
  }

  async pagarConTarjeta(b: { codigo: string; cuotas: number; tarjeta_id?: number; token?: string; guardar?: boolean; tarjeta?: Record<string, string> }) {
    const { data, error } = await this.sb.client.functions.invoke('wompi-tarjeta', { body: { accion: 'pagar', ...b } });
    if (error) {
      // El cuerpo del error trae el mensaje para el cliente
      let msg = 'No se pudo hacer el cobro. Intenta otra vez.';
      try { msg = (await (error as { context?: Response }).context?.json())?.error ?? msg; } catch { /* sin cuerpo */ }
      throw new Error(msg);
    }
    return data as { estado: string; mensaje: string | null; pagado: boolean; guardada?: boolean };
  }

  async quitarTarjeta(id: number) {
    const r = await this.sb.client.rpc('cliente_quitar_tarjeta', { p_id: id });
    if (!r.error) this.perfil.set(r.data as ClientePerfil);
    return r;
  }

  // ---------------------------------------------------------------- Foto de perfil
  /** Sube la foto (ya recortada) a su carpeta y la deja en su cuenta */
  async subirFoto(blob: Blob): Promise<void> {
    const uid = this.sesion()?.user.id;
    if (!uid) throw new Error('Inicia sesión otra vez');
    const ruta = `${uid}/foto-${Date.now()}.jpg`;
    const { error } = await this.sb.client.storage.from('avatars').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    const url = this.sb.client.storage.from('avatars').getPublicUrl(ruta).data.publicUrl;
    await this.ponerFoto(url);
  }

  async ponerFoto(url: string | null): Promise<void> {
    const r = await this.sb.client.rpc('cliente_foto', { p_url: url });
    if (r.error) throw r.error;
    this.perfil.set(r.data as ClientePerfil);
  }

  // ---------------------------------------------------------------- Google
  private google?: Promise<boolean>;
  /** ¿Está activado "Continuar con Google" en Supabase? (Authentication → Providers → Google) */
  googleDisponible(): Promise<boolean> {
    this.google ??= fetch(`${environment.supabaseUrl}/auth/v1/settings`, { headers: { apikey: environment.supabaseKey } })
      .then((r) => r.json())
      .then((j) => !!j?.external?.google)
      .catch(() => false);
    return this.google;
  }

  /** Va a Google y vuelve a Mi cuenta ya con la sesión (si es nuevo, se crea su cuenta de cliente) */
  entrarConGoogle(volver: string | null) {
    const destino = new URL('/tienda/cuenta', location.origin);
    if (volver) destino.searchParams.set('volver', volver);
    return this.sb.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: destino.href, queryParams: { prompt: 'select_account' } } });
  }

  // ---------------------------------------------------------------- Favoritos
  /** Marca o desmarca un favorito en la cuenta; devuelve la lista de ids */
  async favorito(productoId: string, on: boolean): Promise<string[] | null> {
    const { data, error } = await this.sb.client.rpc('cliente_favorito', { p_producto: productoId, p_on: on });
    if (error) return null;
    const ids = ((data as unknown[]) ?? []).map(String);
    const p = this.perfil();
    if (p) this.perfil.set({ ...p, favoritos: ids });
    return ids;
  }

  async misFavoritos(): Promise<Favorito[]> {
    const { data } = await this.sb.client.rpc('cliente_favoritos');
    return (data as Favorito[]) ?? [];
  }

  async salir(): Promise<void> {
    await this.sb.client.auth.signOut();
    this.perfil.set(null);
  }
}
