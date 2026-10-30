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
        path: 'perfil',
        loadComponent: () => import('../paginas/perfil/perfil.page').then((m) => m.PerfilPage),
      },
      {
        path: '',
        loadComponent: () => import('../paginas/mi-panel/mi-panel.page').then((m) => m.MiPanelPage),
      },
      {
        path: 'nuevo-pedido',
        loadComponent: () =>
          import('./nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'catalogo',
        loadComponent: () => import('../paginas/catalogo/catalogo.page').then((m) => m.CatalogoPage),
      },
      {
        path: 'ranking',
        loadComponent: () => import('../paginas/ranking/ranking.page').then((m) => m.RankingPage),
      },
      {
        path: 'novedades',
        loadComponent: () => import('../paginas/novedades/novedades.page').then((m) => m.NovedadesPage),
      },
      {
        path: 'comisiones',
        loadComponent: () => import('../paginas/comisiones/comisiones.page').then((m) => m.ComisionesPage),
      },
      {
        path: 'pedidos-web',
        loadComponent: () => import('../paginas/pedidos-web/pedidos-web.page').then((m) => m.PedidosWebPage),
      },
      {
        path: 'recontactar',
        loadComponent: () => import('../paginas/recontactar/recontactar.page').then((m) => m.RecontactarPage),
      },
      {
        path: 'actualizaciones',
        loadComponent: () => import('../paginas/actualizaciones/actualizaciones.page').then((m) => m.ActualizacionesPage),
      },
    ],
  },
];