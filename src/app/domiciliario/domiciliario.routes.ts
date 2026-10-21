// src/app/domiciliario/domiciliario.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { DomiciliarioLayoutComponent } from './domiciliario-layout/domiciliario-layout.component';

export const DOMICILIARIO_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['domiciliario', 'admin'] },
    component: DomiciliarioLayoutComponent,
    children: [
      {
        path: 'perfil',
        loadComponent: () => import('../paginas/perfil/perfil.page').then((m) => m.PerfilPage),
      },
      {
        path: '',
        loadComponent: () =>
          import('./inicio/inicio.page').then((m) => m.InicioDomiciliarioPage),
      },
      {
        path: 'cuadres',
        loadComponent: () => import('./cuadres/cuadres.page').then((m) => m.CuadresPage),
      },
      {
        path: 'ranking',
        loadComponent: () => import('../paginas/ranking/ranking.page').then((m) => m.RankingPage),
      },
    ],
  },
];