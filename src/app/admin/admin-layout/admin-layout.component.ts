import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  homeOutline,
  receiptOutline,
  cubeOutline,
  peopleOutline,
  walletOutline,
  barChartOutline,
  settingsOutline,
  timeOutline,
  add,
  sunnyOutline,
  moonOutline,
  chevronBackOutline,
  chevronForwardOutline,
  logOutOutline,
  gridOutline,
  peopleCircleOutline,
  bookOutline,
  trophyOutline,
  storefrontOutline,
  mapOutline,
  bagHandleOutline,
  alertCircleOutline,
  statsChartOutline,
  fileTrayStackedOutline,
  returnDownBackOutline,
  cashOutline,
  cardOutline,
  trendingUpOutline,
  sparklesOutline,
} from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { SupabaseService } from '../../core/services/supabase.service';

import { NotificacionesComponent } from '../../shared/notificaciones/notificaciones.component';
import { CambiarAreaComponent } from '../../shared/cambiar-area/cambiar-area.component';
import { BarraMovilComponent } from '../../shared/barra-movil/barra-movil.component';
import { NavMovilComponent } from '../../shared/nav-movil/nav-movil.component';
interface MenuItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon, NotificacionesComponent, CambiarAreaComponent, BarraMovilComponent, NavMovilComponent],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.scss'],
})
export class AdminLayoutComponent {
  collapsed = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/admin', icon: 'home-outline' },
    { label: 'Pedidos', path: '/admin/pedidos', icon: 'receipt-outline' },
    { label: 'Ventas del local', path: '/admin/ventas-local', icon: 'storefront-outline' },
    { label: 'Devoluciones', path: '/admin/devoluciones', icon: 'return-down-back-outline' },
    { label: 'Clientes', path: '/admin/clientes', icon: 'people-circle-outline' },
    { label: 'Cuadres', path: '/admin/cuadres', icon: 'wallet-outline' },
    { label: 'Novedades', path: '/admin/novedades', icon: 'alert-circle-outline' },
    { label: 'Domiciliarios', path: '/admin/resumen-domiciliarios', icon: 'stats-chart-outline' },
    { label: 'Recolector', path: '/admin/recolector', icon: 'bag-handle-outline' },
    { label: 'Comisiones', path: '/admin/comisiones', icon: 'cash-outline' },
    { label: 'Gastos', path: '/admin/gastos', icon: 'card-outline' },
    { label: 'Reportes', path: '/admin/reportes', icon: 'bar-chart-outline' },
    { label: 'Rentabilidad', path: '/admin/rentabilidad', icon: 'trending-up-outline' },
    { label: 'Ranking', path: '/admin/ranking', icon: 'trophy-outline' },
    { label: 'Productos', path: '/admin/productos', icon: 'cube-outline' },
    { label: 'Inventario', path: '/admin/inventario', icon: 'file-tray-stacked-outline' },
    { label: 'Catálogo', path: '/admin/catalogo', icon: 'book-outline' },
    { label: 'Usuarios', path: '/admin/usuarios', icon: 'people-outline' },
    { label: 'Actividad', path: '/admin/actividad', icon: 'time-outline' },
    { label: 'Configuración', path: '/admin/configuracion', icon: 'settings-outline' },
    { label: 'Barrios', path: '/admin/barrios', icon: 'map-outline' },
    { label: 'Tablero', path: '/admin/tablero', icon: 'grid-outline' },
    { label: 'Pedidos de la tienda', path: '/admin/pedidos-web', icon: 'storefront-outline' },
    { label: 'Recontactar', path: '/admin/recontactar', icon: 'people-outline' },
  { label: 'Actualizaciones', path: '/admin/actualizaciones', icon: 'sparkles-outline' },
  ];

  /** Las que se ven siempre en la barra de abajo del celular (las demás, en "Más") */
  readonly navPrincipales = this.menuItems.filter((m) => ['/admin', '/admin/pedidos', '/admin/cuadres', '/admin/reportes'].includes(m.path));

  constructor(
    public theme: ThemeService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({
      sparklesOutline,
      trendingUpOutline,
      cardOutline,
      cashOutline,
      returnDownBackOutline,
      fileTrayStackedOutline,
      statsChartOutline,
      alertCircleOutline,
      mapOutline,
      bagHandleOutline,
      storefrontOutline,
      trophyOutline,
      bookOutline,
      peopleCircleOutline,
      gridOutline,
      homeOutline,
      receiptOutline,
      cubeOutline,
      peopleOutline,
      walletOutline,
      barChartOutline,
      settingsOutline,
      timeOutline,
      add,
      sunnyOutline,
      moonOutline,
      chevronBackOutline,
      chevronForwardOutline,
      logOutOutline,
    });
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  async logout(): Promise<void> {
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}