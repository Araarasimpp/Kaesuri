import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addCircleOutline, closeOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { PesosDirective } from '../../shared/pesos/pesos.directive';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoFechaCO, hoyColombiaISO } from '../../shared/fecha-colombia';
import { confirmar } from '../../shared/dialogo';

interface Cupon {
  id: number; codigo: string; descripcion: string | null; tipo: 'porcentaje' | 'valor'; valor: number; minimo: number;
  usos_max: number | null; usos: number; vence: string | null; activo: boolean; created_at: string; descontado: number; pedidos: number;
}

/** Cupones de descuento para el catálogo público (admin) */
@Component({
  selector: 'app-cupones',
  standalone: true,
  imports: [FormsModule, IonIcon, SkeletonComponent, PesosDirective],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 820px; }
      .lista { display: flex; flex-direction: column; gap: 10px; }
      .cupon { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .cupon.apagado { opacity: .6; }
      .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .codigo { font-family: var(--mono-font); font-size: 18px; font-weight: 800; letter-spacing: .04em; padding: 2px 10px; border: 2px dashed var(--accent); border-radius: 8px; color: var(--accent); }
      .valor { font-size: 20px; font-weight: 800; color: var(--efectivo-texto); }
      .det { margin: 0; font-size: 13.5px; color: var(--text-soft); }
      .estado { font-size: 12px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: var(--ok-wash); color: var(--efectivo-texto); }
      .estado.off { background: var(--surface-2); color: var(--text-muted); }
      .acc { display: flex; gap: 14px; flex-wrap: wrap; }
      .link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-size: 13.5px; text-decoration: underline; cursor: pointer; }
      .link.peligro { color: var(--danger); }
      .tipos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .tipos button { height: 40px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; cursor: pointer; }
      .tipos button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .check { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
      .check input { width: 18px; height: 18px; }
      .vacio-txt { margin: 0; padding: 24px 0; text-align: center; font-size: 14px; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Descuentos para el catálogo público</p><h1>Cupones</h1></div>
        <button class="b b-pri" (click)="abrir(null)"><ion-icon name="add-circle-outline"></ion-icon>Nuevo cupón</button>
      </div>
      <p class="ayuda" style="margin: 0">El cliente escribe el código al hacer su pedido en el catálogo y se le descuenta de los productos (no del domicilio). El descuento se reparte en los precios, así que la ganancia de la tienda y la comisión de el vendedor bajan en la misma proporción.</p>

      <div class="lista">
        @for (c of cupones(); track c.id) {
          <article class="cupon" [class.apagado]="!vigente(c)">
            <div class="cab">
              <span class="codigo">{{ c.codigo }}</span>
              <span class="estado" [class.off]="!vigente(c)">{{ estado(c) }}</span>
            </div>
            <span class="valor">{{ c.tipo === 'porcentaje' ? c.valor + '% de descuento' : pesos(c.valor) + ' de descuento' }}</span>
            <p class="det">
              {{ c.descripcion ? c.descripcion + ' · ' : '' }}{{ +c.minimo ? 'Compras desde ' + pesos(c.minimo) + ' · ' : '' }}{{ c.vence ? 'Vence el ' + fecha(c.vence) + ' · ' : 'Sin vencimiento · ' }}{{ c.usos }}{{ c.usos_max ? ' de ' + c.usos_max : '' }} usos
            </p>
            @if (c.pedidos) { <p class="det">{{ c.pedidos }} {{ c.pedidos === 1 ? 'pedido' : 'pedidos' }} con este cupón · {{ pesos(c.descontado) }} descontados</p> }
            <div class="acc">
              <button class="link" (click)="abrir(c)">Editar</button>
              <button class="link" (click)="alternar(c)">{{ c.activo ? 'Pausar' : 'Activar' }}</button>
              <button class="link" (click)="copiar(c)">Copiar mensaje para clientes</button>
              <button class="link peligro" (click)="eliminar(c)">Eliminar</button>
            </div>
          </article>
        } @empty {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="3"></app-skeleton> }
          @else { <p class="vacio-txt">Todavía no hay cupones. Toca "Nuevo cupón" para crear el primero (ej: BIENVENIDO10).</p> }
        }
      </div>
    </div>

    @if (editando(); as e) {
      <button class="velo" aria-label="Cerrar" (click)="editando.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-cup">
        <div class="hoja-head"><h2 id="t-cup">{{ e.id ? 'Editar cupón' : 'Nuevo cupón' }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="editando.set(null)"><ion-icon name="close-outline"></ion-icon></button></div>
        <div class="hoja-body">
          <div class="campo"><label for="cu-c">Código</label>
            <input id="cu-c" maxlength="30" autocapitalize="characters" [ngModel]="codigo" (ngModelChange)="codigo = $event.toUpperCase().replace(' ', '')" placeholder="Ej: BIENVENIDO10" /></div>
          <div class="campo"><span class="etq">Tipo de descuento</span>
            <div class="tipos">
              <button type="button" [class.on]="tipo() === 'porcentaje'" (click)="tipo.set('porcentaje')">Porcentaje (%)</button>
              <button type="button" [class.on]="tipo() === 'valor'" (click)="tipo.set('valor')">Valor fijo ($)</button>
            </div>
          </div>
          <div class="fila-campos">
            @if (tipo() === 'porcentaje') {
              <div class="campo"><label for="cu-v">Porcentaje</label><input id="cu-v" type="number" inputmode="numeric" min="1" max="90" [(ngModel)]="valor" placeholder="Ej: 10" /></div>
            } @else {
              <div class="campo"><label for="cu-v2">Descuento</label><input id="cu-v2" pesos [(ngModel)]="valor" placeholder="Ej: $ 5.000" /></div>
            }
            <div class="campo"><label for="cu-m">Compra mínima (opcional)</label><input id="cu-m" pesos [(ngModel)]="minimo" placeholder="$ 0" /></div>
          </div>
          <div class="fila-campos">
            <div class="campo"><label for="cu-u">Máximo de usos (opcional)</label><input id="cu-u" type="number" inputmode="numeric" min="1" [(ngModel)]="usosMax" placeholder="Sin límite" /></div>
            <div class="campo"><label for="cu-f">Vence (opcional)</label><input id="cu-f" type="date" [min]="hoy" [(ngModel)]="vence" /></div>
          </div>
          <div class="campo"><label for="cu-d">Descripción (opcional)</label><input id="cu-d" maxlength="120" [(ngModel)]="descripcion" placeholder="Ej: Primera compra" /></div>
          <label class="check"><input type="checkbox" [(ngModel)]="activo" />Activo</label>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="editando.set(null)">Cancelar</button>
          <button class="b b-pri" [disabled]="ocupado()" (click)="guardar()">{{ ocupado() ? 'Guardando…' : 'Guardar cupón' }}</button>
        </div>
      </div>
    }
  `,
})
export class CuponesPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  cupones = signal<Cupon[]>([]);
  cargando = signal(true);
  ocupado = signal(false);
  error = signal('');
  editando = signal<{ id: number | null } | null>(null);
  pesos = pesos;
  hoy = hoyColombiaISO();
  codigo = '';
  tipo = signal<'porcentaje' | 'valor'>('porcentaje');
  valor: number | null = null;
  minimo: number | null = null;
  usosMax: number | null = null;
  vence = '';
  descripcion = '';
  activo = true;

  constructor() {
    addIcons({ addCircleOutline, closeOutline });
  }

  ngOnInit(): void {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('cupones_lista');
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.cupones.set((data ?? []) as Cupon[]);
  }

  vigente(c: Cupon): boolean {
    return c.activo && (!c.vence || c.vence >= this.hoy) && (!c.usos_max || c.usos < c.usos_max);
  }

  estado(c: Cupon): string {
    if (!c.activo) return 'Pausado';
    if (c.vence && c.vence < this.hoy) return 'Vencido';
    if (c.usos_max && c.usos >= c.usos_max) return 'Agotado';
    return 'Activo';
  }

  abrir(c: Cupon | null): void {
    this.error.set('');
    this.codigo = c?.codigo ?? '';
    this.tipo.set(c?.tipo ?? 'porcentaje');
    this.valor = c ? Number(c.valor) : null;
    this.minimo = c && +c.minimo ? Number(c.minimo) : null;
    this.usosMax = c?.usos_max ?? null;
    this.vence = c?.vence ?? '';
    this.descripcion = c?.descripcion ?? '';
    this.activo = c?.activo ?? true;
    this.editando.set({ id: c?.id ?? null });
  }

  async guardar(): Promise<void> {
    if (!/^[A-Z0-9_-]{3,30}$/.test(this.codigo)) return this.error.set('El código va de 3 a 30 letras o números, sin espacios.');
    if (!(Number(this.valor) > 0)) return this.error.set('Escribe el descuento.');
    if (this.tipo() === 'porcentaje' && Number(this.valor) > 90) return this.error.set('El porcentaje máximo es 90%.');
    this.ocupado.set(true);
    const { error } = await this.sb.client.rpc('guardar_cupon', {
      p_id: this.editando()?.id ?? null, p_codigo: this.codigo, p_descripcion: this.descripcion.trim(), p_tipo: this.tipo(), p_valor: Number(this.valor),
      p_minimo: Number(this.minimo) || 0, p_usos_max: Number(this.usosMax) > 0 ? Math.round(Number(this.usosMax)) : null, p_vence: this.vence || null, p_activo: this.activo,
    });
    this.ocupado.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.toast.ok(`Cupón ${this.codigo} guardado`);
    this.editando.set(null);
    await this.cargar();
  }

  async alternar(c: Cupon): Promise<void> {
    const { error } = await this.sb.client.rpc('guardar_cupon', {
      p_id: c.id, p_codigo: c.codigo, p_descripcion: c.descripcion ?? '', p_tipo: c.tipo, p_valor: Number(c.valor), p_minimo: Number(c.minimo),
      p_usos_max: c.usos_max, p_vence: c.vence, p_activo: !c.activo,
    });
    if (error) return this.toast.error(mensajeError(error));
    await this.cargar();
  }

  async eliminar(c: Cupon): Promise<void> {
    if (!(await confirmar(`¿Eliminar el cupón ${c.codigo}? Los pedidos que ya lo usaron no cambian.`, { titulo: 'Eliminar cupón', aceptar: 'Eliminar', cancelar: 'Volver', peligro: true }))) return;
    const { error } = await this.sb.client.rpc('eliminar_cupon', { p_id: c.id });
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok('Cupón eliminado');
    await this.cargar();
  }

  async copiar(c: Cupon): Promise<void> {
    const desc = c.tipo === 'porcentaje' ? `${c.valor}% de descuento` : `${pesos(c.valor)} de descuento`;
    const txt = `🎟️ Usa el cupón ${c.codigo} y obtén ${desc} en tu compra${+c.minimo ? ` desde ${pesos(c.minimo)}` : ''} en nuestro catálogo: ${location.origin}/tienda`
      + (c.vence ? ` (válido hasta el ${this.fecha(c.vence)})` : '');
    try {
      await navigator.clipboard.writeText(txt);
      this.toast.ok('Mensaje copiado');
    } catch {
      this.toast.error('No se pudo copiar');
    }
  }

  fecha(d: string): string {
    return formatoFechaCO(d + 'T12:00:00-05:00', { day: 'numeric', month: 'long' });
  }
}
