export type UserRole = 'admin' | 'vendedor' | 'domiciliario' | 'despachador' | 'venta_local';
export type EstadoPedido = 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado';
export type MetodoPago = 'efectivo' | 'transferencia' | 'mixto';

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  descripcion: string | null;
  costo: number | null;
  precio_base: number;
  precio_sugerido: number;
  imagen_url: string | null;
  stock: number;
  categoria: string | null;
  activo: boolean;
  /** Fotos aparte de la principal y de los colores (máx. 12) */
  imagenes?: string[];
  /** Tallas disponibles (vacío = no maneja tallas) */
  tallas?: string[];
  /** Videos (bucket público "videos", máx. 3) */
  videos?: string[];
  colores?: ProductoColor[];
}

/** Variante de color de un producto, con su propia foto */
export interface ProductoColor {
  id: number;
  producto_id: string;
  nombre: string;
  hex: string | null;
  imagen_url: string | null;
  orden: number;
}

export interface PedidoItem {
  id: string;
  pedido_id: string;
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  precio_base: number;
  color?: string | null;
  talla?: string | null;
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
  /** 'local' = venta en el punto físico (entregada y cobrada al registrarla) */
  canal?: 'domicilio' | 'local';
  valor_domicilio: number;
  comision: number;
  observaciones?: string | null;
  estado: EstadoPedido;
  total: number;
  metodo_pago?: MetodoPago | null;
  /** Solo en pago mixto: cuánto se recibió en efectivo y cuánto por transferencia. */
  monto_efectivo?: number | null;
  monto_transferencia?: number | null;
  comprobante_url?: string | null;
  /** Todas las fotos del comprobante (puede haber varias); comprobante_url es la primera. */
  comprobantes?: string[] | null;
  rotulo_impreso_at?: string | null;
  /** Cuándo y quién empacó el pedido (pendiente alistado, listo para despachar). */
  alistado_at?: string | null;
  alistado_por?: string | null;
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
  /** Quién cerró el cuadre; null = cierre automático de la noche. */
  cerrado_por?: string | null;
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
    precio_base: number;
  }[];
}