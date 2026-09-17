import { Component, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

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
  errorMsg = '';
  loading = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private zone: NgZone
  ) {}

  async onLogin() {
    this.errorMsg = '';

    if (!this.email || !this.password) {
      this.errorMsg = 'Ingresa tu correo y contraseña.';
      return;
    }

    this.loading = true;
    const { error } = await this.supabase.login(this.email, this.password);

    if (error) {
      // Forzamos la detección de cambios: las promesas de Supabase a veces
      // resuelven fuera de la zona de Angular y la vista no se repinta sola.
      this.zone.run(() => {
        this.loading = false;
        this.errorMsg = 'Correo o contraseña incorrectos.';
      });
      return;
    }

    const profile = await this.supabase.getCurrentProfile();

    this.zone.run(() => {
      this.loading = false;

      if (!profile) {
        this.errorMsg = 'No se pudo cargar tu perfil. Intenta de nuevo.';
        return;
      }

      switch (profile.role) {
        case 'admin':
          this.router.navigateByUrl('/admin');
          break;
        case 'vendedor':
          this.router.navigateByUrl('/vendedor');
          break;
        case 'domiciliario':
          this.router.navigateByUrl('/domiciliario');
          break;
      }
    });
  }
}