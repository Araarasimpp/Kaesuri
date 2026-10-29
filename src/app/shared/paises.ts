// Países con su indicativo telefónico (para el selector de prefijo del teléfono del cliente).
// Colombia (+57) va primero y es el predeterminado; los más usados después; luego el resto en orden alfabético.

export interface Pais {
  iso: string;
  prefijo: string;
  nombre: string;
}

const DATOS =
  'CO57Colombia|VE58Venezuela|EC593Ecuador|PE51Perú|PA507Panamá|US1Estados Unidos|ES34España|MX52México|' +
  'AF93Afganistán|AL355Albania|DE49Alemania|AD376Andorra|AO244Angola|AG1268Antigua y Barbuda|SA966Arabia Saudita|DZ213Argelia|AR54Argentina|' +
  'AM374Armenia|AW297Aruba|AU61Australia|AT43Austria|AZ994Azerbaiyán|BS1242Bahamas|BH973Baréin|BD880Bangladés|BB1246Barbados|BE32Bélgica|' +
  'BZ501Belice|BJ229Benín|BY375Bielorrusia|BO591Bolivia|BA387Bosnia y Herzegovina|BW267Botsuana|BR55Brasil|BN673Brunéi|BG359Bulgaria|' +
  'BF226Burkina Faso|BI257Burundi|BT975Bután|CV238Cabo Verde|KH855Camboya|CM237Camerún|CA1Canadá|QA974Catar|TD235Chad|CL56Chile|CN86China|' +
  'CY357Chipre|KM269Comoras|CG242Congo|CD243Congo (RD)|KP850Corea del Norte|KR82Corea del Sur|CI225Costa de Marfil|CR506Costa Rica|' +
  'HR385Croacia|CU53Cuba|CW599Curazao|DK45Dinamarca|DM1767Dominica|EG20Egipto|SV503El Salvador|AE971Emiratos Árabes Unidos|ER291Eritrea|' +
  'SK421Eslovaquia|SI386Eslovenia|EE372Estonia|SZ268Esuatini|ET251Etiopía|PH63Filipinas|FI358Finlandia|FJ679Fiyi|FR33Francia|GA241Gabón|' +
  'GM220Gambia|GE995Georgia|GH233Ghana|GD1473Granada|GR30Grecia|GT502Guatemala|GF594Guayana Francesa|GN224Guinea|GQ240Guinea Ecuatorial|' +
  'GW245Guinea-Bisáu|GY592Guyana|HT509Haití|HN504Honduras|HK852Hong Kong|HU36Hungría|IN91India|ID62Indonesia|IQ964Irak|IR98Irán|IE353Irlanda|' +
  'IS354Islandia|IL972Israel|IT39Italia|JM1876Jamaica|JP81Japón|JO962Jordania|KZ7Kazajistán|KE254Kenia|KG996Kirguistán|KW965Kuwait|LA856Laos|' +
  'LS266Lesoto|LV371Letonia|LB961Líbano|LR231Liberia|LY218Libia|LI423Liechtenstein|LT370Lituania|LU352Luxemburgo|MO853Macao|MK389Macedonia del Norte|' +
  'MG261Madagascar|MY60Malasia|MW265Malaui|MV960Maldivas|ML223Malí|MT356Malta|MA212Marruecos|MU230Mauricio|MR222Mauritania|MD373Moldavia|' +
  'MC377Mónaco|MN976Mongolia|ME382Montenegro|MZ258Mozambique|MM95Myanmar|NA264Namibia|NP977Nepal|NI505Nicaragua|NE227Níger|NG234Nigeria|' +
  'NO47Noruega|NZ64Nueva Zelanda|OM968Omán|NL31Países Bajos|PK92Pakistán|PS970Palestina|PG675Papúa Nueva Guinea|PY595Paraguay|PL48Polonia|' +
  'PT351Portugal|PR1787Puerto Rico|GB44Reino Unido|CF236República Centroafricana|CZ420República Checa|DO1809República Dominicana|RW250Ruanda|' +
  'RO40Rumania|RU7Rusia|WS685Samoa|KN1869San Cristóbal y Nieves|SM378San Marino|VC1784San Vicente y las Granadinas|LC1758Santa Lucía|' +
  'ST239Santo Tomé y Príncipe|SN221Senegal|RS381Serbia|SC248Seychelles|SL232Sierra Leona|SG65Singapur|SY963Siria|SO252Somalia|LK94Sri Lanka|' +
  'ZA27Sudáfrica|SD249Sudán|SS211Sudán del Sur|SE46Suecia|CH41Suiza|SR597Surinam|TH66Tailandia|TW886Taiwán|TZ255Tanzania|TJ992Tayikistán|' +
  'TL670Timor Oriental|TG228Togo|TO676Tonga|TT1868Trinidad y Tobago|TN216Túnez|TM993Turkmenistán|TR90Turquía|UA380Ucrania|UG256Uganda|' +
  'UY598Uruguay|UZ998Uzbekistán|VU678Vanuatu|VN84Vietnam|YE967Yemen|DJ253Yibuti|ZM260Zambia|ZW263Zimbabue';

export const PAISES: Pais[] = DATOS.split('|').map((s) => {
  const m = s.match(/^([A-Z]{2})(\d+)(.+)$/)!;
  return { iso: m[1], prefijo: m[2], nombre: m[3] };
});

/** Bandera (emoji) a partir del código ISO del país */
export function bandera(iso: string): string {
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * Teléfono guardado → prefijo y número. Los de Colombia se guardan como siempre (10 dígitos,
 * sin prefijo); los de otros países, como "+<prefijo> <número>".
 */
export function separarTelefono(guardado: string | null | undefined): { prefijo: string; numero: string } {
  const t = (guardado ?? '').trim();
  if (!t.startsWith('+')) return { prefijo: '57', numero: t.replace(/\D/g, '') };
  const digitos = t.replace(/\D/g, '');
  // El prefijo más largo que coincida (ej. +1809 antes que +1)
  const p = [...PAISES].sort((a, b) => b.prefijo.length - a.prefijo.length).find((x) => digitos.startsWith(x.prefijo));
  return p ? { prefijo: p.prefijo, numero: digitos.slice(p.prefijo.length) } : { prefijo: '57', numero: digitos };
}

export function unirTelefono(prefijo: string, numero: string): string {
  const n = numero.replace(/\D/g, '');
  if (!n) return '';
  return prefijo === '57' ? n : `+${prefijo} ${n}`;
}

/** Mensaje de error del número, o '' si está bien */
export function errorTelefono(prefijo: string, numero: string): string {
  const n = numero.replace(/\D/g, '');
  if (!n) return '';
  if (prefijo === '57') {
    if (n.length !== 10) return 'El número de Colombia debe tener 10 dígitos.';
    if (!/^(3|60)/.test(n)) return 'Revisa el número: los celulares empiezan por 3 y los fijos por 60.';
    return '';
  }
  if (n.length < 6 || n.length > 14) return 'El número debe tener entre 6 y 14 dígitos.';
  return '';
}

/** Nombre: solo letras (con tildes y ñ), espacios, punto, guion y apóstrofo */
export function limpiarNombre(v: string): string {
  return v.replace(/[^\p{L}\s.'’-]/gu, '').replace(/\s{2,}/g, ' ');
}
