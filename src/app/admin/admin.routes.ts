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
        path: 'perfil',
        loadComponent: () => import('../paginas/perfil/perfil.page').then((m) => m.PerfilPage),
      },
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
      {
        path: 'pedidos',
        loadComponent: () =>
          import('./pedidos/pedidos.page').then((m) => m.PedidosPage),
      },
      {
        path: 'pedidos/nuevo',
        data: { volverA: '/admin/pedidos' },
        loadComponent: () =>
          import('../vendedor/nuevo-pedido/nuevo-pedido.page').then(
            (m) => m.NuevoPedidoPage
          ),
      },
      {
        path: 'cuadres',
        loadComponent: () =>
          import('./cuadres/cuadres.page').then((m) => m.AdminCuadresPage),
      },
      {
        path: 'reportes',
        loadComponent: () =>
          import('./reportes/reportes.page').then((m) => m.ReportesPage),
      },
      {
        path: 'actividad',
        loadComponent: () => import('./actividad/actividad.page').then((m) => m.ActividadPage),
      },
      {
        path: 'configuracion',
        loadComponent: () =>
          import('./configuracion/configuracion.page').then((m) => m.ConfiguracionPage),
      },
      {
        path: 'tablero',
        loadComponent: () => import('../paginas/tablero/tablero.page').then((m) => m.TableroPage),
      },
      {
        path: 'clientes',
        loadComponent: () => import('../paginas/clientes/clientes.page').then((m) => m.ClientesPage),
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
        path: 'ventas-local',
        data: { nuevaVenta: '/admin/venta-local' },
        loadComponent: () => import('../paginas/ventas-local/ventas-local.page').then((m) => m.VentasLocalPage),
      },
      {
        path: 'venta-local',
        data: { modo: 'local', volverA: '/admin/ventas-local' },
        loadComponent: () => import('../vendedor/nuevo-pedido/nuevo-pedido.page').then((m) => m.NuevoPedidoPage),
      },
      {
        path: 'recolector',
        loadComponent: () => import('../paginas/recolector/recolector.page').then((m) => m.RecolectorPage),
      },
      {
        path: 'barrios',
        loadComponent: () => import('./barrios/barrios.page').then((m) => m.BarriosPage),
      },
      {
        path: 'novedades',
        loadComponent: () => import('../paginas/novedades/novedades.page').then((m) => m.NovedadesPage),
      },
      {
        path: 'resumen-domiciliarios',
        loadComponent: () => import('../paginas/mi-resumen/mi-resumen.page').then((m) => m.MiResumenPage),
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
        path: 'comisiones',
        loadComponent: () => import('../paginas/comisiones/comisiones.page').then((m) => m.ComisionesPage),
      },
      {
        path: 'gastos',
        loadComponent: () => import('../paginas/gastos/gastos.page').then((m) => m.GastosPage),
      },
      {
        path: 'rentabilidad',
        loadComponent: () => import('../paginas/rentabilidad/rentabilidad.page').then((m) => m.RentabilidadPage),
      },
      {
        path: 'pedidos-web',
        loadComponent: () => import('../paginas/pedidos-web/pedidos-web.page').then((m) => m.PedidosWebPage),
      },
      {
        path: 'recontactar',
        loadComponent: () => import('../paginas/recontactar/recontactar.page').then((m) => m.RecontactarPage),
      },
    ],
  },
];