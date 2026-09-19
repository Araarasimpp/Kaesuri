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
  activo: boolean;
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
  numero: number;
  vendedor_id: string;
  domiciliario_id?: string | null;
  cliente_nombre: string;
  cliente_telefono?: string | null;
  direccion: string;
  barrio?: string | null;
  valor_domicilio: number;
  observaciones?: string | null;
  estado: EstadoPedido;
  total: number;
  created_at: string;
  entregado_at?: string | null;
  items?: PedidoItem[];
}

export interface CrearPedidoPayload {
  p_cliente_nombre: string;
  p_cliente_telefono?: string;
  p_direccion: string;
  p_barrio?: string;
  p_valor_domicilio: number;
  p_observaciones?: string;
  p_items: {
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
  }[];
}