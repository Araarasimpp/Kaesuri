import type { jsPDF } from 'jspdf';

/**
 * Comprobante de egreso (PDF, carta) del pago de comisiones a un vendedor, para el archivo
 * contable y la DIAN: número, fecha, datos del negocio (NIT) y de quien recibe (cédula),
 * concepto, detalle de las comisiones, total en números y en letras, forma de pago, firmas
 * y, en hojas aparte, las fotos del soporte (transferencia o recibo).
 */

export interface DatosComprobante {
  id: number;
  desde: string | null;
  hasta: string | null;
  pedidos: number;
  total: number;
  metodo: string;
  nota: string | null;
  pagado_at: string;
  pagado_por: string | null;
  anulada: boolean;
  vendedor: { nombre: string; documento: string | null; telefono: string | null; email: string | null } | null;
  negocio: { nombre: string | null; nit: string | null; direccion: string | null; telefonos: string | null } | null;
  detalle: { numero: number; dia: string; cliente: string; total: number; comision: number }[];
}

const CARTA = { w: 215.9, h: 279.4 };
const M = 16;
const METODO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', otro: 'Otro' };

function latin1(s: string): string {
  return (s ?? '').normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '').trim();
}

function pesos(n: number): string {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-$ ' : '$ ') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function fecha(d: string | null, conAno = true): string {
  if (!d) return '-';
  const f = new Date(d.length === 10 ? d + 'T12:00:00-05:00' : d);
  return f.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', ...(conAno ? { year: 'numeric' } : {}), timeZone: 'America/Bogota' });
}

/** Número en letras (pesos colombianos), ej. 1.250.000 → "UN MILLÓN DOSCIENTOS CINCUENTA MIL PESOS M/CTE" */
export function enLetras(n: number): string {
  const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
    'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
    'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  const cientos = (x: number): string => {
    if (x === 0) return '';
    if (x === 100) return 'CIEN';
    const c = Math.floor(x / 100), r = x % 100;
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
    return [C[c], dec].filter(Boolean).join(' ');
  };
  // "UNO" se apocopa a "UN" antes de MIL / MILLONES
  const apocope = (s: string) => s.replace(/VEINTIUNO$/, 'VEINTIÚN').replace(/UNO$/, 'UN');
  const v = Math.round(Math.abs(Number(n) || 0));
  if (v === 0) return 'CERO PESOS M/CTE';
  if (v === 1) return 'UN PESO M/CTE';
  const millones = Math.floor(v / 1_000_000), miles = Math.floor((v % 1_000_000) / 1000), resto = v % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : apocope(cientos(millones % 1000)) + ' MILLONES');
  if (miles) partes.push(miles === 1 ? 'MIL' : apocope(cientos(miles)) + ' MIL');
  if (resto) partes.push(apocope(cientos(resto)));
  const texto = partes.join(' ');
  // "un millón de pesos" cuando no hay miles ni unidades
  return texto + (!miles && !resto && millones ? ' DE PESOS M/CTE' : ' PESOS M/CTE');
}

