import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Component({
  selector: 'app-init',
  standalone: true,
  template: `<div class="app-init"><p>Cargando...</p></div>`,
  styles: [
    `
      .app-init {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--k-text-soft);
        font-family: var(--k-font);
        font-size: 14px;
      }
    `,
  ],
})
export class AppInitPage implements OnInit {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    const profile = await this.supabase.getCurrentProfile();

    if (!profile) {
      this.router.navigateByUrl('/auth/login');
      return;
    }

    switch (profile.role) {
      case 'admin':
        this.router.navigateByUrl('/admin');
        break;
      case 'vendedor':
        this.router.navigateByUrl('/vendedor');
        break;
      case 'domiciliario':
        this.router.navigateByUrl('/domiciliario');
        break;
    }
  }
}