import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { hayErrorDeEnlace, vieneDeRecuperacion } from '../../auth/enlace-correo';

@Component({
  selector: 'app-init',
  standalone: true,
  // Mientras decide a dónde ir, se ve el skeleton de arranque de AppComponent.
  template: '',
})
export class AppInitPage implements OnInit {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    // Llegó desde el correo de "recuperar contraseña": se espera a que Supabase
    // lea la sesión del enlace y luego se pide la clave nueva.
    if (vieneDeRecuperacion()) {
      await this.supabase.getCurrentUser();
      this.router.navigateByUrl('/auth/nueva-clave');
      return;
    }
    // Enlace vencido o inválido: al login, que muestra el aviso.
    if (hayErrorDeEnlace()) {
      this.router.navigateByUrl('/auth/login');
      return;
    }

    const profile = await this.supabase.getCurrentProfile();

    if (!profile) {
      this.router.navigateByUrl('/auth/login');
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
      case 'despachador':
        this.router.navigateByUrl('/despachador');
        break;
    }
  }
}