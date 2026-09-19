import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { Producto } from '../../shared/models/models';

interface ItemCarrito {
  producto: Producto;
  cantidad: number;
}

@Component({
  selector: 'app-nuevo-pedido',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './nuevo-pedido.page.html',
  styleUrls: ['./nuevo-pedido.page.scss'],
})
export class NuevoPedidoPage implements OnInit {
  loadingProductos = true;
  productos: Producto[] = [];
  busquedaProducto = '';

  carrito: ItemCarrito[] = [];

  clienteNombre = '';
  clienteTelefono = '';
  direccion = '';
  barrio = '';
  valorDomicilio: number = 0;
  observaciones = '';

  guardando = false;
  errorMsg = '';

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.cargarProductos();
  }

  async cargarProductos(): Promise<void> {
    this.loadingProductos = true;
    const { data, error } = await this.supabase.client
      .from('productos')
      .select('id, nombre, sku, descripcion, categoria, precio, costo, stock, imagen_url, activo')
      .eq('activo', true)
      .gt('stock', 0)
      .order('nombre');

    if (!error && data) {
      this.productos = data as Producto[];
    }
    this.loadingProductos = false;
    this.cdr.detectChanges();
  }

  get productosFiltrados(): Producto[] {
    if (!this.busquedaProducto.trim()) return this.productos;
    const q = this.busquedaProducto.trim().toLowerCase();
    return this.productos.filter(
      (p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }

  // Cuánto de un producto ya está en el carrito (para no dejar agregar más del stock disponible)
  cantidadEnCarrito(productoId: string): number {
    return this.carrito.find((i) => i.producto.id === productoId)?.cantidad ?? 0;
  }

  agregarProducto(producto: Producto): void {
    const existente = this.carrito.find((i) => i.producto.id === producto.id);

    if (existente) {
      if (existente.cantidad < producto.stock) {
        existente.cantidad++;
      }
    } else {
      this.carrito.push({ producto, cantidad: 1 });
    }
  }

  incrementar(item: ItemCarrito): void {
    if (item.cantidad < item.producto.stock) {
      item.cantidad++;
    }
  }

  decrementar(item: ItemCarrito): void {
    item.cantidad--;
    if (item.cantidad <= 0) {
      this.quitarDelCarrito(item);
    }
  }

  quitarDelCarrito(item: ItemCarrito): void {
    this.carrito = this.carrito.filter((i) => i.producto.id !== item.producto.id);
  }

  get subtotal(): number {
    return this.carrito.reduce((sum, i) => sum + i.cantidad * i.producto.precio, 0);
  }

  get total(): number {
    return this.subtotal + (Number(this.valorDomicilio) || 0);
  }

  async onCrearPedido(): Promise<void> {
    this.errorMsg = '';

    if (this.carrito.length === 0) {
      this.errorMsg = 'Agrega al menos un producto al pedido.';
      return;
    }

    if (!this.clienteNombre || !this.direccion) {
      this.errorMsg = 'Nombre del cliente y dirección son obligatorios.';
      return;
    }

    this.guardando = true;

    const items = this.carrito.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
      precio_unitario: i.producto.precio,
    }));

    const { data, error } = await this.supabase.client.rpc('crear_pedido', {
      p_cliente_nombre: this.clienteNombre,
      p_cliente_telefono: this.clienteTelefono || null,
      p_direccion: this.direccion,
      p_barrio: this.barrio || null,
      p_valor_domicilio: Number(this.valorDomicilio) || 0,
      p_observaciones: this.observaciones || null,
      p_items: items,
    });

    this.guardando = false;

    if (error) {
      // error.message trae el texto exacto del raise exception en Postgres,
      // por ejemplo "Stock insuficiente para el producto ...: disponible 2, solicitado 5"
      this.errorMsg = error.message;
      this.cdr.detectChanges();
      return;
    }

    const numeroPedido = data as number;
    alert(`Pedido #${numeroPedido} creado con éxito.`);

    const volverA = (this.route.snapshot.data['volverA'] as string) ?? '/vendedor';
    this.router.navigateByUrl(volverA);
  }

  formatoMoneda(valor: number): string {
    return (valor || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}