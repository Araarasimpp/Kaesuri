import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addCircleOutline, closeOutline, lockClosedOutline, searchOutline, trashOutline,
  airplaneOutline, bulbOutline, busOutline, carOutline, cardOutline, cartOutline, cubeOutline, cutOutline, fastFoodOutline, giftOutline, happyOutline, heartOutline, homeOutline, medkitOutline, pawOutline, phonePortraitOutline, receiptOutline, restaurantOutline, schoolOutline, shirtOutline, speedometerOutline, tvOutline, wineOutline } from 'ionicons/icons';
import { CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { RangoComponent, RangoFechas, diaCorto, sumarDias } from '../../shared/rango/rango.component';
import { mensajeError, pesos } from '../../shared/formato';
import { confirmar } from '../../shared/dialogo';
import { hoyColombiaISO } from '../../shared/fecha-colombia';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { PesosDirective } from '../../shared/pesos/pesos.directive';
import { DonaComponent, Segmento } from '../../shared/dona/dona.component';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler);

/** Categorías de gastos personales: se eligen tocando el ícono (ionicons) */
export const CATEGORIAS_PERSONALES = [
  { id: 'mercado', label: 'Mercado', icon: 'cart-outline', color: '#22c55e' },
  { id: 'almuerzos', label: 'Almuerzos', icon: 'restaurant-outline', color: '#84cc16' },
  { id: 'restaurantes', label: 'Comidas fuera', icon: 'fast-food-outline', color: '#f97316' },
  { id: 'hogar', label: 'Arriendo y hogar', icon: 'home-outline', color: '#3b82f6' },
  { id: 'servicios', label: 'Servicios', icon: 'bulb-outline', color: '#eab308' },
  { id: 'celular', label: 'Celular e internet', icon: 'phone-portrait-outline', color: '#06b6d4' },
  { id: 'transporte', label: 'Transporte', icon: 'bus-outline', color: '#8b5cf6' },
  { id: 'gasolina', label: 'Gasolina', icon: 'speedometer-outline', color: '#ef4444' },
  { id: 'vehiculo', label: 'Carro o moto', icon: 'car-outline', color: '#64748b' },
  { id: 'salud', label: 'Salud y droguería', icon: 'medkit-outline', color: '#ec4899' },
  { id: 'belleza', label: 'Belleza y cuidado', icon: 'cut-outline', color: '#d946ef' },
  { id: 'ropa', label: 'Ropa y zapatos', icon: 'shirt-outline', color: '#0ea5e9' },
  { id: 'estudio', label: 'Estudio', icon: 'school-outline', color: '#6366f1' },
  { id: 'hijos', label: 'Hijos', icon: 'happy-outline', color: '#f59e0b' },
  { id: 'mascotas', label: 'Mascotas', icon: 'paw-outline', color: '#a16207' },
  { id: 'salidas', label: 'Salidas y diversión', icon: 'wine-outline', color: '#e11d48' },
  { id: 'viajes', label: 'Viajes', icon: 'airplane-outline', color: '#14b8a6' },
  { id: 'regalos', label: 'Regalos', icon: 'gift-outline', color: '#f43f5e' },
  { id: 'suscripciones', label: 'Suscripciones', icon: 'tv-outline', color: '#7c3aed' },
  { id: 'creditos', label: 'Créditos y tarjetas', icon: 'card-outline', color: '#475569' },
  { id: 'impuestos', label: 'Impuestos y trámites', icon: 'receipt-outline', color: '#78716c' },
  { id: 'donaciones', label: 'Ayudas y donaciones', icon: 'heart-outline', color: '#10b981' },
  { id: 'otros', label: 'Otros', icon: 'cube-outline', color: '#94a3b8' },
] as const;
type Categoria = (typeof CATEGORIAS_PERSONALES)[number];

