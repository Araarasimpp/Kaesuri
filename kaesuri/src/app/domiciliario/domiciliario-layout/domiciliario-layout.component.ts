import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { homeOutline, walletOutline, logOutOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-domiciliario-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon],
  templateUrl: './domiciliario-layout.component.html',
  styleUrls: ['./domiciliario-layout.component.scss'],
})
export class DomiciliarioLayoutComponent {
  constructor(private supabase: SupabaseService, private router: Router) {
    addIcons({ homeOutline, walletOutline, logOutOutline });
  }

  async logout(): Promise<void> {
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}