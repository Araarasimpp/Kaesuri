// Después de compilar: pone en www/index.html la última novedad como marca del aviso de
// "Nueva versión". La app abierta compara esa marca con la suya; si no hubo novedad, no avisa.
import { readFileSync, writeFileSync } from 'node:fs';

const id = JSON.parse(readFileSync('src/assets/novedades.json', 'utf8'))[0]?.id;
const archivo = 'www/index.html';
const html = readFileSync(archivo, 'utf8');
const vacia = /(<meta name="jyb-aviso" content=")dev(")/;
if (!id || !vacia.test(html)) {
  console.error('No se pudo poner la marca del aviso de actualización');
  process.exit(1);
}
writeFileSync(archivo, html.replace(vacia, `$1${id}$2`));
console.log('Marca de aviso:', id);
