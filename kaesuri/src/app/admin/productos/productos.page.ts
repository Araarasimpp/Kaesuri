import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { SupabaseService } from '../../core/services/supabase.service';
import { ProductoFormComponent } from './producto-form/producto-form.component';
import { Producto } from '../../shared/models/models';

type TabFiltro = 'activos' | 'todos';

@Component({
  selector: 'app-productos',
  standalone: true,
  imports: [CommonModule, FormsModule, ProductoFormComponent],
  templateUrl: './productos.page.html',
  styleUrls: ['./productos.page.scss'],
})
export class ProductosPage implements OnInit, OnDestroy {
  loading = true;
  productos: Producto[] = [];
  busqueda = '';
  tab: TabFiltro = 'activos';
  seleccionados = new Set<string>();

  paginaActual = 1;
  porPagina = 10;

  modalAbierto = false;
  productoEditando: Producto | null = null;
  menuAbiertoId: string | null = null;

  cargandoExcel = false;
  resumenCarga: { creados: number; errores: string[] } | null = null;

  private canal: RealtimeChannel | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarProductos();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('productos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'productos' },
        () => {
          this.cargarProductos();
        }
      )
      .subscribe();
  }

  async cargarProductos(): Promise<void> {
    this.loading = true;
    const { data, error } = await this.supabase.client
      .from('productos')
      .select('id, nombre, sku, descripcion, categoria, precio, costo, stock, imagen_url, activo')
      .order('nombre');

    if (!error && data) {
      this.productos = data as Producto[];
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  get filtrados(): Producto[] {
    let lista = this.productos;

    if (this.tab === 'activos') {
      lista = lista.filter((p) => p.activo);
    }

    if (this.busqueda.trim()) {
      const q = this.busqueda.trim().toLowerCase();
      lista = lista.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      );
    }

    return lista;
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.filtrados.length / this.porPagina));
  }

  get paginados(): Producto[] {
    const inicio = (this.paginaActual - 1) * this.porPagina;
    return this.filtrados.slice(inicio, inicio + this.porPagina);
  }

  cambiarTab(tab: TabFiltro): void {
    this.tab = tab;
    this.paginaActual = 1;
  }

  irAPagina(delta: number): void {
    const next = this.paginaActual + delta;
    if (next >= 1 && next <= this.totalPaginas) {
      this.paginaActual = next;
    }
  }

  toggleSeleccion(id: string): void {
    if (this.seleccionados.has(id)) {
      this.seleccionados.delete(id);
    } else {
      this.seleccionados.add(id);
    }
  }

  toggleMenu(id: string): void {
    this.menuAbiertoId = this.menuAbiertoId === id ? null : id;
  }

  abrirNuevo(): void {
    this.productoEditando = null;
    this.modalAbierto = true;
  }

  abrirEditar(producto: Producto): void {
    this.productoEditando = producto;
    this.modalAbierto = true;
    this.menuAbiertoId = null;
  }

  cerrarModal(): void {
    this.modalAbierto = false;
  }

  async onGuardado(): Promise<void> {
    this.modalAbierto = false;
    await this.cargarProductos();
  }

  async eliminarProducto(producto: Producto): Promise<void> {
    this.menuAbiertoId = null;

    const confirmado = confirm(
      `¿Eliminar "${producto.nombre}"? No aparecerá más en el catálogo, pero se conserva en pedidos anteriores.`
    );
    if (!confirmado) return;

    const { error } = await this.supabase.client
      .from('productos')
      .update({ activo: false })
      .eq('id', producto.id);

    if (!error) {
      await this.cargarProductos();
    } else {
      this.cdr.detectChanges();
    }
  }

  async reactivarProducto(producto: Producto): Promise<void> {
    this.menuAbiertoId = null;

    const { error } = await this.supabase.client
      .from('productos')
      .update({ activo: true })
      .eq('id', producto.id);

    if (!error) {
      await this.cargarProductos();
    } else {
      this.cdr.detectChanges();
    }
  }

  estadoStock(stock: number): { texto: string; clase: string } {
    if (stock === 0) return { texto: 'Agotado', clase: 'estado-agotado' };
    if (stock < 5) return { texto: 'Stock bajo', clase: 'estado-bajo' };
    return { texto: 'Disponible', clase: 'estado-ok' };
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  async onArchivoExcel(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.cargandoExcel = true;
    this.resumenCarga = null;
    this.cdr.detectChanges();

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const filas: any[] = XLSX.utils.sheet_to_json(hoja, { defval: null });

      const errores: string[] = [];
      const productosValidos: any[] = [];

      filas.forEach((fila, i) => {
        const numFila = i + 2; // +2 porque la fila 1 es el encabezado
        const nombre = String(fila.nombre ?? '').trim();
        const sku = String(fila.sku ?? '').trim();
        const precio = Number(fila.precio);

        if (!nombre || !sku || !fila.precio || isNaN(precio)) {
          errores.push(`Fila ${numFila}: falta nombre, sku o precio válido — se omitió.`);
          return;
        }

        productosValidos.push({
          nombre,
          sku,
          categoria: fila.categoria ? String(fila.categoria).trim() : null,
          descripcion: fila.descripcion ? String(fila.descripcion).trim() : null,
          precio,
          costo: fila.costo != null && fila.costo !== '' ? Number(fila.costo) : null,
          stock: fila.stock != null && fila.stock !== '' ? Number(fila.stock) : 0,
          activo: true,
        });
      });

      if (productosValidos.length) {
        // upsert por sku: si el SKU ya existe, actualiza ese producto en vez
        // de crear uno duplicado — así se puede resubir el mismo Excel corregido.
        const { error } = await this.supabase.client
          .from('productos')
          .upsert(productosValidos, { onConflict: 'sku' });

        if (error) {
          errores.push(`Error al guardar: ${error.message}`);
        }
      }

      this.resumenCarga = { creados: productosValidos.length, errores };

      await this.cargarProductos();
    } catch (err) {
      this.resumenCarga = { creados: 0, errores: ['No se pudo leer el archivo. ¿Es un .xlsx válido?'] };
    }

    this.cargandoExcel = false;
    input.value = '';
    this.cdr.detectChanges();
  }

  inicial(nombre: string): string {
    return nombre.charAt(0).toUpperCase();
  }
}