// src/app/recolector/recolector.routes.ts
// Área del rol Recolector: bases de dinero y compras del día.
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { RecolectorLayoutComponent } from './recolector-layout/recolector-layout.component';

export const RECOLECTOR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['recolector', 'admin'] },
    component: RecolectorLayoutComponent,
    children: [
      {
        path: 'perfil',
        loadComponent: () => import('../paginas/perfil/perfil.page').then((m) => m.PerfilPage),
      },
      {
        path: '',
        loadComponent: () => import('../paginas/recolector/recolector.page').then((m) => m.RecolectorPage),
      },
      {
        path: 'actualizaciones',
        loadComponent: () => import('../paginas/actualizaciones/actualizaciones.page').then((m) => m.ActualizacionesPage),
      },
    ],
  },
];
