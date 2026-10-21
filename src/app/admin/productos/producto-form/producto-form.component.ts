import { Component, EventEmitter, Input, NgZone, Output, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Producto } from '../../../shared/models/models';
import { subirFoto } from '../../../shared/fotos';
import { ColoresProductoComponent } from '../../../shared/colores-producto/colores-producto.component';
import { TallasProductoComponent } from '../../../shared/tallas-producto/tallas-producto.component';
import { FotosProductoComponent } from '../../../shared/fotos-producto/fotos-producto.component';
import { VideosProductoComponent } from '../../../shared/videos-producto/videos-producto.component';

// Para un producto nuevo aún no existe el id, así que lo hacemos opcional
// solo dentro de este formulario (el resto de los campos usan el mismo
// tipo Producto que ya usa toda la app, para que TypeScript no los trate
// como tipos distintos).
type ProductoForm = Omit<Producto, 'id'> & { id?: string };

@Component({
  selector: 'app-producto-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ColoresProductoComponent, TallasProductoComponent, FotosProductoComponent, VideosProductoComponent],
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
    this.form = this.producto
      ? { ...this.producto, imagenes: this.producto.imagenes ?? [], tallas: this.producto.tallas ?? [], videos: this.producto.videos ?? [] }
      : this.formVacio();
    this.previewUrl = this.producto?.imagen_url ?? null;
    this.archivoImagen = null;
    this.errorMsg = '';
  }

  get esEdicion(): boolean {
    return !!this.form.id;
  }

  // Comisión sugerida por unidad, solo para que el admin vea cuánto le
  // queda al vendedor con estos precios (no se guarda como tal, se
  // recalcula siempre a partir de precio_base y precio_sugerido).
  get comisionSugerida(): number {
    return (this.form.precio_sugerido ?? 0) - (this.form.precio_base ?? 0);
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

    if (!this.form.nombre || !this.form.sku || this.form.precio_sugerido == null) {
      this.errorMsg = 'Nombre, SKU y precio sugerido son obligatorios.';
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
        precio_base: this.form.precio_base ?? 0,
        precio_sugerido: this.form.precio_sugerido,
        costo: this.form.costo ?? null,
        stock: this.form.stock ?? 0,
        imagen_url: imagenUrl || null,
        imagenes: this.form.imagenes ?? [],
        tallas: this.form.tallas ?? [],
        videos: this.form.videos ?? [],
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

  /** Foto principal: se achica y se guarda con su miniatura, como las demás fotos */
  private subirImagen(file: File): Promise<string> {
    return subirFoto(this.supabase.client, file, 'productos');
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
      precio_base: 0,
      precio_sugerido: 0,
      costo: null,
      stock: 0,
      imagen_url: null,
      activo: true,
      imagenes: [],
      tallas: [],
      videos: [],
    };
  }
}