import { Component, Input, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SupabaseService } from '../../core/services/supabase.service';
import { EntregadoJasta, JastaService } from '../../core/services/jasta.service';
import { VisorService } from '../../shared/visor/visor.service';
import { DiaComponent } from '../../shared/rango/dia.component';
import { RangoFechas } from '../../shared/rango/rango.component';
import { finDiaColombia, formatoHoraCO, inicioDiaColombia } from '../../shared/fecha-colombia';
import { comprobantesDe, efectivoDe, transferenciaDe } from '../../shared/pago';
import { urlsComprobantes } from '../../shared/comprobantes';
import { pesos } from '../../shared/formato';
import { MetodoPago } from '../../shared/models/models';

interface EntregadoJyb {
  id: string;
  numero: number;
  cliente_nombre: string;
  barrio: string | null;
  total: number;
  valor_domicilio: number;
  metodo_pago: MetodoPago | null;
  monto_efectivo: number | null;
  monto_transferencia: number | null;
  comprobante_url: string | null;
  comprobantes: string[] | null;
  entregado_at: string;
  cuadre_id: string | null;
  cuadre: { estado: string } | null;
}

type EstadoCuadre = 'por_cuadrar' | 'por_confirmar' | 'cuadrado';

interface Fila {
  clave: string;
  negocio: 'jyb' | 'jasta';
  numero: string;
  cliente: string;
  barrio: string | null;
  total: number;
  metodo: string;
  cuando: string;
  cuadre: EstadoCuadre;
  fotos: string[];
}

interface Totales {
  entregas: number;
  domicilios: number;
  efectivo: number;
  transferencia: number;
  cuadrado: number;
  porConfirmar: number;
  porCuadrar: number;
}

const TEXTO_CUADRE: Record<EstadoCuadre, string> = {
  por_cuadrar: 'por cuadrar',
  por_confirmar: 'cuadre por confirmar',
  cuadrado: 'cuadrado',
};

/**
 * "Mis entregas hechas" del domiciliario (como en Jasta): las de un día, de los dos
 * negocios, con totales. Cuadrado / por cuadrar = efectivo − domicilios, igual que en Cuadre.
 * Tocar una entrega pagada por transferencia muestra las fotos del comprobante.
 */
