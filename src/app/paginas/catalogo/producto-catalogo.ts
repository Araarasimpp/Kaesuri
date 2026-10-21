import { Producto, ProductoColor } from '../../shared/models/models';

/**
 * Producto como lo usa el catálogo traído de Jasta (mismos nombres de campos que allá),
 * armado a partir del producto de Kaesuri: precio de venta = precio sugerido, precio de
 * compra = costo. En Kaesuri todos los productos llevan control de inventario.
 */
export interface ProductoCatalogo {
  id: string;
  nombre: string;
  sku: string | null;
  descripcion: string | null;
  precio_venta: number;
  precio_base: number;
  precio_compra: number;
  stock: number;
  controla_stock: boolean;
  imagen_url: string | null;
  activo: boolean;
  imagenes?: string[];
  tallas?: string[];
  videos?: string[];
  colores?: ProductoColor[];
}

export function aCatalogo(p: Producto): ProductoCatalogo {
  return {
    id: p.id,
    nombre: p.nombre,
    sku: p.sku,
    descripcion: p.descripcion,
    precio_venta: Number(p.precio_sugerido),
    precio_base: Number(p.precio_base),
    precio_compra: Number(p.costo ?? 0),
    stock: p.stock,
    controla_stock: true,
    imagen_url: p.imagen_url,
    activo: p.activo,
    imagenes: p.imagenes ?? [],
    tallas: p.tallas ?? [],
    videos: p.videos ?? [],
    colores: [...(p.colores ?? [])].sort((a, b) => a.orden - b.orden || a.id - b.id),
  };
}

/** Lo que se pide de cada producto para el catálogo */
export const SELECT_CATALOGO =
  'id, nombre, sku, descripcion, precio_sugerido, precio_base, costo, stock, imagen_url, activo, categoria, imagenes, tallas, videos, colores:producto_colores(id, producto_id, nombre, hex, imagen_url, orden)';
