export type UserRole = 'admin' | 'vendedor' | 'domiciliario';
export type EstadoPedido = 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado';
export type MetodoPago = 'efectivo' | 'transferencia';

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
  comision: number;
  observaciones?: string | null;
  estado: EstadoPedido;
  total: number;
  metodo_pago?: MetodoPago | null;
  comprobante_url?: string | null;
  rotulo_impreso_at?: string | null;
  cuadre_id?: string | null;
  created_at: string;
  entregado_at?: string | null;
  items?: PedidoItem[];
}

export type EstadoCuadre = 'pendiente' | 'confirmado';

export interface Cuadre {
  id: string;
  domiciliario_id: string;
  fecha: string;
  cantidad_pedidos: number;
  total_domicilios: number;
  total_efectivo: number;
  total_transferencia: number;
  total_general: number;
  total_a_entregar: number;
  estado: EstadoCuadre;
  cerrado_at: string;
  confirmado_at?: string | null;
  confirmado_por?: string | null;
}

export interface CrearPedidoPayload {
  p_cliente_nombre: string;
  p_cliente_telefono?: string;
  p_direccion: string;
  p_barrio?: string;
  p_valor_domicilio: number;
  p_comision: number;
  p_observaciones?: string;
  p_items: {
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
  }[];
}