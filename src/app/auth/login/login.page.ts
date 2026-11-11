import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, inicioDe } from '../../core/services/supabase.service';
import { tomarErrorDeEnlace } from '../enlace-correo';

/** 'si' = este celular ya entra con Face ID; 'pendiente' = lo pidió y se activa al entrar con la contraseña */
function leerBio(): string | null {
  try {
    return localStorage.getItem('jyb-face-id');
  } catch {
    return null;
  }
}
function guardarBio(v: 'si' | 'pendiente' | null): void {
  try {
    if (v) localStorage.setItem('jyb-face-id', v);
    else localStorage.removeItem('jyb-face-id');
  } catch { /* sin almacenamiento */ }
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.page.html',
  styleUrls: ['../auth-shell.scss'],
})
export class LoginPage {
  email = '';
  password = '';
  errorMsg = tomarErrorDeEnlace() ?? '';
  avisoMsg = '';
  loading = false;
  enviandoCorreo = false;
  /** La cuenta existe pero no ha confirmado el correo: se ofrece reenviarlo */
  sinConfirmar = false;

  /** El celular tiene Face ID, Touch ID o lector de huella que sirva para entrar (llaves de acceso) */
  puedeBio = false;
  errorBio = '';

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    const pk = (window as unknown as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential;
    void pk?.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then((si) => { this.puedeBio = !!si; this.cdr.detectChanges(); })
      .catch(() => undefined);
  }

  /** Entrar con la llave de acceso guardada en el celular (Face ID, Touch ID o huella) */
  async entrarBiometria() {
    this.errorMsg = '';
    this.errorBio = '';
    this.loading = true;
    const { error } = await this.supabase.client.auth.signInWithPasskey();
    if (error) {
      this.loading = false;
      const code = (error as { code?: string }).code ?? '';
      const msg = (error.message ?? '').toLowerCase();
      if (code === 'passkey_disabled') this.errorBio = 'El inicio con Face ID todavía no está activado. Entra con tu contraseña.';
      else if (code === 'webauthn_credential_not_found' || leerBio() !== 'si') {
        // Este celular todavía no tiene Face ID: queda pedido y se activa solo al entrar una vez con la contraseña
        guardarBio('pendiente');
        this.errorBio = 'Para usar Face ID en este celular, entra una vez con tu correo y contraseña. Desde ahí entras siempre con Face ID.';
      } else if (!(msg.includes('notallowed') || msg.includes('cancel') || msg.includes('abort'))) {
        this.errorBio = 'No se pudo entrar con Face ID. Entra con tu contraseña.';
      }
      this.cdr.detectChanges();
      return;
    }
    guardarBio('si');
    await this.terminarEntrada();
  }

  /** "¿Olvidaste tu contraseña?": manda el enlace para ponerse una nueva. */
  async onOlvideClave() {
    this.errorMsg = '';
    this.avisoMsg = '';
    const email = this.email.trim();
    if (!email) {
      this.errorMsg = 'Escribe tu correo arriba y vuelve a tocar "¿Olvidaste tu contraseña?".';
      return;
    }

    this.enviandoCorreo = true;
    const { error } = await this.supabase.enviarRecuperacion(email);
    this.enviandoCorreo = false;

    if (error) {
      this.errorMsg =
        error.status === 429
          ? 'Ya se enviaron varios correos hace poco. Espera unos minutos y vuelve a intentarlo.'
          : 'No se pudo enviar el correo. Intenta de nuevo.';
    } else {
      // No se confirma si el correo existe, por seguridad.
      this.avisoMsg = `Si ${email} está registrado, te llegará un correo con un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.`;
    }
    this.cdr.detectChanges();
  }

  async onReenviar() {
    this.enviandoCorreo = true;
    const { error } = await this.supabase.reenviarConfirmacion(this.email.trim());
    this.enviandoCorreo = false;
    if (error) {
      this.errorMsg = error.status === 429
        ? 'Ya se enviaron varios correos hace poco. Espera unos minutos y vuelve a intentarlo.'
        : 'No se pudo reenviar el correo. Intenta de nuevo.';
    } else {
      this.errorMsg = '';
      this.sinConfirmar = false;
      this.avisoMsg = `Te mandamos otro correo a ${this.email.trim()}. Revisa también Spam o Promociones y usa el enlace del último que llegue.`;
    }
    this.cdr.detectChanges();
  }

  async onLogin() {
    this.errorMsg = '';
    this.avisoMsg = '';

    if (!this.email || !this.password) {
      this.errorMsg = 'Ingresa tu correo y contraseña.';
      return;
    }

    this.loading = true;
    const { error } = await this.supabase.login(this.email, this.password);

    this.sinConfirmar = false;
    if (error) {
      this.loading = false;
      this.sinConfirmar = error.code === 'email_not_confirmed' || /not confirmed/i.test(error.message);
      this.errorMsg = this.sinConfirmar
        ? 'Todavía no has confirmado tu correo. Busca el correo que te enviamos (revisa también Spam o Promociones) y toca el enlace.'
        : 'Correo o contraseña incorrectos.';
      this.cdr.detectChanges();
      return;
    }

    // Pidió Face ID en este celular: se activa de una vez (el celular pide la cara o la huella)
    if (this.puedeBio && leerBio() === 'pendiente') {
      const r = await this.supabase.client.auth.registerPasskey();
      const yaEstaba = (r.error as { code?: string } | null)?.code === 'webauthn_credential_exists';
      guardarBio(!r.error || yaEstaba ? 'si' : null);
    }
    await this.terminarEntrada();
  }

  private async terminarEntrada() {
    const profile = await this.supabase.getCurrentProfile();
    this.loading = false;

    if (!profile) {
      this.errorMsg = 'No se pudo cargar tu perfil. Intenta de nuevo.';
      this.cdr.detectChanges();
      return;
    }

    if (!profile.activo) {
      await this.supabase.logout();
      this.errorMsg = 'Tu cuenta está desactivada. Contacta al administrador.';
      this.cdr.detectChanges();
      return;
    }

    this.router.navigateByUrl(inicioDe(profile));
  }
}