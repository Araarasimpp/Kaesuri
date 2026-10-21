import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError, numero } from '../../shared/formato';
import { diaColombiaDe, formatoFechaCO, formatoHoraCO, hoyColombiaISO } from '../../shared/fecha-colombia';
import { diaLargo, sumarDias } from '../../shared/rango/rango.component';

interface Operacion {
  creados: number;
  cancelados: number;
  alistados: number;
  despachados: number;
  entregados: number;
  por_estado: Partial<Record<'por_alistar' | 'alistado' | 'en_ruta', number>>;
  sin_rotulo: number;
  min_alistar: number | null;
  mas_antiguo: string | null;
  por_alistar: { nombre: string; color: string | null; talla: string | null; cantidad: number; pedidos: number }[];
  domiciliarios: { nombre: string; en_ruta: number; entregados: number }[];
  por_dia: { dia: string; creados: number; entregados: number }[];
}

/**
 * Tablero de alistamiento (copiado de Jasta): cómo van los pedidos hoy, qué hay que
 * sacar de bodega y dónde están los domiciliarios. Solo cantidades y tiempos, sin plata.
 */
@Component({
  selector: 'app-tablero',
  standalone: true,
  host: { class: 'jt' },
  imports: [RouterLink],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1100px; }
      .head .acciones { display: flex; gap: 8px; }
      a.kpi { color: inherit; text-decoration: none; }
      @media (hover: hover) { a.kpi:hover { background: var(--hover); } }
      .kpi .estado { align-self: flex-start; }
      .kpi.urgente .kpi-valor { color: var(--st-pendiente-text); }
      .chips-hoy { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
      .mini { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .mini span { font-size: 12px; color: var(--text-muted); }
      .mini strong { font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
      .mini small { font-size: 11.5px; color: var(--text-muted); }
      .cols { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; align-items: start; }
      .lado { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
      .cuenta { margin-left: 8px; font-family: var(--mono-font); font-size: 13px; font-weight: 500; color: var(--text-muted); }

      /* Lo que hay que sacar de bodega */
      .bodega { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .bodega li { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 0; border-bottom: var(--perfora); }
      .bodega li:last-child { border-bottom: 0; padding-bottom: 0; }
      .bodega li:first-child { padding-top: 0; }
      .und { height: 34px; display: grid; place-items: center; border-radius: var(--radius); background: var(--oro-wash); color: var(--oro-texto);
        font-family: var(--mono-font); font-size: 15px; font-weight: 700; }
      .bodega .nom { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 14px; font-weight: 550; }
      .bodega .nom span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bodega .nom small { font-size: 12px; font-weight: 600; color: var(--oro-texto); }
      .bodega .ped { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
      .al-dia { margin: 0; padding: 18px 0 4px; text-align: center; font-size: 14px; color: var(--text-soft); }
      .al-dia strong { display: block; margin-bottom: 4px; font-size: 15px; color: var(--text); }

      .mensajeros { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .mensajeros li { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
      .mensajeros .nom { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pill { padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .pill.ruta { background: color-mix(in srgb, var(--st-ruta) 14%, transparent); color: var(--st-ruta); }
      .pill.ok { background: var(--ok-wash); color: var(--efectivo-texto); }
      .suave { color: var(--text-muted); }

      /* Semana: pedidos que entraron (barra clara) y entregados (barra dorada) */
      .semana { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; align-items: end; height: 150px; }
      .dia { display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end; }
      .pares { flex: 1; width: 100%; display: flex; gap: 3px; align-items: flex-end; justify-content: center; }
      .palo { width: min(16px, 40%); border-radius: 3px 3px 0 0; background: var(--border-strong); min-height: 2px; transition: height 300ms var(--ease); }
      .palo.ent { background: var(--oro); }
      .dia .etq { font-size: 11px; color: var(--text-muted); text-transform: capitalize; }
      .dia.hoy .etq { color: var(--text); font-weight: 650; }
      .dia .n { font-size: 11px; font-family: var(--mono-font); color: var(--text-soft); }
      .leyenda { display: flex; gap: 14px; margin-top: 12px; font-size: 12px; color: var(--text-muted); }
      .leyenda i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; background: var(--border-strong); }
      .leyenda i.ent { background: var(--oro); }

      @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } .chips-hoy { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (max-width: 640px) {
        .head .acciones { width: 100%; }
        .head .acciones .b { flex: 1; justify-content: center; }
        .chips-hoy { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .chips-hoy > :last-child { grid-column: 1 / -1; }
        .mini strong { font-size: 18px; }
      }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ hoyLargo }}</p><h1>Tablero</h1></div>
        <div class="acciones">
          <a class="b b-pri" [routerLink]="rutaPedidos">Alistar pedidos</a>
        </div>
      </div>

      <!-- Lo que falta mover ahora -->
      <div class="kpis" role="list" [attr.aria-busy]="cargando()">
        <a class="kpi kpi-principal" [class.urgente]="(o()?.por_estado?.por_alistar ?? 0) > 0" role="listitem" [routerLink]="rutaPedidos">
          <span class="kpi-label">Por alistar</span>
          <span class="kpi-valor num">{{ cargando() ? '…' : numero(o()?.por_estado?.por_alistar ?? 0) }}</span>
          <span class="kpi-nota">{{ o()?.mas_antiguo ? 'El más antiguo entró ' + cuando(o()!.mas_antiguo!) : 'Nada pendiente' }}</span>
        </a>
        <a class="kpi" role="listitem" [routerLink]="rutaPedidos">
          <span class="kpi-label">Alistados sin despachar</span>
          <span class="kpi-valor num">{{ numero(o()?.por_estado?.alistado ?? 0) }}</span>
          <span class="kpi-nota">Esperan domiciliario</span>
        </a>
        <a class="kpi" role="listitem" [routerLink]="rutaPedidos">
          <span class="kpi-label">En ruta</span>
          <span class="kpi-valor num">{{ numero(o()?.por_estado?.en_ruta ?? 0) }}</span>
          <span class="kpi-nota">{{ o()?.domiciliarios?.length ? enRutaMensajeros() : 'Ningún domiciliario en la calle' }}</span>
        </a>
        <div class="kpi" role="listitem">
          <span class="kpi-label">Entregados hoy</span>
          <span class="kpi-valor num">{{ numero(o()?.entregados ?? 0) }}</span>
          <span class="kpi-nota">A domicilio</span>
        </div>
      </div>

      <!-- Hoy, en números -->
      <div class="chips-hoy">
        <div class="mini"><span>Entraron hoy</span><strong>{{ numero(o()?.creados ?? 0) }}</strong><small>{{ o()?.cancelados ? numero(o()!.cancelados) + (o()!.cancelados === 1 ? ' cancelado' : ' cancelados') : 'pedidos' }}</small></div>
        <div class="mini"><span>Alistados hoy</span><strong>{{ numero(o()?.alistados ?? 0) }}</strong><small>pedidos</small></div>
        <div class="mini"><span>Despachados hoy</span><strong>{{ numero(o()?.despachados ?? 0) }}</strong><small>a domiciliarios</small></div>
        <div class="mini"><span>Tiempo para alistar</span><strong>{{ tiempo(o()?.min_alistar ?? null) }}</strong><small>de entrada a alistado</small></div>
        <a class="mini" style="color: inherit; text-decoration: none" [routerLink]="rutaPedidos">
          <span>Sin rótulo</span><strong>{{ numero(o()?.sin_rotulo ?? 0) }}</strong><small>por imprimir</small></a>
      </div>

      <div class="cols">
        <section class="panel" aria-labelledby="t-bodega">
          <div class="panel-head">
            <div>
              <h2 id="t-bodega">Para alistar ahora<span class="cuenta">{{ unidades() }} und</span></h2>
              <p class="panel-sub">Lo que hay que sacar de bodega para los pedidos por alistar</p>
            </div>
          </div>
          @if (o()?.por_alistar?.length) {
            <ul class="bodega">
              @for (p of o()!.por_alistar; track $index) {
                <li>
                  <span class="und">{{ p.cantidad }}</span>
                  <span class="nom"><span>{{ p.nombre }}</span>@if (variante(p); as v) { <small>{{ v }}</small> }</span>
                  <span class="ped">{{ p.pedidos === 1 ? '1 pedido' : p.pedidos + ' pedidos' }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="al-dia"><strong>{{ cargando() ? 'Cargando…' : 'Todo alistado' }}</strong>
              @if (!cargando()) { No hay pedidos esperando alistamiento. }</p>
          }
        </section>

        <div class="lado">
          <section class="panel">
            <div class="panel-head"><div><h2>Domiciliarios</h2><p class="panel-sub">En la calle y entregas de hoy</p></div></div>
            <ul class="mensajeros">
              @for (m of o()?.domiciliarios ?? []; track m.nombre) {
                <li><span class="nom">{{ m.nombre }}</span>
                  @if (m.en_ruta) { <span class="pill ruta">{{ m.en_ruta }} en ruta</span> }
                  @if (m.entregados) { <span class="pill ok">{{ m.entregados }} entregados</span> }
                </li>
              } @empty {
                <li class="suave">{{ cargando() ? 'Cargando…' : 'Ningún domiciliario tiene pedidos hoy.' }}</li>
              }
            </ul>
          </section>

          <section class="panel">
            <div class="panel-head"><div><h2>Últimos 7 días</h2><p class="panel-sub">Pedidos que entraron y que se entregaron</p></div></div>
            <div class="semana" role="img" [attr.aria-label]="resumenSemana()">
              @for (d of o()?.por_dia ?? []; track d.dia) {
                <div class="dia" [class.hoy]="d.dia === hoy">
                  <span class="n">{{ d.creados }}</span>
                  <div class="pares">
                    <span class="palo" [style.height.%]="(d.creados / maxDia()) * 100" [title]="d.creados + ' entraron'"></span>
                    <span class="palo ent" [style.height.%]="(d.entregados / maxDia()) * 100" [title]="d.entregados + ' entregados'"></span>
                  </div>
                  <span class="etq">{{ d.dia === hoy ? 'Hoy' : diaCorto(d.dia) }}</span>
                </div>
              }
            </div>
            <div class="leyenda"><span><i></i>Entraron</span><span><i class="ent"></i>Entregados</span></div>
          </section>
        </div>
      </div>
    </div>
  `,
})
export class TableroPage implements OnInit, OnDestroy {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  /** Pedidos del área donde está (admin o despachador) */
  readonly rutaPedidos = '/' + inject(Router).url.split('/')[1] + '/pedidos';

  readonly hoy = hoyColombiaISO();
  readonly hoyLargo = diaLargo(this.hoy);

  o = signal<Operacion | null>(null);
  cargando = signal(true);

  unidades = computed(() => (this.o()?.por_alistar ?? []).reduce((s, p) => s + p.cantidad, 0));
  maxDia = computed(() => Math.max(1, ...(this.o()?.por_dia ?? []).flatMap((d) => [d.creados, d.entregados])));
  enRutaMensajeros = computed(() => {
    const n = (this.o()?.domiciliarios ?? []).filter((m) => m.en_ruta).length;
    return n === 1 ? '1 domiciliario en la calle' : `${n} domiciliarios en la calle`;
  });
  resumenSemana = computed(() =>
    (this.o()?.por_dia ?? []).map((d) => `${this.diaCorto(d.dia)}: ${d.creados} entraron, ${d.entregados} entregados`).join('; ')
  );

  numero = numero;

  private canal: RealtimeChannel | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    void this.cargar();
    // Los pedidos que cambian (de otros usuarios) actualizan el tablero, en una sola recarga
    this.canal = this.sb.client
      .channel('tablero-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.cargar(), 800);
      })
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.canal) void this.sb.client.removeChannel(this.canal);
    clearTimeout(this.timer);
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('resumen_operacion', { p_dia: hoyColombiaISO() });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.o.set(data as Operacion);
  }

  variante(p: { color: string | null; talla: string | null }): string {
    return [p.color, p.talla ? 'Talla ' + p.talla : null].filter(Boolean).join(' · ');
  }

  tiempo(min: number | null): string {
    if (min === null || min === undefined) return '—';
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  diaCorto(iso: string): string {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('es-CO', { timeZone: 'UTC', weekday: 'short' }).replace('.', '');
  }

  /** "hoy a las 8:32 a. m.", "ayer a las …" o "el 12 oct" */
  cuando(iso: string): string {
    const dia = diaColombiaDe(iso);
    if (dia === this.hoy) return `hoy a las ${formatoHoraCO(iso)}`;
    if (dia === sumarDias(this.hoy, -1)) return `ayer a las ${formatoHoraCO(iso)}`;
    return 'el ' + formatoFechaCO(iso, { day: 'numeric', month: 'short' });
  }
}
