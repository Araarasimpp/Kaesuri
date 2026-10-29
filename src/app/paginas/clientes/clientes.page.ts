import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { searchOutline, closeOutline, logoWhatsapp } from 'ionicons/icons';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError, numero, pesos } from '../../shared/formato';
import { formatoFechaCO } from '../../shared/fecha-colombia';
import { enlaceWhatsapp, mensajeSeguimiento } from '../../shared/whatsapp';

/** Una compra entregada del cliente (de la función compras_cliente) */
interface Compra { id: string; numero: number; created_at: string; total: number; vendedor: string | null; productos: string[] }

interface Cliente {
  telefono: string; nombre: string; barrio: string | null; direccion: string | null;
  pedidos: number; entregados: number; total: number; ultimo: string; total_filas: number;
}

/** Clientes armados a partir de los pedidos entregados (agrupados por teléfono). Copiado de Jasta. */
@Component({
  selector: 'app-clientes',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon],
  styles: [
    `
      .tabla td { white-space: nowrap; }
      .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .lista li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-soft); font-size: 13px; }
      .lista small { display: block; color: var(--text-muted); font-size: 12px; }
      .marca { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: var(--danger-wash); color: var(--danger);
        font-size: 11px; font-weight: 700; vertical-align: 1px; }
      .alerta { padding: 10px 12px; border-radius: var(--radius-sm); background: var(--danger-wash); color: var(--danger); font-size: 13.5px; }
      .alerta textarea { width: 100%; box-sizing: border-box; margin-top: 8px; }
    `,
  ],
  template: `
    <div class="vista">
      <div class="vista-head">
        <h1>Clientes <small class="num">{{ numero(total()) }}</small></h1>
        <label class="buscar">
          <ion-icon name="search-outline"></ion-icon>
          <input type="search" placeholder="Nombre, teléfono o barrio" [(ngModel)]="q" (ngModelChange)="buscarLuego()" />
        </label>
      </div>
      <div class="tabla-wrap">
        <table class="tabla tarjetas-cel">
          <thead><tr><th>Cliente</th><th>Teléfono</th><th>Barrio</th><th class="der">Compras</th><th class="der">Comprado</th><th>Última compra</th></tr></thead>
          <tbody>
            @for (c of clientes(); track c.telefono) {
              <tr class="click" (click)="abrir(c)">
                <td class="titulo">{{ c.nombre }}@if (marcaDe(c); as m) { <span class="marca" [title]="m.nota">⚠ Marcado</span> }</td>
                <td class="num" data-etq="Teléfono">{{ c.telefono }}</td>
                <td class="suave corta" data-etq="Barrio">{{ c.barrio || '—' }}</td>
                <td class="der num" data-etq="Compras">{{ c.entregados }}</td>
                <td class="der num" data-etq="Comprado">{{ pesos(c.total) }}</td>
                <td class="suave" data-etq="Última compra">{{ fecha(c.ultimo) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="suave">{{ cargando() ? 'Cargando…' : 'No hay clientes con esa búsqueda.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (total() > 50) {
        <div class="paginar">
          <span class="num">{{ pagina() * 50 + 1 }}–{{ min((pagina() + 1) * 50, total()) }} de {{ numero(total()) }}</span>
          <span style="display: flex; gap: 8px">
            <button class="b" [disabled]="pagina() === 0" (click)="ir(pagina() - 1)">Anterior</button>
            <button class="b" [disabled]="(pagina() + 1) * 50 >= total()" (click)="ir(pagina() + 1)">Siguiente</button>
          </span>
        </div>
      }
      <div class="vista-body"><p class="ayuda">Solo aparecen los clientes que ya recibieron al menos un pedido. "Compras" y "Comprado" cuentan solo los pedidos entregados.</p></div>
    </div>

    @if (sel(); as c) {
      <button class="velo" aria-label="Cerrar" (click)="sel.set(null)"></button>
      <aside class="hoja" role="dialog" aria-labelledby="t-cli">
        <div class="hoja-head">
          <h2 id="t-cli">{{ c.nombre }}</h2>
          <button class="b b-icono" aria-label="Cerrar" (click)="sel.set(null)"><ion-icon name="close-outline"></ion-icon></button>
        </div>
        <div class="hoja-body">
          <dl class="datos">
            <dt>Teléfono</dt><dd><a [href]="'tel:' + c.telefono">{{ c.telefono }}</a></dd>
            <dt>Dirección</dt><dd>{{ c.direccion || '—' }}</dd>
            <dt>Barrio</dt><dd>{{ c.barrio || '—' }}</dd>
            <dt>Compras</dt><dd>{{ c.entregados }} entregadas · {{ pesos(c.total) }}</dd>
          </dl>
          <a class="b" [href]="whatsapp(c)" target="_blank" rel="noopener"><ion-icon name="logo-whatsapp"></ion-icon>Escribir por WhatsApp</a>
          <!-- Marca del admin: sale como alerta al escribir su teléfono en Nuevo pedido -->
          @if (marcaDe(c); as m) {
            <p class="alerta"><strong>⚠ Cliente marcado</strong><br />"{{ m.nota }}"{{ m.autor ? ' — ' + m.autor : '' }}</p>
          }
          @if (esAdmin()) {
            @if (editandoMarca()) {
              <div class="campo">
                <label for="cli-marca">Por qué hay que tener cuidado con este cliente</label>
                <textarea id="cli-marca" rows="2" maxlength="300" [(ngModel)]="notaMarca" placeholder="Ej: no recibió dos pedidos, pide y cancela"></textarea>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap">
                <button class="b b-pri" (click)="guardarMarca(c)" [disabled]="guardandoMarca()">Guardar</button>
                @if (marcaDe(c)) { <button class="b" (click)="notaMarca = ''; guardarMarca(c)" [disabled]="guardandoMarca()">Quitar marca</button> }
                <button class="b" (click)="editandoMarca.set(false)">Cancelar</button>
              </div>
            } @else {
              <button class="b" (click)="notaMarca = marcaDe(c)?.nota ?? ''; editandoMarca.set(true)">{{ marcaDe(c) ? 'Cambiar la marca' : 'Marcar como cliente problemático' }}</button>
            }
          }
          <section>
            <h3 class="seccion-titulo">Lo que ha comprado</h3>
            <ul class="lista">
              @for (p of pedidosCli(); track p.id) {
                <li>
                  <span>#{{ p.numero }} · {{ fecha(p.created_at) }}<small>{{ p.vendedor || 'Sin vendedor' }}</small>
                    @if (p.productos.length) { <small>{{ p.productos.join(', ') }}</small> }</span>
                  <span class="num">{{ pesos(p.total) }}</span>
                </li>
              } @empty {
                <li class="suave">{{ cargandoCli() ? 'Cargando…' : 'Sin compras entregadas.' }}</li>
              }
            </ul>
          </section>
        </div>
      </aside>
    }
  `,
})
export class ClientesPage implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  clientes = signal<Cliente[]>([]);
  total = signal(0);
  pagina = signal(0);
  cargando = signal(true);
  sel = signal<Cliente | null>(null);
  pedidosCli = signal<Compra[]>([]);
  cargandoCli = signal(false);
  q = '';
  /** Clientes marcados por el admin (por los últimos 10 dígitos del teléfono) */
  marcas = signal<Record<string, { nota: string; autor: string | null }>>({});
  esAdmin = signal(false);
  editandoMarca = signal(false);
  guardandoMarca = signal(false);
  notaMarca = '';
  private timer?: ReturnType<typeof setTimeout>;

  pesos = pesos;
  numero = numero;
  min = Math.min;

  constructor() {
    addIcons({ searchOutline, closeOutline, logoWhatsapp });
  }

  ngOnInit(): void {
    void this.ir(0);
    void this.cargarMarcas();
    void this.sb.getCurrentProfile().then((p) => this.esAdmin.set(!!p && rolesDe(p).includes('admin')));
  }

  private async cargarMarcas(): Promise<void> {
    const { data } = await this.sb.client.rpc('clientes_marcados');
    if (data) this.marcas.set(data as Record<string, { nota: string; autor: string | null }>);
  }

  marcaDe(c: Cliente): { nota: string; autor: string | null } | null {
    return this.marcas()[c.telefono.replace(/\D/g, '').slice(-10)] ?? null;
  }

  async guardarMarca(c: Cliente): Promise<void> {
    this.guardandoMarca.set(true);
    const { error } = await this.sb.client.rpc('marcar_cliente', { p_telefono: c.telefono, p_nota: this.notaMarca.trim() });
    this.guardandoMarca.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(this.notaMarca.trim() ? 'Cliente marcado: saldrá la alerta en Nuevo pedido' : 'Marca quitada');
    this.editandoMarca.set(false);
    await this.cargarMarcas();
  }

  buscarLuego(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ir(0), 350);
  }

  async ir(n: number): Promise<void> {
    this.pagina.set(n);
    this.cargando.set(true);
    const { data, error } = await this.sb.client.rpc('clientes', { p_buscar: this.q || null, p_limite: 50, p_desde: n * 50 });
    this.cargando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const filas = (data ?? []) as Cliente[];
    this.clientes.set(filas);
    this.total.set(filas[0]?.total_filas ?? 0);
  }

  async abrir(c: Cliente): Promise<void> {
    this.sel.set(c);
    this.editandoMarca.set(false);
    this.pedidosCli.set([]);
    this.cargandoCli.set(true);
    // Solo lo que de verdad recibió (sin cancelados ni pendientes), a domicilio y en el local
    const { data, error } = await this.sb.client.rpc('compras_cliente', { p_telefono: c.telefono });
    this.cargandoCli.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.pedidosCli.set((data ?? []) as Compra[]);
  }

  /** Mensaje de seguimiento con lo que compró en su último pedido entregado */
  whatsapp(c: Cliente): string {
    const pedidos = this.pedidosCli();
    const productos = pedidos[0]?.productos ?? [];
    return enlaceWhatsapp(c.telefono, mensajeSeguimiento(c.nombre, productos));
  }

  fecha(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}
