import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { pesos } from '../formato';
import { TransferenciasAlertaService } from './transferencias-alerta.service';

/** Franja roja arriba de las páginas del admin mientras haya transferencias sin revisar (como en Jasta) */
@Component({
  selector: 'app-transferencias-alerta',
  standalone: true,
  imports: [RouterLink],
  styles: [
    `
      :host { display: contents; }
      a { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap;
        padding: 10px 16px; padding-top: calc(10px + env(safe-area-inset-top)); background: var(--danger); color: #fff; font-size: 14px; font-weight: 650;
        text-decoration: none; text-align: center; animation: latido 1.8s ease-in-out infinite; }
      a .ir { padding: 3px 12px; border-radius: 999px; background: #fff; color: var(--danger); font-size: 13px; font-weight: 750; white-space: nowrap; }
      @keyframes latido { 50% { filter: brightness(1.18); } }
      @media (prefers-reduced-motion: reduce) { a { animation: none; } }
    `,
  ],
  template: `
    @if (alerta.n() && !enPagina()) {
      <a routerLink="/admin/transferencias" role="alert">
        <span>🚨 {{ alerta.n() }} {{ alerta.n() === 1 ? 'transferencia sin revisar' : 'transferencias sin revisar' }} · {{ pesos(alerta.valor()) }}</span>
        <span class="ir">Revisar ahora</span>
      </a>
    }
  `,
})
export class TransferenciasAlertaComponent implements OnInit, OnDestroy {
  alerta = inject(TransferenciasAlertaService);
  private router = inject(Router);
  pesos = pesos;
  enPagina = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url.startsWith('/admin/transferencias'))),
    { initialValue: this.router.url.startsWith('/admin/transferencias') }
  );

  ngOnInit(): void {
    this.alerta.iniciar();
  }

  ngOnDestroy(): void {
    this.alerta.detener();
  }
}
