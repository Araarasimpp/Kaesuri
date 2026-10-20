import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-imagen-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './imagen-preview.component.html',
  styleUrls: ['./imagen-preview.component.scss'],
})
export class ImagenPreviewComponent {
  @Input() url: string | null = null;
  @Output() cerrar = new EventEmitter<void>();

  onCerrar(): void {
    this.cerrar.emit();
  }
}