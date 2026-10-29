import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  homeOutline,
  receiptOutline,
  walletOutline,
  add,
  sunnyOutline,
  moonOutline,
  chevronBackOutline,
  chevronForwardOutline,
  logOutOutline,
  gridOutline,
  trophyOutline,
  alertCircleOutline,
  fileTrayStackedOutline,
  returnDownBackOutline,
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
  selector: 'app-despachador-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon, NotificacionesComponent, CambiarAreaComponent, BarraMovilComponent, NavMovilComponent],
  templateUrl: './despachador-layout.component.html',
  styleUrls: ['./despachador-layout.component.scss'],
})
export class DespachadorLayoutComponent {
  collapsed = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/despachador', icon: 'home-outline' },
    { label: 'Pedidos', path: '/despachador/pedidos', icon: 'receipt-outline' },
    { label: 'Cuadres', path: '/despachador/cuadres', icon: 'wallet-outline' },
    { label: 'Tablero', path: '/despachador/tablero', icon: 'grid-outline' },
    { label: 'Ranking', path: '/despachador/ranking', icon: 'trophy-outline' },
    { label: 'Novedades', path: '/despachador/novedades', icon: 'alert-circle-outline' },
    { label: 'Inventario', path: '/despachador/inventario', icon: 'file-tray-stacked-outline' },
    { label: 'Devoluciones', path: '/despachador/devoluciones', icon: 'return-down-back-outline' },
  ];

  /** Las que se ven siempre en la barra de abajo del celular (las demás, en "Más") */
  readonly navPrincipales = this.menuItems.filter((m) => ['/despachador', '/despachador/pedidos', '/despachador/cuadres', '/despachador/tablero'].includes(m.path));

  constructor(
    public theme: ThemeService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({
      returnDownBackOutline,
      fileTrayStackedOutline,
      alertCircleOutline,
      trophyOutline,
      gridOutline,
      homeOutline,
      receiptOutline,
      walletOutline,
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