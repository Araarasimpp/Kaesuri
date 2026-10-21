import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, inicioDe } from '../../core/services/supabase.service';
import { terminarRecuperacion } from '../enlace-correo';

/**
 * Se llega aquí desde el enlace del correo "recuperar contraseña": ese enlace ya
 * dejó la sesión abierta, así que solo falta guardar la contraseña nueva.
 */
@Component({
  selector: 'app-nueva-clave',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './nueva-clave.page.html',
  styleUrls: ['../auth-shell.scss'],
})
export class NuevaClavePage implements OnInit {
  /** Correo de la cuenta, para que el celular guarde la clave nueva con el usuario correcto. */
  correo = '';
  password = '';
  confirmar = '';
  errorMsg = '';
  verificando = true;
  sinSesion = false;
  guardando = false;

  constructor(private supabase: SupabaseService, private router: Router, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    this.sinSesion = !user;
    this.correo = user?.email ?? '';
    if (!user) terminarRecuperacion();
    this.verificando = false;
    this.cdr.detectChanges();
  }

  async onGuardar(): Promise<void> {
    this.errorMsg = '';
    if (this.password.length < 6) {
      this.errorMsg = 'La contraseña debe tener al menos 6 caracteres.';
      this.cdr.detectChanges();
      return;
    }
    if (this.password !== this.confirmar) {
      this.errorMsg = 'Las dos contraseñas no coinciden.';
      this.cdr.detectChanges();
      return;
    }

    this.guardando = true;
    const { error } = await this.supabase.cambiarClave(this.password);
    this.guardando = false;

    if (error) {
      const codigo = (error as { code?: string }).code;
      this.errorMsg =
        codigo === 'same_password'
          ? 'Esa es la misma contraseña que ya tenías. Escribe una diferente.'
          : codigo === 'weak_password'
            ? 'Esa contraseña es muy débil. Usa una más larga o con números.'
            : 'No se pudo guardar la contraseña. Intenta de nuevo.';
      this.cdr.detectChanges();
      return;
    }

    terminarRecuperacion();
    const perfil = await this.supabase.getCurrentProfile();
    if (!perfil || !perfil.activo) {
      // Sin perfil o cuenta desactivada: que entre por el login, que explica el motivo.
      await this.supabase.logout();
      this.router.navigateByUrl('/auth/login', { replaceUrl: true });
      return;
    }
    this.router.navigateByUrl(inicioDe(perfil), { replaceUrl: true });
  }
}
