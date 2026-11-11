import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, output } from '@angular/core';
import { environment } from '../../../environments/environment';

// Verificación anti-robots de Cloudflare Turnstile. Si no hay llave configurada
// (environment.turnstileSiteKey vacío) no se muestra nada y el formulario funciona igual.
declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string;
      reset(id?: string): void;
      remove(id?: string): void;
    };
  }
}

let cargaScript: Promise<void> | null = null;
function cargarTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  cargaScript ??= new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      cargaScript = null;
      mal(new Error('No se pudo cargar la verificación'));
    };
    document.head.appendChild(s);
  });
  return cargaScript;
}

export const CAPTCHA_ACTIVO = !!environment.turnstileSiteKey;

@Component({
  selector: 'app-captcha',
  standalone: true,
  styles: [`:host { display: block; min-height: 0; } .caja { display: flex; justify-content: center; }`],
  template: `<div class="caja" #caja></div>`,
})
export class CaptchaComponent implements AfterViewInit, OnDestroy {
  @ViewChild('caja') caja!: ElementRef<HTMLElement>;
  token = output<string>();
  private id?: string;

  async ngAfterViewInit(): Promise<void> {
    if (!CAPTCHA_ACTIVO) return;
    try {
      await cargarTurnstile();
      this.id = window.turnstile!.render(this.caja.nativeElement, {
        sitekey: environment.turnstileSiteKey,
        language: 'es',
        theme: document.body.classList.contains('dark') ? 'dark' : 'light',
        callback: (t: string) => this.token.emit(t),
        'expired-callback': () => this.token.emit(''),
        'error-callback': () => this.token.emit(''),
      });
    } catch {
      this.token.emit('');
    }
  }

  /** Cada token sirve una sola vez: se pide uno nuevo después de cada intento. */
  reiniciar(): void {
    this.token.emit('');
    if (this.id && window.turnstile) window.turnstile.reset(this.id);
  }

  ngOnDestroy(): void {
    if (this.id && window.turnstile) window.turnstile.remove(this.id);
  }
}
