import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { MetodoPago, Producto } from '../../shared/models/models';
import { urlMini } from '../../shared/formato';

import { avisar, confirmar } from '../../shared/dialogo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
interface ItemCarrito {
  /** Cada línea es un producto con un color y una talla */
  key: number;
  producto: Producto;
  cantidad: number;
  color: string | null;
  talla: string | null;
  // Precio al que se vende ESTE pedido. Arranca en precio_sugerido, pero el
  // vendedor lo puede subir si vende más caro — ahí su comisión sube también.
  precioUnitario: number;
}

@Component({
  selector: 'app-nuevo-pedido',
  standalone: true,
  imports: [SkeletonComponent, CommonModule, FormsModule],
  templateUrl: './nuevo-pedido.page.html',
  styleUrls: ['./nuevo-pedido.page.scss'],
})
export class NuevoPedidoPage implements OnInit {
  loadingProductos = true;
  productos: Producto[] = [];
  busquedaProducto = '';

  carrito: ItemCarrito[] = [];
  private claves = 0;
  urlMini = urlMini;

  clienteNombre = '';
  clienteTelefono = '';
  direccion = '';
  barrio = '';
  zonas: { id: string; nombre: string; valor: number }[] = [];
  valorDomicilio: number = 0;
  observaciones = '';

  guardando = false;
  errorMsg = '';

  /** Venta en el punto físico (ruta con data.modo = 'local'): queda entregada y cobrada de una vez */
  local = false;
  vendedores: { id: string; nombre: string }[] = [];
  vendedorId: string | null = null;
  readonly metodos: { id: MetodoPago; label: string }[] = [
    { id: 'efectivo', label: 'Efectivo' },
    { id: 'transferencia', label: 'Transferencia' },
    { id: 'mixto', label: 'Mixto' },
  ];
  metodo: MetodoPago = 'efectivo';
  efectivo: number | null = null;

