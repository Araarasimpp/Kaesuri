import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Profile, SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { confirmar } from '../../shared/dialogo';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoFechaCO, formatoHoraCO } from '../../shared/fecha-colombia';
import { enlaceWhatsapp } from '../../shared/whatsapp';
import { EstadisticasTiendaComponent } from './estadisticas-tienda.component';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { EnlacesProductosComponent } from './enlaces-productos.component';

interface Riesgo {
  nivel: 'alto' | 'medio' | null; pedidos: number; entregados: number; rechazados: number; novedades: number; devoluciones: number;
  marca: { nota: string; autor: string | null } | null;
}
interface ItemWeb { producto_id: string; nombre: string; cantidad: number; precio: number; color: string | null; talla: string | null }
interface PedidoWeb {
  id: number; estado: 'por_confirmar' | 'confirmado' | 'cancelado'; vendedora: string | null;
  cliente_nombre: string; cliente_telefono: string; direccion: string; barrio: string; observaciones: string | null;
  valor_domicilio: number; domicilio_por_confirmar: boolean; items: ItemWeb[]; subtotal: number; pedido_id: string | null; numero: number | null;
  motivo: string | null; atendido_por: string | null; atendido_at: string | null; created_at: string; riesgo: Riesgo | null;
}

/** Enlace de la tienda: /tienda/<primer nombre>-<primeros 8 caracteres del id> */
export function enlaceTienda(u: { id: string; nombre: string | null } | null): string {
  if (!u) return location.origin + '/tienda';
  const nombre = (u.nombre ?? '').trim().split(/\s+/)[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${location.origin}/tienda/${nombre ? nombre + '-' : ''}${u.id.slice(0, 8)}`;
}

/**
 * Pedidos que llegan del catálogo público. El vendedor (o el admin) llama al cliente,
 * y lo confirma (se crea el pedido normal y sigue a alistamiento) o lo cancela.
 */
@Component({
  selector: 'app-pedidos-web',
  standalone: true,
  imports: [EnlacesProductosComponent, SkeletonComponent, FormsModule, EstadisticasTiendaComponent],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 860px; }
      .enlace { display: flex; flex-direction: column; gap: 10px; }
      .enlace code { display: block; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13.5px; word-break: break-all; }
      .acciones { display: flex; gap: 8px; flex-wrap: wrap; }
      .lista { display: flex; flex-direction: column; gap: 12px; }
      .pw { display: flex; flex-direction: column; gap: 8px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .pw.atendido { opacity: .78; }
      .cab { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
      .cab strong { font-size: 16px; }
      .cab small, .meta { display: block; font-size: 12.5px; color: var(--text-muted); }
      .est { flex-shrink: 0; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; background: var(--oro-wash); color: var(--oro-texto); }
      .est.confirmado { background: var(--ok-wash); color: var(--efectivo-texto); }
      .est.cancelado { background: var(--danger-wash); color: var(--danger); }
      .dir { margin: 0; font-size: 14px; }
      .items { list-style: none; margin: 0; padding: 0; font-size: 14px; }
      .items li { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; }
      .items small { color: var(--text-muted); }
      .tot { display: flex; justify-content: space-between; padding-top: 6px; border-top: var(--perfora); font-weight: 700; }
      .tot .num { font-family: var(--mono-font); }
      .riesgo { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--oro-wash); color: var(--oro-texto); font-size: 13px; }
      .riesgo.alto { background: var(--danger-wash); color: var(--danger); }
      .obs { margin: 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13.5px; }
      .check { display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; line-height: 1.4; }
      .check input { margin-top: 3px; }
      .vacio-txt { margin: 0; padding: 20px 0; text-align: center; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Lo que piden los clientes en el catálogo</p><h1>Pedidos de la tienda</h1></div>
      </div>

      <section class="panel enlace">
        <h2 class="seccion-titulo">{{ esVendedor() ? 'Tu enlace de la tienda' : 'Enlace general de la tienda' }}</h2>
        <code>{{ enlace() }}</code>
        <div class="acciones">
          <button class="b b-pri" (click)="compartir()">Compartir enlace</button>
          <button class="b" (click)="copiar()">Copiar</button>
          <a class="b" [href]="enlace()" target="_blank" rel="noopener">Ver como cliente</a>
        </div>
        <p class="ayuda" style="margin: 0">{{ esVendedor()
          ? 'Compártelo en tus estados, Instagram o grupos. Lo que pidan por ahí te llega aquí a tu nombre, con tu comisión normal.'
          : 'Los pedidos de este enlace llegan sin vendedor y los atiende el admin. Cada vendedor ve el suyo en esta misma página.' }}</p>
      </section>

      <section class="panel">
        <app-enlaces-productos [base]="enlace()"></app-enlaces-productos>
      </section>

      <app-estadisticas-tienda></app-estadisticas-tienda>

      @if (porConfirmar().length) {
        <h2 class="seccion-titulo">Por confirmar ({{ porConfirmar().length }})</h2>
      }
      <div class="lista">
        @for (w of lista(); track w.id) {
          <article class="pw" [class.atendido]="w.estado !== 'por_confirmar'">
            <div class="cab">
              <span><strong>{{ w.cliente_nombre }}</strong>
                <small>{{ cuando(w.created_at) }}{{ w.vendedora && !esVendedor() ? ' · catálogo de ' + w.vendedora : !w.vendedora ? ' · catálogo general' : '' }}</small></span>
              <span [class]="'est ' + w.estado">{{ estadoTxt(w.estado) }}</span>
            </div>
            @if (w.riesgo?.nivel) {
              <div class="riesgo" [class.alto]="w.riesgo!.nivel === 'alto'">
                <strong>⚠️ {{ w.riesgo!.marca ? 'Cliente marcado: "' + w.riesgo!.marca!.nota + '"' : 'Este cliente ha tenido problemas' }}</strong>
                <span>{{ w.riesgo!.rechazados }} cancelados después de salir · {{ w.riesgo!.devoluciones }} devoluciones · {{ w.riesgo!.entregados }} de {{ w.riesgo!.pedidos }} entregados</span>
              </div>
            }
            <p class="dir"><a [href]="'tel:' + w.cliente_telefono">{{ w.cliente_telefono }}</a> · {{ w.direccion }} · <strong>{{ w.barrio }}</strong></p>
            @if (w.observaciones) { <p class="obs">"{{ w.observaciones }}"</p> }
            <ul class="items">
              @for (i of w.items; track $index) {
                <li><span>{{ i.cantidad }} × {{ i.nombre }}@if (i.color || i.talla) { <small> · {{ variante(i) }}</small> }</span><span class="num">{{ pesos(i.precio * i.cantidad) }}</span></li>
              }
              <li><span>Domicilio</span><span class="num">{{ w.domicilio_por_confirmar && w.estado === 'por_confirmar' ? 'Por definir' : pesos(w.valor_domicilio) }}</span></li>
            </ul>
            <div class="tot"><span>Total</span><span class="num">{{ pesos(+w.subtotal + +w.valor_domicilio) }}</span></div>

            @if (w.estado === 'por_confirmar') {
              <div class="acciones">
                <a class="b" [href]="whatsapp(w)" target="_blank" rel="noopener">WhatsApp</a>
                <a class="b" [href]="'tel:' + w.cliente_telefono">Llamar</a>
                <button class="b" (click)="abrirCancelar(w)">Cancelar</button>
                <button class="b b-pri" (click)="abrirConfirmar(w)">Confirmar</button>
              </div>
            } @else if (w.estado === 'confirmado') {
              <span class="meta">Confirmado por {{ w.atendido_por }} · <strong>Pedido #{{ w.numero }}</strong></span>
            } @else {
              <span class="meta">Cancelado por {{ w.atendido_por }}: {{ w.motivo }}</span>
            }
          </article>
        } @empty {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="3"></app-skeleton> } @else { <p class="vacio-txt">{{ 'Todavía no han llegado pedidos de la tienda. Comparte tu enlace para empezar.' }}</p> }
        }
      </div>
    </div>

    @if (accion(); as a) {
      <button class="velo" aria-label="Cerrar" (click)="accion.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-acc">
        <div class="hoja-head"><h2 id="t-acc">{{ a.tipo === 'confirmar' ? 'Confirmar pedido' : 'Cancelar pedido' }} de {{ a.w.cliente_nombre }}</h2></div>
        <div class="hoja-body">
          @if (a.tipo === 'confirmar') {
            <p class="ayuda" style="margin: 0">Confírmalo solo después de hablar con el cliente. Al confirmar, el pedido pasa a Pedidos por alistar a tu nombre.</p>
            <div class="campo"><label for="pw-dom">Domicilio{{ a.w.domicilio_por_confirmar ? ' (su barrio no está en la tabla)' : '' }}</label>
              <input id="pw-dom" type="number" inputmode="numeric" min="0" step="1000" [(ngModel)]="domicilio" [placeholder]="a.w.domicilio_por_confirmar ? 'Escribe lo que vas a cobrar' : ''" /></div>
            @if (a.w.domicilio_por_confirmar) {
              <p class="ayuda" style="margin: 0">El cliente escribió el barrio <strong>{{ a.w.barrio }}</strong>, que no está en la tabla de domicilios. Pregúntale bien dónde queda y cobra lo que corresponda.</p>
              <label class="check"><input type="checkbox" [(ngModel)]="guardarBarrio" />
                {{ esAdmin() ? 'Guardar "' + a.w.barrio + '" en la tabla de domicilios con este valor' : 'Pedirle al admin que agregue "' + a.w.barrio + '" a la tabla con este valor' }}</label>
            }
            <div class="campo"><label for="pw-nota">Nota para alistamiento (opcional)</label>
              <input id="pw-nota" maxlength="200" [(ngModel)]="nota" placeholder="Ej: confirmado, entregar después de las 4 pm" /></div>
          } @else {
            <div class="campo"><label for="pw-mot">¿Por qué se cancela?</label>
              <input id="pw-mot" maxlength="200" [(ngModel)]="motivo" placeholder="Ej: no contestó, pedido de broma, ya no lo quiere" /></div>
          }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="accion.set(null)">Volver</button>
          <button class="b b-pri" (click)="hacer()" [disabled]="ocupado()">{{ ocupado() ? 'Guardando…' : a.tipo === 'confirmar' ? 'Confirmar pedido' : 'Cancelar pedido' }}</button>
        </div>
      </div>
    }
  `,
})
export class PedidosWebPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  lista = signal<PedidoWeb[]>([]);
  cargando = signal(true);
  ocupado = signal(false);
  accion = signal<{ tipo: 'confirmar' | 'cancelar'; w: PedidoWeb } | null>(null);
  domicilio: number | null = null;
  guardarBarrio = true;
  esAdmin = signal(false);
  nota = '';
  motivo = '';
  pesos = pesos;

  esVendedor = signal(false);
  private yo = signal<Profile | null>(null);
  porConfirmar = computed(() => this.lista().filter((w) => w.estado === 'por_confirmar'));
  enlace = computed(() => {
    const u = this.yo();
    return enlaceTienda(this.esVendedor() && u ? { id: u.id, nombre: u.nombre } : null);
  });

  ngOnInit(): void {
    void this.sb.getCurrentProfile().then((p) => {
      const roles = p ? rolesDe(p) : [];
      this.yo.set(p);
      this.esAdmin.set(roles.includes('admin'));
      this.esVendedor.set(roles.includes('vendedor') && !roles.includes('admin'));
    });
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('pedidos_web_lista');
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.lista.set((data ?? []) as PedidoWeb[]);
  }

  async compartir(): Promise<void> {
    const url = this.enlace();
    const texto = 'Mira el catálogo y haz tu pedido aquí 👇';
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Catálogo', text: texto, url });
        return;
      } catch {
        /* lo cerró: se copia */
      }
    }
    await this.copiar();
  }

  async copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.enlace());
      this.toast.ok('Enlace copiado');
    } catch {
      this.toast.error('No se pudo copiar: mantén presionado el enlace para copiarlo');
    }
  }

  abrirConfirmar(w: PedidoWeb): void {
    this.domicilio = Number(w.valor_domicilio) || null;
    this.guardarBarrio = true;
    this.nota = '';
    this.accion.set({ tipo: 'confirmar', w });
  }

  abrirCancelar(w: PedidoWeb): void {
    this.motivo = '';
    this.accion.set({ tipo: 'cancelar', w });
  }

  async hacer(): Promise<void> {
    const a = this.accion();
    if (!a) return;
    if (a.tipo === 'cancelar' && !this.motivo.trim()) return this.toast.error('Escribe por qué se cancela');
    if (a.tipo === 'confirmar' && a.w.domicilio_por_confirmar && !(Number(this.domicilio) > 0)
        && !(await confirmar('No escribiste el valor del domicilio. ¿Confirmar el pedido sin domicilio?', { aceptar: 'Confirmar sin domicilio' }))) return;
    this.ocupado.set(true);
    const r = a.tipo === 'confirmar'
      ? await this.sb.client.rpc('confirmar_pedido_web', { p_id: a.w.id, p_domicilio: Number(this.domicilio) || 0, p_nota: this.nota.trim(), p_guardar_barrio: this.guardarBarrio && Number(this.domicilio) > 0 })
      : await this.sb.client.rpc('cancelar_pedido_web', { p_id: a.w.id, p_motivo: this.motivo.trim() });
    this.ocupado.set(false);
    if (r.error) return this.toast.error(mensajeError(r.error));
    this.toast.ok(a.tipo === 'confirmar' ? `Listo: quedó como pedido #${r.data} por alistar` : 'Pedido cancelado');
    this.accion.set(null);
    await this.cargar();
  }

  whatsapp(w: PedidoWeb): string {
    const nombre = w.cliente_nombre.split(' ')[0];
    const prods = w.items.map((i) => `${i.cantidad} ${i.nombre}`).join(', ');
    const total = pesos(Number(w.subtotal) + Number(w.valor_domicilio));
    return enlaceWhatsapp(w.cliente_telefono,
      `Hola ${nombre}, recibimos tu pedido del catálogo: ${prods}. Total ${total}${w.domicilio_por_confirmar ? ' más el domicilio' : ' con domicilio'}, para entregar en ${w.direccion} (${w.barrio}). ¿Te lo confirmo?`);
  }

  variante(i: ItemWeb): string {
    return [i.color, i.talla].filter((x) => !!x).join(' · ');
  }

  estadoTxt(e: string): string {
    return { por_confirmar: 'Por confirmar', confirmado: 'Confirmado', cancelado: 'Cancelado' }[e] ?? e;
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
