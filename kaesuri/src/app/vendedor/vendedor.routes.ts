// src/app/vendedor/vendedor.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { VendedorLayoutComponent } from './vendedor-layout/vendedor-layout.component';

export const VENDEDOR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['vendedor', 'admin'] },
    component: VendedorLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () => import('./inicio/inicio.page').then((m) => m.InicioPage),
      },
      {
        path: 'nuevo-pedido',
        loadComponent: () =>
          import('./nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
    ],
  },
];