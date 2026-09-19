import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-inicio-vendedor',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="inicio-vendedor">
      <header class="header">
        <h1>Vendedor</h1>
        <button class="logout-btn" (click)="logout()">Salir</button>
      </header>

      <a routerLink="/vendedor/nuevo-pedido" class="btn-nuevo-pedido">+ Nuevo pedido</a>

      <p class="hint">Aquí más adelante va el listado de tus pedidos recientes.</p>
    </div>
  `,
  styles: [`
    .inicio-vendedor {
      padding: 32px 24px;
      max-width: 480px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .header h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0;
    }
    .logout-btn {
      border: none;
      background: none;
      color: var(--k-text-soft);
      font-size: 14px;
      cursor: pointer;
    }
    .btn-nuevo-pedido {
      display: block;
      text-align: center;
      padding: 14px;
      border-radius: 12px;
      background: var(--k-ink);
      color: var(--k-paper);
      font-weight: 600;
      text-decoration: none;
      margin-bottom: 20px;
    }
    .hint {
      color: var(--k-text-soft);
      font-size: 14px;
      text-align: center;
    }
  `],
})
export class InicioPage {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async logout() {
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}