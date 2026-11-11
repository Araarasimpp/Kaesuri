/**
 * Festivos de Colombia (con la Ley Emiliani) y fechas buenas para vender. Todo se calcula aquí,
 * así sirve para cualquier año sin tocar la base.
 */
export interface FechaEspecial {
  /** YYYY-MM-DD */
  dia: string;
  nombre: string;
  tipo: 'festivo' | 'comercial' | 'pago';
  /** Qué hacer antes (solo las comerciales) */
  consejo?: string;
  /** Con cuántos días de anticipación avisar */
  avisar?: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fecha = (a: number, m: number, d: number) => new Date(a, m - 1, d, 12);
const sumar = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

/** Domingo de Pascua (algoritmo de Meeus) */
function pascua(a: number): Date {
  const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25);
  const h = Math.floor((c - g + 1) / 3), i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4;
  const m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451);
  const mes = Math.floor((i + m - 7 * n + 114) / 31), dia = ((i + m - 7 * n + 114) % 31) + 1;
  return fecha(a, mes, dia);
}

/** Ley Emiliani: el festivo pasa al lunes siguiente (si no cae en lunes) */
function aLunes(d: Date): Date {
  const dow = d.getDay();
  return dow === 1 ? d : sumar(d, (8 - dow) % 7);
}

/** n-ésimo día de la semana del mes (dow: 0 domingo … 6 sábado) */
function enesimo(a: number, m: number, dow: number, n: number): Date {
  const primero = fecha(a, m, 1);
  return sumar(primero, ((dow - primero.getDay() + 7) % 7) + (n - 1) * 7);
}

function ultimoDow(a: number, m: number, dow: number): Date {
  const ultimo = fecha(a, m + 1, 0);
  return sumar(ultimo, -((ultimo.getDay() - dow + 7) % 7));
}

export function fechasDelAnio(a: number): FechaEspecial[] {
  const p = pascua(a);
  const fest = (d: Date, nombre: string): FechaEspecial => ({ dia: iso(d), nombre, tipo: 'festivo' });
  const com = (d: Date, nombre: string, consejo: string, avisar = 10): FechaEspecial => ({ dia: iso(d), nombre, tipo: 'comercial', consejo, avisar });
  const l: FechaEspecial[] = [
    fest(fecha(a, 1, 1), 'Año Nuevo'),
    fest(aLunes(fecha(a, 1, 6)), 'Reyes Magos'),
    fest(aLunes(fecha(a, 3, 19)), 'San José'),
    fest(sumar(p, -3), 'Jueves Santo'),
    fest(sumar(p, -2), 'Viernes Santo'),
    fest(fecha(a, 5, 1), 'Día del Trabajo'),
    fest(sumar(p, 43), 'Ascensión'),
    fest(sumar(p, 64), 'Corpus Christi'),
    fest(sumar(p, 71), 'Sagrado Corazón'),
    fest(aLunes(fecha(a, 6, 29)), 'San Pedro y San Pablo'),
    fest(fecha(a, 7, 20), 'Independencia'),
    fest(fecha(a, 8, 7), 'Batalla de Boyacá'),
    fest(aLunes(fecha(a, 8, 15)), 'Asunción de la Virgen'),
    fest(aLunes(fecha(a, 10, 12)), 'Día de la Raza'),
    fest(aLunes(fecha(a, 11, 1)), 'Todos los Santos'),
    fest(aLunes(fecha(a, 11, 11)), 'Independencia de Cartagena'),
    fest(fecha(a, 12, 8), 'Inmaculada Concepción'),
    fest(fecha(a, 12, 25), 'Navidad'),

    com(fecha(a, 1, 6), 'Reyes', 'Juguetes y regalos para niños: recuérdalo en tus estados.', 7),
    com(fecha(a, 3, 8), 'Día de la Mujer', 'Belleza y cuidado: arma combos y un cupón.', 7),
    com(ultimoDow(a, 4, 6), 'Día del Niño', 'Revisa el inventario de juguetes y ponlos de primeros en el catálogo.'),
    com(enesimo(a, 5, 0, 2), 'Día de la Madre', 'La fecha más fuerte del primer semestre: pide mercancía con tiempo y crea un cupón.', 15),
    com(enesimo(a, 6, 0, 3), 'Día del Padre', 'Herramientas, tecnología y carros: muévelos en el catálogo.'),
    com(enesimo(a, 9, 6, 3), 'Amor y Amistad', 'Regalos pequeños y combos para compartir. Crea un cupón.'),
    com(fecha(a, 10, 31), 'Halloween', 'Disfraces, dulceros y luces. Publícalo desde mediados de octubre.'),
    com(sumar(enesimo(a, 11, 4, 4), 1), 'Black Friday', 'Prepara descuentos y un cupón con anticipación. Revisa los productos quietos.', 14),
    com(fecha(a, 12, 7), 'Noche de Velitas', 'Iluminación y decoración navideña.', 10),
    com(fecha(a, 12, 24), 'Nochebuena', 'Los regalos de última hora: ten stock de lo más vendido.', 20),
    com(fecha(a, 12, 31), 'Fin de año', 'Cierra el año: revisa deudas, cuentas por cobrar y productos quietos.', 7),

    { dia: iso(fecha(a, 6, 30)), nombre: 'Pago de prima', tipo: 'pago', consejo: 'La gente tiene plata extra: buen momento para promociones.', avisar: 7 },
    { dia: iso(fecha(a, 12, 20)), nombre: 'Pago de prima', tipo: 'pago', consejo: 'La gente tiene plata extra: buen momento para promociones.', avisar: 7 },
  ];
  // Quincenas: el 15 y el último día de cada mes
  for (let m = 1; m <= 12; m++) {
    l.push({ dia: iso(fecha(a, m, 15)), nombre: 'Quincena', tipo: 'pago' });
    l.push({ dia: iso(fecha(a, m + 1, 0)), nombre: 'Quincena', tipo: 'pago' });
  }
  return l;
}

/** Fechas especiales entre dos días (YYYY-MM-DD), agrupadas por día */
export function fechasEntre(desde: string, hasta: string): Map<string, FechaEspecial[]> {
  const out = new Map<string, FechaEspecial[]>();
  const a1 = Number(desde.slice(0, 4)), a2 = Number(hasta.slice(0, 4));
  for (let a = a1; a <= a2; a++) {
    for (const f of fechasDelAnio(a)) {
      if (f.dia < desde || f.dia > hasta) continue;
      out.set(f.dia, [...(out.get(f.dia) ?? []), f]);
    }
  }
  return out;
}
