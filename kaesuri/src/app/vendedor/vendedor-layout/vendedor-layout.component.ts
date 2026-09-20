import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { homeOutline, addCircleOutline, logOutOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-vendedor-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, IonIcon],
  templateUrl: './vendedor-layout.component.html',
  styleUrls: ['./vendedor-layout.component.scss'],
})
export class VendedorLayoutComponent {
  constructor(private supabase: SupabaseService, private router: Router) {
    addIcons({ homeOutline, addCircleOutline, logOutOutline });
  }

  async logout(): Promise<void> {
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}