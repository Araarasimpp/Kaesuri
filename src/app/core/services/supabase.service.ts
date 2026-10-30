import { Injectable, signal } from '@angular/core';
import { createClient, isAuthRetryableFetchError, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/**
 * fetch con límite de tiempo. Cuando el celular deja la app en segundo plano,
 * la conexión queda muerta y, al volver, la petición que renueva la sesión se
 * podía quedar colgada para siempre: todo lo que espera la sesión (incluido el
 * guard que deja ver cada pantalla) esperaba con ella y la app quedaba en blanco.
 * Al cortarla, Supabase la reintenta sola por una conexión nueva.
 * Las subidas de fotos (storage) no tienen límite: con mala señal pueden tardar.
 */
function fetchConLimite(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const limiteMs = url.includes('/auth/v1/') ? 10_000 : url.includes('/rest/v1/') ? 20_000 : 0;
  if (!limiteMs) return fetch(input, init);

  const control = new AbortController();
  const original = init?.signal;
  if (original?.aborted) control.abort(original.reason);
  original?.addEventListener('abort', () => control.abort(original.reason), { once: true });
  const temporizador = setTimeout(() => control.abort(new DOMException('Tiempo de espera agotado', 'TimeoutError')), limiteMs);

  return fetch(input, { ...init, signal: control.signal }).finally(() => clearTimeout(temporizador));
}

export type UserRole = 'admin' | 'vendedor' | 'domiciliario' | 'despachador' | 'venta_local' | 'recolector';

export interface Profile {
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
  /** Rol principal (el de más permisos); lo calcula la base a partir de roles */
  role: UserRole;
  /** Todos los roles de la persona (puede tener varios, por ejemplo vendedor y domiciliario) */
  roles: UserRole[];
  activo: boolean;
  avatar_url?: string | null;
}

/** Áreas de la app, de más permisos a menos: la primera que tenga la persona es donde entra */
export const AREAS: { rol: UserRole; ruta: string; etiqueta: string }[] = [
  { rol: 'admin', ruta: '/admin', etiqueta: 'Administración' },
  { rol: 'despachador', ruta: '/despachador', etiqueta: 'Despacho' },
  { rol: 'vendedor', ruta: '/vendedor', etiqueta: 'Ventas' },
  { rol: 'domiciliario', ruta: '/domiciliario', etiqueta: 'Entregas' },
  { rol: 'venta_local', ruta: '/local', etiqueta: 'Venta local' },
  { rol: 'recolector', ruta: '/recolector', etiqueta: 'Recolector' },
];

export function rolesDe(p: Pick<Profile, 'role' | 'roles'>): UserRole[] {
  return p.roles?.length ? p.roles : [p.role];
}

export function areasDe(p: Pick<Profile, 'role' | 'roles'>): typeof AREAS {
  const roles = rolesDe(p);
  return AREAS.filter((a) => roles.includes(a.rol));
}

/** Pantalla de inicio según los roles */
export function inicioDe(p: Pick<Profile, 'role' | 'roles'>): string {
  return areasDe(p)[0]?.ruta ?? '/auth/login';
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  public client: SupabaseClient;
  private currentProfile: Profile | null = null;
  /** Perfil cargado (para mostrar el nombre y la foto donde haga falta) */
  readonly perfil = signal<Profile | null>(null);

  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        // La sesión se guarda en el dispositivo y se mantiene hasta que el
        // usuario cierre sesión explícitamente (funciona igual en PC y móvil).
        persistSession: true,
        autoRefreshToken: true,
        // Lee la sesión que traen los enlaces del correo (recuperar contraseña,
        // enlace mágico). Sin esto, esos enlaces dejaban a la persona en el login.
        detectSessionInUrl: true,
      },
      global: { fetch: fetchConLimite },
    });
  }

  async login(email: string, password: string) {
    return this.client.auth.signInWithPassword({ email, password });
  }

  async register(email: string, password: string, nombre: string, telefono?: string) {
    return this.client.auth.signUp({
      email,
      password,
      options: { data: { nombre, telefono } },
    });
  }

  /** Vuelve a mandar el correo para confirmar la cuenta (Supabase deja uno por minuto). */
  async reenviarConfirmacion(email: string) {
    return this.client.auth.resend({ type: 'signup', email });
  }

  /** Manda el correo con el enlace para poner una contraseña nueva. */
  async enviarRecuperacion(email: string) {
    return this.client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/' });
  }

  async cambiarClave(password: string) {
    return this.client.auth.updateUser({ password });
  }

  async logout() {
    this.currentProfile = null;
    this.perfil.set(null);
    await this.quitarPushDeEsteDispositivo();
    return this.client.auth.signOut();
  }

  /** Al cerrar sesión, este celular deja de recibir los avisos de esta persona. */
  private async quitarPushDeEsteDispositivo(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator)) return;
      const registro = await navigator.serviceWorker.getRegistration('/');
      const sub = await registro?.pushManager?.getSubscription();
      if (sub) await this.client.from('push_suscripciones').delete().eq('endpoint', sub.endpoint);
    } catch {
      // sin conexión o sin soporte: no impide cerrar sesión
    }
  }


  async getCurrentUser(): Promise<User | null> {
    const { data, error } = await this.client.auth.getUser();
    if (data.user || !error || !isAuthRetryableFetchError(error)) return data.user;

    // Falló la red (típico justo al volver del segundo plano), no es que no
    // haya sesión: un segundo intento va por una conexión nueva.
    const reintento = await this.client.auth.getUser();
    return reintento.data.user;
  }

  async getCurrentProfile(): Promise<Profile | null> {
    if (this.currentProfile) return this.currentProfile;

    const user = await this.getCurrentUser();
    if (!user) return null;

    const { data, error } = await this.client
      .from('profiles')
      .select('id, nombre, email, telefono, role, roles, activo, avatar_url')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error cargando profile:', error.message);
      return null;
    }

    this.currentProfile = data as Profile;
    this.perfil.set(this.currentProfile);
    return this.currentProfile;
  }

  /** Vuelve a leer el perfil (después de cambiar nombre o foto) sin dejar de mostrar el anterior mientras tanto */
  async recargarPerfil(): Promise<Profile | null> {
    this.currentProfile = null;
    return this.getCurrentProfile();
  }

  clearCachedProfile() {
    this.currentProfile = null;
    this.perfil.set(null);
  }
}