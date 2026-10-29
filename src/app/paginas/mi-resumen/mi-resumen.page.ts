import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError, numero, pesos } from '../../shared/formato';
import { formatoFechaCO, hoyColombiaISO } from '../../shared/fecha-colombia';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

interface Resumen {
  nombre: string; ganado: number; entregas: number; dias_trabajados: number;
  anterior: { ganado: number; entregas: number };
  cancelados_en_ruta: number; novedades: number;
  por_dia: { dia: string; entregas: number; ganado: number }[];
  por_hora: { hora: number; entregas: number }[];
  barrios: { barrio: string; entregas: number; ganado: number }[];
  barrios_distintos: number;
  calificacion: { promedio: number | null; cantidad: number };
  comentarios: { estrellas: number; comentario: string; fecha: string }[];
  por_cuadrar: { pedidos: number; efectivo: number; domicilios: number };
}
type Periodo = 'hoy' | 'semana' | 'mes' | 'pasado';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Rango de fechas (Colombia) de cada periodo */
function rango(p: Periodo): { desde: string; hasta: string } {
  const hoy = hoyColombiaISO();
  const d = new Date(hoy + 'T12:00:00Z');
  if (p === 'hoy') return { desde: hoy, hasta: hoy };
  if (p === 'semana') {
    const lunes = new Date(d);
    lunes.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return { desde: iso(lunes), hasta: hoy };
  }
  if (p === 'mes') return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
  const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 12));
  const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 12));
  return { desde: iso(ini), hasta: iso(fin) };
}

/**
 * Panel del domiciliario (como en Jasta): cuánto ganó en domicilios, sus entregas por día,
 * los barrios a los que más va, su hora pico, efectividad, calificaciones y lo que tiene
 * por cuadrar. El admin puede elegir cualquier domiciliario.
 */
