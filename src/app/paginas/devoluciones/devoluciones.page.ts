import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { RangoComponent, RangoFechas } from '../../shared/rango/rango.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoFechaCO, formatoHoraCO, hoyColombiaISO } from '../../shared/fecha-colombia';
import { DevolucionComponent } from './devolucion.component';

interface Devolucion {
  id: number;
  pedido_id: string;
  numero: number;
  cliente: string;
  vendedor: string | null;
  tipo: 'devolucion' | 'cambio' | 'garantia';
  motivo: string;
  estado_producto: 'vuelve_stock' | 'danado';
  reemplazo: boolean;
  reembolso: number;
  metodo: string | null;
  comision_descuento: number;
  nota: string | null;
  fotos: string[];
  creado_por_nombre: string | null;
  fecha: string;
  perdida: number | null;
  items: { nombre: string; cantidad: number }[];
  tecnico: string | null;
  tecnico_fecha: string | null;
  tecnico_obs: string | null;
  resuelta: boolean;
  nuevo_nombre: string | null;
  nuevo_cantidad: number | null;
  diferencia: number;
  diferencia_metodo: string | null;
}

/**
 * Devoluciones, cambios y garantías del periodo (como en Jasta). Se registran con
 * "Registrar devolución" y el número del pedido entregado; aquí se ven todas con su resumen.
 * Entran admin, despachador y venta local; la pérdida por dañados solo la ve el admin.
 */
