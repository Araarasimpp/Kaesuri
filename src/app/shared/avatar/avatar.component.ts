import { Component, Input, computed, signal } from '@angular/core';

/** Foto de la persona o sus iniciales */
@Component({
  selector: 'app-avatar',
  standalone: true,
  styles: [
    `
      :host { display: inline-flex; flex-shrink: 0; }
      span, img { border-radius: 50%; }
      img { object-fit: cover; background: var(--surface-2); }
      span { display: flex; align-items: center; justify-content: center; background: var(--oro-wash); color: var(--oro-texto); box-shadow: inset 0 0 0 1px var(--oro-soft); font-weight: 600; }
    `,
  ],
  template: `
    @if (url() && !fallo()) {
      <img [src]="url()" alt="" [style.width.px]="tam" [style.height.px]="tam" (error)="fallo.set(true)" />
    } @else {
      <span [style.width.px]="tam" [style.height.px]="tam" [style.font-size.px]="tam * 0.38" aria-hidden="true">{{ iniciales() }}</span>
    }
  `,
})
export class AvatarComponent {
  private _nombre = signal('');
  url = signal<string | null>(null);
  fallo = signal(false);
  @Input() tam = 32;
  @Input() set nombre(v: string | null | undefined) {
    this._nombre.set(v ?? '');
  }
  @Input() set foto(v: string | null | undefined) {
    this.url.set(v ?? null);
    this.fallo.set(false);
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
