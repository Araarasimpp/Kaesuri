import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonText,
} from '@ionic/angular';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonText,
  ],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
})
export class LoginPage {
  email = '';
  password = '';
  errorMsg = '';
  loading = false;

  constructor(private supabase: SupabaseService, private router: Router) {}

  async onLogin() {
    this.errorMsg = '';

    if (!this.email || !this.password) {
      this.errorMsg = 'Ingresa tu correo y contraseña.';
      return;
    }

    this.loading = true;
    const { error } = await this.supabase.login(this.email, this.password);

    if (error) {
      this.loading = false;
      this.errorMsg = 'Correo o contraseña incorrectos.';
      return;
    }

    // Ya autenticado: traemos el profile para saber a dónde redirigir según el rol
    const profile = await this.supabase.getCurrentProfile();
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
  }
}