@Component({
  selector: 'app-devoluciones',
  standalone: true,
  host: { class: 'jt' },
  imports: [IonIcon, DevolucionComponent, RangoComponent, SkeletonComponent, FormsModule],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 1000px; }
      .lista { list-style: none; margin: 0; padding: 0; }
      .dev { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; padding: 12px 0; border-bottom: var(--perfora); }
      .dev:last-child { border-bottom: 0; }
      .dev strong { font-size: 14.5px; }
      .dev p { margin: 2px 0 0; font-size: 13px; color: var(--text-soft); }
      .dev small { font-size: 12px; color: var(--text-muted); }
      .der { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; }
      .der .num { font-weight: 700; }
      .tipo { display: inline-block; padding: 1px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 650; }
      .tipo.devolucion { background: var(--danger-wash); color: var(--danger); }
      .tipo.cambio { background: var(--accent-wash); color: var(--accent); }
      .tipo.garantia { background: var(--oro-wash); color: var(--oro-texto); }
      .estado { font-size: 12px; color: var(--text-muted); }
      .estado.danado { color: var(--danger); font-weight: 600; }
      .foto { width: 36px; height: 36px; padding: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--surface-2); cursor: zoom-in; }
      .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .motivos { display: flex; flex-wrap: wrap; gap: 8px; }
      .motivos span { padding: 5px 11px; border-radius: 999px; background: var(--surface-2); font-size: 13px; }
      .motivos b { font-family: var(--mono-font); margin-left: 4px; }
      .g-estado { display: inline-block; margin-left: 4px; padding: 1px 8px; border-radius: 8px; font-size: 11.5px; font-weight: 650; background: var(--danger-wash); color: var(--danger); }
      .g-estado.tec { background: var(--accent-wash); color: var(--accent); }
      .g-estado.ok { background: var(--ok-wash, #dcfce7); color: var(--efectivo-texto, #15803d); }
      .tec-info { margin: 4px 0 0; padding: 6px 10px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13px; color: var(--text-soft); }
      .link { display: block; margin: 6px 0 2px; border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; text-decoration: underline; cursor: pointer; }
      .check { display: flex; gap: 8px; align-items: center; font-size: 14px; }
      .vacio-txt { margin: 0; padding: 14px 0 6px; text-align: center; font-size: 13.5px; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">{{ etiqueta() }}</p><h1>Devoluciones</h1></div>
        <button class="b b-pri" (click)="registrando.set(true)"><ion-icon name="add-outline"></ion-icon>Registrar devolución</button>
      </div>
      <app-rango inicial="mes" (cambio)="cambiarRango($event)"></app-rango>

      <div class="kpis" role="list">
        <div class="kpi" role="listitem"><span class="kpi-label">Casos</span><span class="kpi-valor num">{{ lista().length }}</span>
          <span class="kpi-nota">{{ cuenta('devolucion') }} devoluciones · {{ cuenta('cambio') }} cambios · {{ cuenta('garantia') }} garantías{{ garantiasAbiertas() ? ' (' + garantiasAbiertas() + ' sin resolver)' : '' }}</span></div>
        <div class="kpi" role="listitem"><span class="kpi-label">Unidades</span><span class="kpi-valor num">{{ resumen().unidades }}</span>
          <span class="kpi-nota">{{ resumen().danadas }} dañadas</span></div>
        <div class="kpi" role="listitem"><span class="kpi-label">Reembolsado</span><span class="kpi-valor num">{{ pesos(resumen().reembolsos) }}</span>
          <span class="kpi-nota">Plata devuelta a clientes</span></div>
        @if (esAdmin()) {
          <div class="kpi" role="listitem"><span class="kpi-label">Pérdida por dañados</span><span class="kpi-valor num">{{ pesos(resumen().perdida) }}</span>
            <span class="kpi-nota">A precio de compra</span></div>
        } @else {
          <div class="kpi" role="listitem"><span class="kpi-label">Comisión descontada</span><span class="kpi-valor num">{{ pesos(resumen().comision) }}</span>
            <span class="kpi-nota">A los vendedores</span></div>
        }
      </div>

      @if (porMotivo().length) {
        <div class="motivos">
          @for (m of porMotivo(); track m.motivo) { <span>{{ m.motivo }}<b>{{ m.n }}</b></span> }
        </div>
      }

      <section class="panel">
        @if (lista().length) {
          <ul class="lista">
            @for (d of lista(); track d.id) {
              <li class="dev">
                <span style="min-width: 0">
                  <strong>#{{ d.numero }} {{ d.cliente }}</strong> <span class="tipo" [class]="'tipo ' + d.tipo">{{ tipoTxt(d.tipo) }}</span>
                  @if (d.tipo === 'garantia') {
                    <span class="g-estado" [class.tec]="d.tecnico && !d.resuelta" [class.ok]="d.resuelta">{{ d.resuelta ? 'Resuelta' : d.tecnico ? 'Con el técnico' : 'Falta técnico' }}</span>
                    <p>{{ items(d) }}</p>
                    @if (d.nota) { <p>Problema: "{{ d.nota }}"</p> }
                    @if (d.tecnico) {
                      <p class="tec-info">🔧 {{ d.tecnico }} · {{ fechaCorta(d.tecnico_fecha) }}{{ d.tecnico_obs ? ' · ' + d.tecnico_obs : '' }}</p>
                    }
                    <button type="button" class="link" (click)="abrirTecnico(d)">{{ d.tecnico ? 'Editar técnico' : 'Poner técnico' }}</button>
                  } @else {
                    <p>{{ items(d) }} · {{ d.motivo }}</p>
                    @if (d.nuevo_nombre) { <p>→ Por {{ d.nuevo_cantidad }} {{ d.nuevo_nombre }}{{ +d.diferencia ? ' · pagó ' + pesos(d.diferencia) + ' de diferencia (' + d.diferencia_metodo + ')' : ' · sin diferencia' }}</p> }
                    @if (d.nota) { <p>"{{ d.nota }}"</p> }
                  }
                  <small>{{ cuando(d.fecha) }}{{ d.creado_por_nombre ? ' · ' + d.creado_por_nombre : '' }}{{ d.vendedor ? ' · vendió ' + d.vendedor : '' }}</small>
                </span>
                <span class="der">
                  @if (d.tipo === 'devolucion' && d.reembolso) { <span class="num">−{{ pesos(d.reembolso) }}</span> }
                  @if (+d.diferencia) { <span class="num" style="color: var(--efectivo-texto, #15803d)">+{{ pesos(d.diferencia) }}</span> }
                  @if (d.tipo !== 'garantia') {
                    <span class="estado" [class.danado]="d.estado_producto === 'danado'">{{ d.estado_producto === 'danado' ? 'Dañado' : 'Volvió al inventario' }}{{ d.reemplazo ? ' · se entregó otro' : '' }}</span>
                  }
                  @if (d.comision_descuento) { <small>Comisión −{{ pesos(d.comision_descuento) }}</small> }
                  @if (esAdmin() && d.fotos.length) {
                    <button type="button" class="foto" (click)="verFotos(d)" aria-label="Ver fotos">
                      @if (miniaturas()[d.fotos[0]]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                    </button>
                  }
                </span>
              </li>
            }
          </ul>
        } @else {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="4"></app-skeleton> } @else { <p class="vacio-txt">No hubo devoluciones ni garantías en este periodo.</p> }
        }
      </section>
    </div>

    @if (tecDe(); as d) {
      <button class="velo" aria-label="Cerrar" (click)="tecDe.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-tec">
        <div class="hoja-head"><h2 id="t-tec">Garantía · #{{ d.numero }}</h2></div>
        <div class="hoja-body">
          <p class="ayuda" style="margin: 0">{{ items(d) }}{{ d.nota ? ' · "' + d.nota + '"' : '' }}</p>
          <div class="campo"><label for="tc-n">Técnico</label><input id="tc-n" maxlength="80" [(ngModel)]="tNombre" placeholder="Nombre del técnico" /></div>
          <div class="campo"><label for="tc-f">Fecha</label><input id="tc-f" type="date" [(ngModel)]="tFecha" /></div>
          <div class="campo"><label for="tc-o">Observaciones</label>
            <textarea id="tc-o" rows="3" maxlength="600" [(ngModel)]="tObs" placeholder="Ej: cambió la batería, queda listo el viernes"></textarea></div>
          <label class="check"><input type="checkbox" [(ngModel)]="tResuelta" /> Ya está resuelta (se le entregó al cliente)</label>
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="tecDe.set(null)">Cancelar</button>
          <button class="b b-pri" [disabled]="guardando()" (click)="guardarTecnico()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
        </div>
      </div>
    }

    @if (registrando()) {
      <app-devolucion (cerrar)="registrando.set(false)" (registrado)="registrada()"></app-devolucion>
    }
  `,
})
export class DevolucionesPage {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  lista = signal<Devolucion[]>([]);
  porMotivo = signal<{ motivo: string; n: number }[]>([]);
  miniaturas = signal<Record<string, string>>({});
  cargando = signal(true);
  etiqueta = signal('');
  registrando = signal(false);
  esAdmin = signal(false);
  pesos = pesos;
  private rango: RangoFechas | null = null;
  private consulta = 0;
  private perfil = this.sb.getCurrentProfile().then((p) => this.esAdmin.set(!!p && rolesDe(p).includes('admin')));

  constructor() {
    addIcons({ addOutline });
  }

  garantiasAbiertas = computed(() => this.lista().filter((d) => d.tipo === 'garantia' && !d.resuelta).length);
  resumen = computed(() => {
    const l = this.lista();
    const unidades = (d: Devolucion): number => (d.items ?? []).reduce((a, i) => a + i.cantidad, 0);
    return {
      unidades: l.reduce((s, d) => s + unidades(d), 0),
      danadas: l.filter((d) => d.estado_producto === 'danado').reduce((s, d) => s + unidades(d), 0),
      reembolsos: l.reduce((s, d) => s + Number(d.reembolso || 0), 0),
      perdida: l.reduce((s, d) => s + Number(d.perdida || 0), 0),
      comision: l.reduce((s, d) => s + Number(d.comision_descuento || 0), 0),
    };
  });

  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    this.etiqueta.set(r.etiqueta);
    void this.cargar();
  }

  registrada(): void {
    this.registrando.set(false);
    this.toast.ok('Devolución registrada');
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    const n = ++this.consulta;
    const { data, error } = await this.sb.client.rpc('devoluciones_lista', { p_desde: r.desde || '2020-01-01', p_hasta: r.hasta || hoyColombiaISO() });
    if (n !== this.consulta) return;
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const res = data as { lista: Devolucion[]; por_motivo: { motivo: string; n: number }[] };
    this.lista.set(res.lista ?? []);
    this.porMotivo.set(res.por_motivo ?? []);
    // Las fotos están en el bucket privado de comprobantes: solo el admin puede verlas
    await this.perfil;
    if (!this.esAdmin()) return;
    const faltan = (res.lista ?? []).flatMap((d) => (d.fotos ?? []).slice(0, 1)).filter((f) => !this.miniaturas()[f]);
    if (faltan.length) {
      const urls = await urlsComprobantes(this.sb.client, faltan);
      this.miniaturas.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
    }
  }

  // Técnico de la garantía
  tecDe = signal<Devolucion | null>(null);
  guardando = signal(false);
  tNombre = '';
  tFecha = '';
  tObs = '';
  tResuelta = false;

  abrirTecnico(d: Devolucion): void {
    this.tNombre = d.tecnico ?? '';
    this.tFecha = d.tecnico_fecha ?? hoyColombiaISO();
    this.tObs = d.tecnico_obs ?? '';
    this.tResuelta = d.resuelta;
    this.tecDe.set(d);
  }

  async guardarTecnico(): Promise<void> {
    const d = this.tecDe();
    if (!d) return;
    if (!this.tNombre.trim()) return this.toast.error('Escribe el nombre del técnico');
    if (!this.tFecha) return this.toast.error('Elige la fecha');
    this.guardando.set(true);
    const { error } = await this.sb.client.rpc('garantia_tecnico', {
      p_id: d.id, p_tecnico: this.tNombre.trim(), p_fecha: this.tFecha, p_obs: this.tObs.trim(), p_resuelta: this.tResuelta,
    });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(this.tResuelta ? 'Garantía resuelta ✓' : 'Técnico guardado');
    this.tecDe.set(null);
    await this.cargar();
  }

  fechaCorta(d: string | null): string {
    return d ? formatoFechaCO(d + 'T12:00:00-05:00', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  cuenta(t: string): number {
    return this.lista().filter((d) => d.tipo === t).length;
  }

  tipoTxt(t: string): string {
    return { devolucion: 'Devolución', cambio: 'Cambio', garantia: 'Garantía' }[t] ?? t;
  }

  items(d: Devolucion): string {
    return (d.items ?? []).map((i) => `${i.cantidad} ${i.nombre}`).join(', ');
  }

  verFotos(d: Devolucion): void {
    void urlsComprobantes(this.sb.client, d.fotos).then((urls) => this.visor.abrir(urls.map((url) => ({ url, titulo: `Pedido #${d.numero}` })), 0));
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
