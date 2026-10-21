import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { hoyColombiaISO } from '../fecha-colombia';

export type Rango = 'todo' | 'hoy' | 'ayer' | '7' | 'mes' | 'mes_pasado' | 'otro';
export interface RangoFechas {
  desde: string; // YYYY-MM-DD (Colombia); vacío = sin límite
  hasta: string;
  etiqueta: string;
}

export function sumarDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diaLargo(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function diaCorto(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Selector de periodo (Hoy, Ayer, 7 días, mes, mes pasado u otro rango) */
@Component({
  selector: 'app-rango',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule],
  styles: [`:host { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; } input { width: 140px; }`],
  template: `
    <div class="segmented">
      @for (r of opciones(); track r.id) {
        <button [class.on]="rango() === r.id" (click)="elegir(r.id)">{{ r.label }}</button>
      }
    </div>
    @if (rango() === 'otro') {
      <input class="inp inp-chico" type="date" [(ngModel)]="desde" (change)="emitir()" aria-label="Desde" />
      <input class="inp inp-chico" type="date" [(ngModel)]="hasta" (change)="emitir()" aria-label="Hasta" />
    }
  `,
})
export class RangoComponent implements OnInit {
  /** Agrega la opción "Todo" (sin filtro de fechas) */
  @Input() conTodo = false;
  /** Periodo con el que arranca */
  @Input() inicial: Rango = 'hoy';
  @Output() cambio = new EventEmitter<RangoFechas>();
  rangos: { id: Rango; label: string }[] = [
    { id: 'hoy', label: 'Hoy' },
    { id: 'ayer', label: 'Ayer' },
    { id: '7', label: '7 días' },
    { id: 'mes', label: 'Este mes' },
    { id: 'mes_pasado', label: 'Mes pasado' },
    { id: 'otro', label: 'Otro' },
  ];
  rango = signal<Rango>('hoy');
  opciones = signal(this.rangos);
  desde = hoyColombiaISO();
  hasta = hoyColombiaISO();

  ngOnInit(): void {
    if (this.conTodo) this.opciones.set([{ id: 'todo', label: 'Todo' }, ...this.rangos]);
    this.elegir(this.inicial);
  }

  elegir(r: Rango): void {
    this.rango.set(r);
    const hoy = hoyColombiaISO();
    if (r === 'todo') {
      this.cambio.emit({ desde: '', hasta: '', etiqueta: 'Todas las fechas' });
      return;
    }
    if (r === 'otro' && (!this.desde || !this.hasta)) [this.desde, this.hasta] = [hoy, hoy];
    if (r === 'hoy') [this.desde, this.hasta] = [hoy, hoy];
    if (r === 'ayer') [this.desde, this.hasta] = [sumarDias(hoy, -1), sumarDias(hoy, -1)];
    if (r === '7') [this.desde, this.hasta] = [sumarDias(hoy, -6), hoy];
    if (r === 'mes') [this.desde, this.hasta] = [hoy.slice(0, 8) + '01', hoy];
    if (r === 'mes_pasado') {
      const fin = sumarDias(hoy.slice(0, 8) + '01', -1);
      [this.desde, this.hasta] = [fin.slice(0, 8) + '01', fin];
    }
    this.emitir();
  }

  emitir(): void {
    if (!this.desde || !this.hasta) return;
    if (this.desde > this.hasta) [this.desde, this.hasta] = [this.hasta, this.desde];
    const etiqueta = this.desde === this.hasta ? diaLargo(this.desde) : `${diaLargo(this.desde)} – ${diaLargo(this.hasta)}`;
    this.cambio.emit({ desde: this.desde, hasta: this.hasta, etiqueta });
  }
}
