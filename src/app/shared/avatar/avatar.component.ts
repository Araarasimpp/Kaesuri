import { Component, Input, computed, inject, signal } from '@angular/core';
import { PresenciaService } from '../../core/services/presencia.service';

/** Foto de la persona o sus iniciales. Con [usuario] lleva el punto de estado (como en Discord). */
@Component({
  selector: 'app-avatar',
  standalone: true,
  styles: [
    `
      :host { display: inline-flex; flex-shrink: 0; position: relative; }
      span, img { border-radius: 50%; }
      img { object-fit: cover; background: var(--surface-2); }
      span.ini { display: flex; align-items: center; justify-content: center; background: var(--oro-wash); color: var(--oro-texto); box-shadow: inset 0 0 0 1px var(--oro-soft); font-weight: 600; }
      /* Punto de estado: verde activo, luna amarilla ausente, gris desconectado */
      .presencia { --aro: var(--surface, var(--k-card-bg, #fff)); position: absolute; right: -1px; bottom: -1px; box-sizing: content-box;
        border: 2.5px solid var(--aro); border-radius: 50%; }
      .presencia.activo { background: #23a55a; }
      .presencia.ausente { background: radial-gradient(circle at 22% 22%, var(--aro) 0 36%, #f0b232 38%); }
      .presencia.desconectado { background: radial-gradient(circle, var(--aro) 0 30%, #80848e 33%); }
    `,
  ],
  template: `
    @if (url() && !fallo()) {
      <img [src]="url()" alt="" [style.width.px]="tam" [style.height.px]="tam" (error)="fallo.set(true)" />
    } @else {
      <span class="ini" [style.width.px]="tam" [style.height.px]="tam" [style.font-size.px]="tam * 0.38" aria-hidden="true">{{ iniciales() }}</span>
    }
    @if (usuario(); as u) {
      <span [class]="'presencia ' + presencia.estado(u)" [style.width.px]="punto" [style.height.px]="punto"
        role="img" [attr.aria-label]="presencia.texto(u)" [attr.title]="presencia.texto(u)"></span>
    }
  `,
})
export class AvatarComponent {
  presencia = inject(PresenciaService);
  private _nombre = signal('');
  url = signal<string | null>(null);
  fallo = signal(false);
  usuario = signal<string | null>(null);
  @Input() tam = 32;
  @Input() set nombre(v: string | null | undefined) {
    this._nombre.set(v ?? '');
  }
  @Input() set foto(v: string | null | undefined) {
    this.url.set(v ?? null);
    this.fallo.set(false);
  }
  /** id de la persona: muestra su punto de estado */
  @Input('usuario') set usuarioId(v: string | null | undefined) {
    this.usuario.set(v ?? null);
  }
  get punto(): number {
    return Math.max(8, Math.round(this.tam * 0.28));
  }
  iniciales = computed(() =>
    this._nombre()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('')
  );
}
