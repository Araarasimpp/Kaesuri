import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, closeOutline } from 'ionicons/icons';

const GRUPOS: { nombre: string; tallas: string[] }[] = [
  { nombre: 'Ropa', tallas: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { nombre: 'Niños', tallas: ['2', '4', '6', '8', '10', '12', '14', '16'] },
  { nombre: 'Calzado', tallas: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44'] },
  { nombre: 'Anillos', tallas: ['5', '6', '7', '8', '9', '10', '11', '12'] },
  { nombre: 'Única', tallas: ['Única'] },
];

/**
 * Tallas de un producto. Vacío = el producto no maneja tallas.
 * Se agregan escribiéndolas (Enter o coma separa) o con un grupo de un toque.
 */
@Component({
  selector: 'app-tallas-producto',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon],
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 10px; }
      .lista { display: flex; flex-wrap: wrap; gap: 6px; min-height: 34px; align-items: center; }
      .talla { display: inline-flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px 0 12px; border-radius: 16px; background: var(--text); color: var(--bg);
        font-family: var(--mono-font); font-size: 13px; font-weight: 600; animation: entra 180ms ease both; }
      @keyframes entra { from { opacity: 0; transform: scale(0.9); } }
      .talla button { width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: none; color: inherit; cursor: pointer; font-size: 15px; opacity: 0.75; }
      @media (hover: hover) { .talla button:hover { opacity: 1; background: rgba(255, 255, 255, 0.15); } }
      .vacia { font-size: 13px; color: var(--text-muted); }
      .nueva { display: flex; gap: 8px; }
      .nueva input { flex: 1; min-width: 0; }
      .grupos { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .grupos span { font-size: 12px; color: var(--text-muted); margin-right: 2px; }
      .grupo { height: 30px; padding: 0 11px; border: 1px dashed var(--border-strong); border-radius: 15px; background: none; color: var(--text-soft); font: inherit; font-size: 12.5px; cursor: pointer; }
      @media (hover: hover) { .grupo:hover { border-color: var(--accent); color: var(--text); } }
    `,
  ],
  template: `
    <div class="lista" aria-live="polite">
      @for (t of tallas; track t) {
        <span class="talla">{{ t }}<button type="button" (click)="quitar(t)" [attr.aria-label]="'Quitar talla ' + t"><ion-icon name="close-outline"></ion-icon></button></span>
      } @empty {
        <span class="vacia">Sin tallas: el producto se vende sin elegir talla.</span>
      }
    </div>
    <div class="nueva">
      <input class="inp" [(ngModel)]="texto" placeholder="Escribe una talla (ej: M, 38, Única)" maxlength="80" aria-label="Nueva talla"
        (keydown.enter)="$event.preventDefault(); agregarTexto()" (keydown)="coma($event)" (blur)="agregarTexto()" />
      <button type="button" class="b" (click)="agregarTexto()" [disabled]="!texto.trim()"><ion-icon name="add"></ion-icon>Agregar</button>
    </div>
    <div class="grupos">
      <span>Rápido:</span>
      @for (g of grupos; track g.nombre) {
        <button type="button" class="grupo" (click)="agregar(g.tallas)" [title]="g.tallas.join(', ')">{{ g.nombre }}</button>
      }
      @if (tallas.length) { <button type="button" class="grupo" (click)="cambio.emit([])">Quitar todas</button> }
    </div>
  `,
})
export class TallasProductoComponent {
  @Input() tallas: string[] = [];
  @Output() cambio = new EventEmitter<string[]>();

  texto = '';
  readonly grupos = GRUPOS;

  constructor() {
    addIcons({ add, closeOutline });
  }

  coma(ev: KeyboardEvent): void {
    if (ev.key === ',') {
      ev.preventDefault();
      this.agregarTexto();
    }
  }

  agregarTexto(): void {
    const nuevas = this.texto.split(',').map((t) => t.trim()).filter(Boolean);
    this.texto = '';
    if (nuevas.length) this.agregar(nuevas);
  }

  agregar(nuevas: string[]): void {
    const l = [...this.tallas];
    for (const t of nuevas.map((x) => x.slice(0, 40))) {
      if (l.length >= 40) break;
      if (!l.some((x) => x.toLowerCase() === t.toLowerCase())) l.push(t);
    }
    this.cambio.emit(l);
  }

  quitar(t: string): void {
    this.cambio.emit(this.tallas.filter((x) => x !== t));
  }
}