  /** Editando un pedido existente (admin y despachador, desde Pedidos → Editar pedido) */
  editarId: string | null = null;
  numeroEditando: number | null = null;
  /** Lo que el pedido ya tenía de cada producto: vuelve al inventario al guardar, así que cuenta como disponible */
  private enPedido = new Map<string, number>();

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.local = this.route.snapshot.data['modo'] === 'local';
    this.editarId = this.local ? null : this.route.snapshot.queryParamMap.get('editar');
    if (this.editarId) await this.cargarPedido(this.editarId);
    await this.cargarProductos();
    if (this.local) await this.cargarVendedores();
    else await this.cargarZonas();
    if (this.editarId) this.armarCarritoDelPedido();
    else this.agregarDesdeCatalogo();
  }

  /** Desde el catálogo llega ?producto=…&color=…: el producto ya queda en el carrito */
  private agregarDesdeCatalogo(): void {
    const q = this.route.snapshot.queryParamMap;
    const producto = this.productos.find((p) => p.id === q.get('producto'));
    if (!producto) return;
    this.agregarProducto(producto);
    const linea = this.carrito.at(-1);
    const color = q.get('color');
    if (linea && color && producto.colores?.some((c) => c.nombre === color)) linea.color = color;
    this.cdr.detectChanges();
  }

  private itemsDelPedido: { producto_id: string; cantidad: number; precio_unitario: number; color: string | null; talla: string | null }[] = [];

  /** Trae el pedido a editar y llena los datos del cliente */
  private async cargarPedido(id: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select('numero, estado, cliente_nombre, cliente_telefono, direccion, barrio, valor_domicilio, observaciones, pedido_items(producto_id, cantidad, precio_unitario, color, talla)')
      .eq('id', id)
      .single();
    if (error || !data) {
      this.errorMsg = 'No se encontró el pedido para editar.';
      this.editarId = null;
      return;
    }
    const p = data as any;
    if (p.estado !== 'pendiente' && p.estado !== 'en_ruta') {
      this.errorMsg = 'Este pedido ya no se puede editar.';
      this.editarId = null;
      return;
    }
    this.numeroEditando = p.numero;
    this.clienteNombre = p.cliente_nombre ?? '';
    this.clienteTelefono = p.cliente_telefono ?? '';
    this.direccion = p.direccion ?? '';
    this.barrio = p.barrio ?? '';
    this.valorDomicilio = Number(p.valor_domicilio) || 0;
    this.observaciones = p.observaciones ?? '';
    this.itemsDelPedido = p.pedido_items ?? [];
    for (const i of this.itemsDelPedido) this.enPedido.set(i.producto_id, (this.enPedido.get(i.producto_id) ?? 0) + i.cantidad);
  }

  private armarCarritoDelPedido(): void {
    for (const i of this.itemsDelPedido) {
      const producto = this.productos.find((p) => p.id === i.producto_id);
      if (!producto) continue;
      this.carrito.push({
        key: ++this.claves,
        producto,
        cantidad: i.cantidad,
        color: i.color,
        talla: i.talla,
        precioUnitario: Number(i.precio_unitario),
      });
    }
    this.cdr.detectChanges();
  }

  /** Unidades que se pueden pedir: el inventario más lo que el pedido que se edita ya tenía */
  disponible(p: Producto): number {
    return p.stock + (this.enPedido.get(p.id) ?? 0);
  }

  async cargarZonas(): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('zonas_domicilio')
      .select('id, nombre, valor')
      .order('nombre');

    if (!error && data) {
      this.zonas = data;
    }
    this.cdr.detectChanges();
  }

  mostrarSugerenciasBarrio = false;

  get sugerenciasBarrio(): { id: string; nombre: string; valor: number }[] {
    const q = this.barrio.trim().toLowerCase();
    if (!q) return this.zonas;
    return this.zonas.filter((z) => z.nombre.toLowerCase().includes(q));
  }

  seleccionarZona(zona: { nombre: string; valor: number }): void {
    this.barrio = zona.nombre;
    this.valorDomicilio = zona.valor;
    this.mostrarSugerenciasBarrio = false;
  }

  cerrarSugerenciasBarrio(): void {
    // pequeño retraso para que el (mousedown) de la opción alcance a
    // dispararse antes de que el blur del input cierre la lista
    setTimeout(() => (this.mostrarSugerenciasBarrio = false), 150);
  }

  volver(): void {
    const volverA = (this.route.snapshot.data['volverA'] as string) ?? '/vendedor';
    this.router.navigateByUrl(volverA);
  }

  async cargarProductos(): Promise<void> {
    this.loadingProductos = true;
    const { data, error } = await this.supabase.client
      .from('productos')
      .select(
        'id, nombre, sku, descripcion, categoria, precio_base, precio_sugerido, costo, stock, imagen_url, activo, tallas, colores:producto_colores(id, nombre, hex, imagen_url, orden)'
      )
      .eq('activo', true)
      .order('nombre');

    if (!error && data) {
      this.productos = (data as Producto[]).filter((p) => this.disponible(p) > 0).map((p) => ({
        ...p,
        colores: [...(p.colores ?? [])].sort((a, b) => a.orden - b.orden || a.id - b.id),
      }));
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
    return this.carrito.filter((i) => i.producto.id === productoId).reduce((s, i) => s + i.cantidad, 0);
  }

  tieneVariantes(p: Producto): boolean {
    return !!(p.colores?.length || p.tallas?.length);
  }

  agregarProducto(producto: Producto): void {
    if (this.cantidadEnCarrito(producto.id) >= this.disponible(producto)) return;
    // Con colores o tallas, cada vez que se agrega es una línea nueva (puede ser otra variante)
    const existente = this.tieneVariantes(producto) ? null : this.carrito.find((i) => i.producto.id === producto.id);

    if (existente) {
      existente.cantidad++;
    } else {
      // Si solo hay un color o una talla, ya queda elegida
      const color = producto.colores?.length === 1 ? producto.colores[0].nombre : null;
      const talla = producto.tallas?.length === 1 ? producto.tallas[0] : null;
      this.carrito.push({ key: ++this.claves, producto, cantidad: 1, color, talla, precioUnitario: producto.precio_sugerido });
    }
  }

  elegir(item: ItemCarrito, campo: 'color' | 'talla', valor: string): void {
    item[campo] = item[campo] === valor ? null : valor;
  }

  /** Le falta elegir color o talla */
  faltaVariante(item: ItemCarrito): boolean {
    return (!!item.producto.colores?.length && !item.color) || (!!item.producto.tallas?.length && !item.talla);
  }

  incrementar(item: ItemCarrito): void {
    if (this.cantidadEnCarrito(item.producto.id) < this.disponible(item.producto)) {
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
    this.carrito = this.carrito.filter((i) => i.key !== item.key);
  }

  // Comisión que deja ESTE item con el precio actual (puede subir si el
  // vendedor editó el precio hacia arriba, o bajar si lo editó hacia abajo)
  comisionDe(item: ItemCarrito): number {
    return item.cantidad * (item.precioUnitario - item.producto.precio_base);
  }

  get subtotal(): number {
    return this.carrito.reduce((sum, i) => sum + i.cantidad * i.precioUnitario, 0);
  }

  get comisionTotal(): number {
    return this.carrito.reduce((sum, i) => sum + this.comisionDe(i), 0);
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

    const sinVariante = this.carrito.find((i) => this.faltaVariante(i));
    if (sinVariante) {
      const falta = [!sinVariante.color && sinVariante.producto.colores?.length ? 'color' : '', !sinVariante.talla && sinVariante.producto.tallas?.length ? 'talla' : '']
        .filter(Boolean)
        .join(' y ');
      this.errorMsg = `Elige ${falta} de ${sinVariante.producto.nombre}.`;
      return;
    }

    if (this.local) return this.registrarVentaLocal();

    if (!this.clienteNombre || !this.direccion) {
      this.errorMsg = 'Nombre del cliente y dirección son obligatorios.';
      return;
    }

    this.guardando = true;

    const items = this.carrito.map((i) => ({
      producto_id: i.producto.id,
      cantidad: i.cantidad,
      precio_unitario: i.precioUnitario,
      precio_base: i.producto.precio_base,
      color: i.color,
      talla: i.talla,
    }));

    if (this.editarId) {
      const { error } = await this.supabase.client.rpc('editar_pedido', {
        p_pedido_id: this.editarId,
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
        this.errorMsg = error.message.includes('editar_pedido') ? 'Editar pedidos aún no está activo en la base de datos.' : error.message;
        this.cdr.detectChanges();
        return;
      }
      avisar(`Pedido #${this.numeroEditando} actualizado.`);
      this.volver();
      return;
    }

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
    avisar(`Pedido #${numeroPedido} creado con éxito.`);

    const volverA = (this.route.snapshot.data['volverA'] as string) ?? '/vendedor';
    this.router.navigateByUrl(volverA);
  }

  private async cargarVendedores(): Promise<void> {
    const { data } = await this.supabase.client
      .from('profiles')
      .select('id, nombre')
      .contains('roles', ['vendedor'])
      .eq('activo', true)
      .order('nombre');
    this.vendedores = (data ?? []) as { id: string; nombre: string }[];
    this.cdr.detectChanges();
  }

  private async registrarVentaLocal(): Promise<void> {
    if (this.metodo === 'mixto') {
      const e = Number(this.efectivo) || 0;
      if (e <= 0 || e >= this.subtotal) {
        this.errorMsg = `En el pago mixto, el efectivo debe ser mayor que 0 y menor que ${this.formatoMoneda(this.subtotal)}.`;
        return;
      }
    }
    this.guardando = true;
    const { data, error } = await this.supabase.client.rpc('registrar_venta_local', {
      p_cliente_nombre: this.clienteNombre || null,
      p_cliente_telefono: this.clienteTelefono || null,
      p_observaciones: this.observaciones || null,
      p_items: this.carrito.map((i) => ({
        producto_id: i.producto.id,
        cantidad: i.cantidad,
        precio_unitario: i.precioUnitario,
        color: i.color,
        talla: i.talla,
      })),
      p_metodo: this.metodo,
      p_efectivo: this.metodo === 'mixto' ? Number(this.efectivo) : null,
      p_vendedor: this.vendedorId,
    });
    this.guardando = false;
    if (error) {
      this.errorMsg = error.message;
      this.cdr.detectChanges();
      return;
    }
    avisar(`Venta #${data as number} registrada.`);
    // Queda en blanco para la siguiente venta (el vendedor elegido se mantiene)
    this.carrito = [];
    this.clienteNombre = this.clienteTelefono = this.observaciones = '';
    this.metodo = 'efectivo';
    this.efectivo = null;
    await this.cargarProductos();
    this.cdr.detectChanges();
  }

  formatoMoneda(valor: number): string {
    return (valor || 0).toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}