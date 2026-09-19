import { Component, EventEmitter, Input, NgZone, Output, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Producto } from '../../../shared/models/models';

// Para un producto nuevo aún no existe el id, así que lo hacemos opcional
// solo dentro de este formulario (el resto de los campos usan el mismo
// tipo Producto que ya usa toda la app, para que TypeScript no los trate
// como tipos distintos).
type ProductoForm = Omit<Producto, 'id'> & { id?: string };

@Component({
  selector: 'app-producto-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './producto-form.component.html',
  styleUrls: ['./producto-form.component.scss'],
})
export class ProductoFormComponent implements OnChanges {
  @Input() producto: Producto | null = null;
  @Output() cerrar = new EventEmitter<void>();
  @Output() guardado = new EventEmitter<void>();

  form: ProductoForm = this.formVacio();

  archivoImagen: File | null = null;
  previewUrl: string | null = null;

  guardando = false;
  errorMsg = '';

  constructor(private supabase: SupabaseService, private zone: NgZone) {}

  ngOnChanges(): void {
    this.form = this.producto ? { ...this.producto } : this.formVacio();
    this.previewUrl = this.producto?.imagen_url ?? null;
    this.archivoImagen = null;
    this.errorMsg = '';
  }

  get esEdicion(): boolean {
    return !!this.form.id;
  }

  onArchivoSeleccionado(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.archivoImagen = file;
    this.previewUrl = URL.createObjectURL(file);
  }

  async onGuardar(): Promise<void> {
    this.errorMsg = '';

    if (!this.form.nombre || !this.form.sku || this.form.precio == null) {
      this.errorMsg = 'Nombre, SKU y precio son obligatorios.';
      return;
    }

    this.guardando = true;

    try {
      let imagenUrl = this.form.imagen_url;

      if (this.archivoImagen) {
        imagenUrl = await this.subirImagen(this.archivoImagen);
      }

      const payload = {
        nombre: this.form.nombre,
        sku: this.form.sku,
        descripcion: this.form.descripcion || null,
        categoria: this.form.categoria || null,
        precio: this.form.precio,
        costo: this.form.costo ?? null,
        stock: this.form.stock ?? 0,
        imagen_url: imagenUrl || null,
      };

      const query = this.esEdicion
        ? this.supabase.client.from('productos').update(payload).eq('id', this.form.id)
        : this.supabase.client.from('productos').insert(payload);

      const { error } = await query;

      this.zone.run(() => {
        this.guardando = false;

        if (error) {
          this.errorMsg =
            error.code === '23505'
              ? 'Ya existe un producto con ese SKU.'
              : 'No se pudo guardar el producto.';
          return;
        }

        this.guardado.emit();
      });
    } catch (err) {
      this.zone.run(() => {
        this.guardando = false;
        this.errorMsg = 'No se pudo subir la imagen. Intenta de nuevo.';
      });
    }
  }

  private async subirImagen(file: File): Promise<string> {
    const extension = file.name.split('.').pop();
    const ruta = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;

    const { error } = await this.supabase.client.storage
      .from('productos')
      .upload(ruta, file, { upsert: false });

    if (error) throw error;

    const { data } = this.supabase.client.storage.from('productos').getPublicUrl(ruta);
    return data.publicUrl;
  }

  onCerrar(): void {
    this.cerrar.emit();
  }

  private formVacio(): ProductoForm {
    return {
      nombre: '',
      sku: '',
      descripcion: null,
      categoria: null,
      precio: 0,
      costo: null,
      stock: 0,
      imagen_url: null,
      activo: true,
    };
  }
}