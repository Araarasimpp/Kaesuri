export type UserRole = 'admin' | 'vendedor' | 'domiciliario';
export type EstadoPedido = 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado';

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  descripcion?: string;
  precio: number;
  stock: number;
  categoria?: string;
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

// Payload que espera la función RPC crear_pedido()
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