import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, inicioDe } from '../../core/services/supabase.service';
import { tomarErrorDeEnlace } from '../enlace-correo';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.page.html',
  styleUrls: ['../auth-shell.scss', './login.page.scss'],
})
export class LoginPage {
  email = '';
  password = '';
  errorMsg = tomarErrorDeEnlace() ?? '';
  avisoMsg = '';
  loading = false;
  enviandoCorreo = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

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

  async onLogin() {
    this.errorMsg = '';
    this.avisoMsg = '';

    if (!this.email || !this.password) {
      this.errorMsg = 'Ingresa tu correo y contraseña.';
      return;
    }

    this.loading = true;
    const { error } = await this.supabase.login(this.email, this.password);

    if (error) {
      this.loading = false;
      this.errorMsg = 'Correo o contraseña incorrectos.';
      this.cdr.detectChanges();
      return;
    }

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