@Component({
  selector: 'app-mi-resumen',
  standalone: true,
  host: { class: 'jt' },
  imports: [SkeletonComponent, FormsModule, RouterLink],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 900px; }
      .controles { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chips button { height: 36px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft);
        font: inherit; font-size: 14px; cursor: pointer; }
      .chips button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .controles select { width: auto; margin-left: auto; }
      .heroe { padding: 22px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); }
      .heroe .etq { font-size: 13px; font-weight: 600; color: var(--text-muted); }
      .heroe .monto { margin-top: 4px; font-family: var(--mono-font); font-size: 44px; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }
      .delta { display: inline-block; margin-top: 8px; padding: 2px 9px; border-radius: 999px; font-size: 13px; font-weight: 650; }
      .delta.sube { background: var(--ok-wash); color: var(--efectivo-texto); }
      .delta.baja { background: var(--danger-wash); color: var(--danger); }
      .delta.igual { background: var(--surface-2); color: var(--text-soft); }
      .heroe .det { margin: 12px 0 0; font-size: 14px; color: var(--text-soft); line-height: 1.5; }
      .nw { white-space: nowrap; }
      .cuadrar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 16px; border-radius: var(--radius-lg);
        background: var(--oro-wash); color: var(--oro-texto); font-size: 14px; }
      .cuadrar a { font-weight: 700; color: inherit; }
      .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
      h3 { margin: 0 0 12px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
      .barras { position: relative; display: flex; align-items: flex-end; gap: 3px; height: 150px; padding-top: 44px; box-sizing: border-box; border-bottom: 1px solid var(--border); }
      .col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
      .col i { display: block; width: 100%; min-height: 2px; border-radius: 4px 4px 0 0; background: var(--accent); opacity: .85; }
      .col:hover i { opacity: 1; }
      .col.cero i { background: var(--border-strong); }
      .ejes { display: flex; justify-content: space-between; margin-top: 4px; font-size: 11px; color: var(--text-muted); }
      .tip { position: absolute; top: 0; transform: translateX(-50%); padding: 6px 9px; border-radius: 8px; background: var(--text); color: var(--bg); font-size: 12px;
        line-height: 1.35; white-space: nowrap; pointer-events: none; z-index: 2; }
      .zonas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .zona { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; font-size: 14px; }
      .zona .riel { grid-column: 1 / -1; height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
      .zona .riel i { display: block; height: 100%; border-radius: 0 4px 4px 0; background: var(--accent); }
      .zona b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      .zona small { color: var(--text-muted); white-space: nowrap; }
      .datos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .dato { padding: 12px; border-radius: var(--radius); background: var(--surface-2); }
      .dato strong { display: block; font-family: var(--mono-font); font-size: 24px; }
      .dato span { font-size: 12.5px; color: var(--text-muted); }
      .estrella { color: var(--oro); }
      .coment { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
      .vacio-txt { margin: 0; padding: 20px 0; text-align: center; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ etiqueta() }}</p><h1>{{ esAdmin() && r()?.nombre ? r()!.nombre : 'Mi resumen' }}</h1></div>
      </div>
      <div class="controles">
        <div class="chips" role="group" aria-label="Periodo">
          @for (p of periodos; track p.id) { <button [class.on]="periodo() === p.id" (click)="elegir(p.id)">{{ p.label }}</button> }
        </div>
        @if (esAdmin()) {
          <select [ngModel]="mensajero()" (ngModelChange)="mensajero.set($event); cargar()" aria-label="Domiciliario">
            @for (m of mensajeros(); track m.id) { <option [value]="m.id">{{ m.nombre }}</option> }
          </select>
        }
      </div>

      @if (r(); as d) {
        <section class="heroe">
          <div class="etq">Ganaste en domicilios</div>
          <div class="monto">{{ pesos(d.ganado) }}</div>
          @if (delta(); as x) { <span class="delta" [class]="'delta ' + x.clase">{{ x.texto }}</span> }
          <p class="det">{{ numero(d.entregas) }} {{ d.entregas === 1 ? 'entrega' : 'entregas' }}
            @if (d.dias_trabajados > 1) { en {{ d.dias_trabajados }} días · <span class="nw">{{ pesos(d.ganado / d.dias_trabajados) }} por día</span> }
            @if (d.entregas) { · <span class="nw">{{ pesos(d.ganado / d.entregas) }} por entrega</span> }</p>
        </section>

        @if (d.por_cuadrar.pedidos) {
          <div class="cuadrar" role="status">
            <span>Tienes <b>{{ pesos(d.por_cuadrar.efectivo) }}</b> en efectivo de {{ d.por_cuadrar.pedidos }} {{ d.por_cuadrar.pedidos === 1 ? 'pedido' : 'pedidos' }} por cuadrar.</span>
            <a [routerLink]="rutaCuadres">Ir a Cuadres →</a>
          </div>
        }

        @if (!d.entregas) {
          <p class="vacio-txt">{{ periodo() === 'hoy' ? 'Todavía no has entregado pedidos hoy.' : 'No hay entregas en este periodo.' }}</p>
        } @else {
          @if (d.por_dia.length > 1) {
            <section class="panel">
              <h3>Ganancias por día</h3>
              <div class="barras" (mouseleave)="sobre.set(null)">
                @for (x of d.por_dia; track x.dia; let i = $index) {
                  <div class="col" [class.cero]="!x.ganado" (mouseenter)="sobre.set(i)" [attr.aria-label]="fecha(x.dia) + ': ' + pesos(x.ganado)">
                    <i [style.height.%]="(x.ganado / maxDia()) * 100"></i>
                  </div>
                }
                @if (sobre() !== null) {
                  <div class="tip" [style.left.%]="((sobre()! + 0.5) / d.por_dia.length) * 100">
                    <b>{{ fecha(d.por_dia[sobre()!].dia) }}</b><br />{{ pesos(d.por_dia[sobre()!].ganado) }} · {{ d.por_dia[sobre()!].entregas }} entregas
                  </div>
                }
              </div>
              <div class="ejes"><span>{{ fecha(d.por_dia[0].dia) }}</span><span>{{ fecha(d.por_dia[d.por_dia.length - 1].dia) }}</span></div>
            </section>
          }

          <div class="grid2">
            <section class="panel">
              <h3>Zonas a las que más vas</h3>
              <ul class="zonas">
                @for (z of d.barrios; track z.barrio) {
                  <li class="zona"><b>{{ z.barrio }}</b><small>{{ z.entregas }} {{ z.entregas === 1 ? 'entrega' : 'entregas' }} · {{ pesos(z.ganado) }}</small>
                    <span class="riel"><i [style.width.%]="(z.entregas / d.barrios[0].entregas) * 100"></i></span></li>
                }
              </ul>
              <p class="ayuda" style="margin: 12px 0 0">Fuiste a {{ numero(d.barrios_distintos) }} barrios distintos.</p>
            </section>

            <section class="panel">
              <h3>Cómo te fue</h3>
              <div class="datos">
                <div class="dato"><strong>{{ efectividad() }}</strong><span>entregados a la primera</span></div>
                <div class="dato"><strong>{{ horaPico() }}</strong><span>tu hora con más entregas</span></div>
                <div class="dato"><strong>{{ d.novedades }}</strong><span>{{ d.novedades === 1 ? 'novedad' : 'novedades' }} reportadas</span></div>
                <div class="dato"><strong>{{ d.cancelados_en_ruta }}</strong><span>cancelados en ruta</span></div>
              </div>
              <h3 style="margin-top: 16px">Calificación de los clientes</h3>
              @if (d.calificacion.cantidad) {
                <div><span class="estrella">★</span> <b style="font-size: 20px">{{ d.calificacion.promedio }}</b> de 5 · {{ d.calificacion.cantidad }}
                  {{ d.calificacion.cantidad === 1 ? 'calificación' : 'calificaciones' }}</div>
                @if (d.comentarios.length) {
                  <ul class="coment">
                    @for (k of d.comentarios; track k.fecha) { <li><span class="estrella">{{ '★'.repeat(k.estrellas) }}</span> "{{ k.comentario }}"</li> }
                  </ul>
                }
              } @else {
                <p class="ayuda" style="margin: 0">Aún no hay calificaciones en este periodo. Los clientes califican desde su enlace de seguimiento.</p>
              }
            </section>
          </div>
        }
      } @else {
        <app-skeleton variante="stats" [cantidad]="3"></app-skeleton>
      }
    </div>
  `,
})
export class MiResumenPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  periodos: { id: Periodo; label: string }[] = [
    { id: 'hoy', label: 'Hoy' }, { id: 'semana', label: 'Esta semana' }, { id: 'mes', label: 'Este mes' }, { id: 'pasado', label: 'Mes pasado' },
  ];
  periodo = signal<Periodo>('mes');
  r = signal<Resumen | null>(null);
  sobre = signal<number | null>(null);
  mensajero = signal<string | null>(null);
  mensajeros = signal<{ id: string; nombre: string }[]>([]);
  etiqueta = signal('');
  /** El admin (que no reparte) elige a qué domiciliario ver; desde el área de domiciliario se ve lo propio */
  esAdmin = signal(false);
  readonly rutaCuadres = '/' + (inject(Router).url.split('/')[1] || 'domiciliario') + '/cuadres';
  pesos = pesos;
  numero = numero;

  maxDia = computed(() => Math.max(1, ...(this.r()?.por_dia ?? []).map((x) => x.ganado)));

  delta = computed(() => {
    const d = this.r();
    if (!d || this.periodo() === 'hoy' || !d.anterior.ganado) return null;
    const pct = Math.round(((d.ganado - d.anterior.ganado) / d.anterior.ganado) * 100);
    const base = this.periodo() === 'semana' ? 'la semana anterior' : this.periodo() === 'mes' ? 'los mismos días antes' : 'el mes anterior';
    if (pct === 0) return { clase: 'igual', texto: `Igual que ${base}` };
    return { clase: pct > 0 ? 'sube' : 'baja', texto: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% frente a ${base}` };
  });

  efectividad = computed(() => {
    const d = this.r();
    if (!d) return '—';
    const intentos = d.entregas + d.cancelados_en_ruta;
    return intentos ? Math.round((d.entregas / intentos) * 100) + '%' : '—';
  });

  horaPico = computed(() => {
    const h = [...(this.r()?.por_hora ?? [])].sort((a, b) => b.entregas - a.entregas)[0];
    if (!h) return '—';
    const hr = h.hora % 12 || 12;
    return `${hr} ${h.hora < 12 ? 'a. m.' : 'p. m.'}`;
  });

  async ngOnInit(): Promise<void> {
    const perfil = await this.sb.getCurrentProfile();
    this.esAdmin.set(!!perfil && rolesDe(perfil).includes('admin') && this.rutaCuadres.startsWith('/admin'));
    if (this.esAdmin()) {
      const { data } = await this.sb.client.from('profiles').select('id, nombre, roles, activo').order('nombre');
      const lista = ((data ?? []) as { id: string; nombre: string; roles: string[]; activo: boolean | null }[])
        .filter((u) => u.activo !== false && u.roles?.includes('domiciliario'));
      this.mensajeros.set(lista);
      this.mensajero.set(lista[0]?.id ?? null);
    }
    void this.cargar();
  }

  elegir(p: Periodo): void {
    this.periodo.set(p);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const { desde, hasta } = rango(this.periodo());
    this.etiqueta.set(desde === hasta ? this.fecha(desde) : `${this.fecha(desde)} – ${this.fecha(hasta)}`);
    const { data, error } = await this.sb.client.rpc('resumen_domiciliario', { p_desde: desde, p_hasta: hasta, p_domiciliario: this.esAdmin() ? this.mensajero() : null });
    if (error) return this.toast.error(mensajeError(error));
    this.r.set(data as Resumen);
  }

  fecha(d: string): string {
    return formatoFechaCO(d + 'T12:00:00-05:00', { weekday: 'short', day: 'numeric', month: 'short' });
  }
}
