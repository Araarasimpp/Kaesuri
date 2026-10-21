import type { jsPDF } from 'jspdf';
import { ProductoCatalogo as Producto } from '../paginas/catalogo/producto-catalogo';
import { urlImagen } from './formato';

/**
 * Catálogo en PDF (A4) para mandarle a los clientes.
 * Copiado de Jasta, con la marca de Variedades JYB.
 * Portada con el logo y franjas de color; adentro, 9 productos por hoja
 * en tarjetas: foto, nombre, descripción y precio en letra de tiquete.
 * Todo se arma en el teléfono, sin servidor: las fotos se achican y se
 * pasan a JPEG para que el archivo no pese demasiado.
 */

export interface OpcionesCatalogo {
  productos: Producto[];
  vendedora?: { nombre: string; telefono: string | null } | null;
  /** Avance mientras se preparan las fotos (0 a 1) */
  avance?: (fraccion: number) => void;
}

// Colores de la marca (mm y RGB para jsPDF)
const TINTA: [number, number, number] = [15, 23, 42]; // #0F172A
const ORO: [number, number, number] = [212, 160, 23]; // #D4A017
const ORO_TEXTO: [number, number, number] = [138, 101, 8];
const ORO_WASH: [number, number, number] = [254, 243, 199];
const GRIS: [number, number, number] = [107, 114, 128];
const LINEA: [number, number, number] = [229, 231, 235];

const A4 = { w: 210, h: 297 };
const MARGEN = 14;
const COLS = 3;
const FILAS = 3;
const FOTO_PX = 420;

