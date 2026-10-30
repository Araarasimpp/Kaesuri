// Ticket de venta para impresora térmica de 58 mm (Goojprt PT-210 y parecidas, ESC/POS).
// El mismo contenido sale como bytes ESC/POS (Bluetooth o RawBT) y como imagen (ver / compartir).
import qrcode from 'qrcode-generator';
import { DatosNegocio } from '../rotulo.service';
import { nombreConVariante } from '../variante';
import { formatoFechaCO, formatoHoraCO } from '../fecha-colombia';

/** Caracteres por línea con la letra normal en papel de 58 mm */
export const ANCHO = 32;

/** Lo que necesita el ticket de una venta del local */
export interface VentaTicket {
  numero: number;
  created_at: string;
  estado: string;
  cliente_nombre: string | null;
  total: number;
  metodo_pago: string | null;
  monto_efectivo: number | null;
  monto_transferencia: number | null;
  seguimiento: string | null;
  vendedor: { nombre: string } | null;
  pedido_items: { cantidad: number; precio_unitario: number; color: string | null; talla: string | null; productos: { nombre: string } | null }[];
}

type Estilo = 'normal' | 'negrita' | 'grande';
export interface Linea { texto: string; estilo?: Estilo; centro?: boolean; /** En vez de texto, un código QR con esta dirección */ qr?: string }

const PAGO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', mixto: 'Mixto' };

function plata(v: number | null | undefined): string {
  return '$' + Math.round(Number(v) || 0).toLocaleString('es-CO').replace(/,/g, '.');
}

/** Parte un texto en renglones del ancho dado sin cortar palabras (salvo que no quepan) */
function partir(texto: string, ancho: number): string[] {
  const out: string[] = [];
  let actual = '';
  for (const palabra of texto.replace(/\s+/g, ' ').trim().split(' ')) {
    let p = palabra;
    while (p.length > ancho) { if (actual) { out.push(actual); actual = ''; } out.push(p.slice(0, ancho)); p = p.slice(ancho); }
    if (!actual) actual = p;
    else if (actual.length + 1 + p.length <= ancho) actual += ' ' + p;
    else { out.push(actual); actual = p; }
  }
  if (actual) out.push(actual);
  return out;
}

/** Izquierda y derecha en el mismo renglón */
function aLados(izq: string, der: string, ancho = ANCHO): string {
  const espacio = ancho - der.length;
  const i = izq.length > espacio - 1 ? izq.slice(0, Math.max(0, espacio - 1)) : izq;
  return i + ' '.repeat(Math.max(1, ancho - i.length - der.length)) + der;
}

export function lineasTicket(v: VentaTicket, negocio: DatosNegocio): Linea[] {
  const l: Linea[] = [];
  const raya = { texto: '-'.repeat(ANCHO) };
  for (const t of partir(negocio.nombre_negocio, ANCHO / 2)) l.push({ texto: t, estilo: 'grande', centro: true });
  if (negocio.telefonos) for (const t of partir('Tel: ' + negocio.telefonos, ANCHO)) l.push({ texto: t, centro: true });
  if (negocio.redes) for (const t of partir(negocio.redes, ANCHO)) l.push({ texto: t, centro: true });
  l.push(raya);
  l.push({ texto: aLados('Venta #' + v.numero, formatoHoraCO(v.created_at)), estilo: 'negrita' });
  l.push({ texto: formatoFechaCO(v.created_at, { day: 'numeric', month: 'long', year: 'numeric' }) });
  if (v.cliente_nombre && !/^cliente( del local)?$/i.test(v.cliente_nombre.trim())) l.push({ texto: 'Cliente: ' + v.cliente_nombre });
  if (v.vendedor?.nombre) l.push({ texto: 'Te atendió: ' + v.vendedor.nombre.split(' ')[0] });
  l.push(raya);
  for (const i of v.pedido_items ?? []) {
    for (const t of partir(nombreConVariante(i.productos?.nombre ?? 'Producto', i), ANCHO)) l.push({ texto: t });
    l.push({ texto: aLados(`  ${i.cantidad} x ${plata(i.precio_unitario)}`, plata(Number(i.precio_unitario) * i.cantidad)) });
  }
  l.push(raya);
  l.push({ texto: aLados('TOTAL', plata(v.total), ANCHO / 2), estilo: 'grande' });
  l.push({ texto: '' });
  l.push({ texto: aLados('Pago', PAGO[v.metodo_pago ?? ''] ?? '-') });
  if (v.metodo_pago === 'mixto') {
    l.push({ texto: aLados('  Efectivo', plata(v.monto_efectivo)) });
    l.push({ texto: aLados('  Transferencia', plata(v.monto_transferencia)) });
  }
  if (v.estado === 'cancelado') l.push({ texto: '*** VENTA CANCELADA ***', estilo: 'negrita', centro: true });
  l.push(raya);
  if (negocio.texto_garantia) for (const t of partir(negocio.texto_garantia, ANCHO)) l.push({ texto: t, centro: true });
  // QR al seguimiento: el cliente ve su compra y la garantía sin guardar el papel
  if (v.seguimiento) {
    l.push({ texto: '', qr: `${location.origin}/seguimiento/${v.seguimiento}` });
    l.push({ texto: 'Escanea para ver tu compra', centro: true });
    l.push({ texto: 'y tu garantía', centro: true });
    l.push({ texto: '' });
  }
  l.push({ texto: '¡Gracias por tu compra!', estilo: 'negrita', centro: true });
  return l;
}

