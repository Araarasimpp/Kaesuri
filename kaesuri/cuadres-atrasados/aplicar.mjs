#!/usr/bin/env node
// Cuadres del domiciliario: muestra TODOS los pedidos entregados sin cuadrar
// (también los de días anteriores), para que nunca se queden por fuera.
// Va junto con el cambio ya aplicado en Supabase a la función cerrar_cuadre.
// Uso (desde la carpeta del proyecto, la que contiene /src):
//   node cuadres-atrasados/aplicar.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(process.argv[2] || process.cwd());
const respaldo = path.join(aqui, 'respaldo', new Date().toISOString().replace(/[:.]/g, '-'));
const base = 'src/app/domiciliario/cuadres/';

const cambios = {
  'cuadres.page.ts': [
    ['quitar límite "desde hoy" en la consulta', /\n\s*\.gte\('entregado_at',\s*inicioHoy\.toISOString\(\)\)/, ''],
    ['quitar variable sin uso', /\n\s*const inicioHoy = inicioDiaColombia\(\);/, ''],
    [
      'texto de confirmación',
      /¿Cerrar el cuadre de hoy con \$\{this\.pedidosHoy\.length\} pedido\(s\)\?/,
      '¿Cerrar el cuadre con ${this.pedidosHoy.length} pedido(s) entregado(s) sin cuadrar?',
    ],
  ],
  'cuadres.page.html': [
    ['texto del botón', /'Cerrar cuadre de hoy'/, "'Cerrar cuadre'"],
    ['mensaje vacío', /No has entregado pedidos hoy todavía\./, 'No tienes pedidos entregados pendientes de cuadrar.'],
  ],
};

let avisos = 0;
for (const [nombre, reglas] of Object.entries(cambios)) {
  const rel = base + nombre;
  const archivo = path.join(raiz, rel);
  if (!fs.existsSync(archivo)) {
    console.log(`  ✖ ${rel}: no existe`);
    avisos++;
    continue;
  }
  const antes = fs.readFileSync(archivo, 'utf8');
  let s = antes;
  for (const [desc, re, nuevo] of reglas) {
    if (re.test(s)) s = s.replace(re, nuevo);
    else console.log(`  · ${rel}: "${desc}" ya estaba aplicado o no se encontró`);
  }
  if (s !== antes) {
    const copia = path.join(respaldo, rel);
    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.copyFileSync(archivo, copia);
    fs.writeFileSync(archivo, s);
    console.log(`  ✔ ${rel}`);
  }
}
console.log(avisos ? '\nRevisa los avisos de arriba.' : '\nListo. Prueba con: ionic serve\n');
