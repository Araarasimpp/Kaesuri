import { Component, computed, inject, signal } from '@angular/core';
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
  imports: [IonIcon, DevolucionComponent, RangoComponent, SkeletonComponent],
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
          <span class="kpi-nota">{{ cuenta('devolucion') }} devoluciones · {{ cuenta('cambio') }} cambios · {{ cuenta('garantia') }} garantías</span></div>
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
                  <p>{{ items(d) }} · {{ d.motivo }}</p>
                  @if (d.nota) { <p>"{{ d.nota }}"</p> }
                  <small>{{ cuando(d.fecha) }}{{ d.creado_por_nombre ? ' · ' + d.creado_por_nombre : '' }}{{ d.vendedor ? ' · vendió ' + d.vendedor : '' }}</small>
                </span>
                <span class="der">
                  @if (d.tipo === 'devolucion' && d.reembolso) { <span class="num">−{{ pesos(d.reembolso) }}</span> }
                  <span class="estado" [class.danado]="d.estado_producto === 'danado'">{{ d.estado_producto === 'danado' ? 'Dañado' : 'Volvió al inventario' }}{{ d.reemplazo ? ' · se entregó otro' : '' }}</span>
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