@Component({
  selector: 'app-entregas-hechas',
  standalone: true,
  host: { class: 'jt' },
  imports: [DiaComponent, NgTemplateOutlet],
  styles: [
    `
      :host { display: block; margin-top: 24px; padding: 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
      .cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      h2 { margin: 0; font-size: 18px; font-weight: 700; }
      .tot { display: flex; gap: 6px 16px; flex-wrap: wrap; margin: 14px 0 4px; font-size: 13px; color: var(--text-soft); }
      .tot strong { color: var(--text); }
      .lista { margin: 10px 0 0; padding: 0; list-style: none; }
      .fila { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 10px 0; border: 0; border-top: 1px solid var(--border-soft);
        background: none; color: var(--text); font: inherit; text-align: left; }
      button.fila { cursor: pointer; }
      .fila small { display: block; margin-top: 2px; font-size: 12px; color: var(--text-muted); }
      .der { text-align: right; white-space: nowrap; }
      .negocio { display: inline-block; margin-right: 6px; padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
        background: var(--oro-wash); color: var(--oro-texto); vertical-align: 1px; }
      .negocio.jasta { background: var(--accent-wash); color: var(--accent); }
      .vacio { margin: 12px 0 0; font-size: 13.5px; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="cab">
      <h2>Mis entregas hechas</h2>
      <app-dia (cambio)="cambiarDia($event)"></app-dia>
    </div>

    @if (filas().length) {
      @for (t of totales(); track t.nombre) {
        <p class="tot">
          @if (totales().length > 1) {<span><strong>{{ t.nombre }}</strong></span>}
          <span><strong class="num">{{ t.v.entregas }}</strong> {{ t.v.entregas === 1 ? 'entrega' : 'entregas' }}</span>
          <span>Domicilios <strong class="num">{{ pesos(t.v.domicilios) }}</strong></span>
          <span>Efectivo <strong class="num">{{ pesos(t.v.efectivo) }}</strong></span>
          <span>Transferencias <strong class="num">{{ pesos(t.v.transferencia) }}</strong></span>
          <span>Cuadrado <strong class="num">{{ pesos(t.v.cuadrado) }}</strong></span>
          @if (t.v.porConfirmar) {<span>Por confirmar <strong class="num">{{ pesos(t.v.porConfirmar) }}</strong></span>}
          @if (t.v.porCuadrar) {<span>Por cuadrar <strong class="num">{{ pesos(t.v.porCuadrar) }}</strong></span>}
        </p>
      }
      <ul class="lista">
        @for (f of filas(); track f.clave) {
          <li>
            @if (f.fotos.length) {
              <button type="button" class="fila" (click)="verFotos(f)" [attr.aria-label]="'Ver comprobante del pedido ' + f.numero">
                <ng-container *ngTemplateOutlet="contenido; context: { $implicit: f }"></ng-container>
              </button>
            } @else {
              <div class="fila"><ng-container *ngTemplateOutlet="contenido; context: { $implicit: f }"></ng-container></div>
            }
          </li>
        }
      </ul>
    } @else {
      <p class="vacio">{{ cargando() ? 'Cargando…' : 'No hay entregas este día.' }}</p>
    }

    <ng-template #contenido let-f>
      <span>
        @if (conJasta) {<span class="negocio" [class.jasta]="f.negocio === 'jasta'">{{ f.negocio === 'jasta' ? 'Jasta' : 'JYB' }}</span>}#{{ f.numero }} · {{ f.cliente }}
        <small>{{ f.barrio ? f.barrio + ' · ' : '' }}{{ hora(f.cuando) }} · {{ textoDe(f.cuadre) }}@if (f.fotos.length) { · {{ f.fotos.length === 1 ? '1 foto' : f.fotos.length + ' fotos' }} }</small>
      </span>
      <span class="der"><strong class="num">{{ pesos(f.total) }}</strong><small>{{ f.metodo }}</small></span>
    </ng-template>
  `,
})
export class EntregasHechasComponent {
  /** Si también reparte para Jasta (sus entregas de allá se suman aquí). Se sabe después de cargar. */
  @Input() set conJasta(v: boolean) {
    const antes = this._conJasta;
    this._conJasta = v;
    if (v && !antes) void this.cargar();
  }
  get conJasta(): boolean {
    return this._conJasta;
  }
  private _conJasta = false;

  private sb = inject(SupabaseService);
  private jastas = inject(JastaService);
  private visor = inject(VisorService);
  pesos = pesos;
  textoDe(c: EstadoCuadre): string {
    return TEXTO_CUADRE[c];
  }

  private jyb = signal<EntregadoJyb[]>([]);
  private jasta = signal<EntregadoJasta[]>([]);
  cargando = signal(true);
  private dia: RangoFechas | null = null;

  filas = computed<Fila[]>(() =>
    [
      ...this.jyb().map((p) => ({
        clave: 'k:' + p.id,
        negocio: 'jyb' as const,
        numero: String(p.numero),
        cliente: p.cliente_nombre,
        barrio: p.barrio,
        total: Number(p.total),
        metodo: p.metodo_pago ?? '',
        cuando: p.entregado_at,
        cuadre: estadoJyb(p),
        fotos: comprobantesDe(p),
      })),
      ...this.jasta().map((p) => ({
        clave: 'j:' + p.id,
        negocio: 'jasta' as const,
        numero: String(p.id),
        cliente: p.cliente_nombre,
        barrio: p.barrio,
        total: Number(p.total),
        metodo: p.tipo_recaudo ?? '',
        cuando: p.entregado_at,
        cuadre: p.cuadre,
        fotos: [],
      })),
    ].sort((a, b) => b.cuando.localeCompare(a.cuando))
  );

  totales = computed(() => {
    const out: { nombre: string; v: Totales }[] = [];
    if (this.jyb().length)
      out.push({
        nombre: 'Variedades JYB',
        v: sumar(this.jyb().map((p) => ({ dom: Number(p.valor_domicilio), ef: efectivoDe(p), tr: transferenciaDe(p), cuadre: estadoJyb(p) }))),
      });
    if (this.jasta().length)
      out.push({
        nombre: 'Jasta',
        v: sumar(this.jasta().map((p) => ({ dom: Number(p.valor_domicilio), ef: Number(p.efectivo || 0), tr: Number(p.transferencia || 0), cuadre: p.cuadre }))),
      });
    return out;
  });

  cambiarDia(r: RangoFechas): void {
    this.dia = r;
    void this.cargar();
  }

  /** Lo llama el panel cuando se entrega un pedido (para que aparezca de una vez) */
  async cargar(): Promise<void> {
    const r = this.dia;
    if (!r) return;
    const desde = inicioDiaColombia(r.desde).toISOString();
    const hasta = finDiaColombia(r.hasta).toISOString();
    const user = await this.sb.getCurrentUser();
    if (!user) return;
    const [k, j] = await Promise.all([
      this.sb.client
        .from('pedidos')
        .select(
          'id, numero, cliente_nombre, barrio, total, valor_domicilio, metodo_pago, monto_efectivo, monto_transferencia, comprobante_url, comprobantes, entregado_at, cuadre_id, cuadre:cuadres(estado)'
        )
        .eq('domiciliario_id', user.id)
        .eq('estado', 'entregado')
        .gte('entregado_at', desde)
        .lte('entregado_at', hasta)
        .order('entregado_at', { ascending: false })
        .limit(300),
      this.conJasta ? this.jastas.entregadas(desde, hasta).catch(() => null) : Promise.resolve([]),
    ]);
    // Si se cambió de día mientras cargaba, se deja lo del día nuevo
    if (this.dia !== r) return;
    if (!k.error) this.jyb.set((k.data ?? []) as unknown as EntregadoJyb[]);
    if (j) this.jasta.set(j);
    this.cargando.set(false);
  }

  async verFotos(f: Fila): Promise<void> {
    const urls = await urlsComprobantes(this.sb.client, f.fotos);
    this.visor.abrir(urls.map((url, i) => ({ url, titulo: `Comprobante ${i + 1} · pedido #${f.numero}` })));
  }

  hora(iso: string): string {
    return formatoHoraCO(iso);
  }
}

function estadoJyb(p: EntregadoJyb): EstadoCuadre {
  if (!p.cuadre_id) return 'por_cuadrar';
  return p.cuadre?.estado === 'confirmado' ? 'cuadrado' : 'por_confirmar';
}

function sumar(lista: { dom: number; ef: number; tr: number; cuadre: EstadoCuadre }[]): Totales {
  return lista.reduce<Totales>(
    (a, p) => {
      const neto = p.ef - p.dom;
      return {
        entregas: a.entregas + 1,
        domicilios: a.domicilios + p.dom,
        efectivo: a.efectivo + p.ef,
        transferencia: a.transferencia + p.tr,
        cuadrado: a.cuadrado + (p.cuadre === 'cuadrado' ? neto : 0),
        porConfirmar: a.porConfirmar + (p.cuadre === 'por_confirmar' ? neto : 0),
        porCuadrar: a.porCuadrar + (p.cuadre === 'por_cuadrar' ? neto : 0),
      };
    },
    { entregas: 0, domicilios: 0, efectivo: 0, transferencia: 0, cuadrado: 0, porConfirmar: 0, porCuadrar: 0 }
  );
}
