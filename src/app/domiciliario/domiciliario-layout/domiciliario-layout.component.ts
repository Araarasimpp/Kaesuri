import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { homeOutline, walletOutline, logOutOutline, sunnyOutline, moonOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ThemeService } from '../../core/services/theme.service';

import { NotificacionesComponent } from '../../shared/notificaciones/notificaciones.component';
import { CambiarAreaComponent } from '../../shared/cambiar-area/cambiar-area.component';
@Component({
  selector: 'app-domiciliario-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon, NotificacionesComponent, CambiarAreaComponent],
  templateUrl: './domiciliario-layout.component.html',
  styleUrls: ['../../shared/pill-nav.scss', './domiciliario-layout.component.scss'],
})
export class DomiciliarioLayoutComponent {
  constructor(
    private supabase: SupabaseService,
    private router: Router,
    public theme: ThemeService
  ) {
    addIcons({ homeOutline, walletOutline, logOutOutline, sunnyOutline, moonOutline });
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  async logout(): Promise<void> {
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}