/** Foto del soporte, achicada a JPEG */
async function foto(url: string, maximo = 1400): Promise<{ dato: string; w: number; h: number } | null> {
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const k = Math.min(1, maximo / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return { dato: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
  } catch {
    return null;
  }
}

function linea(doc: jsPDF, y: number): void {
  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(M, y, CARTA.w - M, y);
}

export function numeroComprobante(id: number): string {
  return 'CE-' + String(id).padStart(6, '0');
}

export async function generarComprobanteEgreso(d: DatosComprobante, soportes: string[]): Promise<File> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'letter', compress: true });
  const ancho = CARTA.w - M * 2;
  const neg = d.negocio ?? { nombre: null, nit: null, direccion: null, telefonos: null };
  const ven = d.vendedor ?? { nombre: '-', documento: null, telefono: null, email: null };
  let y = M;

  // Encabezado: negocio a la izquierda, número del comprobante a la derecha
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(latin1(neg.nombre || 'Variedades JYB'), M, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const datosNeg = [neg.nit ? 'NIT ' + neg.nit : 'NIT: (sin registrar en Configuración)', neg.direccion, neg.telefonos ? 'Tel. ' + neg.telefonos : null].filter(Boolean) as string[];
  datosNeg.forEach((t, i) => doc.text(latin1(t), M, y + 11 + i * 4.5));

  doc.setDrawColor(30);
  doc.setLineWidth(0.5);
  doc.roundedRect(CARTA.w - M - 64, y, 64, 22, 2, 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('COMPROBANTE DE EGRESO', CARTA.w - M - 32, y + 7, { align: 'center' });
  doc.setFontSize(14);
  doc.text(numeroComprobante(d.id), CARTA.w - M - 32, y + 15, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(latin1('Fecha: ' + fecha(d.pagado_at)), CARTA.w - M - 32, y + 20, { align: 'center' });
  y += 32;

  if (d.anulada) {
    doc.setTextColor(200, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('ANULADO', CARTA.w / 2, y, { align: 'center' });
    doc.setTextColor(0);
    y += 7;
  }

  // Pagado a
  linea(doc, y);
  y += 6;
  doc.setFontSize(10);
  const fila = (etq: string, val: string) => {
    doc.setFont('helvetica', 'bold');
    doc.text(latin1(etq), M, y);
    doc.setFont('helvetica', 'normal');
    const t = doc.splitTextToSize(latin1(val), ancho - 42);
    doc.text(t, M + 42, y);
    y += Math.max(1, t.length) * 5;
  };
  fila('Pagado a:', ven.nombre);
  fila('Cédula / NIT:', ven.documento || '(sin registrar)');
  if (ven.telefono) fila('Teléfono:', ven.telefono);
  fila('Concepto:', `Pago de comisiones por ventas, pedidos del ${fecha(d.desde, false)} al ${fecha(d.hasta)} (${d.pedidos} ${d.pedidos === 1 ? 'pedido' : 'pedidos'}).`);
  fila('Forma de pago:', METODO[d.metodo] ?? d.metodo);
  if (d.nota) fila('Nota:', d.nota);
  y += 2;

  // Valor
  doc.setFillColor(245, 245, 245);
  doc.rect(M, y, ancho, 18, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('VALOR PAGADO', M + 4, y + 7);
  doc.setFontSize(16);
  doc.text(pesos(d.total), CARTA.w - M - 4, y + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(doc.splitTextToSize(latin1('Son: ' + enLetras(d.total)), ancho - 8), M + 4, y + 14);
  y += 26;

  // Detalle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Detalle de las comisiones', M, y);
  y += 5;
  const cols = [M, M + 26, M + 46, M + 128, CARTA.w - M];
  const cabecera = () => {
    doc.setFillColor(30, 30, 30);
    doc.rect(M, y - 4, ancho, 6.5, 'F');
    doc.setTextColor(255);
    doc.setFontSize(8.5);
    doc.text('Fecha', cols[0] + 2, y);
    doc.text('Pedido', cols[1] + 2, y);
    doc.text('Cliente', cols[2] + 2, y);
    doc.text('Valor pedido', cols[3] + 20, y, { align: 'right' });
    doc.text('Comisión', cols[4] - 2, y, { align: 'right' });
    doc.setTextColor(0);
    y += 6;
  };
  cabecera();
  doc.setFont('helvetica', 'normal');
  for (const x of d.detalle) {
    if (y > CARTA.h - 60) {
      doc.addPage('letter');
      y = M + 6;
      cabecera();
      doc.setFont('helvetica', 'normal');
    }
    doc.setFontSize(8.5);
    doc.text(latin1(fecha(x.dia, false)), cols[0] + 2, y);
    doc.text('#' + x.numero, cols[1] + 2, y);
    doc.text(doc.splitTextToSize(latin1(x.cliente || ''), cols[3] - cols[2] - 4)[0] ?? '', cols[2] + 2, y);
    doc.text(x.total ? pesos(x.total) : '', cols[3] + 20, y, { align: 'right' });
    doc.text(pesos(x.comision), cols[4] - 2, y, { align: 'right' });
    doc.setDrawColor(225);
    doc.line(M, y + 2, CARTA.w - M, y + 2);
    y += 6;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('TOTAL', cols[3] + 20, y + 1, { align: 'right' });
  doc.text(pesos(d.total), cols[4] - 2, y + 1, { align: 'right' });
  y += 10;

  // Firmas
  if (y > CARTA.h - 45) {
    doc.addPage('letter');
    y = M + 10;
  }
  y = Math.max(y, CARTA.h - 52);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const anchoFirma = (ancho - 20) / 2;
  doc.setDrawColor(60);
  doc.line(M, y + 14, M + anchoFirma, y + 14);
  doc.line(M + anchoFirma + 20, y + 14, CARTA.w - M, y + 14);
  doc.text(latin1('Elaboró / pagó: ' + (d.pagado_por || '')), M, y + 19);
  doc.text(latin1('Recibí conforme: ' + ven.nombre), M + anchoFirma + 20, y + 19);
  doc.text(latin1('C.C. ' + (ven.documento || '____________')), M + anchoFirma + 20, y + 24);
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(latin1(`Generado desde Variedades JYB el ${fecha(new Date().toISOString())}.${soportes.length ? ' Soporte del pago en las hojas siguientes.' : ' Sin soporte adjunto.'}`), M, CARTA.h - 10);
  doc.setTextColor(0);

  // Soportes (foto de la transferencia o del recibo), uno por hoja
  for (let i = 0; i < soportes.length; i++) {
    const f = await foto(soportes[i]);
    if (!f) continue;
    doc.addPage('letter');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(latin1(`Soporte del pago ${numeroComprobante(d.id)}${soportes.length > 1 ? ' (' + (i + 1) + ' de ' + soportes.length + ')' : ''}`), M, M + 4);
    const maxW = ancho, maxH = CARTA.h - M * 2 - 12;
    const k = Math.min(maxW / f.w, maxH / f.h);
    const w = f.w * k, h = f.h * k;
    doc.addImage(f.dato, 'JPEG', M + (maxW - w) / 2, M + 10, w, h, undefined, 'FAST');
  }

  const limpio = ven.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w ]/g, '').trim();
  const nombre = `${numeroComprobante(d.id)} ${limpio}.pdf`;
  return new File([doc.output('blob')], nombre, { type: 'application/pdf' });
}
