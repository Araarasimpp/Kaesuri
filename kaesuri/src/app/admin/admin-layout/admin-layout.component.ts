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
  add,
  sunnyOutline,
  moonOutline,
  chevronBackOutline,
  chevronForwardOutline,
  logOutOutline,
} from 'ionicons/icons';
import { ThemeService } from '../../core/services/theme.service';
import { SupabaseService } from '../../core/services/supabase.service';

interface MenuItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon],
  templateUrl: './admin-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './admin-layout.component.scss'],
})
export class AdminLayoutComponent {
  collapsed = false;

  menuItems: MenuItem[] = [
    { label: 'Inicio', path: '/admin', icon: 'home-outline' },
    { label: 'Pedidos', path: '/admin/pedidos', icon: 'receipt-outline' },
    { label: 'Cuadres', path: '/admin/cuadres', icon: 'wallet-outline' },
    { label: 'Productos', path: '/admin/productos', icon: 'cube-outline' },
    { label: 'Usuarios', path: '/admin/usuarios', icon: 'people-outline' },
  ];

  constructor(
    public theme: ThemeService,
    private supabase: SupabaseService,
    private router: Router
  ) {
    addIcons({
      homeOutline,
      receiptOutline,
      cubeOutline,
      peopleOutline,
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