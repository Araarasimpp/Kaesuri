// src/app/vendedor/vendedor.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';

export const VENDEDOR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['vendedor', 'admin'] },
    loadComponent: () =>
      import('./inicio/inicio.page').then((m) => m.InicioPage),
  },
  {
    path: 'nuevo-pedido',
    canActivate: [RoleGuard],
    data: { roles: ['vendedor', 'admin'] },
    loadComponent: () =>
      import('./nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
  },
];