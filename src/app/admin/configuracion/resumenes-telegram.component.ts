import { Component, inject, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError } from '../../shared/formato';

/**
 * Configuración → Resúmenes por Telegram (como en Jasta): el cierre del día (9 p. m.), la lista
 * de compras (lunes) y el respaldo en Excel (domingos) llegan solos a los admins con Telegram
 * vinculado; aquí se pueden pedir en el momento.
 */
@Component({
  selector: 'app-resumenes-telegram',
  standalone: true,
  host: { class: 'jt' },
  styles: [
    `
      :host { display: block; }
      h2 { margin: 0 0 4px; font-size: 17px; }
      .ayuda { margin: 0 0 12px; font-size: 13.5px; color: var(--text-soft); line-height: 1.45; }
      .acciones { display: flex; gap: 8px; flex-wrap: wrap; }
      pre { margin: 12px 0 0; padding: 12px 14px; border-radius: var(--radius); background: var(--surface-2); font: 13px/1.5 var(--ui-font); white-space: pre-wrap; }
    `,
  ],
  template: `
    <h2>Resúmenes por Telegram</h2>
    <p class="ayuda">A los admins con su Telegram vinculado (Mi perfil → Telegram) les llega solo: el <strong>cierre del día</strong> a las 9 p. m.,
      la <strong>lista de compras</strong> los lunes y el <strong>respaldo en Excel</strong> de la semana los domingos en la noche.</p>
    <div class="acciones">
      <button class="b" (click)="enviarCierre()" [disabled]="enviandoCierre()">{{ enviandoCierre() ? 'Enviando…' : 'Mandar el cierre de hoy' }}</button>
      <button class="b" (click)="pedirRespaldo()" [disabled]="pidiendoRespaldo()">{{ pidiendoRespaldo() ? 'Pidiendo…' : 'Mandar respaldo ahora' }}</button>
    </div>
    @if (cierre()) { <pre>{{ cierre() }}</pre> }
  `,
})
export class ResumenesTelegramComponent {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  enviandoCierre = signal(false);
  pidiendoRespaldo = signal(false);
  cierre = signal('');

  async pedirRespaldo(): Promise<void> {
    this.pidiendoRespaldo.set(true);
    const { data, error } = await this.sb.client.rpc('pedir_respaldo');
    this.pidiendoRespaldo.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`En un momento le llega el Excel por Telegram a ${data} ${data === 1 ? 'admin' : 'admins'}`);
  }

  async enviarCierre(): Promise<void> {
    this.enviandoCierre.set(true);
    const { data, error } = await this.sb.client.rpc('enviar_cierre_dia_ahora');
    this.enviandoCierre.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const r = data as { enviados: number; texto: string };
    this.cierre.set(r.texto);
    if (r.enviados) this.toast.ok(r.enviados === 1 ? 'Enviado a 1 admin por Telegram' : `Enviado a ${r.enviados} admins por Telegram`);
    else this.toast.error('Ningún admin tiene Telegram vinculado (Mi perfil → Telegram) o el bot no está conectado.');
  }
}
