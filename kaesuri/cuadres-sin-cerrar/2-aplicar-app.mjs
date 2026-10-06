#!/usr/bin/env node
// Cuadres sin cerrar en la app (admin y despachador comparten la página).
// Uso desde kaesuri/:  node cuadres-sin-cerrar/2-aplicar-app.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(process.argv[2] || process.cwd());
const app = path.join(raiz, 'src', 'app');
const respaldo = path.join(aqui, 'respaldo', new Date().toISOString().replace(/[:.]/g, '-'));
let avisos = 0;

function editar(rel, cambios) {
  const archivo = path.join(app, rel);
  if (!fs.existsSync(archivo)) { console.log(`  ✖ ${rel}: no existe`); avisos++; return; }
  const antes = fs.readFileSync(archivo, 'utf8');
  let s = antes;
  for (const [desc, ya, re, nuevo] of cambios) {
    if (ya(s)) continue;
    if (!re.test(s)) { console.log(`  ✖ ${rel}: no encontré "${desc}"`); avisos++; continue; }
    s = s.replace(re, nuevo);
  }
  if (s !== antes) {
    const copia = path.join(respaldo, 'src', 'app', rel);
    fs.mkdirSync(path.dirname(copia), { recursive: true });
    fs.copyFileSync(archivo, copia);
    fs.writeFileSync(archivo, s);
    console.log(`  ✔ ${rel}`);
  } else console.log(`  · ${rel}: ya estaba`);
}

