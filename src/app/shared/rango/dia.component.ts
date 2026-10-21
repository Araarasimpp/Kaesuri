import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { hoyColombiaISO } from '../fecha-colombia';
import { RangoFechas, diaLargo, sumarDias } from './rango.component';

/** Filtro de un día: arranca en hoy, con flechas para el día anterior y el siguiente */
@Component({
  selector: 'app-dia',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon],
  styles: [
    `
      :host { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
      .flecha { width: 34px; height: 34px; flex-shrink: 0; display: grid; place-items: center; padding: 0; }
      .flecha ion-icon { font-size: 16px; }
      input { width: 150px; }
      .hoy { height: 34px; flex-shrink: 0; }
    `,
  ],
  template: `
    <button class="b flecha" type="button" aria-label="Día anterior" (click)="mover(-1)"><ion-icon name="chevron-back-outline"></ion-icon></button>
    <input class="inp inp-chico num" type="date" [max]="hoy" [ngModel]="dia()" (ngModelChange)="poner($event)" aria-label="Fecha" />
    <button class="b flecha" type="button" aria-label="Día siguiente" [disabled]="dia() >= hoy" (click)="mover(1)"><ion-icon name="chevron-forward-outline"></ion-icon></button>
    @if (dia() !== hoy) {
      <button class="b hoy" type="button" (click)="poner(hoy)">Hoy</button>
    }
  `,
})
export class DiaComponent implements OnInit {
  /** Día con el que arranca (YYYY-MM-DD); por defecto hoy */
  @Input() inicial = '';
  @Output() cambio = new EventEmitter<RangoFechas>();
  hoy = hoyColombiaISO();
  dia = signal(this.hoy);

  constructor() {
    addIcons({ chevronBackOutline, chevronForwardOutline });
  }

  ngOnInit(): void {
    this.poner(this.inicial || this.hoy);
  }

  mover(n: number): void {
    this.poner(sumarDias(this.dia(), n));
  }

  poner(d: string): void {
    if (!d) return;
    this.dia.set(d);
    this.cambio.emit({ desde: d, hasta: d, etiqueta: diaLargo(d) });
  }
}
