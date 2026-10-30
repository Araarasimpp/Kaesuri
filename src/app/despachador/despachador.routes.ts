// src/app/despachador/despachador.routes.ts
import { Routes } from '@angular/router';
import { RoleGuard } from '../core/guards/role.guard';
import { DespachadorLayoutComponent } from './despachador-layout/despachador-layout.component';

export const DESPACHADOR_ROUTES: Routes = [
  {
    path: '',
    canActivate: [RoleGuard],
    data: { roles: ['despachador', 'admin'] },
    component: DespachadorLayoutComponent,
    children: [
      {
        path: 'perfil',
        loadComponent: () => import('../paginas/perfil/perfil.page').then((m) => m.PerfilPage),
      },
      {
        path: '',
        loadComponent: () =>
          import('./inicio/inicio.page').then((m) => m.InicioDespachadorPage),
      },
      {
        path: 'pedidos',
        loadComponent: () =>
          import('../admin/pedidos/pedidos.page').then((m) => m.PedidosPage),
      },
      {
        path: 'pedidos/nuevo',
        canActivate: [RoleGuard],
        data: { roles: ['despachador', 'admin'], volverA: '/despachador/pedidos' },
        loadComponent: () =>
          import('../vendedor/nuevo-pedido/nuevo-pedido.page').then(
            (m) => m.NuevoPedidoPage
          ),
      },
      {
        path: 'cuadres',
        loadComponent: () =>
          import('../admin/cuadres/cuadres.page').then((m) => m.AdminCuadresPage),
      },
      {
        path: 'tablero',
        loadComponent: () => import('../paginas/tablero/tablero.page').then((m) => m.TableroPage),
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
        path: 'inventario',
        loadComponent: () => import('../paginas/inventario/inventario.page').then((m) => m.InventarioPage),
      },
      {
        path: 'devoluciones',
        loadComponent: () => import('../paginas/devoluciones/devoluciones.page').then((m) => m.DevolucionesPage),
      },
      {
        path: 'actualizaciones',
        loadComponent: () => import('../paginas/actualizaciones/actualizaciones.page').then((m) => m.ActualizacionesPage),
      },
    ],
  },
];