/** jsPDF con la fuente estándar solo entiende Latin-1: fuera emojis y símbolos raros */
function latin1(s: string): string {
  return (s ?? '')
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function pesos(n: number): string {
  return '$ ' + Math.round(Number(n) || 0).toLocaleString('es-CO');
}

function mesAnio(): string {
  const t = new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Carga una imagen y la deja cuadrada, centrada sobre blanco, como JPEG liviano */
async function fotoCuadrada(url: string, lado = FOTO_PX): Promise<string | null> {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas');
    c.width = c.height = lado;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, lado, lado);
    const k = Math.min(lado / bmp.width, lado / bmp.height) * 0.92;
    const w = bmp.width * k;
    const h = bmp.height * k;
    ctx.drawImage(bmp, (lado - w) / 2, (lado - h) / 2, w, h);
    bmp.close?.();
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}

async function logo(): Promise<string | null> {
  try {
    const r = await fetch('assets/icon/logo.png');
    const b = await r.blob();
    return await new Promise((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = () => ok(null);
      fr.readAsDataURL(b);
    });
  } catch {
    return null;
  }
}

/** Carga todas las fotos con unos pocos pedidos a la vez */
async function fotos(productos: Producto[], avance?: (f: number) => void): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let hechas = 0;
  let i = 0;
  const trabajador = async () => {
    while (i < productos.length) {
      const p = productos[i++];
      // Sin foto principal, sirve la del primer color que tenga
      const url = urlImagen(p.imagen_url) ?? urlImagen((p.colores ?? []).find((c) => c.imagen_url)?.imagen_url);
      const dato = url ? await fotoCuadrada(url) : null;
      if (dato) out.set(p.id, dato);
      avance?.(++hechas / productos.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabajador));
  return out;
}

/** Línea punteada, como la perforación del tiquete */
function perforacion(doc: jsPDF, x1: number, y: number, x2: number): void {
  doc.setDrawColor(...LINEA);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([1.2, 1.2], 0);
  doc.line(x1, y, x2, y);
  doc.setLineDashPattern([], 0);
}

/** Texto centrado con letras separadas (jsPDF no cuenta el espaciado al centrar) */
function centradoEspaciado(doc: jsPDF, texto: string, y: number, espacio: number): void {
  const ancho = doc.getTextWidth(texto) + espacio * (texto.length - 1);
  doc.setCharSpace(espacio);
  doc.text(texto, (A4.w - ancho) / 2, y);
  doc.setCharSpace(0);
}

function portada(doc: jsPDF, logoDato: string | null, total: number, op: OpcionesCatalogo): void {
  // Marco fino de oro
  doc.setDrawColor(...ORO);
  doc.setLineWidth(0.6);
  doc.rect(10, 10, A4.w - 20, A4.h - 20);
  doc.setLineWidth(0.2);
  doc.rect(12.5, 12.5, A4.w - 25, A4.h - 25);

  if (logoDato) doc.addImage(logoDato, 'PNG', A4.w / 2 - 42, 46, 84, 84);

  doc.setTextColor(...ORO_TEXTO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  centradoEspaciado(doc, 'VARIEDADES JYB', 148, 2.2);

  doc.setTextColor(...TINTA);
  doc.setFontSize(46);
  centradoEspaciado(doc, 'CATÁLOGO', 168, 1.5);

  // Franja de oro con el mes
  doc.setFillColor(...ORO);
  doc.rect(A4.w / 2 - 34, 176, 68, 0.8, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(...GRIS);
  doc.text(latin1(`${mesAnio()}  ·  ${total} productos`), A4.w / 2, 186, { align: 'center' });

  doc.setFontSize(11);
  doc.text('Hogar, herramientas, juguetería, gadgets y mucho más', A4.w / 2, 196, { align: 'center' });

  // Contacto
  // Con quién pedir (el vendedor que comparte el catálogo)
  if (op.vendedora?.telefono) {
    const y = 228;
    doc.setFillColor(...ORO_WASH);
    doc.roundedRect(34, y, A4.w - 68, 26, 3, 3, 'F');
    doc.setTextColor(...TINTA);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(latin1(`Pide con ${op.vendedora.nombre}`), A4.w / 2, y + 10, { align: 'center' });
    doc.setFont('courier', 'bold');
    doc.setFontSize(16);
    doc.text(latin1(`WhatsApp ${op.vendedora.telefono}`), A4.w / 2, y + 19, { align: 'center' });
  }

  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  doc.text('Precios en pesos colombianos, sujetos a cambio y a disponibilidad.', A4.w / 2, A4.h - 18, { align: 'center' });
}

function encabezado(doc: jsPDF, logoDato: string | null): void {
  if (logoDato) doc.addImage(logoDato, 'PNG', MARGEN, 8, 13, 13);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TINTA);
  doc.text('Catálogo Variedades JYB', MARGEN + 16, 14.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  doc.text(latin1(mesAnio()), MARGEN + 16, 19);
  doc.setFillColor(...ORO);
  doc.rect(MARGEN, 24, A4.w - MARGEN * 2, 0.6, 'F');
}

function pie(doc: jsPDF, pagina: number, total: number, op: OpcionesCatalogo): void {
  perforacion(doc, MARGEN, A4.h - 14, A4.w - MARGEN);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRIS);
  const contacto = op.vendedora?.telefono ? `Pedidos por WhatsApp: ${op.vendedora.telefono} (${op.vendedora.nombre})` : 'Variedades JYB';
  doc.text(latin1(contacto), MARGEN, A4.h - 9);
  doc.setFont('courier', 'bold');
  doc.text(`${pagina} / ${total}`, A4.w - MARGEN, A4.h - 9, { align: 'right' });
}

function tarjeta(doc: jsPDF, p: Producto, foto: string | null, x: number, y: number, w: number, h: number): void {
  // Tarjeta
  doc.setDrawColor(...LINEA);
  doc.setLineWidth(0.3);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');

  // Foto cuadrada
  const pad = 3;
  const lado = w - pad * 2;
  if (foto) {
    doc.addImage(foto, 'JPEG', x + pad, y + pad, lado, lado, undefined, 'FAST');
  } else {
    doc.setFillColor(...ORO_WASH);
    doc.roundedRect(x + pad, y + pad, lado, lado, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.setTextColor(...ORO);
    doc.text(latin1(p.nombre).charAt(0).toUpperCase() || 'J', x + w / 2, y + pad + lado / 2 + 4, { align: 'center' });
  }

  // En el PDF para clientes no se marca "agotado": el inventario no siempre
  // está al día (en la app sí se ve el stock)

  // Nombre (hasta 2 líneas)
  let ty = y + pad + lado + 5.2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(...TINTA);
  const nombre = doc.splitTextToSize(latin1(p.nombre), lado) as string[];
  const lineasNombre = nombre.slice(0, 2);
  if (nombre.length > 2) lineasNombre[1] = lineasNombre[1].replace(/\s*\S*$/, '') + '...';
  doc.text(lineasNombre, x + pad, ty, { lineHeightFactor: 1.15 });
  ty += lineasNombre.length * 3.9;

  // Descripción (hasta 2 líneas)
  const desc = latin1(p.descripcion ?? '');
  // Con colores o tallas queda espacio para una sola línea; con los dos, para ninguna
  const max = p.colores?.length && p.tallas?.length ? 0 : p.colores?.length || p.tallas?.length ? 1 : 2;
  if (desc && max > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...GRIS);
    const d = doc.splitTextToSize(desc.replace(/\n+/g, ' '), lado) as string[];
    const ld = d.slice(0, max);
    if (d.length > max) ld[max - 1] = ld[max - 1].replace(/\s*\S*$/, '') + '...';
    doc.text(ld, x + pad, ty + 0.4, { lineHeightFactor: 1.2 });
  }

  // Colores disponibles: bolitas con el tono y cuántos hay
  const colores = (p.colores ?? []).filter((c) => c.hex);
  if (colores.length) {
    const cy = y + h - 12.6;
    const r = 1.5;
    let cx = x + pad + r;
    for (const c of colores.slice(0, 8)) {
      const hex = c.hex!.replace('#', '');
      doc.setFillColor(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
      doc.setDrawColor(...LINEA);
      doc.setLineWidth(0.25);
      doc.circle(cx, cy, r, 'FD');
      cx += r * 2 + 1.2;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...GRIS);
    const n = (p.colores ?? []).length;
    doc.text(`${n} ${n === 1 ? 'color' : 'colores'}`, cx + 0.6, cy + 0.9);
  }

  // Tallas: en su propia línea (arriba de los colores si los hay)
  if (p.tallas?.length) {
    const ty2 = y + h - (colores.length ? 16.4 : 12.6) + 0.9;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...GRIS);
    let txt = latin1('Tallas: ' + p.tallas.join(' · '));
    while (doc.getTextWidth(txt) > lado && txt.length > 10) txt = txt.slice(0, -4).replace(/[\s·]+$/, '') + '...';
    doc.text(txt, x + pad, ty2);
  }

  // Precio abajo, en letra de tiquete, con raya de oro
  const py = y + h - 4.2;
  perforacion(doc, x + pad, py - 5.6, x + w - pad);
  doc.setFont('courier', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(...TINTA);
  doc.text(pesos(p.precio_venta), x + pad, py);
  if (p.sku) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...GRIS);
    doc.text(latin1(p.sku), x + w - pad, py, { align: 'right' });
  }
}

/** Arma el PDF y lo devuelve como archivo listo para guardar o compartir */
export async function generarCatalogoPdf(op: OpcionesCatalogo): Promise<File> {
  const { jsPDF } = await import('jspdf');
  const [logoDato, mapaFotos] = await Promise.all([logo(), fotos(op.productos, op.avance)]);

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: 'Catálogo Variedades JYB', author: 'Variedades JYB', creator: 'Variedades JYB' });

  portada(doc, logoDato, op.productos.length, op);

  const porHoja = COLS * FILAS;
  const hojas = Math.max(1, Math.ceil(op.productos.length / porHoja));
  const gap = 5;
  const top = 30;
  const w = (A4.w - MARGEN * 2 - gap * (COLS - 1)) / COLS;
  const h = (A4.h - top - 20 - gap * (FILAS - 1)) / FILAS;

  for (let hoja = 0; hoja < hojas; hoja++) {
    doc.addPage();
    encabezado(doc, logoDato);
    const grupo = op.productos.slice(hoja * porHoja, hoja * porHoja + porHoja);
    grupo.forEach((p, i) => {
      const col = i % COLS;
      const fila = Math.floor(i / COLS);
      tarjeta(doc, p, mapaFotos.get(p.id) ?? null, MARGEN + col * (w + gap), top + fila * (h + gap), w, h);
    });
    pie(doc, hoja + 2, hojas + 1, op);
  }

  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const blob = doc.output('blob');
  return new File([blob], `catalogo-variedades-jyb-${fecha}.pdf`, { type: 'application/pdf' });
}
