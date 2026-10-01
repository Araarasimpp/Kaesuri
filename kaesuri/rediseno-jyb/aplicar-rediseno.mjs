#!/usr/bin/env node
// Aplica el rediseño estándar de Variedades JYB al proyecto Ionic.
// Uso (desde la carpeta del proyecto, la que contiene /src):
//   node rediseno-jyb/aplicar-rediseno.mjs
// Guarda una copia de cada archivo que cambia en rediseno-jyb/respaldo/<fecha>/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformScss, transformIndex } = require('./transformar.cjs');

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(process.argv[2] || process.cwd());
const src = path.join(raiz, 'src');
const nuevos = path.join(aqui, 'archivos', 'src');
const respaldo = path.join(aqui, 'respaldo', new Date().toISOString().replace(/[:.]/g, '-'));
const MARCA = 'estilo estándar de software de tienda';

const tema = path.join(src, 'theme', 'kaesuri-theme.scss');
if (!fs.existsSync(tema)) {
  console.error('No encuentro src/theme/kaesuri-theme.scss en ' + raiz);
  console.error('Ejecuta el script desde la carpeta del proyecto (la que tiene /src).');
  process.exit(1);
}
if (fs.readFileSync(tema, 'utf8').includes(MARCA)) {
  console.log('El rediseño ya está aplicado en este proyecto; no hago nada.');
  process.exit(0);
}

function listar(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : [p];
  });
}

function guardar(destino, contenido) {
  const rel = path.relative(raiz, destino);
  if (fs.existsSync(destino)) {
    const copia = path.join(respaldo, rel);
    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.copyFileSync(destino, copia);
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
  console.log('  ✔ ' + rel);
}

// 1) Archivos reescritos (tema, menús, acceso, pedidos, configuración, rótulo)
console.log('\nArchivos nuevos o reescritos:');
const reescritos = new Set();
for (const archivo of listar(nuevos)) {
  const rel = path.relative(nuevos, archivo);
  reescritos.add(rel.split(path.sep).join('/'));
  guardar(path.join(src, rel), fs.readFileSync(archivo, 'utf8'));
}

// 2) Resto de estilos: adaptados al nuevo tema
console.log('\nEstilos adaptados al nuevo tema:');
let sinCambios = 0;
for (const archivo of listar(path.join(src, 'app'))) {
  if (!archivo.endsWith('.scss')) continue;
  const rel = path.relative(src, archivo).split(path.sep).join('/');
  if (reescritos.has(rel)) continue;
  const antes = fs.readFileSync(archivo, 'utf8');
  const despues = transformScss(antes);
  if (despues !== antes) guardar(archivo, despues);
  else sinCambios++;
}
console.log(`  (${sinCambios} archivos no necesitaban cambios)`);

// 3) Logo real en el menú del despachador (el del admin ya viene reescrito)
const despLayout = path.join(src, 'app', 'despachador', 'despachador-layout', 'despachador-layout.component.html');
if (fs.existsSync(despLayout)) {
  const antes = fs.readFileSync(despLayout, 'utf8');
  const despues = antes.replace(
    /<span class="brand-mark">\s*V\s*<\/span>/,
    '<img class="brand-logo" src="assets/icon/logo.png" alt="Variedades JYB" />'
  );
  if (despues !== antes) {
    console.log('\nMenú del despachador:');
    guardar(despLayout, despues);
  }
}

// 4) index.html: fuente Figtree, color de la barra del sistema, idioma
const index = path.join(src, 'index.html');
const htmlAntes = fs.readFileSync(index, 'utf8');
const htmlDespues = transformIndex(htmlAntes);
if (htmlDespues !== htmlAntes) {
  console.log('\nindex.html:');
  guardar(index, htmlDespues);
}

console.log('\nListo. Copia de seguridad en: ' + path.relative(raiz, respaldo));
console.log('Prueba con: ionic serve\n');
