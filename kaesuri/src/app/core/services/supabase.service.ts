import { Injectable } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

export type UserRole = 'admin' | 'vendedor' | 'domiciliario';

export interface Profile {
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
  role: UserRole;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  public client: SupabaseClient;
  private currentProfile: Profile | null = null;

  constructor() {
    this.client = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        // La sesión se guarda en el dispositivo y se mantiene hasta que el
        // usuario cierre sesión explícitamente (funciona igual en PC y móvil).
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
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

  async logout() {
    this.currentProfile = null;
    return this.client.auth.signOut();
  }

  async getCurrentUser(): Promise<User | null> {
    const { data } = await this.client.auth.getUser();
    return data.user;
  }

  async getCurrentProfile(): Promise<Profile | null> {
    if (this.currentProfile) return this.currentProfile;

    const user = await this.getCurrentUser();
    if (!user) return null;

    const { data, error } = await this.client
      .from('profiles')
      .select('id, nombre, email, telefono, role')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error cargando profile:', error.message);
      return null;
    }

    this.currentProfile = data as Profile;
    return this.currentProfile;
  }

  clearCachedProfile() {
    this.currentProfile = null;
  }
}