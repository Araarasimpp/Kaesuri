import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

/** Mensajes cortos abajo de la pantalla (como en Jasta); el estilo .toast viene de jasta-ui.scss */
@Component({
  selector: 'app-toast',
  standalone: true,
  host: { class: 'jt' },
  template: `
    @if (t.mensaje(); as m) {
      <div class="toast" [class.mal]="m.mal" role="status">{{ m.texto }}</div>
    }
  `,
})
export class ToastComponent {
  t = inject(ToastService);
}