interface Gasto {
  id: number;
  fecha: string;
  categoria: string;
  descripcion: string;
  valor: number;
  metodo: string;
  creado_por_nombre: string | null;
}
interface Resumen {
  total: number;
  n: number;
  dias: number;
  por_categoria: { categoria: string; total: number; n: number }[];
  por_metodo: { metodo: string; total: number }[];
  agrupado: 'dia' | 'mes';
  serie: { fecha: string; total: number }[];
  anterior: number | null;
  serie_anterior: number[] | null;
  lista: Gasto[];
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Gastos personales de los administradores (mercado, hogar, salud…), aparte de los del negocio:
 * no restan en la utilidad real. Solo los ven y registran los administradores. Sin fotos: solo el registro.
 */
@Component({
  selector: 'app-gastos-personales',
  standalone: true,
  imports: [PesosDirective, SkeletonComponent, FormsModule, IonIcon, RangoComponent, DonaComponent],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1040px; }
      .privado { display: flex; align-items: center; gap: 8px; margin: 0; padding: 9px 14px; border-radius: var(--radius); background: var(--surface-2); font-size: 12.5px; color: var(--text-soft); }
      .privado ion-icon { font-size: 16px; flex-shrink: 0; }
      .kpi-valor.rojo { color: var(--danger); }
      .kpi-valor.verde { color: var(--efectivo-texto); }
      .kpi-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .kpi-top .emo { display: grid; font-size: 22px; line-height: 1; }
      .kpi-top strong { font-size: 15px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dos { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; }
      .seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--surface-2); }
      .seg button { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--text-soft); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
      .seg button.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,.12); }
      .chart { position: relative; height: 240px; margin-top: 8px; }
      .chart-nota { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); }
      .chart-nota i { display: inline-block; width: 14px; height: 0; margin: 0 4px 3px 0; vertical-align: middle; border-top: 2px solid var(--accent); }
      .chart-nota i.ant { border-top: 2px dashed var(--text-muted); margin-left: 10px; }
      .cats { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
      .cats button { width: 100%; display: grid; grid-template-columns: 26px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 7px 8px; border: 0; border-radius: var(--radius-sm);
        background: transparent; color: var(--text); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
      .cats button:hover { background: var(--hover); }
      .cats button.on { background: var(--selected); }
      .cats .emo { display: grid; place-items: center; font-size: 18px; }
      .cats .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cats .pct { font-size: 11.5px; color: var(--text-muted); }
      .cats .v { font-family: var(--mono-font); font-weight: 650; white-space: nowrap; }
      .filtros { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .buscar { flex: 1; min-width: 180px; position: relative; }
      .buscar ion-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
      .buscar input { width: 100%; height: 38px; padding: 0 12px 0 34px; box-sizing: border-box; }
      .filtro-on { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 6px 0 12px; border: 0; border-radius: 999px; background: var(--accent-wash); color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
      .filtro-on ion-icon { font-size: 16px; }
      .dia-cab { display: flex; justify-content: space-between; align-items: baseline; margin: 14px 0 2px; padding-bottom: 6px; border-bottom: 1px solid var(--border-soft); font-size: 12px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); }
      .dia-cab b { font-family: var(--mono-font); letter-spacing: 0; }
      .gastos-lista { list-style: none; margin: 0; padding: 0; }
      .gasto { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 9px 0; }
      .gasto .ico { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; font-size: 19px; }
      :host-context(body.dark) .gasto .ico { filter: brightness(1.25); }
      .gasto .t1 { display: block; font-size: 14px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gasto .t2 { display: block; font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gasto .monto { font-family: var(--mono-font); font-size: 14px; font-weight: 650; white-space: nowrap; }
      .quitar { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 16px; }
      .quitar:hover { color: var(--danger); background: var(--danger-wash); }
      .vacio-txt { margin: 0; padding: 18px 0 8px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
      /* Formulario */
      .valor-grande input { height: 56px; font-size: 26px; font-weight: 700; text-align: center; }
      .cat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
      .cat-op { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 72px; padding: 8px 4px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface); color: var(--text-soft); font: inherit; font-size: 11.5px; line-height: 1.2; text-align: center; cursor: pointer; transition: transform 120ms ease, border-color 120ms ease; }
      .cat-op span { display: grid; font-size: 24px; line-height: 1; }
      .cat-op:active { transform: scale(.95); }
      .cat-op.on { border-color: var(--accent); background: var(--accent-wash); color: var(--text); font-weight: 650; }
      .rapido { display: flex; gap: 6px; margin-top: 6px; }
      .rapido button { height: 30px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--text-soft); font: inherit; font-size: 12.5px; cursor: pointer; }
      .rapido button.on { border-color: var(--accent); color: var(--accent); font-weight: 650; }
      .metodos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .metodo { height: 42px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 14px; cursor: pointer; }
      .metodo.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      @media (max-width: 860px) { .dos { grid-template-columns: 1fr; } }
      @media (max-width: 640px) {
        .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .kpi-valor { font-size: 18px; }
        .chart { height: 200px; }
        .cat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ etiqueta() }}</p><h1>Gastos personales</h1></div>
        <button class="b b-pri" (click)="abrirForm()"><ion-icon name="add-circle-outline"></ion-icon>Registrar gasto</button>
      </div>

      <p class="privado"><ion-icon name="lock-closed-outline"></ion-icon>Solo los administradores ven esta página. Estos gastos no cuentan en la utilidad del negocio.</p>

      <app-rango inicial="mes" (cambio)="cambiarRango($event)"></app-rango>

      <!-- Cifras del periodo -->
      <div class="kpis" [attr.aria-busy]="cargando()">
        <div class="kpi kpi-principal">
          <span class="kpi-label">Total gastado</span>
          <span class="kpi-valor">{{ pesos(r()?.total) }}</span>
          <span class="kpi-nota">{{ r()?.n ?? 0 }} {{ r()?.n === 1 ? 'gasto' : 'gastos' }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Promedio por día</span>
          <span class="kpi-valor">{{ pesos(promedio()) }}</span>
          <span class="kpi-nota">en {{ r()?.dias ?? 0 }} {{ r()?.dias === 1 ? 'día' : 'días' }}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">Vs. periodo anterior</span>
          @if (cambio(); as c) {
            <span class="kpi-valor" [class.rojo]="c.sube" [class.verde]="!c.sube">{{ c.sube ? '▲' : '▼' }} {{ c.pct }}%</span>
            <span class="kpi-nota">{{ c.sube ? 'Más' : 'Menos' }} que antes ({{ pesos(r()?.anterior) }})</span>
          } @else {
            <span class="kpi-valor">—</span><span class="kpi-nota">Sin gastos antes para comparar</span>
          }
        </div>
        <div class="kpi">
          <span class="kpi-label">Lo que más pesa</span>
          @if (mayor(); as m) {
            <span class="kpi-top"><span class="emo" [style.color]="m.cat.color"><ion-icon [name]="m.cat.icon"></ion-icon></span><strong>{{ m.cat.label }}</strong></span>
            <span class="kpi-nota">{{ m.pct }}% del total · {{ pesos(m.total) }}</span>
          } @else {
            <span class="kpi-valor">—</span><span class="kpi-nota">Todavía no hay gastos</span>
          }
        </div>
      </div>

      <div class="dos">
        <!-- Gráfica de líneas -->
        <section class="panel" aria-labelledby="t-linea">
          <div class="panel-head">
            <div><h2 id="t-linea">Cómo fue el gasto</h2><p class="panel-sub">{{ r()?.agrupado === 'mes' ? 'Por mes' : modo() === 'diario' ? 'Lo que se gastó cada día' : 'Cómo se fue sumando en el periodo' }}</p></div>
            @if (r()?.agrupado !== 'mes') {
              <div class="seg" role="group" aria-label="Tipo de gráfica">
                <button type="button" [class.on]="modo() === 'diario'" (click)="modo.set('diario')">Diario</button>
                <button type="button" [class.on]="modo() === 'acumulado'" (click)="modo.set('acumulado')">Acumulado</button>
              </div>
            }
          </div>
          <div class="chart"><canvas #lienzo role="img" aria-label="Gráfica de gastos personales en el tiempo"></canvas></div>
          @if (modo() === 'acumulado' && r()?.serie_anterior && r()?.agrupado !== 'mes') {
            <p class="chart-nota"><i></i>Este periodo<i class="ant"></i>Periodo anterior</p>
          }
        </section>

        <!-- Dona por categoría -->
        <section class="panel" aria-labelledby="t-dona">
          <div class="panel-head"><div><h2 id="t-dona">Por categoría</h2><p class="panel-sub">Toca una para ver solo esos gastos</p></div></div>
          @if (r()?.por_categoria?.length) {
            <app-dona [segmentos]="dona()" [valor]="pesosCorto(r()?.total)" etiqueta="gastado" [tam]="160" [leyenda]="false"></app-dona>
            <ul class="cats">
              @for (c of categoriasDelPeriodo(); track c.id) {
                <li><button type="button" [class.on]="filtro() === c.id" (click)="filtro.set(filtro() === c.id ? null : c.id)">
                  <span class="emo" [style.color]="c.color"><ion-icon [name]="c.icon"></ion-icon></span><span class="nom">{{ c.label }}</span><span class="pct">{{ c.pct }}%</span><span class="v">{{ pesos(c.total) }}</span>
                </button></li>
              }
            </ul>
          } @else {
            @if (cargando()) { <app-skeleton variante="filas" [cantidad]="4"></app-skeleton> } @else { <p class="vacio-txt">Sin gastos en este periodo.</p> }
          }
        </section>
      </div>

      <!-- Lista por día -->
      <section class="panel" aria-labelledby="t-lista">
        <div class="panel-head"><div><h2 id="t-lista">Gastos</h2></div></div>
        <div class="filtros">
          <label class="buscar"><ion-icon name="search-outline"></ion-icon>
            <input type="search" placeholder="Buscar un gasto" aria-label="Buscar un gasto" [ngModel]="busca()" (ngModelChange)="busca.set($event)" /></label>
          @if (filtroCat(); as f) {
            <button type="button" class="filtro-on" (click)="filtro.set(null)" [attr.aria-label]="'Quitar filtro ' + f.label"><ion-icon [name]="f.icon"></ion-icon>{{ f.label }}<ion-icon name="close-outline"></ion-icon></button>
          }
        </div>
        @if (porDia().length) {
          @for (d of porDia(); track d.fecha) {
            <div class="dia-cab"><span>{{ dia(d.fecha) }}</span><b>{{ pesos(d.total) }}</b></div>
            <ul class="gastos-lista">
              @for (g of d.gastos; track g.id) {
                <li class="gasto">
                  <span class="ico" [style.background]="color(g.categoria) + '22'" [style.color]="color(g.categoria)"><ion-icon [name]="cat(g.categoria).icon"></ion-icon></span>
                  <span style="min-width: 0">
                    <span class="t1">{{ g.descripcion }}</span>
                    <span class="t2">{{ cat(g.categoria).label }} · {{ metodo(g.metodo) }}@if (g.creado_por_nombre) { · {{ g.creado_por_nombre }} }</span>
                  </span>
                  <span class="monto">{{ pesos(g.valor) }}</span>
                  <button type="button" class="quitar" (click)="quitar(g)" [attr.aria-label]="'Quitar gasto ' + g.descripcion"><ion-icon name="trash-outline"></ion-icon></button>
                </li>
              }
            </ul>
          }
        } @else {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="5"></app-skeleton> }
          @else { <p class="vacio-txt">{{ busca() || filtro() ? 'No hay gastos con ese filtro.' : 'No hay gastos personales en este periodo.' }}</p> }
        }
      </section>
    </div>

    @if (form()) {
      <button class="velo" aria-label="Cerrar" (click)="form.set(false)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-gasto">
        <div class="hoja-head"><h2 id="t-gasto">Registrar gasto personal</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="form.set(false)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="campo valor-grande"><label for="gv">¿Cuánto fue?</label><input pesos id="gv" class="num" inputmode="numeric" [(ngModel)]="valor" /></div>
          <div class="campo"><span class="etq">¿En qué fue?</span>
            <div class="cat-grid" role="radiogroup" aria-label="Categoría">
              @for (c of categorias; track c.id) {
                <button type="button" class="cat-op" role="radio" [attr.aria-checked]="cat_() === c.id" [class.on]="cat_() === c.id" (click)="cat_.set(c.id)">
                  <span aria-hidden="true" [style.color]="c.color"><ion-icon [name]="c.icon"></ion-icon></span>{{ c.label }}</button>
              }
            </div>
          </div>
          <div class="campo"><label for="gd">Detalle (opcional)</label><input id="gd" maxlength="300" [(ngModel)]="descripcion" [placeholder]="'Ej: ' + cat(cat_()).label" /></div>
          <div class="campo"><label for="gf">Fecha</label><input id="gf" type="date" [max]="hoy" [ngModel]="fecha()" (ngModelChange)="fecha.set($event)" />
            <div class="rapido">
              <button type="button" [class.on]="fecha() === hoy" (click)="fecha.set(hoy)">Hoy</button>
              <button type="button" [class.on]="fecha() === ayer" (click)="fecha.set(ayer)">Ayer</button>
            </div>
          </div>
          <div class="campo"><span class="etq">¿Cómo se pagó?</span>
            <div class="metodos">
              @for (m of metodos; track m.id) {
                <button type="button" class="metodo" [class.on]="met() === m.id" (click)="met.set(m.id)">{{ m.label }}</button>
              }
            </div>
          </div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="form.set(false)">Cancelar</button>
          <button class="b b-pri" (click)="guardar()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : 'Registrar ' + (valor ? pesos(valor) : 'gasto') }}</button>
        </div>
      </div>
    }
  `,
})
export class GastosPersonalesPage implements OnDestroy {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  @ViewChild('lienzo') private lienzo?: ElementRef<HTMLCanvasElement>;
  private grafica?: Chart;

  r = signal<Resumen | null>(null);
  cargando = signal(true);
  etiqueta = signal('');
  form = signal(false);
  ocupado = signal(false);
  error = signal('');
  modo = signal<'diario' | 'acumulado'>('diario');
  filtro = signal<string | null>(null);
  busca = signal('');

  categorias = CATEGORIAS_PERSONALES;
  metodos = [
    { id: 'efectivo', label: 'Efectivo' },
    { id: 'transferencia', label: 'Transferencia' },
    { id: 'tarjeta', label: 'Tarjeta' },
  ];
  hoy = hoyColombiaISO();
  ayer = sumarDias(this.hoy, -1);
  valor: number | null = null;
  fecha = signal(this.hoy);
  cat_ = signal('mercado');
  descripcion = '';
  met = signal('efectivo');
  pesos = pesos;

  private rango: RangoFechas | null = null;
  private consulta = 0;

  promedio = computed(() => {
    const r = this.r();
    return r && r.dias ? Math.round(Number(r.total) / r.dias) : 0;
  });
  cambio = computed(() => {
    const r = this.r();
    const ant = Number(r?.anterior ?? 0);
    if (!r || !ant) return null;
    const pct = Math.round(((Number(r.total) - ant) / ant) * 100);
    return { sube: pct > 0, pct: Math.abs(pct) };
  });
  categoriasDelPeriodo = computed(() => {
    const r = this.r();
    const total = Number(r?.total ?? 0) || 1;
    return (r?.por_categoria ?? []).map((c) => ({ ...this.cat(c.categoria), total: Number(c.total), pct: Math.round((Number(c.total) / total) * 100) }));
  });
  mayor = computed(() => {
    const c = this.categoriasDelPeriodo()[0];
    return c ? { cat: c, pct: c.pct, total: c.total } : null;
  });
  dona = computed<Segmento[]>(() => this.categoriasDelPeriodo().map((c) => ({ etiqueta: c.label, valor: c.total, color: c.color })));
  filtroCat = computed(() => (this.filtro() ? this.cat(this.filtro()!) : null));
  porDia = computed(() => {
    const t = normal(this.busca().trim());
    const f = this.filtro();
    const lista = (this.r()?.lista ?? []).filter(
      (g) => (!f || g.categoria === f) && (!t || normal(g.descripcion + ' ' + this.cat(g.categoria).label + ' ' + (g.creado_por_nombre ?? '')).includes(t))
    );
    const dias: { fecha: string; total: number; gastos: Gasto[] }[] = [];
    for (const g of lista) {
      let d = dias[dias.length - 1];
      if (!d || d.fecha !== g.fecha) dias.push((d = { fecha: g.fecha, total: 0, gastos: [] }));
      d.total += Number(g.valor);
      d.gastos.push(g);
    }
    return dias;
  });

  constructor() {
    addIcons({ addCircleOutline, closeOutline, lockClosedOutline, searchOutline, trashOutline,
      airplaneOutline, bulbOutline, busOutline, carOutline, cardOutline, cartOutline, cubeOutline, cutOutline, fastFoodOutline, giftOutline, happyOutline, heartOutline, homeOutline, medkitOutline, pawOutline, phonePortraitOutline, receiptOutline, restaurantOutline, schoolOutline, shirtOutline, speedometerOutline, tvOutline, wineOutline });
    // La gráfica se redibuja cuando llegan datos o se cambia entre diario y acumulado
    effect(() => {
      const r = this.r();
      const m = this.modo();
      if (r) queueMicrotask(() => this.dibujar(r, m));
    });
  }

  ngOnDestroy(): void {
    this.grafica?.destroy();
  }

  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    this.etiqueta.set(r.etiqueta);
    this.filtro.set(null);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    const n = ++this.consulta;
    const { data, error } = await this.sb.client.rpc('gastos_personales_resumen', { p_desde: r.desde || '2020-01-01', p_hasta: r.hasta || this.hoy });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.r.set(data as Resumen);
  }

  abrirForm(): void {
    this.valor = null;
    this.fecha.set(this.hoy);
    this.descripcion = '';
    this.met.set('efectivo');
    this.error.set('');
    this.form.set(true);
  }

  async guardar(): Promise<void> {
    const v = Number(this.valor) || 0;
    if (v <= 0) return this.error.set('Escribe cuánto fue el gasto.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('registrar_gasto_personal', {
      p_fecha: this.fecha() || this.hoy, p_categoria: this.cat_(), p_descripcion: this.descripcion.trim() || this.cat(this.cat_()).label, p_valor: v, p_metodo: this.met(),
    });
    this.ocupado.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.toast.ok(`${this.cat(this.cat_()).label}: ${pesos(v)} registrado`);
    this.form.set(false);
    await this.cargar();
  }

  async quitar(g: Gasto): Promise<void> {
    if (!(await confirmar(`¿Quitar el gasto "${g.descripcion}" de ${pesos(g.valor)}?`, { peligro: true }))) return;
    const { error } = await this.sb.client.rpc('quitar_gasto_personal', { p_id: g.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Gasto quitado');
    await this.cargar();
  }

  cat(id: string): Categoria {
    return CATEGORIAS_PERSONALES.find((c) => c.id === id) ?? CATEGORIAS_PERSONALES[CATEGORIAS_PERSONALES.length - 1];
  }

  color(id: string): string {
    return this.cat(id).color;
  }

  metodo(id: string): string {
    return this.metodos.find((m) => m.id === id)?.label ?? id;
  }

  dia(f: string): string {
    return f === this.hoy ? 'Hoy' : f === this.ayer ? 'Ayer' : diaCorto(f);
  }

  pesosCorto(n: number | null | undefined): string {
    const a = Math.abs(Number(n ?? 0));
    if (a >= 1_000_000) return `$${(a / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
    if (a >= 1_000) return `$${Math.round(a / 1_000)} mil`;
    return `$${Math.round(a)}`;
  }

  // --------------------------------------------------------------- Gráfica de líneas
  private css(v: string): string {
    return getComputedStyle(document.body).getPropertyValue(v).trim() || '#888';
  }

  private dibujar(r: Resumen, modo: 'diario' | 'acumulado'): void {
    const canvas = this.lienzo?.nativeElement;
    if (!canvas) return;
    const porMes = r.agrupado === 'mes';
    const acumulado = modo === 'acumulado' && !porMes;
    const etiquetas = r.serie.map((s) => {
      const [, m, d] = s.fecha.split('-').map(Number);
      return porMes ? `${MESES[m - 1]} ${s.fecha.slice(2, 4)}` : `${d} ${MESES[m - 1]}`;
    });
    const sumar = (xs: number[]) => {
      let t = 0;
      return xs.map((x) => (t += Number(x)));
    };
    const actual = r.serie.map((s) => Number(s.total));
    const datos = acumulado ? sumar(actual) : actual;
    const anterior = acumulado && r.serie_anterior ? sumar(r.serie_anterior.slice(0, actual.length)) : null;

    const acento = this.css('--accent');
    const texto = this.css('--text-muted');
    const linea = this.css('--border-soft');
    const fuente = this.css('--ui-font');
    const ctx = canvas.getContext('2d');
    const degradado = ctx?.createLinearGradient(0, 0, 0, canvas.clientHeight || 240);
    degradado?.addColorStop(0, acento + '55');
    degradado?.addColorStop(1, acento + '00');

    const series = [
      { label: acumulado ? 'Este periodo' : 'Gastado', data: datos, borderColor: acento, backgroundColor: degradado ?? acento, fill: true, tension: 0.35,
        borderWidth: 2.5, pointRadius: datos.length > 40 ? 0 : 2.5, pointHoverRadius: 5, pointBackgroundColor: acento },
      ...(anterior ? [{ label: 'Periodo anterior', data: anterior, borderColor: texto, backgroundColor: 'transparent', fill: false, tension: 0.35,
        borderWidth: 1.5, borderDash: [5, 5], pointRadius: 0, pointHoverRadius: 3 }] : []),
    ];

    this.grafica?.destroy();
    this.grafica = new Chart(canvas, {
      type: 'line',
      data: { labels: etiquetas, datasets: series },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 10,
            titleFont: { family: fuente, weight: 600 },
            bodyFont: { family: fuente },
            callbacks: { label: (item) => ` ${item.dataset.label}: ${pesos(Number(item.raw))}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: texto, font: { family: fuente, size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 10 } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: linea },
            ticks: { color: texto, font: { family: fuente, size: 11 }, maxTicksLimit: 5, callback: (v) => this.pesosCorto(Number(v)) } },
        },
      },
    });
  }
}

function normal(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
