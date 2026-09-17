// src/app/admin/admin.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { AdminLayoutComponent } from './admin-layout/admin-layout.component';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['admin'] },
    component: AdminLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'productos',
        loadComponent: () =>
          import('./productos/productos.page').then((m) => m.ProductosPage),
      },
      {
        path: 'usuarios',
        loadComponent: () =>
          import('./usuarios/usuarios.page').then((m) => m.UsuariosPage),
      },
      // {
      //   path: 'pedidos',
      //   loadComponent: () => import('./pedidos/pedidos.page').then((m) => m.PedidosPage),
      // },
    ],
  },
];