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
} from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { SupabaseService } from '../../core/services/supabase.service';

import { NotificacionesComponent } from '../../shared/notificaciones/notificaciones.component';
import { CambiarAreaComponent } from '../../shared/cambiar-area/cambiar-area.component';
interface MenuItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon, NotificacionesComponent, CambiarAreaComponent],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './admin-layout.component.scss'],
})
export class AdminLayoutComponent {
  collapsed = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/admin', icon: 'home-outline' },
    { label: 'Pedidos', path: '/admin/pedidos', icon: 'receipt-outline' },
    { label: 'Ventas del local', path: '/admin/ventas-local', icon: 'storefront-outline' },
    { label: 'Clientes', path: '/admin/clientes', icon: 'people-circle-outline' },
    { label: 'Cuadres', path: '/admin/cuadres', icon: 'wallet-outline' },
    { label: 'Recolector', path: '/admin/recolector', icon: 'wallet-outline' },
    { label: 'Reportes', path: '/admin/reportes', icon: 'bar-chart-outline' },
    { label: 'Ranking', path: '/admin/ranking', icon: 'trophy-outline' },
    { label: 'Productos', path: '/admin/productos', icon: 'cube-outline' },
    { label: 'Catálogo', path: '/admin/catalogo', icon: 'book-outline' },
    { label: 'Usuarios', path: '/admin/usuarios', icon: 'people-outline' },
    { label: 'Actividad', path: '/admin/actividad', icon: 'time-outline' },
    { label: 'Configuración', path: '/admin/configuracion', icon: 'settings-outline' },
    { label: 'Barrios', path: '/admin/barrios', icon: 'map-outline' },
    { label: 'Tablero', path: '/admin/tablero', icon: 'grid-outline' },
  ];

  constructor(
    public theme: ThemeService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({
      mapOutline,
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