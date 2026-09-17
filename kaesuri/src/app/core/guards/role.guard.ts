import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot } from '@angular/router';
import { SupabaseService, UserRole } from '../services/supabase.service';

@Injectable({ providedIn: 'root' })
export class RoleGuard implements CanActivate {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean> {
    const allowedRoles = route.data['roles'] as UserRole[] | undefined;

    const profile = await this.supabase.getCurrentProfile();

    // No hay sesión → al login
    if (!profile) {
      this.router.navigate(['/auth/login']);
      return false;
    }

    // La ruta no restringe roles → cualquier autenticado pasa
    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    // El rol del usuario no está en la lista permitida → afuera
    if (!allowedRoles.includes(profile.role)) {
      this.router.navigate(['/auth/no-autorizado']);
      return false;
    }

    return true;
  }
}

/*
 * Uso en app-routing.module.ts:
 *
 * {
 *   path: 'admin',
 *   loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule),
 *   canActivate: [RoleGuard],
 *   data: { roles: ['admin'] }
 * },
 * {
 *   path: 'vendedor',
 *   loadChildren: () => import('./vendedor/vendedor.module').then(m => m.VendedorModule),
 *   canActivate: [RoleGuard],
 *   data: { roles: ['vendedor', 'admin'] }
 * },
 * {
 *   path: 'domiciliario',
 *   loadChildren: () => import('./domiciliario/domiciliario.module').then(m => m.DomiciliarioModule),
 *   canActivate: [RoleGuard],
 *   data: { roles: ['domiciliario', 'admin'] }
 * },
 */