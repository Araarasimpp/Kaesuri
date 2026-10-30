import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './registro.page.html',
  styleUrls: ['../auth-shell.scss', './registro.page.scss'],
})
export class RegistroPage implements OnDestroy {
  nombre = '';
  email = '';
  telefono = '';
  password = '';
  errorMsg = '';
  loading = false;
  /** Ya se mandó el correo de confirmación: se muestra qué hacer y el botón para reenviarlo */
  enviado = false;
  /** Segundos que faltan para poder pedir otro correo */
  espera = 0;
  avisoMsg = '';
  private reloj?: ReturnType<typeof setInterval>;

  constructor(
    private supabase: SupabaseService,
    private cdr: ChangeDetectorRef
  ) {}

  async onRegistrar() {
    this.errorMsg = '';

    if (!this.nombre || !this.email || !this.password) {
      this.errorMsg = 'Completa todos los campos obligatorios.';
      return;
    }

    if (this.password.length < 6) {
      this.errorMsg = 'La contraseña debe tener al menos 6 caracteres.';
      return;
    }

    this.loading = true;
    const { error } = await this.supabase.register(
      this.email,
      this.password,
      this.nombre,
      this.telefono || undefined
    );

    this.loading = false;

    if (error) {
      this.errorMsg =
        error.message === 'User already registered'
          ? 'Ya existe una cuenta con ese correo.'
          : 'No se pudo crear la cuenta. Intenta de nuevo.';
      this.cdr.detectChanges();
      return;
    }

    this.enviado = true;
    this.iniciarEspera();
    this.cdr.detectChanges();
  }

  async reenviar() {
    this.errorMsg = '';
    this.avisoMsg = '';
    const { error } = await this.supabase.reenviarConfirmacion(this.email.trim());
    if (error) {
      this.errorMsg = error.status === 429
        ? 'Ya se enviaron varios correos hace poco. Espera unos minutos y revisa también Spam o Promociones.'
        : 'No se pudo reenviar el correo. Intenta de nuevo.';
    } else {
      this.avisoMsg = 'Listo, te mandamos otro correo. Usa el enlace del último que llegue.';
      this.iniciarEspera();
    }
    this.cdr.detectChanges();
  }

  /** Supabase solo deja mandar un correo por minuto; el botón queda bloqueado ese tiempo. */
  private iniciarEspera(): void {
    clearInterval(this.reloj);
    this.espera = 60;
    this.reloj = setInterval(() => {
      this.espera--;
      if (this.espera <= 0) clearInterval(this.reloj);
      this.cdr.detectChanges();
    }, 1000);
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
  }
}