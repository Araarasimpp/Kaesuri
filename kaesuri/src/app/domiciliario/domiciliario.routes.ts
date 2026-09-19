// src/app/domiciliario/domiciliario.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';

export const DOMICILIARIO_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['domiciliario', 'admin'] },
    loadComponent: () =>
      import('./inicio/inicio.page').then((m) => m.InicioDomiciliarioPage),
  },
  {
    path: 'cuadres',
    canActivate: [RoleGuard],
    data: { roles: ['domiciliario', 'admin'] },
    loadComponent: () => import('./cuadres/cuadres.page').then((m) => m.CuadresPage),
  },
];