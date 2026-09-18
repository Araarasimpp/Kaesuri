import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
export class ProductosPage implements OnInit {
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

  constructor(private supabase: SupabaseService) {}

  async ngOnInit(): Promise<void> {
    await this.cargarProductos();
  }

  async cargarProductos(): Promise<void> {
    this.loading = true;
    const { data, error } = await this.supabase.client
      .from('productos')
      .select('id, nombre, sku, descripcion, categoria, precio, costo, stock, imagen_url')
      .order('nombre');

    if (!error && data) {
      this.productos = data as Producto[];
    }
    this.loading = false;
  }

  get filtrados(): Producto[] {
    let lista = this.productos;

    if (this.tab === 'activos') {
      lista = lista.filter((p) => p.stock > 0);
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

  inicial(nombre: string): string {
    return nombre.charAt(0).toUpperCase();
  }
}