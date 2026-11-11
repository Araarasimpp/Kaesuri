import { Directive, ElementRef, HostListener, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/** "85000" → "$ 85.000" (pesos colombianos, sin decimales) */
export function formatoPesos(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  return '$ ' + Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Campo de plata con formato COP mientras se escribe: <input pesos [(ngModel)]="valor" />
 * Se ve "$ 85.000" (puntos de miles, sin decimales) y el modelo recibe el número 85000
 * (o null si está vacío). El cursor no salta al poner los puntos. Abre el teclado numérico.
 */
@Directive({
  selector: 'input[pesos]',
  standalone: true,
  host: { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'num' },
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PesosDirective), multi: true }],
})
export class PesosDirective implements ControlValueAccessor {
  private el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private alCambiar: (v: number | null) => void = () => undefined;
  private alTocar: () => void = () => undefined;

  writeValue(v: number | string | null): void {
    const n = v === null || v === undefined || v === '' ? null : Number(v);
    this.el.nativeElement.value = n === null || Number.isNaN(n) ? '' : formatoPesos(n);
  }

  registerOnChange(fn: (v: number | null) => void): void {
    this.alCambiar = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.alTocar = fn;
  }

  setDisabledState(desactivado: boolean): void {
    this.el.nativeElement.disabled = desactivado;
  }

  @HostListener('input')
  escribir(): void {
    const input = this.el.nativeElement;
    // Cuántos dígitos hay antes del cursor, para dejarlo en el mismo sitio después de formatear
    const cursor = input.selectionStart ?? input.value.length;
    const digitosAntes = input.value.slice(0, cursor).replace(/\D/g, '').length;
    const digitos = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
    const n = digitos ? Number(digitos) : null;
    const texto = formatoPesos(n);
    input.value = texto;
    let pos = texto.length;
    if (digitosAntes < digitos.length) {
      let vistos = 0;
      pos = 0;
      for (let i = 0; i < texto.length && vistos < digitosAntes; i++) {
        if (/\d/.test(texto[i])) vistos++;
        pos = i + 1;
      }
      if (digitosAntes === 0) pos = texto.indexOf(digitos[0] ?? '') >= 0 ? texto.search(/\d/) : texto.length;
    }
    try { input.setSelectionRange(pos, pos); } catch { /* algunos navegadores no lo permiten */ }
    this.alCambiar(n);
  }

  @HostListener('blur')
  salir(): void {
    this.alTocar();
  }
}
