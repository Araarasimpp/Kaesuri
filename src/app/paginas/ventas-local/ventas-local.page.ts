import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add } from 'ionicons/icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { RangoFechas } from '../../shared/rango/rango.component';
import { DiaComponent } from '../../shared/rango/dia.component';
import { mensajeError, numero, pesos } from '../../shared/formato';
import { finDiaColombia, formatoFechaCO, formatoHoraCO, inicioDiaColombia } from '../../shared/fecha-colombia';
import { nombreConVariante } from '../../shared/variante';
import { CuadreCajaComponent } from './cuadre-caja.component';
import { BotonTicketComponent } from '../../shared/ticket/boton-ticket.component';

type Metodo = 'todos' | 'efectivo' | 'transferencia' | 'mixto';

interface VentaLocal {
  id: string;
  numero: number;
  created_at: string;
  cliente_nombre: string;
  total: number;
  comision: number;
  metodo_pago: string | null;
  monto_efectivo: number | null;
  monto_transferencia: number | null;
  vendedor: { nombre: string } | null;
  registro: { nombre: string } | null;
  pedido_items: { cantidad: number; color: string | null; talla: string | null; productos: { nombre: string } | null }[];
}

/** Registro de las ventas del punto físico (como en Jasta): qué se vendió, quién, a qué hora y cómo pagó */
@Component({
  selector: 'app-ventas-local',
  standalone: true,
  host: { class: 'jt' },
  imports: [RouterLink, IonIcon, DiaComponent, CuadreCajaComponent, BotonTicketComponent],
  styles: [
    `
      .seccion { padding: 16px 20px 0; }
      .prods { white-space: normal; min-width: 220px; max-width: 360px; font-size: 12px; color: var(--text-soft); line-height: 1.35; }
      .tabla td { white-space: nowrap; }
      .tabla td.ticket { min-width: 200px; }
      @media (max-width: 760px) { .seccion { padding: 12px 14px 0; } }
    `,
  ],
  template: `
    <div class="vista">
      <div class="vista-head">
        <h1>Ventas del local <small class="num">{{ numero(filtradas().length) }}</small></h1>
        <a class="b b-pri" [routerLink]="nuevaVenta"><ion-icon name="add"></ion-icon>Nueva venta</a>
      </div>
      <div class="barra">
        <app-dia (cambio)="cambiarRango($event)"></app-dia>
        <div class="chips">
          @for (m of metodos; track m.id) {
            <button class="chip" [class.on]="metodo() === m.id" (click)="metodo.set(m.id)">{{ m.label }}</button>
          }
        </div>
      </div>
      <div class="seccion">
        <div class="cifras-grid">
          <div class="cifra-t clave"><small>Total vendido</small><strong class="num">{{ pesos(tot().total) }}</strong><em>{{ tot().n }} ventas</em></div>
          <div class="cifra-t"><small>Efectivo</small><strong class="num">{{ pesos(tot().efectivo) }}</strong></div>
          <div class="cifra-t"><small>Transferencias</small><strong class="num">{{ pesos(tot().transferencia) }}</strong></div>
          <div class="cifra-t"><small>Comisiones</small><strong class="num">{{ pesos(tot().comision) }}</strong><em>De los vendedores</em></div>
        </div>
        @if (diaCaja(); as d) { <app-cuadre-caja [fecha]="d" [version]="ventas().length + tot().efectivo"></app-cuadre-caja> }
      </div>
      <div class="tabla-wrap" style="margin-top: 16px">
        <table class="tabla tarjetas-cel">
          <thead><tr><th>Hora</th><th>N.º</th><th>Cliente</th><th>Productos</th><th>Vendió</th><th>Pago</th><th class="der">Efectivo</th><th class="der">Transferencia</th><th class="der">Total</th><th></th></tr></thead>
          <tbody>
            @for (v of filtradas(); track v.id) {
              <tr>
                <td class="suave" data-etq="Hora">{{ fecha(v.created_at) }}</td>
                <td data-etq="N.º"><span class="guia">#{{ v.numero }}</span></td>
                <td class="titulo">{{ v.cliente_nombre }}</td>
                <td class="prods" data-etq="Productos">{{ productos(v) }}</td>
                <td data-etq="Vendió">{{ v.comision > 0 || v.vendedor?.nombre !== v.registro?.nombre ? v.vendedor?.nombre : '—' }}</td>
                <td data-etq="Pago">{{ pago(v.metodo_pago) }}</td>
                <td class="der num" data-etq="Efectivo">{{ pesos(efectivo(v)) }}</td>
                <td class="der num" data-etq="Transferencia">{{ pesos(transferencia(v)) }}</td>
                <td class="der num" data-etq="Total">{{ pesos(v.total) }}</td>
                <td class="ticket"><app-boton-ticket [pedidoId]="v.id"></app-boton-ticket></td>
              </tr>
            } @empty {
              <tr><td colspan="10" class="suave">{{ cargando() ? 'Cargando…' : 'No hay ventas en el local en este periodo.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class VentasLocalPage implements OnInit, OnDestroy {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  readonly nuevaVenta: string = inject(ActivatedRoute).snapshot.data['nuevaVenta'] ?? '/local/nueva';

  metodos: { id: Metodo; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'efectivo', label: 'Efectivo' },
    { id: 'transferencia', label: 'Transferencia' },
    { id: 'mixto', label: 'Mixto' },
  ];
  metodo = signal<Metodo>('todos');
  ventas = signal<VentaLocal[]>([]);
  cargando = signal(true);
  /** Día que se puede cuadrar (solo cuando se ve un día, no un rango) */
  diaCaja = signal<string | null>(null);
  private rango: RangoFechas | null = null;
  private canal: RealtimeChannel | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  filtradas = computed(() => (this.metodo() === 'todos' ? this.ventas() : this.ventas().filter((v) => v.metodo_pago === this.metodo())));
  tot = computed(() =>
    this.filtradas().reduce(
      (a, v) => ({
        n: a.n + 1,
        total: a.total + Number(v.total),
        efectivo: a.efectivo + this.efectivo(v),
        transferencia: a.transferencia + this.transferencia(v),
        comision: a.comision + Number(v.comision || 0),
      }),
      { n: 0, total: 0, efectivo: 0, transferencia: 0, comision: 0 }
    )
  );

  pesos = pesos;
  numero = numero;

  constructor() {
    addIcons({ add });
  }

  ngOnInit(): void {
    this.canal = this.sb.client
      .channel('ventas-local-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.cargar(), 600);
      })
      .subscribe();
  }

  ngOnDestroy(): void {
    if (this.canal) void this.sb.client.removeChannel(this.canal);
    clearTimeout(this.timer);
  }

  cambiarRango(r: RangoFechas): void {
    this.rango = r;
    this.diaCaja.set(r.desde && r.desde === r.hasta ? r.desde : null);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const r = this.rango;
    if (!r) return;
    this.cargando.set(true);
    let q = this.sb.client
      .from('pedidos')
      .select(
        'id, numero, created_at, cliente_nombre, total, comision, metodo_pago, monto_efectivo, monto_transferencia, ' +
          'vendedor:profiles!pedidos_vendedor_id_fkey(nombre), registro:profiles!pedidos_registrado_por_fkey(nombre), ' +
          'pedido_items(cantidad, color, talla, productos(nombre))'
      )
      .eq('canal', 'local')
      .neq('estado', 'cancelado');
    if (r.desde) q = q.gte('created_at', inicioDiaColombia(r.desde).toISOString());
    if (r.hasta) q = q.lte('created_at', finDiaColombia(r.hasta).toISOString());
    const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.ventas.set((data ?? []) as unknown as VentaLocal[]);
  }

  productos(v: VentaLocal): string {
    return v.pedido_items
      .map((i) => {
        const n = nombreConVariante(i.productos?.nombre ?? 'Producto', i);
        return i.cantidad > 1 ? `${n} x${i.cantidad}` : n;
      })
      .join(', ');
  }

  efectivo(v: VentaLocal): number {
    return v.metodo_pago === 'efectivo' ? Number(v.total) : v.metodo_pago === 'mixto' ? Number(v.monto_efectivo || 0) : 0;
  }

  transferencia(v: VentaLocal): number {
    return v.metodo_pago === 'transferencia' ? Number(v.total) : v.metodo_pago === 'mixto' ? Number(v.monto_transferencia || 0) : 0;
  }

  pago(t: string | null): string {
    return t === 'efectivo' ? 'Efectivo' : t === 'transferencia' ? 'Transferencia' : t === 'mixto' ? 'Mixto' : '—';
  }

  fecha(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
