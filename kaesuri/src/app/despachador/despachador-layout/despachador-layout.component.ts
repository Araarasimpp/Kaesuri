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
} from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { SupabaseService } from '../../core/services/supabase.service';

import { NotificacionesComponent } from '../../shared/notificaciones/notificaciones.component';
interface MenuItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-despachador-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon, NotificacionesComponent],
  templateUrl: './despachador-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './despachador-layout.component.scss'],
})
export class DespachadorLayoutComponent {
  collapsed = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/despachador', icon: 'home-outline' },
    { label: 'Pedidos', path: '/despachador/pedidos', icon: 'receipt-outline' },
    { label: 'Cuadres', path: '/despachador/cuadres', icon: 'wallet-outline' },
  ];

  constructor(
    public theme: ThemeService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({
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