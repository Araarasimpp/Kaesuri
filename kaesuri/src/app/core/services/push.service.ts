// src/app/core/services/push.service.ts
// Avisos push: llegan al celular o PC aunque la app esté cerrada.
//
// - Android / PC (Chrome, Edge, Firefox): funcionan en el navegador y en la app instalada.
// - iPhone / iPad: solo con la app INSTALADA en la pantalla de inicio (iOS 16.4 o superior).
//
// El envío lo hace la Edge Function "enviar-push" de Supabase cada vez que se crea
// un aviso en la tabla notificaciones.

import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { VAPID_PUBLIC_KEY } from '../push-config';

export type EstadoPush = 'cargando' | 'no-soportado' | 'ios-instalar' | 'bloqueado' | 'inactivo' | 'activo';

@Injectable({ providedIn: 'root' })
export class PushService {
  readonly estado = signal<EstadoPush>('cargando');
  readonly trabajando = signal(false);

  constructor(private supabase: SupabaseService) {
    this.revisar();
  }

  static esIOS(): boolean {
    const ua = navigator.userAgent;
    return /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  }

  static instalada(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  }

  async revisar(): Promise<void> {
    const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!soporta) {
      this.estado.set(PushService.esIOS() && !PushService.instalada() ? 'ios-instalar' : 'no-soportado');
      return;
    }
    if (Notification.permission === 'denied') {
      this.estado.set('bloqueado');
      return;
    }
    const registro = await navigator.serviceWorker.getRegistration('/');
    const sub = await registro?.pushManager.getSubscription();
    this.estado.set(sub && Notification.permission === 'granted' ? 'activo' : 'inactivo');
    // Si ya estaba activa, se vuelve a guardar por si el navegador renovó la suscripción.
    if (sub && Notification.permission === 'granted') this.guardar(sub);
  }

  /** Debe llamarse desde un toque del usuario (iPhone lo exige). */
  async activar(): Promise<void> {
    if (this.trabajando()) return;
    this.trabajando.set(true);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        this.estado.set(permiso === 'denied' ? 'bloqueado' : 'inactivo');
        return;
      }
      const registro = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw-push.js'));
      await navigator.serviceWorker.ready;
      let sub = await registro.pushManager.getSubscription();
      if (!sub) {
        sub = await registro.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.claveBinaria(VAPID_PUBLIC_KEY) as BufferSource,
        });
      }
      await this.guardar(sub);
      this.estado.set('activo');
    } catch (e) {
      console.error('No se pudo activar el push', e);
      this.estado.set('inactivo');
    } finally {
      this.trabajando.set(false);
    }
  }

  async desactivar(): Promise<void> {
    this.trabajando.set(true);
    try {
      const registro = await navigator.serviceWorker.getRegistration('/');
      const sub = await registro?.pushManager.getSubscription();
      if (sub) {
        await this.supabase.client.from('push_suscripciones').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      this.estado.set('inactivo');
    } finally {
      this.trabajando.set(false);
    }
  }

  private async guardar(sub: PushSubscription): Promise<void> {
    const json = sub.toJSON();
    await this.supabase.client.rpc('guardar_suscripcion_push', {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.['p256dh'] ?? '',
      p_auth: json.keys?.['auth'] ?? '',
      p_user_agent: navigator.userAgent.slice(0, 300),
    });
  }

  private claveBinaria(base64url: string): Uint8Array {
    const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
    const b64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const salida = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) salida[i] = bin.charCodeAt(i);
    return salida;
  }
}