// ---------- Modelo
editar('shared/models/models.ts', [
  ['Cuadre.cerrado_por', (s) => /cerrado_por\?:/.test(s), /(export interface Cuadre \{[\s\S]*?confirmado_por\?: string \| null;)/,
   '$1\n  /** Quién cerró el cuadre; null = cierre automático de la noche. */\n  cerrado_por?: string | null;'],
]);

// ---------- Lógica de la página
const TS = 'admin/cuadres/cuadres.page.ts';
editar(TS, [
  ['import diaColombiaDe', (s) => s.includes('diaColombiaDe'),
   /import \{ hoyColombiaISO, formatoFechaCO \} from '\.\.\/\.\.\/shared\/fecha-colombia';/,
   "import { diaColombiaDe, formatoFechaCO, hoyColombiaISO } from '../../shared/fecha-colombia';"],
  ['import avisar', (s) => /import \{[^}]*avisar[^}]*\} from '\.\.\/\.\.\/shared\/dialogo'/.test(s),
   /import \{ confirmar \} from '\.\.\/\.\.\/shared\/dialogo';/, "import { avisar, confirmar } from '../../shared/dialogo';"],
  ['tipo SinCerrar', (s) => s.includes('interface SinCerrar'), /(\ninterface Domiciliario \{)/,
   `
/** Entregas de un domiciliario en un día que todavía no están en ningún cuadre. */
interface SinCerrar {
  domiciliarioId: string;
  fecha: string;
  pedidos: number;
  efectivo: number;
  transferencia: number;
  domicilios: number;
  aEntregar: number;
}
$1`],
  ['estado de la página', (s) => s.includes('sinCerrar: SinCerrar[]'), /(\n\s*private canal: RealtimeChannel \| null = null;)/,
   `
  readonly hoy = hoyColombiaISO();

  /** Lo que los domiciliarios llevan entregado y aún no han cerrado (en vivo). */
  sinCerrar: SinCerrar[] = [];
  /** Pedidos en ruta por domiciliario (todavía no entregados). */
  enRutaPorDom = new Map<string, number>();
  cerrandoClave: string | null = null;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
$1`],
  ['limpiar temporizador', (s) => s.includes('clearTimeout(this.temporizador)'), /(ngOnDestroy\(\): void \{)/,
   '$1\n    if (this.temporizador) clearTimeout(this.temporizador);'],
  ['escuchar pedidos en vivo', (s) => s.includes('programarRecarga'),
   /\.on\('postgres_changes', \{ event: '\*', schema: 'public', table: 'cuadres' \}, \(\) =>\s*this\.cargarTodo\(\)\s*\)/,
   `.on('postgres_changes', { event: '*', schema: 'public', table: 'cuadres' }, () => this.programarRecarga())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => this.programarRecarga())`],
  ['consulta de lo abierto', (s) => s.includes('abiertosRes'),
   /async cargarTodo\(\): Promise<void> \{\s*this\.loading = true;\s*const \[cuadresRes, perfilesRes\] = await Promise\.all\(\[([\s\S]*?)\]\);/,
   `private programarRecarga(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      this.pedidosPorCuadre.clear();
      this.cargarTodo();
    }, 400);
  }

  async cargarTodo(): Promise<void> {
    if (!this.cuadres.length) this.loading = true;

    const [cuadresRes, perfilesRes, abiertosRes] = await Promise.all([$1  this.supabase.client
        .from('pedidos')
        .select('domiciliario_id, estado, entregado_at, total, metodo_pago, valor_domicilio')
        .in('estado', ['entregado', 'en_ruta'])
        .is('cuadre_id', null)
        .not('domiciliario_id', 'is', null),
    ]);`],
  ['procesar lo abierto', (s) => s.includes('this.calcularSinCerrar('),
   /(\n\s*if \(!cuadresRes\.error && cuadresRes\.data\) \{)/,
   `
    if (!abiertosRes.error && abiertosRes.data) {
      this.calcularSinCerrar(abiertosRes.data as any[]);
    }
$1`],
  ['métodos de sin cerrar', (s) => s.includes('cerrarPorDomiciliario'), /(\n\s*get filtrados\(\): Cuadre\[\] \{)/,
   `
  private calcularSinCerrar(filas: any[]): void {
    const grupos = new Map<string, SinCerrar>();
    const enRuta = new Map<string, number>();
    for (const p of filas) {
      if (p.estado === 'en_ruta') {
        enRuta.set(p.domiciliario_id, (enRuta.get(p.domiciliario_id) ?? 0) + 1);
        continue;
      }
      if (!p.entregado_at) continue;
      const fecha = diaColombiaDe(p.entregado_at);
      const clave = p.domiciliario_id + '|' + fecha;
      const g = grupos.get(clave) ?? {
        domiciliarioId: p.domiciliario_id, fecha, pedidos: 0, efectivo: 0, transferencia: 0, domicilios: 0, aEntregar: 0,
      };
      const total = Number(p.total) || 0;
      g.pedidos++;
      if (p.metodo_pago === 'efectivo') g.efectivo += total;
      if (p.metodo_pago === 'transferencia') g.transferencia += total;
      g.domicilios += Number(p.valor_domicilio) || 0;
      g.aEntregar = g.efectivo - g.domicilios;
      grupos.set(clave, g);
    }
    this.enRutaPorDom = enRuta;
    this.sinCerrar = Array.from(grupos.values()).sort(
      (a, b) =>
        b.fecha.localeCompare(a.fecha) ||
        this.nombreDomiciliario(a.domiciliarioId).localeCompare(this.nombreDomiciliario(b.domiciliarioId))
    );
  }

  get sinCerrarFiltrados(): SinCerrar[] {
    return this.sinCerrar.filter((g) => this.domiciliarioId === 'todos' || g.domiciliarioId === this.domiciliarioId);
  }

  claveDe(g: SinCerrar): string {
    return g.domiciliarioId + '|' + g.fecha;
  }

  /** Cierra el cuadre en nombre del domiciliario (cuando él no lo hizo). */
  async cerrarPorDomiciliario(g: SinCerrar): Promise<void> {
    const nombre = this.nombreDomiciliario(g.domiciliarioId);
    const enRuta = g.fecha === this.hoy ? this.enRutaPorDom.get(g.domiciliarioId) ?? 0 : 0;
    const aviso = enRuta
      ? \`\\n\\nTodavía tiene \${enRuta} \${enRuta === 1 ? 'pedido' : 'pedidos'} en ruta; esos quedarán para otro cuadre.\`
      : '';
    const ok = await confirmar(
      \`Se cerrará el cuadre de \${nombre} del \${this.formatoFecha(g.fecha)}. Debe entregar \${this.formatoMoneda(g.aEntregar)}.\${aviso}\`,
      { titulo: 'Cerrar cuadre', aceptar: 'Cerrar cuadre' }
    );
    if (!ok) return;

    this.cerrandoClave = this.claveDe(g);
    this.cdr.detectChanges();
    const { error } = await this.supabase.client.rpc('cerrar_cuadre', { p_fecha: g.fecha, p_domiciliario: g.domiciliarioId });
    this.cerrandoClave = null;
    if (error) {
      avisar(error.message, 'No se pudo cerrar');
    } else {
      this.filtro = 'pendiente';
      this.fecha = g.fecha;
    }
    await this.cargarTodo();
  }

  /** Quién cerró el cuadre, si no fue el propio domiciliario. */
  cerradoPor(c: Cuadre): string | null {
    const por = c.cerrado_por;
    if (por === undefined || por === c.domiciliario_id) return null;
    if (por === null) return 'Cierre automático';
    return 'Cerró ' + (this.nombresPorId.get(por) ?? 'la oficina');
  }

  /** Cuadres pendientes que el filtro de fecha está ocultando. */
  get pendientesOtrosDias(): number {
    if (!this.fecha) return 0;
    return this.cuadres.filter(
      (c) =>
        c.estado === 'pendiente' &&
        c.fecha !== this.fecha &&
        (this.domiciliarioId === 'todos' || c.domiciliario_id === this.domiciliarioId)
    ).length;
  }

  verPendientesOtrosDias(): void {
    this.fecha = '';
    this.filtro = 'pendiente';
  }
$1`],
]);

// ---------- Plantilla
const HTML = 'admin/cuadres/cuadres.page.html';
editar(HTML, [
  ['botones de fecha', (s) => s.includes('fecha = hoy'),
   /<input type="date" class="filtro" \[\(ngModel\)\]="fecha" title="Fecha" \/>/,
   `<input type="date" class="filtro" [(ngModel)]="fecha" title="Fecha" aria-label="Fecha de los cuadres" />
      <button class="btn-fecha" *ngIf="fecha !== hoy" (click)="fecha = hoy">Hoy</button>
      <button class="btn-fecha" *ngIf="fecha" (click)="fecha = ''">Todas las fechas</button>`],
  ['sección sin cerrar', (s) => s.includes('sin-cerrar'), /(\n\s*<div class="table-card">)/,
   `

  <!-- Con la fecha de hoy por defecto, avisa si quedaron cuadres pendientes de otros días -->
  <div class="aviso-otros-dias" *ngIf="!loading && fecha && pendientesOtrosDias > 0" role="status">
    <span>
      {{ pendientesOtrosDias === 1 ? 'Hay 1 cuadre pendiente' : 'Hay ' + pendientesOtrosDias + ' cuadres pendientes' }}
      de otros días.
    </span>
    <button (click)="verPendientesOtrosDias()">Ver pendientes</button>
  </div>

  <!-- Lo que los domiciliarios llevan entregado y todavía no han cerrado -->
  <section class="sin-cerrar" *ngIf="!loading && sinCerrarFiltrados.length" aria-labelledby="t-sin-cerrar">
    <div class="sin-cerrar-head">
      <h2 id="t-sin-cerrar">Sin cerrar</h2>
      <span class="text-soft">En vivo: lo entregado que aún no está en un cuadre. Si nadie lo cierra, se cierra solo a las 11:50 p. m.</span>
    </div>
    <div class="sin-cerrar-fila" *ngFor="let g of sinCerrarFiltrados">
      <span class="col-dom">{{ nombreDomiciliario(g.domiciliarioId) }}</span>
      <span class="col-fecha text-soft">{{ g.fecha === hoy ? 'Hoy' : formatoFecha(g.fecha) }}</span>
      <span class="col-pedidos text-soft">
        {{ g.pedidos }} {{ g.pedidos === 1 ? 'entregado' : 'entregados'
        }}<ng-container *ngIf="g.fecha === hoy && enRutaPorDom.get(g.domiciliarioId)">, {{ enRutaPorDom.get(g.domiciliarioId) }} en ruta</ng-container>
      </span>
      <span class="col-monto text-soft">Efectivo: {{ formatoMoneda(g.efectivo) }}</span>
      <span class="col-monto text-soft">Transf: {{ formatoMoneda(g.transferencia) }}</span>
      <span class="col-monto text-soft">Domicilios: {{ formatoMoneda(g.domicilios) }}</span>
      <span class="col-entregar"><span class="text-soft">Debe entregar</span> <strong>{{ formatoMoneda(g.aEntregar) }}</strong></span>
      <button class="btn-confirmar" (click)="cerrarPorDomiciliario(g)" [disabled]="cerrandoClave === claveDe(g)">
        {{ cerrandoClave === claveDe(g) ? 'Cerrando…' : 'Cerrar cuadre' }}
      </button>
    </div>
  </section>
$1`],
  ['quién cerró', (s) => s.includes('cerradoPor(c)'),
   /(\n\s*<span class="badge" \[class\.confirmado\]="c\.estado === 'confirmado'">)/,
   `
          <span class="cerrado-por text-soft" *ngIf="cerradoPor(c) as quien">{{ quien }}</span>$1`],
  ['mensaje vacío', (s) => s.includes("'No hay cuadres ' + "),
   /<p class="empty-msg">No hay cuadres en este filtro\.<\/p>/,
   `<p class="empty-msg">
          {{ fecha ? 'No hay cuadres ' + (fecha === hoy ? 'de hoy' : 'del ' + formatoFecha(fecha)) + ' en este filtro.' : 'No hay cuadres en este filtro.' }}
        </p>`],
]);

// ---------- Estilos
editar('admin/cuadres/cuadres.page.scss', [
  ['estilos sin cerrar', (s) => s.includes('.sin-cerrar'), /$/, `

/* ---------- Fecha */
.btn-fecha {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--k-border);
  background: var(--k-card-bg);
  color: var(--k-text);
  font-size: 13px;
  font-weight: 600;
  font-family: var(--k-font);
  cursor: pointer;
}

/* ---------- Aviso de pendientes de otros días */
.aviso-otros-dias {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--k-amber-soft);
  color: var(--k-amber);
  font-size: 13px;
  font-weight: 600;
}

.aviso-otros-dias button {
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

/* ---------- Sin cerrar */
.sin-cerrar {
  margin-bottom: 16px;
  background: var(--k-card-bg);
  border: 1px solid var(--k-border);
  border-left: 3px solid var(--k-amber);
  border-radius: 14px;
  overflow: hidden;
}

.sin-cerrar-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 18px 10px;
  font-size: 13px;
}

.sin-cerrar-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.sin-cerrar-fila {
  display: flex;
  align-items: center;
  gap: 12px 16px;
  flex-wrap: wrap;
  padding: 12px 18px;
  border-top: 1px solid var(--k-border);
  font-size: 13px;
}

.cerrado-por {
  font-size: 12px;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .sin-cerrar-fila {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}
`],
]);

console.log(avisos ? `\nTerminado con ${avisos} aviso(s) ✖.` : '\nListo. Prueba con: ionic serve\n');
