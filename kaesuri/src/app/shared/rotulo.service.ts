// src/app/shared/rotulo.service.ts
// Arma e imprime los rótulos de entrega. Los datos del negocio (nombre,
// teléfonos, redes y texto de garantía) se leen de la tabla "configuracion",
// así que se cambian desde Admin › Configuración sin tocar código.
// Lo usan la página de pedidos (admin y despachador) y la vista previa de
// Configuración.
//
// Formato: etiqueta adhesiva de 100 mm x 100 mm, sin márgenes, un rótulo por
// etiqueta. Se imprime desde un marco oculto dentro de la misma página, así que
// no se abre ninguna pestaña nueva que haya que cerrar.

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
   * Devuelve true cuando se abrió el diálogo de impresión.
   */
  async imprimir(
    pedidos: (PedidoRotulo & { id?: string })[],
    items: ItemRotulo[],
    negocio?: DatosNegocio
  ): Promise<boolean> {
    const datos = negocio ?? (await this.cargarNegocio());
    const html = this.construirHtml(pedidos, items, datos);

    return new Promise<boolean>((resolve) => {
      const marco = document.createElement('iframe');
      marco.setAttribute('aria-hidden', 'true');
      marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
      document.body.appendChild(marco);

      const doc = marco.contentDocument ?? marco.contentWindow?.document;
      const ventana = marco.contentWindow;
      if (!doc || !ventana) {
        marco.remove();
        resolve(false);
        return;
      }

      let limpiado = false;
      const limpiar = () => {
        if (limpiado) return;
        limpiado = true;
        setTimeout(() => marco.remove(), 500);
      };
      ventana.addEventListener('afterprint', limpiar);

      doc.open();
      doc.write(html);
      doc.close();

      // Espera a que cargue el logo antes de imprimir.
      const imprimirYa = () => {
        try {
          ventana.focus();
          ventana.print();
          resolve(true);
        } catch {
          resolve(false);
        }
        // Respaldo por si el navegador no dispara "afterprint".
        setTimeout(limpiar, 60000);
      };
      const logo = doc.querySelector('img');
      if (logo && !(logo as HTMLImageElement).complete) {
        logo.addEventListener('load', imprimirYa, { once: true });
        logo.addEventListener('error', imprimirYa, { once: true });
      } else {
        setTimeout(imprimirYa, 100);
      }
    });
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
  @page { size: 100mm 100mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rotulo {
    width: 100mm;
    height: 100mm;
    padding: 4mm;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
  }
  .rotulo:last-child { page-break-after: auto; break-after: auto; }
  .rotulo-header { display: flex; justify-content: space-between; align-items: center; gap: 3mm; margin-bottom: 2.5mm; }
  .marca-logo { width: 30mm; height: 30mm; object-fit: contain; flex-shrink: 0; }
  .cabecera-derecha { display: flex; flex-direction: column; align-items: flex-end; gap: 2mm; min-width: 0; }
  .contacto { font-size: 8.5pt; text-align: right; line-height: 1.3; word-break: break-word; }
  .fecha-box { border: 0.3mm solid #000; padding: 1mm 2mm; font-size: 8.5pt; white-space: nowrap; }
  .valor-cobrar { border: 0.4mm solid #000; padding: 1.5mm 2.5mm; margin-bottom: 2mm; font-size: 10pt; display: flex; justify-content: space-between; align-items: center; }
  .valor-cobrar strong { font-size: 13pt; }
  .datos { width: 100%; font-size: 9pt; border-collapse: collapse; }
  .datos td { padding: 0.6mm 0; vertical-align: top; }
  .datos td:first-child { font-weight: bold; width: 21mm; }
  .garantia { margin-top: auto; font-size: 6.5pt; line-height: 1.25; text-align: center; border-top: 0.3mm dashed #000; padding-top: 1.5mm; }
  @media screen { body { background: #eee; padding: 8mm; } .rotulo { background: #fff; margin: 0 auto 6mm; } }
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
