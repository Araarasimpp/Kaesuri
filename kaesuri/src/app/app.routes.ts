import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'auth/login',
    pathMatch: 'full',
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./auth/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'auth/registro',
    loadComponent: () => import('./auth/registro/registro.page').then((m) => m.RegistroPage),
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
];