import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { callOutline, checkmarkCircleOutline, helpBuoyOutline, logoWhatsapp, refreshOutline, arrowUndoOutline } from 'ionicons/icons';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoFechaCO, formatoHoraCO, hoyColombiaISO, diaColombiaDe } from '../../shared/fecha-colombia';

interface Reporte {
  id: number;
  motivo: string;
  mensaje: string | null;
  estado: 'abierta' | 'resuelta';
  fecha: string;
  respuesta: string | null;
  resuelta_at: string | null;
  resuelta_por: string | null;
  cliente: string;
  prefijo: string | null;
  telefono: string | null;
  email: string | null;
  avatar_url: string | null;
  pedido_id: number | null;
  pedido_web_id: number | null;
  estado_pedido: string | null;
  total: number | null;
  barrio: string | null;
  vendedora: string | null;
  productos_ped: string | null;
  productos_web: string | null;
}

/**
 * Ayuda a clientes: lo que los clientes reportan desde "Mis compras" (llegó dañado, garantía,
 * ¿cuándo me llega?…). El admin ve todo; el vendedor, lo de sus pedidos. Al resolverlo se le
 * puede dejar una respuesta que el cliente ve en su pedido.
 */
@Component({
  selector: 'app-ayuda-clientes',
  standalone: true,
  imports: [FormsModule, RouterLink, IonIcon, AvatarComponent, SkeletonComponent],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 860px; }
      .tabs { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--surface-2); }
      .tabs button { height: 34px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--text-soft); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
      .tabs button.on { background: var(--surface); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,.12); }
      .tabs b { margin-left: 4px; padding: 1px 7px; border-radius: 999px; background: var(--danger); color: #fff; font-size: 11px; }
      .barra { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
      .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
      .rep { display: flex; flex-direction: column; gap: 10px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .rep.abierta { border-left: 4px solid var(--danger); }
      .cab { display: flex; align-items: center; gap: 12px; }
      .cab .quien { flex: 1; min-width: 0; }
      .cab strong { display: block; font-size: 15px; }
      .cab small { display: block; font-size: 12.5px; color: var(--text-muted); }
      .estado { flex-shrink: 0; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
      .estado.abierta { background: var(--danger-wash); color: var(--danger); }
      .estado.resuelta { background: var(--ok-wash); color: var(--efectivo-texto); }
      .motivo { margin: 0; font-size: 16px; font-weight: 700; }
      .msj { margin: 0; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-2); font-size: 14px; line-height: 1.45; }
      .ped { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--text-soft); }
      .ped a { color: var(--accent); font-weight: 650; text-decoration: none; }
      .resp { margin: 0; padding: 10px 12px; border-radius: var(--radius); background: var(--ok-wash); font-size: 13.5px; line-height: 1.45; }
      .resp small { display: block; margin-top: 2px; color: var(--text-muted); font-size: 12px; }
      .acc { display: flex; flex-wrap: wrap; gap: 8px; }
      .acc .b { height: 38px; }
      .wa { background: #25d366 !important; border-color: #25d366 !important; color: #fff !important; }
      textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; resize: vertical; }
      .vacio-txt { margin: 0; padding: 26px 0; text-align: center; color: var(--text-soft); font-size: 14px; }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Lo que reportan los clientes desde su cuenta</p><h1>Ayuda a clientes</h1></div>
        <button class="b" (click)="cargar()" [disabled]="cargando()"><ion-icon name="refresh-outline"></ion-icon>Actualizar</button>
      </div>

      <div class="barra">
        <div class="tabs" role="tablist">
          <button type="button" role="tab" [class.on]="filtro() === 'abierta'" (click)="cambiar('abierta')">Por resolver@if (abiertas()) { <b>{{ abiertas() }}</b> }</button>
          <button type="button" role="tab" [class.on]="filtro() === 'resuelta'" (click)="cambiar('resuelta')">Resueltas</button>
          <button type="button" role="tab" [class.on]="filtro() === 'todas'" (click)="cambiar('todas')">Todas</button>
        </div>
      </div>

      @if (cargando() && !lista().length) {
        <app-skeleton variante="filas" [cantidad]="4"></app-skeleton>
      } @else if (lista().length) {
        <ul class="lista">
          @for (r of lista(); track r.id) {
            <li class="rep" [class.abierta]="r.estado === 'abierta'">
              <div class="cab">
                <app-avatar [nombre]="r.cliente" [foto]="r.avatar_url" [tam]="42"></app-avatar>
                <div class="quien"><strong>{{ r.cliente || 'Cliente' }}</strong><small>{{ tel(r) || r.email }} · {{ cuando(r.fecha) }}</small></div>
                <span class="estado" [class]="'estado ' + r.estado">{{ r.estado === 'abierta' ? 'Por resolver' : 'Resuelta' }}</span>
              </div>
              <p class="motivo">{{ r.motivo }}</p>
              @if (r.mensaje) { <p class="msj">"{{ r.mensaje }}"</p> }
              <div class="ped">
                @if (r.pedido_id) { <span>Pedido #{{ r.pedido_id }}</span> }
                @else if (r.pedido_web_id) { <a routerLink="../pedidos-web">Pedido de la tienda #{{ r.pedido_web_id }}</a> }
                @if (r.estado_pedido) { <span>{{ estadoPedido(r.estado_pedido) }}</span> }
                @if (r.total) { <span>{{ pesos(r.total) }}</span> }
                @if (r.barrio) { <span>{{ r.barrio }}</span> }
                @if (esAdmin() && r.vendedora) { <span>Vendedor: {{ r.vendedora }}</span> }
              </div>
              @if (r.productos_ped || r.productos_web) { <div class="ped"><span>{{ r.productos_ped || r.productos_web }}</span></div> }

              @if (r.estado === 'resuelta') {
                <p class="resp">{{ r.respuesta ? 'Le respondiste: "' + r.respuesta + '"' : 'Resuelta sin respuesta escrita' }}
                  <small>{{ r.resuelta_por || '' }}{{ r.resuelta_at ? ' · ' + cuando(r.resuelta_at) : '' }}</small></p>
              }

              @if (resolviendo() === r.id) {
                <textarea rows="2" maxlength="500" [(ngModel)]="respuesta" placeholder="Respuesta para el cliente (la ve en su pedido). Ej: Te cambiamos el producto mañana."></textarea>
                <div class="acc">
                  <button class="b b-ok" [disabled]="ocupado()" (click)="resolver(r)"><ion-icon name="checkmark-circle-outline"></ion-icon>{{ ocupado() ? 'Guardando…' : 'Marcar resuelta' }}</button>
                  <button class="b" (click)="resolviendo.set(null)">Cancelar</button>
                </div>
              } @else {
                <div class="acc">
                  @if (whatsapp(r); as w) { <a class="b wa" [href]="w" target="_blank" rel="noopener"><ion-icon name="logo-whatsapp"></ion-icon>WhatsApp</a> }
                  @if (tel(r); as t) { <a class="b" [href]="'tel:' + t"><ion-icon name="call-outline"></ion-icon>Llamar</a> }
                  @if (r.estado === 'abierta') {
                    <button class="b b-ok" (click)="abrirResolver(r)"><ion-icon name="checkmark-circle-outline"></ion-icon>Resolver</button>
                  } @else {
                    <button class="b" (click)="reabrir(r)"><ion-icon name="arrow-undo-outline"></ion-icon>Reabrir</button>
                  }
                </div>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="vacio-txt">{{ filtro() === 'abierta' ? '¡Todo al día! No hay clientes esperando ayuda.' : 'No hay reportes aquí todavía.' }}</p>
      }
    </div>
  `,
})
export class AyudaClientesPage {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  lista = signal<Reporte[]>([]);
  cargando = signal(true);
  ocupado = signal(false);
  filtro = signal<'abierta' | 'resuelta' | 'todas'>('abierta');
  abiertas = signal(0);
  resolviendo = signal<number | null>(null);
  respuesta = '';
  esAdmin = signal(false);
  private perfil = this.sb.getCurrentProfile().then((p) => this.esAdmin.set(!!p && rolesDe(p).includes('admin')));
  pesos = pesos;

  constructor() {
    addIcons({ callOutline, checkmarkCircleOutline, helpBuoyOutline, logoWhatsapp, refreshOutline, arrowUndoOutline });
    void this.cargar();
  }

  cambiar(f: 'abierta' | 'resuelta' | 'todas'): void {
    this.filtro.set(f);
    this.resolviendo.set(null);
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const { data, error } = await this.sb.client.rpc('ayuda_clientes_lista', { p_estado: this.filtro() });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const l = (data as Reporte[]) ?? [];
    this.lista.set(l);
    if (this.filtro() === 'abierta') this.abiertas.set(l.length);
    else void this.sb.client.rpc('ayuda_clientes_lista', { p_estado: 'abierta' }).then(({ data: d }) => this.abiertas.set(((d as Reporte[]) ?? []).length));
  }

  abrirResolver(r: Reporte): void {
    this.respuesta = '';
    this.resolviendo.set(r.id);
  }

  async resolver(r: Reporte): Promise<void> {
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('ayuda_cliente_resolver', { p_id: r.id, p_respuesta: this.respuesta.trim() });
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.resolviendo.set(null);
    this.toast.ok('Resuelta: el cliente lo ve en su pedido');
    await this.cargar();
  }

  async reabrir(r: Reporte): Promise<void> {
    const { error } = await this.sb.client.rpc('ayuda_cliente_reabrir', { p_id: r.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Reabierta');
    await this.cargar();
  }

  tel(r: Reporte): string {
    const n = (r.telefono ?? '').replace(/\D/g, '');
    if (!n) return '';
    return (r.prefijo ?? '57') === '57' ? n : `+${r.prefijo}${n}`;
  }

  whatsapp(r: Reporte): string | null {
    const n = (r.telefono ?? '').replace(/\D/g, '');
    if (n.length < 7) return null;
    const num = (r.prefijo ?? '57') + n;
    const nombre = (r.cliente || '').trim().split(/\s+/)[0];
    const ped = r.pedido_id ? ` #${r.pedido_id}` : '';
    const txt = `Hola ${nombre}, te escribimos de Variedades JYB por lo que nos reportaste de tu pedido${ped}: "${r.motivo}".`;
    return `https://wa.me/${num}?text=${encodeURIComponent(txt)}`;
  }

  estadoPedido(e: string): string {
    const m: Record<string, string> = {
      por_pagar: 'Esperando pago', por_confirmar: 'Por confirmar', confirmado: 'Confirmado', cancelado: 'Cancelado',
      por_alistar: 'Por alistar', alistado: 'Alistado', despachado: 'En camino', entregado: 'Entregado',
    };
    return m[e] ?? e;
  }

  cuando(iso: string): string {
    const d = diaColombiaDe(iso);
    const hoy = hoyColombiaISO();
    if (d === hoy) return 'hoy ' + formatoHoraCO(iso);
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
