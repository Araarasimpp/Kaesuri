export type UserRole = 'admin' | 'vendedor' | 'domiciliario';
export type EstadoPedido = 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado';

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  descripcion: string | null;
  precio: number;
  costo: number | null;
  imagen_url: string | null;
  stock: number;
  categoria: string | null;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
}

export interface Pedido {
  id: string;
  vendedor_id: string;
  domiciliario_id?: string;
  cliente_nombre: string;
  cliente_telefono?: string;
  direccion: string;
  estado: EstadoPedido;
  total: number;
  created_at: string;
  entregado_at?: string;
  items?: PedidoItem[];
}

export interface CrearPedidoPayload {
  p_cliente_nombre: string;
  p_cliente_telefono?: string;
  p_direccion: string;
  p_items: {
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
  }[];
}