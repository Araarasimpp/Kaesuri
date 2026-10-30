import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./core/app-init/app-init.page').then((m) => m.AppInitPage),
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./auth/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'auth/nueva-clave',
    loadComponent: () => import('./auth/nueva-clave/nueva-clave.page').then((m) => m.NuevaClavePage),
  },
  {
    path: 'auth/registro',
    loadComponent: () => import('./auth/registro/registro.page').then((m) => m.RegistroPage),
  },
  {
    // Pública (sin sesión): catálogo de la tienda (general o de un vendedor) con pedido directo
    path: 'tienda',
    loadComponent: () => import('./tienda/tienda.page').then((m) => m.TiendaPage),
  },
  {
    path: 'tienda/:codigo',
    loadComponent: () => import('./tienda/tienda.page').then((m) => m.TiendaPage),
  },
  {
    // Pública (sin sesión): el cliente ve en qué va su pedido
    path: 'seguimiento/:codigo',
    loadComponent: () => import('./seguimiento/seguimiento.page').then((m) => m.SeguimientoPage),
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: 'vendedor',
    loadChildren: () => import('./vendedor/vendedor.routes').then((m) => m.VENDEDOR_ROUTES),
  },
  {
    path: 'domiciliario',
    loadChildren: () =>
      import('./domiciliario/domiciliario.routes').then((m) => m.DOMICILIARIO_ROUTES),
  },
  {
    path: 'despachador',
    loadChildren: () =>
      import('./despachador/despachador.routes').then((m) => m.DESPACHADOR_ROUTES),
  },
  {
    path: 'local',
    loadChildren: () => import('./local/local.routes').then((m) => m.LOCAL_ROUTES),
  },
  {
    path: 'recolector',
    loadChildren: () => import('./recolector/recolector.routes').then((m) => m.RECOLECTOR_ROUTES),
  },
];