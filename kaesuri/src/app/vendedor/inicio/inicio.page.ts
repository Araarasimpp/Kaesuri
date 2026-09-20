import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-inicio-vendedor',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="inicio-vendedor">
      <h1>Hola</h1>
      <a routerLink="/vendedor/nuevo-pedido" class="btn-nuevo-pedido">+ Nuevo pedido</a>
      <p class="hint">Aquí más adelante va el listado de tus pedidos recientes.</p>
    </div>
  `,
  styles: [`
    .inicio-vendedor {
      padding: 24px 20px;
      max-width: 480px;
      margin: 0 auto;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 20px;
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
export class InicioPage {}