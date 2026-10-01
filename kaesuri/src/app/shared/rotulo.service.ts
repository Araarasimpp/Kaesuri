// src/app/shared/rotulo.service.ts
// Arma e imprime los rótulos de entrega. Los datos del negocio (nombre,
// teléfonos, redes y texto de garantía) se leen de la tabla "configuracion",
// así que se cambian desde Admin › Configuración sin tocar código.
// Lo usan las páginas de pedidos del admin y del despachador, y la vista
// previa de Configuración.

import { Injectable } from '@angular/core';
import { SupabaseService } from '../core/services/supabase.service';
import { ROTULO_LOGO_BASE64 } from '../admin/rotulo-logo';

export interface DatosNegocio {
  nombre_negocio: string;
  telefonos: string | null;
  redes: string | null;
  texto_garantia: string | null;
}

export interface PedidoRotulo {
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  observaciones: string | null;
  total: number;
  created_at: string;
}

export interface ItemRotulo {
  pedido_id?: string;
  cantidad: number;
  producto?: { nombre: string } | null;
}

/** Valores de respaldo si la tabla configuracion no responde. */
export const NEGOCIO_POR_DEFECTO: DatosNegocio = {
  nombre_negocio: 'Variedades JYB',
  telefonos: '318 8156960 - 310 7425663',
  redes: '@variedadesjyb',
  texto_garantia:
    'Todos nuestros productos cuentan con garantía. Guarda este documento ya que es el soporte para la garantía.',
};

export const LOGO_ROTULO = ROTULO_LOGO_BASE64;

@Injectable({ providedIn: 'root' })
export class RotuloService {
  constructor(private supabase: SupabaseService) {}

  /** Lee los datos del negocio desde Configuración. */
  async cargarNegocio(): Promise<DatosNegocio> {
    const { data, error } = await this.supabase.client
      .from('configuracion')
      .select('nombre_negocio, telefonos, redes, texto_garantia')
      .eq('id', true)
      .single();

    if (error || !data) return NEGOCIO_POR_DEFECTO;
    return {
      nombre_negocio: data.nombre_negocio || NEGOCIO_POR_DEFECTO.nombre_negocio,
      telefonos: data.telefonos,
      redes: data.redes,
      texto_garantia: data.texto_garantia,
    };
  }

  /**
   * Imprime los rótulos de los pedidos dados. `items` puede traer pedido_id
   * para repartir los productos entre varios pedidos.
   */
  async imprimir(
    pedidos: (PedidoRotulo & { id?: string })[],
    items: ItemRotulo[],
    negocio?: DatosNegocio
  ): Promise<boolean> {
    // Se abre la ventana antes de esperar a la base de datos para que el
    // navegador no la bloquee como ventana emergente.
    const ventana = window.open('', '_blank');
    if (!ventana) return false;
    ventana.document.write('<p style="font-family:sans-serif;padding:24px">Preparando rótulos…</p>');

    const datos = negocio ?? (await this.cargarNegocio());
    const html = this.construirHtml(pedidos, items, datos);

    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
    ventana.focus();
    setTimeout(() => ventana.print(), 400);
    return true;
  }

  /** Rótulo de ejemplo con los datos que se están editando en Configuración. */
  imprimirPrueba(negocio: DatosNegocio): void {
    const ejemplo: PedidoRotulo & { id: string } = {
      id: 'prueba',
      numero: 0,
      cliente_nombre: 'Cliente de prueba',
      cliente_telefono: '300 000 0000',
      direccion: 'Calle 00 # 00-00',
      barrio: 'Barrio de prueba',
      observaciones: 'Este es un rótulo de prueba',
      total: 0,
      created_at: new Date().toISOString(),
    };
    this.imprimir([ejemplo], [{ pedido_id: 'prueba', cantidad: 1, producto: { nombre: 'Producto de prueba' } }], negocio);
  }

  construirHtml(pedidos: (PedidoRotulo & { id?: string })[], items: ItemRotulo[], negocio: DatosNegocio): string {
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const rotulos = pedidos
      .map((p) => {
        const productos = items
          .filter((i) => !p.id || i.pedido_id === p.id)
          .map((i) => `${esc(i.producto?.nombre ?? 'Producto')} x${i.cantidad}`)
          .join('<br>');

        return `
<div class="rotulo">
  <div class="rotulo-header">
    <img class="marca-logo" src="${LOGO_ROTULO}" alt="${esc(negocio.nombre_negocio)}" />
    <div class="cabecera-derecha">
      <div class="contacto">
        ${negocio.telefonos ? `<div>${esc(negocio.telefonos)}</div>` : ''}
        ${negocio.redes ? `<div>${esc(negocio.redes)}</div>` : ''}
      </div>
      <div class="fecha-box">${this.fecha(p.created_at)}</div>
    </div>
  </div>
  <div class="valor-cobrar">
    <span>VALOR A COBRAR:</span>
    <strong>${this.moneda(p.total)}</strong>
  </div>
  <table class="datos">
    <tr><td>Pedido:</td><td>#${esc(p.numero)}</td></tr>
    <tr><td>Nombre:</td><td>${esc(p.cliente_nombre)}</td></tr>
    <tr><td>Dirección:</td><td>${esc(p.direccion)}</td></tr>
    <tr><td>Barrio:</td><td>${esc(p.barrio ?? '—')}</td></tr>
    <tr><td>Producto:</td><td>${productos || '—'}</td></tr>
    <tr><td>Celular:</td><td>${esc(p.cliente_telefono ?? '—')}</td></tr>
    <tr><td>Observación:</td><td>${esc(p.observaciones ?? '—')}</td></tr>
  </table>
  ${negocio.texto_garantia ? `<p class="garantia">${esc(negocio.texto_garantia)}</p>` : ''}
</div>`;
      })
      .join('');

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Rótulos · ${esc(negocio.nombre_negocio)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 16px; color: #000; }
  .rotulo {
    width: 340px;
    border: 2px solid #000;
    border-radius: 14px;
    padding: 16px;
    margin: 0 auto 24px;
    page-break-after: always;
    break-after: page;
    box-sizing: border-box;
  }
  .rotulo:last-child { page-break-after: auto; break-after: auto; margin-bottom: 0; }
  .rotulo-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
  .marca-logo { width: 120px; height: 120px; object-fit: contain; flex-shrink: 0; }
  .cabecera-derecha { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .contacto { font-size: 12px; text-align: right; line-height: 1.4; }
  .fecha-box { border: 1px solid #000; padding: 4px 8px; font-size: 12px; white-space: nowrap; }
  .valor-cobrar { border: 1.5px solid #000; padding: 8px 10px; margin-bottom: 10px; font-size: 15px; display: flex; justify-content: space-between; align-items: center; }
  .valor-cobrar strong { font-size: 18px; }
  .datos { width: 100%; font-size: 13px; border-collapse: collapse; }
  .datos td { padding: 3px 0; vertical-align: top; }
  .datos td:first-child { font-weight: bold; width: 92px; }
  .garantia { font-size: 10px; text-align: center; margin: 12px 0 0; border-top: 1px dashed #000; padding-top: 8px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>${rotulos}</body>
</html>`;
  }

  moneda(valor: number): string {
    return (valor ?? 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  }

  fecha(iso: string): string {
    const f = new Date(iso);
    return `${String(f.getDate()).padStart(2, '0')} / ${String(f.getMonth() + 1).padStart(2, '0')} / ${f.getFullYear()}`;
  }
}
