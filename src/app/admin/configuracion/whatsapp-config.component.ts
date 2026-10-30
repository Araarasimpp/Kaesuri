import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';

interface WaConfig {
  phone_number_id: string | null;
  token_guardado: boolean;
  plantilla: string;
  idioma: string;
  app_url: string | null;
  activo: boolean;
}
interface WaEnvio {
  fecha: string;
  numero: number | null;
  tipo: string;
  telefono: string;
  codigo: number | null;
  error: string | null;
}

/**
 * Configuración → Seguimiento automático por WhatsApp (como en Jasta): cuando un pedido sale en
 * ruta por primera vez, al cliente le llega la plantilla de Meta con el enlace de seguimiento.
 */
@Component({
  selector: 'app-whatsapp-config',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule],
  styles: [
    `
      :host { display: block; }
      h2 { margin: 0 0 4px; font-size: 17px; }
      .ayuda { margin: 0; font-size: 13.5px; color: var(--text-soft); line-height: 1.45; }
      .wa-campos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; margin-top: 10px; }
      .wa-check { display: flex; gap: 8px; align-items: center; margin: 6px 0 12px; font-size: 14px; }
      .wa-acciones { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .wa-acciones input { width: 190px; }
      .wa-envios { width: 100%; margin-top: 14px; border-collapse: collapse; font-size: 13px; }
      .wa-envios th { text-align: left; font-size: 11.5px; color: var(--text-muted); font-weight: 650; padding: 6px 4px; border-bottom: 1px solid var(--border); }
      .wa-envios td { padding: 7px 4px; border-bottom: 1px solid var(--border-soft, var(--border)); }
      .wa-envios td.mal { color: var(--danger); }
      @media (max-width: 640px) { .wa-campos { grid-template-columns: 1fr; } }
    `,
  ],
  template: `
    <h2>Seguimiento automático por WhatsApp</h2>
    <p class="ayuda">Cuando un pedido sale en ruta por primera vez, al cliente le llega por WhatsApp (API oficial de Meta) el enlace para ver en qué va su pedido.
      Una sola vez por pedido y solo a celulares colombianos. Meta cobra cada mensaje (categoría Utilidad).</p>
    @if (wa(); as w) {
      <div class="wa-campos">
        <div class="campo"><label for="wa-id">Phone number ID</label><input id="wa-id" [(ngModel)]="f.phone_number_id" placeholder="Ej: 123456789012345" /></div>
        <div class="campo"><label for="wa-tk">Token de acceso permanente</label>
          <input id="wa-tk" type="password" autocomplete="off" [(ngModel)]="f.token" [placeholder]="w.token_guardado ? 'Guardado · escribe uno nuevo para cambiarlo' : 'Pega el token de Meta'" /></div>
        <div class="campo"><label for="wa-pl">Nombre de la plantilla</label><input id="wa-pl" [(ngModel)]="f.plantilla" /></div>
        <div class="campo"><label for="wa-id2">Idioma de la plantilla</label><input id="wa-id2" [(ngModel)]="f.idioma" placeholder="es" /></div>
        <div class="campo"><label for="wa-url">Dirección de la app</label><input id="wa-url" [(ngModel)]="f.app_url" placeholder="https://…" /></div>
      </div>
      <label class="wa-check"><input type="checkbox" [(ngModel)]="f.activo" /> Mandar el enlace automáticamente cuando el pedido sale en ruta</label>
      <div class="wa-acciones">
        <button class="b b-pri" (click)="guardar()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Guardar' }}</button>
        <input [(ngModel)]="prueba" inputmode="tel" placeholder="Celular para probar" aria-label="Celular para la prueba" />
        <button class="b" (click)="probar()" [disabled]="ocupado() || !w.token_guardado">Enviar prueba</button>
      </div>
      @if (envios().length) {
        <table class="wa-envios">
          <thead><tr><th>Cuándo</th><th>Pedido</th><th>Celular</th><th>Resultado</th></tr></thead>
          <tbody>
            @for (e of envios(); track $index) {
              <tr>
                <td>{{ cuando(e.fecha) }}</td><td>{{ e.numero ? '#' + e.numero : 'Prueba' }}</td><td>{{ e.telefono }}</td>
                <td [class.mal]="!!e.error">{{ e.error ? e.error : e.codigo ? (e.codigo < 300 ? 'Enviado' : 'Error ' + e.codigo) : 'Enviando…' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    } @else {
      <p class="ayuda" style="margin-top: 10px">{{ error() || 'Cargando…' }}</p>
    }
  `,
})
export class WhatsappConfigComponent implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  wa = signal<WaConfig | null>(null);
  envios = signal<WaEnvio[]>([]);
  ocupado = signal(false);
  error = signal('');
  f = { phone_number_id: '', token: '', plantilla: 'seguimiento_pedido', idioma: 'es', app_url: '', activo: false };
  prueba = '';

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const [c, e] = await Promise.all([this.sb.client.rpc('whatsapp_config_leer'), this.sb.client.rpc('whatsapp_envios_recientes')]);
    if (c.error) {
      const falta = /function|schema cache|does not exist/i.test(c.error.message);
      return this.error.set(falta ? 'Falta activar esta función en la base de datos: corre supabase/sql/PENDIENTE_correr_en_supabase.sql en el editor SQL de Supabase.' : 'No se pudo leer la configuración de WhatsApp: ' + c.error.message);
    }
    const w = c.data as WaConfig;
    this.wa.set(w);
    this.f = { phone_number_id: w.phone_number_id ?? '', token: '', plantilla: w.plantilla, idioma: w.idioma, app_url: w.app_url ?? location.origin, activo: w.activo };
    this.envios.set((e.data ?? []) as WaEnvio[]);
  }

  async guardar(): Promise<void> {
    this.ocupado.set(true);
    const f = this.f;
    const { error } = await this.sb.client.rpc('whatsapp_config_guardar', {
      p_phone_number_id: f.phone_number_id, p_token: f.token || null, p_plantilla: f.plantilla, p_idioma: f.idioma, p_app_url: f.app_url, p_activo: f.activo,
    });
    this.ocupado.set(false);
    if (error) return this.toast.error(error.message);
    this.toast.ok(f.activo ? 'Guardado: el enlace se manda solo cuando el pedido sale en ruta' : 'Guardado (apagado)');
    await this.cargar();
  }

  async probar(): Promise<void> {
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('whatsapp_probar', { p_telefono: this.prueba });
    this.ocupado.set(false);
    if (error) return this.toast.error(error.message);
    this.toast.ok('Prueba enviada: en unos segundos aparece el resultado abajo');
    setTimeout(() => void this.cargar(), 4000);
  }

  cuando(iso: string): string {
    return new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