// ------------------------------------------------------------------ ESC/POS
// Página de códigos PC437 (la que traen por defecto): tiene las minúsculas con tilde y la ñ;
// las mayúsculas con tilde que no existen ahí se imprimen sin tilde.
const CP437: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81, Ü: 0x9a, É: 0x90, '¿': 0xa8, '¡': 0xad, '°': 0xf8,
};

function bytesTexto(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.replace(/[  ]/g, ' ')) {
    const c = ch.charCodeAt(0);
    if (c < 128) out.push(c);
    else if (CP437[ch] != null) out.push(CP437[ch]);
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out.push(base.length === 1 && base.charCodeAt(0) < 128 ? base.charCodeAt(0) : 0x3f);
    }
  }
  return out;
}

/** Cuadritos del QR (true = negro) */
function modulosQr(url: string): boolean[][] {
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, f) => Array.from({ length: n }, (_, c) => q.isDark(f, c)));
}

/** Tamaño de cada cuadrito en puntos: 4 en 58 mm (≈ 0,5 mm) se lee bien con la cámara y no tarda en mandarse */
const PUNTO_QR = 4;
/** Ancho imprimible del papel de 58 mm, en puntos */
const ANCHO_PUNTOS = 384;

/** QR como imagen de puntos (GS v 0): la entienden todas las impresoras ESC/POS, aunque no traigan QR propio */
function qrEscPos(url: string): number[] {
  const m = modulosQr(url);
  const n = m.length + 4; // con 2 cuadritos de margen a cada lado
  const lado = n * PUNTO_QR;
  // Centrado con puntos en blanco a la izquierda (no todas las impresoras centran las imágenes)
  const izq = Math.max(0, Math.floor((ANCHO_PUNTOS - lado) / 2));
  const bytesFila = Math.ceil((izq + lado) / 8);
  const out = [0x1b, 0x61, 0, 0x1d, 0x76, 0x30, 0, bytesFila & 0xff, bytesFila >> 8, lado & 0xff, lado >> 8];
  for (let y = 0; y < lado; y++) {
    const f = Math.floor(y / PUNTO_QR) - 2;
    for (let xb = 0; xb < bytesFila; xb++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = xb * 8 + bit - izq;
        const c = px < 0 ? -1 : Math.floor(px / PUNTO_QR) - 2;
        if (f >= 0 && c >= 0 && f < m.length && c < m.length && m[f][c]) byte |= 0x80 >> bit;
      }
      out.push(byte);
    }
  }
  out.push(0x0a);
  return out;
}

export function ticketEscPos(lineas: Linea[]): Uint8Array {
  const ESC = 0x1b, GS = 0x1d;
  const b: number[] = [ESC, 0x40, ESC, 0x74, 0x00]; // reiniciar + PC437
  for (const ln of lineas) {
    if (ln.qr) { for (const x of qrEscPos(ln.qr)) b.push(x); continue; }
    b.push(ESC, 0x61, ln.centro ? 1 : 0);
    b.push(ESC, 0x45, ln.estilo === 'normal' || !ln.estilo ? 0 : 1);
    b.push(GS, 0x21, ln.estilo === 'grande' ? 0x11 : 0x00);
    b.push(...bytesTexto(ln.texto), 0x0a);
  }
  b.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
  b.push(ESC, 0x64, 4); // avanzar papel para cortar con la mano
  return new Uint8Array(b);
}

// ------------------------------------------------------------------ Imagen (para compartir / ver en el celular)
/** El ticket como imagen PNG del ancho de la impresora (384 puntos = 58 mm) */
export async function ticketPng(lineas: Linea[]): Promise<Blob> {
  const W = 384, pad = 8, alto = { normal: 26, negrita: 26, grande: 46 };
  const fuente = (e: Estilo) => (e === 'grande' ? '700 38px' : e === 'negrita' ? '700 20px' : '400 20px') + ' "DejaVu Sans Mono", Menlo, Consolas, monospace';
  const ladoQr = (url: string) => (modulosQr(url).length + 4) * 5;
  const H = pad * 2 + lineas.reduce((h, l) => h + (l.qr ? ladoQr(l.qr) + 6 : alto[l.estilo ?? 'normal']), 0) + 24;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#000';
  g.textBaseline = 'top';
  let y = pad;
  for (const l of lineas) {
    if (l.qr) {
      const m = modulosQr(l.qr);
      const t = 5, x0 = Math.round((W - (m.length + 4) * t) / 2);
      m.forEach((fila, f) => fila.forEach((osc, c) => osc && g.fillRect(x0 + (c + 2) * t, y + (f + 2) * t, t, t)));
      y += ladoQr(l.qr) + 6;
      continue;
    }
    const e = l.estilo ?? 'normal';
    g.font = fuente(e);
    // Que los 32 caracteres (o 16 en grande) quepan justos en el ancho
    const ancho = g.measureText(l.texto).width;
    const max = W - pad * 2;
    const escala = ancho > max ? max / ancho : 1;
    const x = l.centro ? (W - ancho * escala) / 2 : pad;
    g.save();
    g.translate(x, y + 2);
    g.scale(escala, 1);
    g.fillText(l.texto, 0, 0);
    g.restore();
    y += alto[e];
  }
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo crear la imagen del ticket'))), 'image/png'));
}
