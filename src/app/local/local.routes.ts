// src/app/local/local.routes.ts
// Área del rol Venta local: registrar las ventas del punto físico y ver las del día.
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { LocalLayoutComponent } from './local-layout/local-layout.component';

export const LOCAL_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['venta_local', 'admin'] },
    component: LocalLayoutComponent,
    children: [
      {
        path: 'perfil',
        loadComponent: () => import('../paginas/perfil/perfil.page').then((m) => m.PerfilPage),
      },
      {
        path: '',
        loadComponent: () => import('../paginas/ventas-local/ventas-local.page').then((m) => m.VentasLocalPage),
      },
      {
        path: 'nueva',
        data: { modo: 'local', volverA: '/local' },
        loadComponent: () => import('../vendedor/nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'catalogo',
        loadComponent: () => import('../paginas/catalogo/catalogo.page').then((m) => m.CatalogoPage),
      },
      {
        path: 'clientes',
        loadComponent: () => import('../paginas/clientes/clientes.page').then((m) => m.ClientesPage),
      },
      {
        path: 'devoluciones',
        loadComponent: () => import('../paginas/devoluciones/devoluciones.page').then((m) => m.DevolucionesPage),
      },
    ],
  },
];
