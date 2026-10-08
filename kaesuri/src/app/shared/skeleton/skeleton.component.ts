import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Silueta gris animada que ocupa el lugar del contenido mientras carga.
 * - tarjetas: pedidos/cuadres en tarjetas (domiciliario, despachador)
 * - stats: fichas de números + un panel (inicio del vendedor, dashboard)
 * - filas: tablas y listas (pedidos, productos, usuarios, reportes...)
 * - formulario: campos con etiqueta (configuración)
 */
export type VarianteSkeleton = 'tarjetas' | 'stats' | 'filas' | 'formulario';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './skeleton.component.html',
  styleUrls: ['./skeleton.component.scss'],
})
export class SkeletonComponent {
  @Input() variante: VarianteSkeleton = 'tarjetas';
  /** Cuántas tarjetas / filas / campos dibujar. */
  @Input() cantidad = 3;

  get items(): number[] {
    return Array.from({ length: this.cantidad }, (_, i) => i);
  }

  /** Varía el largo de las líneas para que no se vea como una cuadrícula rígida. */
  ancho(i: number, base: number): string {
    return `${base - ((i * 17) % 30)}%`;
  }
}
