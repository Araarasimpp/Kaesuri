import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { flagOutline, trophyOutline } from 'ionicons/icons';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { mensajeError, pesos } from '../../shared/formato';
import { hoyColombiaISO } from '../../shared/fecha-colombia';

type Tipo = 'vendedora' | 'mensajero';
type Periodo = 'hoy' | 'semana' | 'mes';

interface Fila {
  usuario_id: string; nombre: string; avatar_url: string | null; tipo: Tipo;
  cantidad: number; ventas: number | null; meta: number | null; puesto: number; avance: number | null;
}

/** Primer y último día del mes (YYYY-MM); el mes en curso llega hasta hoy */
function rangoMes(mes: string): { desde: string; hasta: string } {
  const hoy = hoyColombiaISO();
  if (hoy.startsWith(mes)) return { desde: mes + '-01', hasta: hoy };
  const [a, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { desde: mes + '-01', hasta: fin };
}

/** Hoy, esta semana (desde el lunes) o el mes elegido */
function rango(p: Periodo, mes: string): { desde: string; hasta: string } {
  const hoy = hoyColombiaISO();
  if (p === 'hoy') return { desde: hoy, hasta: hoy };
  if (p === 'semana') {
    const d = new Date(hoy + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return { desde: d.toISOString().slice(0, 10), hasta: hoy };
  }
  return rangoMes(mes);
}

/** Los últimos 24 meses, del más reciente al más antiguo */
function ultimosMeses(): { id: string; label: string }[] {
  const hoy = hoyColombiaISO();
  let a = Number(hoy.slice(0, 4));
  let m = Number(hoy.slice(5, 7));
  const out: { id: string; label: string }[] = [];
  for (let i = 0; i < 24; i++) {
    const id = `${a}-${String(m).padStart(2, '0')}`;
    const label = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    out.push({ id, label: label.charAt(0).toUpperCase() + label.slice(1) });
    if (--m === 0) [a, m] = [a - 1, 12];
  }
  return out;
}

/**
 * Ranking (copiado de Jasta): podio con medallas (2.º, 1.º, 3.º), la lista
 * completa con tu puesto resaltado y el avance hacia la meta de la semana o del mes.
 * Vendedores por cantidad de ventas entregadas; domiciliarios por entregas.
 */
@Component({
  selector: 'app-ranking',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon, AvatarComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 760px; }
      .head h1 { display: flex; align-items: center; gap: 8px; }
      .head h1 ion-icon { color: var(--oro); }
      .controles { justify-content: space-between; align-items: center; }
      .mes { width: auto; min-width: 180px; height: 34px; }
      .nota { margin: -8px 0 0; font-size: 14px; color: var(--text-soft); }
      .nota strong { color: var(--accent); }

      /* ---------- Podio ---------- */
      .podio { display: grid; grid-template-columns: repeat(3, 1fr); align-items: end; gap: 10px; padding: 8px 4px 0; }
      .escalon { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; text-align: center;
        animation: subir 520ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      .escalon[data-puesto='1'] { animation-delay: 160ms; }
      .escalon[data-puesto='2'] { animation-delay: 60ms; }
      .escalon[data-puesto='3'] { animation-delay: 260ms; }
      @keyframes subir { from { opacity: 0; transform: translateY(24px) scale(0.92); } }
      @media (prefers-reduced-motion: reduce) { .escalon { animation: none; } }
      .medalla { font-size: 30px; line-height: 1; }
      .escalon[data-puesto='1'] .medalla { font-size: 40px; }
      .podio-nombre { max-width: 100%; font-size: 14px; font-weight: 600; line-height: 1.25; overflow: hidden; text-overflow: ellipsis;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .podio-nombre span { color: var(--accent); }
      .podio-valor { font-size: 15px; font-weight: 700; color: var(--accent); }
      .podio-pesos { font-size: 12px; color: var(--text-muted); margin-top: -4px; }
      .bloque { width: 100%; margin-top: 4px; border-radius: 12px 12px 4px 4px; display: grid; place-items: start center; padding-top: 8px;
        font-family: var(--mono-font); font-size: 22px; font-weight: 800; color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.18); }
      .escalon[data-puesto='1'] .bloque { height: 110px; background: linear-gradient(180deg, #e3c45c, #c9a227); }
      .escalon[data-puesto='2'] .bloque { height: 80px; background: linear-gradient(180deg, #cfd5de, #9aa3b2); }
      .escalon[data-puesto='3'] .bloque { height: 60px; background: linear-gradient(180deg, #e2a46d, #b8733a); }
      .escalon.yo .podio-nombre { color: var(--accent); }

      /* ---------- Lista ---------- */
      .lista { margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; }
      .fila { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; }
      .fila + .fila { border-top: 1px solid var(--border); }
      .fila.yo { background: var(--accent-wash); }
      .puesto { width: 28px; flex-shrink: 0; padding-top: 8px; text-align: center; font-size: 15px; font-weight: 700; color: var(--text-soft); }
      .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .linea { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .linea strong { font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tu { margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 700; vertical-align: 2px; }
      .valor { flex-shrink: 0; font-size: 15px; font-weight: 700; }
      .sub { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--text-soft); }
      .progreso { height: 8px; border-radius: 4px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border-soft); overflow: hidden; }
      .progreso span { display: block; height: 100%; border-radius: 4px; background: var(--accent); transition: width 600ms cubic-bezier(0.2, 0, 0, 1); }
      .progreso span.lograda { background: var(--efectivo); }
      .meta-btn { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; margin: -6px 0; padding: 8px 0; border: none; background: none;
        color: var(--accent); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
      .meta-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
      .meta-form label { width: 100%; font-size: 12.5px; color: var(--text-soft); }
      .meta-form input { height: 38px; width: 150px; }
      .meta-form .b { height: 38px; }
      .pie { margin: 0; font-size: 13px; color: var(--text-soft); }
      .link { padding: 0; border: none; background: none; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; }

      @media (max-width: 640px) {
        .controles .segmented { flex: 1; }
        .controles .segmented:first-child { flex-basis: 100%; }
        .controles .segmented button { flex: 1; }
        .mes { width: 100%; }
      }
    `,
  ],
  template: `
    <div class="page">
      <header class="head">
        <div>
          <p class="fecha">{{ subtitulo() }}</p>
          <h1><ion-icon name="trophy-outline" aria-hidden="true"></ion-icon> Ranking</h1>
        </div>
      </header>

      <div class="controles">
        <div class="segmented" role="group" aria-label="Quiénes">
          <button [class.on]="tipo() === 'vendedora'" [attr.aria-pressed]="tipo() === 'vendedora'" (click)="cambiarTipo('vendedora')">Vendedores</button>
          <button [class.on]="tipo() === 'mensajero'" [attr.aria-pressed]="tipo() === 'mensajero'" (click)="cambiarTipo('mensajero')">Domiciliarios</button>
        </div>
        <div class="segmented" role="group" aria-label="Periodo">
          <button [class.on]="periodo() === 'hoy'" [attr.aria-pressed]="periodo() === 'hoy'" (click)="cambiarPeriodo('hoy')">Hoy</button>
          <button [class.on]="periodo() === 'semana'" [attr.aria-pressed]="periodo() === 'semana'" (click)="cambiarPeriodo('semana')">Semana</button>
          <button [class.on]="periodo() === 'mes' && esMesActual()" [attr.aria-pressed]="periodo() === 'mes' && esMesActual()" (click)="cambiarPeriodo('mes')">Mes</button>
        </div>
        <select class="inp mes" [ngModel]="periodo() === 'mes' ? mes() : ''" (ngModelChange)="elegirMes($event)" aria-label="Elegir mes">
          @if (periodo() !== 'mes') { <option value="" disabled>Otro mes…</option> }
          @for (m of meses; track m.id) { <option [ngValue]="m.id">{{ m.label }}</option> }
        </select>
      </div>

      <p class="nota">
        {{ tipo() === 'vendedora' ? 'Quién hizo más ventas (pedidos entregados).' : 'Quién hizo más entregas a domicilio.' }}
        @if (miPuesto(); as p) { Vas <strong>#{{ p }}</strong> de {{ lista().length }}. }
      </p>

      @if (!cargando() || datos().length) {
        @if (podio().length) {
          <section class="podio" aria-label="Podio">
            @for (p of podioVisual(); track p.f.usuario_id) {
              <div class="escalon" [attr.data-puesto]="p.puesto" [class.yo]="esYo(p.f)">
                <span class="medalla" aria-hidden="true">{{ medallas[p.puesto - 1] }}</span>
                <app-avatar [nombre]="p.f.nombre" [foto]="p.f.avatar_url" [tam]="p.puesto === 1 ? 64 : 52"></app-avatar>
                <strong class="podio-nombre">{{ p.f.nombre }}@if (esYo(p.f)) {<span> (tú)</span>}</strong>
                <span class="podio-valor num">{{ valor(p.f) }}</span>
                @if (detalle(p.f); as d) { <span class="podio-pesos num">{{ d }}</span> }
                <div class="bloque"><span>{{ p.puesto }}</span></div>
              </div>
            }
          </section>
        } @else {
          <div class="vacio">
            <p class="vacio-titulo">Todavía no hay {{ tipo() === 'vendedora' ? 'ventas entregadas' : 'entregas' }} {{ cuando() }}</p>
            <p>El primero en {{ tipo() === 'vendedora' ? 'vender' : 'entregar' }} se lleva el oro 🥇</p>
          </div>
        }

        @if (lista().length) {
          <ol class="lista">
            @for (f of lista(); track f.usuario_id; let i = $index) {
              <li class="fila" [class.yo]="esYo(f)">
                <span class="puesto num">{{ i < podio().length ? medallas[i] : i + 1 }}</span>
                <app-avatar [nombre]="f.nombre" [foto]="f.avatar_url" [tam]="36"></app-avatar>
                <div class="info">
                  <div class="linea">
                    <strong>{{ f.nombre }}@if (esYo(f)) {<span class="tu">tú</span>}</strong>
                    <span class="valor num">{{ valor(f) }}</span>
                  </div>
                  @if (detalle(f) || avance(f) !== null) {
                    <div class="sub">
                      <span class="num">{{ detalle(f) }}</span>
                      @if (avance(f) !== null) { <span class="num">{{ textoMeta(f) }} · {{ avance(f) }}%</span> }
                    </div>
                  }
                  @if (avance(f) !== null) {
                    <div class="progreso" [attr.aria-label]="'Avance de la meta: ' + avance(f) + '%'">
                      <span [style.width.%]="avance(f)" [class.lograda]="avance(f) === 100"></span>
                    </div>
                  }

                  @if (esAdmin() && conMeta()) {
                    @if (editandoId() !== f.usuario_id) {
                      <button type="button" class="meta-btn" (click)="editarMeta(f)">
                        <ion-icon name="flag-outline" aria-hidden="true"></ion-icon>{{ (f.meta ? 'Cambiar meta ' : 'Poner meta ') + nombreMeta() }}
                      </button>
                    } @else {
                      <form class="meta-form" (ngSubmit)="guardarMeta(f)">
                        <label [attr.for]="'meta-' + f.usuario_id">{{ (f.tipo === 'vendedora' ? 'Meta de ventas ' : 'Meta de entregas ') + nombreMeta() + ' (cantidad)' }}</label>
                        <input class="inp num" [id]="'meta-' + f.usuario_id" name="meta" type="text" inputmode="numeric" [(ngModel)]="metaTexto"
                          [placeholder]="periodo() === 'semana' ? (f.tipo === 'vendedora' ? '10' : '30') : (f.tipo === 'vendedora' ? '40' : '120')" />
                        <button type="submit" class="b b-pri" [disabled]="guardandoMeta()">{{ guardandoMeta() ? 'Guardando…' : 'Guardar' }}</button>
                        <button type="button" class="b" (click)="editandoId.set(null)">Cancelar</button>
                      </form>
                    }
                  }
                </div>
              </li>
            }
          </ol>
          @if (!conMeta()) {
            <p class="pie">Hay metas semanales y del mes: cámbiate a <button type="button" class="link" (click)="cambiarPeriodo('semana')">Semana</button>
              o <button type="button" class="link" (click)="cambiarPeriodo('mes')">Mes</button> para ver el avance.</p>
          }
        }
      } @else {
        <p class="vacio">Cargando ranking…</p>
      }
    </div>
  `,
})
export class RankingPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  readonly medallas = ['🥇', '🥈', '🥉'];
  meses = ultimosMeses();
  tipo = signal<Tipo>('vendedora');
  periodo = signal<Periodo>('mes');
  mes = signal(this.meses[0].id);
  datos = signal<Fila[]>([]);
  cargando = signal(true);
  editandoId = signal<string | null>(null);
  guardandoMeta = signal(false);
  metaTexto = '';

  esMesActual = computed(() => this.mes() === this.meses[0].id);
  /** Las metas aplican a esta semana (de lunes a hoy) y al mes en curso */
  conMeta = computed(() => this.periodo() === 'semana' || (this.periodo() === 'mes' && this.esMesActual()));
  nombreMeta = computed(() => (this.periodo() === 'semana' ? 'de la semana' : 'del mes'));
  yo = signal<string | null>(null);
  esAdmin = signal(false);
  subtitulo = computed(() => {
    const p = this.periodo();
    if (p === 'hoy') return 'Hoy';
    if (p === 'semana') return 'Esta semana';
    return this.esMesActual() ? 'Este mes' : this.meses.find((m) => m.id === this.mes())?.label ?? '';
  });
  cuando = computed(() => {
    const p = this.periodo();
    if (p === 'hoy') return 'hoy';
    if (p === 'semana') return 'esta semana';
    return this.esMesActual() ? 'este mes' : 'en ' + (this.meses.find((m) => m.id === this.mes())?.label.toLowerCase() ?? 'ese mes');
  });

  /** Del tipo elegido, en el orden del puesto que calcula la base */
  lista = computed(() => {
    const todos = this.datos().filter((f) => f.tipo === this.tipo()).sort((a, b) => a.puesto - b.puesto);
    // En meses pasados (o hoy/semana) solo los que tuvieron algo; en el mes en curso todos, para ver la meta
    return this.conMeta() ? todos : todos.filter((f) => f.cantidad > 0);
  });
  podio = computed(() => this.lista().slice(0, 3).filter((f) => f.cantidad > 0));
  /** Orden visual del podio: 2.º, 1.º, 3.º */
  podioVisual = computed(() => {
    const p = this.podio().map((f, i) => ({ f, puesto: i + 1 }));
    return [p[1], p[0], p[2]].filter(Boolean);
  });
  miPuesto = computed(() => {
    const i = this.lista().findIndex((f) => f.usuario_id === this.yo());
    return i >= 0 ? i + 1 : null;
  });

  constructor() {
    addIcons({ flagOutline, trophyOutline });
  }

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((p) => {
      if (!p) return;
      const roles = rolesDe(p);
      this.yo.set(p.id);
      this.esAdmin.set(roles.includes('admin'));
      // El domiciliario (que no vende) abre en el ranking de domiciliarios
      if (roles.includes('domiciliario') && !roles.some((r) => r === 'admin' || r === 'vendedor')) this.tipo.set('mensajero');
    });
    void this.cargar();
  }

  cambiarTipo(t: Tipo): void {
    this.tipo.set(t);
    this.editandoId.set(null);
  }

  cambiarPeriodo(p: Periodo): void {
    this.periodo.set(p);
    if (p === 'mes') this.mes.set(this.meses[0].id);
    this.editandoId.set(null);
    void this.cargar();
  }

  elegirMes(m: string): void {
    if (!m) return;
    this.mes.set(m);
    this.periodo.set('mes');
    this.editandoId.set(null);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const r = rango(this.periodo(), this.mes());
    const { data, error } = await this.sb.client.rpc('ranking', { p_desde: r.desde, p_hasta: r.hasta, p_periodo: this.periodo() });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.datos.set(((data ?? []) as Fila[]).map((f) => ({ ...f, cantidad: Number(f.cantidad) || 0, ventas: f.ventas == null ? null : Number(f.ventas) })));
  }

  esYo(f: Fila): boolean {
    return f.usuario_id === this.yo();
  }

  valor(f: Fila): string {
    if (f.tipo === 'mensajero') return `${f.cantidad} ${f.cantidad === 1 ? 'entrega' : 'entregas'}`;
    return `${f.cantidad} ${f.cantidad === 1 ? 'venta' : 'ventas'}`;
  }

  /** Los pesos vendidos: solo el admin (a los demás la base no se los manda; solo ven cuántas ventas) */
  detalle(f: Fila): string {
    return f.tipo === 'vendedora' && f.ventas != null ? `${pesos(f.ventas)} vendidos` : '';
  }

  /** Avance hacia la meta de la semana o del mes en curso */
  avance(f: Fila): number | null {
    if (!this.conMeta() || !f.meta) return null;
    return f.avance ?? Math.min(100, Math.round((f.cantidad / f.meta) * 100));
  }

  textoMeta(f: Fila): string {
    const de = this.periodo() === 'semana' ? ' semanal' : '';
    return f.tipo === 'vendedora' ? `Meta${de} ${f.meta} ventas` : `Meta${de} ${f.meta} entregas`;
  }

  editarMeta(f: Fila): void {
    this.editandoId.set(f.usuario_id);
    this.metaTexto = f.meta ? String(f.meta) : '';
  }

  async guardarMeta(f: Fila): Promise<void> {
    if (this.guardandoMeta()) return;
    const texto = this.metaTexto.replace(/[^\d]/g, '');
    const n = texto ? Number(texto) : null;
    const campo = (f.tipo === 'vendedora' ? 'meta_ventas' : 'meta_entregas') + (this.periodo() === 'semana' ? '_semana' : '');
    this.guardandoMeta.set(true);
    const { error } = await this.sb.client.from('metas').upsert({ usuario_id: f.usuario_id, [campo]: n, updated_at: new Date().toISOString() });
    this.guardandoMeta.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(`Meta de ${f.nombre} guardada`);
    this.editandoId.set(null);
    await this.cargar();
  }
}
