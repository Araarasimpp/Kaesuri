import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../core/services/supabase.service';
import { pesos } from '../shared/formato';
import { formatoFechaCO, formatoHoraCO } from '../shared/fecha-colombia';

interface Seguimiento {
  id: number;
  /** Kaesuri lo manda como booleano; se pasa a canal al cargar */
  local?: boolean;
  canal?: 'domicilio' | 'local';
  garantia?: string | null;
  estado: 'por_alistar' | 'alistado' | 'despachado' | 'entregado' | 'cancelado';
  creado_at: string;
  alistado_at: string | null;
  en_ruta_at: string | null;
  entregado_at: string | null;
  cliente: string;
  barrio: string | null;
  total: number;
  domicilio: number;
  mensajero: string | null;
  novedad: string | null;
  novedad_at: string | null;
  vendedora: string | null;
  vendedora_telefono: string | null;
  negocio: string | null;
  telefonos: string | null;
  items: { nombre: string; cantidad: number; color: string | null; talla: string | null }[];
  calificacion: { estrellas: number; comentario: string | null } | null;
}

/**
 * Página pública del pedido (sin iniciar sesión), como en Jasta: el cliente abre el enlace
 * que le mandó el vendedor y ve en qué va su pedido. Se actualiza sola cada minuto.
 */
@Component({
  selector: 'app-seguimiento',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule],
  styles: [
    `
      /* Ionic deja el body fijo y sin desplazamiento: la página pública es su propio contenedor con scroll */
      :host { display: block; position: absolute; inset: 0; height: 100vh; height: 100dvh; overflow-x: hidden; overflow-y: auto;
        overscroll-behavior-y: contain; background: var(--bg); color: var(--text); }
      .caja { max-width: 520px; margin: 0 auto; padding: calc(20px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; }
      .marca { display: flex; align-items: center; gap: 10px; }
      .marca img { width: 40px; height: 40px; border-radius: 10px; background: #fff; object-fit: contain; }
      .marca strong { font-size: 16px; }
      .marca small { display: block; font-size: 12px; color: var(--text-muted); }
      .tarjeta { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      h1 { margin: 0; font-size: 22px; line-height: 1.25; }
      .sub { margin: 4px 0 0; font-size: 14px; color: var(--text-soft); }
      .estado { display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 6px 12px; border-radius: 999px; font-size: 14px; font-weight: 700;
        background: var(--accent-wash); color: var(--accent); }
      .estado.entregado { background: var(--ok-wash); color: var(--efectivo-texto); }
      .estado.cancelado { background: var(--danger-wash); color: var(--danger); }
      .pasos { list-style: none; margin: 0; padding: 0; }
      .paso { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; padding-bottom: 18px; }
      .paso:last-child { padding-bottom: 0; }
      .paso::before { content: ''; position: absolute; left: 13px; top: 28px; bottom: 0; width: 2px; background: var(--border); }
      .paso:last-child::before { display: none; }
      .paso.hecho::before { background: var(--oro); }
      .punto { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; border: 2px solid var(--border-strong); background: var(--surface);
        font-size: 14px; color: var(--text-muted); z-index: 1; }
      .paso.hecho .punto { border-color: var(--oro); background: var(--oro); color: #1a1408; }
      .paso.actual .punto { border-color: var(--oro); color: var(--oro); box-shadow: 0 0 0 5px var(--oro-wash); }
      .paso strong { display: block; font-size: 15px; }
      .paso small { display: block; margin-top: 2px; font-size: 13px; color: var(--text-soft); }
      .paso:not(.hecho):not(.actual) strong { color: var(--text-muted); font-weight: 550; }
      .novedad { padding: 12px 14px; border-radius: var(--radius); background: var(--oro-wash); color: var(--oro-texto); font-size: 14px; line-height: 1.4; }
      .novedad strong { display: block; }
      .items { list-style: none; margin: 0; padding: 0; }
      .items li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: var(--perfora); font-size: 14px; }
      .items li:last-child { border-bottom: 0; }
      .items small { color: var(--text-muted); }
      .total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 10px; font-size: 15px; font-weight: 650; }
      .total strong { font-family: var(--mono-font); font-size: 20px; }
      .total-nota { margin: 2px 0 0; font-size: 12.5px; color: var(--text-muted); }
      h2 { margin: 0 0 8px; font-size: 13px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
      .contacto { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .contacto a { display: flex; align-items: center; justify-content: center; height: 48px; border-radius: var(--radius); font-size: 15px; font-weight: 650; text-decoration: none; }
      .wa { background: #25d366; color: #fff; }
      .tel { border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); }
      .solo { grid-column: 1 / -1; }
      .vacio { padding: 40px 18px; text-align: center; color: var(--text-soft); }
      .vacio strong { display: block; margin-bottom: 6px; font-size: 18px; color: var(--text); }
      .pie { text-align: center; font-size: 12px; color: var(--text-muted); }
      .califica { display: flex; flex-direction: column; }
      .garantia h2 { margin-bottom: 2px; }
      .garantia-txt { margin: 10px 0 0; padding: 10px 12px; border-radius: var(--radius); background: var(--ok-wash); color: var(--efectivo-texto); font-size: 14px; font-weight: 600; line-height: 1.45; }
      .garantia-nota { margin: 10px 0 0; font-size: 13px; color: var(--text-muted); line-height: 1.45; }
      .estrellas { display: flex; gap: 6px; }
      .estrellas button, .estrellas span { width: 48px; height: 48px; display: grid; place-items: center; padding: 0; border: 0; background: none;
        font-size: 38px; line-height: 1; color: var(--border-strong); cursor: pointer; transition: transform 160ms var(--ease), color 160ms var(--ease); }
      .estrellas button:active { transform: scale(.88); }
      .estrellas .on { color: var(--oro); }
      .estrellas.fijas span { width: 34px; height: 34px; font-size: 28px; cursor: default; }
      .califica textarea { margin-top: 12px; width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: var(--surface); color: var(--text); font: inherit; font-size: 16px; resize: vertical; }
      .enviar { margin-top: 10px; height: 46px; border: 0; border-radius: var(--radius); background: var(--accent); color: #fff; font: inherit; font-size: 15px; font-weight: 650; cursor: pointer; }
      .enviar:disabled { opacity: .6; }
      .gracias { margin: 8px 0 0; font-size: 14px; color: var(--text-soft); line-height: 1.45; }
      .error-cal { margin: 8px 0 0; font-size: 13px; color: var(--danger); }
    `,
  ],
  template: `
    <div class="caja">
      <div class="marca">
        <img src="assets/icon/logo.png" alt="" />
        <div><strong>{{ s()?.negocio || 'Variedades JYB' }}</strong><small>{{ s()?.canal === 'local' ? 'Tu compra' : 'Seguimiento de tu pedido' }}</small></div>
      </div>

      @if (s(); as p) {
        <section class="tarjeta">
          @if (p.canal === 'local') {
            <h1>{{ p.cliente && p.cliente !== 'Cliente' ? 'Hola ' + p.cliente + ', esta' : 'Esta' }} es tu compra #{{ p.id }}</h1>
            <p class="sub">Compra en el local · {{ fecha(p.creado_at) }}</p>
          } @else {
            <h1>Hola {{ p.cliente }}, este es tu pedido #{{ p.id }}</h1>
            <p class="sub">{{ p.barrio ? 'Entrega en ' + p.barrio : 'Pedido del ' + fecha(p.creado_at) }}</p>
          }
          <span class="estado" [class.entregado]="p.estado === 'entregado'" [class.cancelado]="p.estado === 'cancelado'">{{ titulo() }}</span>
        </section>

        @if (p.novedad && p.estado !== 'cancelado') {
          <div class="novedad" role="status">
            <strong>Intentamos entregarte tu pedido</strong>
            {{ p.novedad }}{{ p.novedad_at ? ' · ' + fecha(p.novedad_at) : '' }}. Escríbele a {{ p.vendedora || 'la tienda' }} para acordar la entrega.
          </div>
        }

        @if (p.estado !== 'cancelado' && p.canal !== 'local') {
          <section class="tarjeta">
            <ol class="pasos">
              @for (paso of pasos(); track paso.titulo) {
                <li class="paso" [class.hecho]="paso.hecho" [class.actual]="paso.actual">
                  <span class="punto" aria-hidden="true">{{ paso.hecho ? '✓' : '' }}</span>
                  <div><strong>{{ paso.titulo }}</strong>@if (paso.detalle) {<small>{{ paso.detalle }}</small>}</div>
                </li>
              }
            </ol>
          </section>
        }

        <section class="tarjeta">
          <h2>{{ p.canal === 'local' ? 'Lo que compraste' : 'Lo que pediste' }}</h2>
          <ul class="items">
            @for (i of p.items; track $index) {
              <li><span>{{ i.cantidad }} × {{ i.nombre }}@if (i.color || i.talla) {&nbsp;<small>· {{ variante(i) }}</small>}</span></li>
            }
          </ul>
          <div class="total"><span>{{ p.canal === 'local' || p.estado === 'entregado' ? 'Total pagado' : 'Total a pagar' }}</span><strong>{{ pesos(p.total) }}</strong></div>
          @if (p.domicilio) { <p class="total-nota">Incluye domicilio de {{ pesos(p.domicilio) }}</p> }
        </section>

        @if (p.estado === 'entregado') {
          <section class="tarjeta garantia">
            <h2>Tu garantía</h2>
            <p class="sub" style="margin: 0">{{ p.canal === 'local' ? 'Compra del ' : 'Entregado el ' }}{{ fechaLarga(p.entregado_at || p.creado_at) }}</p>
            @if (p.garantia) { <p class="garantia-txt">{{ p.garantia }}</p> }
            <p class="garantia-nota">Guarda este enlace: es el soporte de tu compra. Si algo falla, escríbenos y lo revisamos.</p>
          </section>
        }

        @if (p.estado === 'entregado' && p.canal !== 'local') {
          <section class="tarjeta califica">
            @if (p.calificacion; as c) {
              <h2>Tu calificación</h2>
              <div class="estrellas fijas" [attr.aria-label]="c.estrellas + ' de 5 estrellas'">
                @for (n of [1, 2, 3, 4, 5]; track n) { <span [class.on]="n <= c.estrellas">★</span> }
              </div>
              <p class="gracias">¡Gracias por contarnos cómo te fue!{{ c.comentario ? ' "' + c.comentario + '"' : '' }}</p>
            } @else {
              <h2>¿Cómo te fue con la entrega?</h2>
              <p class="sub" style="margin: 0 0 10px">{{ p.mensajero ? 'Te la llevó ' + p.mensajero + '. ' : '' }}Tu opinión nos ayuda a mejorar.</p>
              <div class="estrellas" role="radiogroup" aria-label="Calificación de 1 a 5">
                @for (n of [1, 2, 3, 4, 5]; track n) {
                  <button type="button" role="radio" [attr.aria-checked]="estrellas() === n" [attr.aria-label]="n + (n === 1 ? ' estrella' : ' estrellas')"
                    [class.on]="n <= estrellas()" (click)="estrellas.set(n)">★</button>
                }
              </div>
              @if (estrellas()) {
                <textarea [(ngModel)]="comentario" maxlength="300" rows="2"
                  [placeholder]="estrellas() <= 3 ? '¿Qué pasó? Cuéntanos para mejorarlo' : 'Si quieres, déjanos un comentario'"></textarea>
                @if (errorCal()) { <p class="error-cal" role="alert">{{ errorCal() }}</p> }
                <button class="enviar" (click)="calificar(p)" [disabled]="enviando()">{{ enviando() ? 'Enviando…' : 'Enviar calificación' }}</button>
              }
            }
          </section>
        }

        <section class="contacto">
          @if (p.vendedora_telefono) {
            <a class="wa" [class.solo]="!telefonoTienda()" [href]="whatsapp(p)" target="_blank" rel="noopener">WhatsApp a {{ p.vendedora || 'la tienda' }}</a>
          }
          @if (telefonoTienda(); as t) {
            <a class="tel" [class.solo]="!p.vendedora_telefono" [href]="'tel:' + t">Llamar a la tienda</a>
          }
        </section>
        <p class="pie">Esta página se actualiza sola · {{ actualizado() }}</p>
      } @else {
        <div class="tarjeta vacio">
          @if (cargando()) {
            Buscando tu pedido…
          } @else {
            <strong>No encontramos este pedido</strong>
            Revisa que el enlace esté completo o pídele uno nuevo a quien te vendió.
          }
        </div>
      }
    </div>
  `,
})
export class SeguimientoPage implements OnInit, OnDestroy {
  private sb = inject(SupabaseService);
  estrellas = signal(0);
  comentario = '';
  enviando = signal(false);
  errorCal = signal('');
  private route = inject(ActivatedRoute);

  s = signal<Seguimiento | null>(null);
  cargando = signal(true);
  actualizado = signal('');
  pesos = pesos;
  private reloj?: ReturnType<typeof setInterval>;

  titulo = computed(() => {
    const p = this.s();
    if (!p) return '';
    if (p.canal === 'local') return p.estado === 'cancelado' ? 'Compra cancelada' : 'Compra realizada';
    return {
      por_alistar: 'Recibimos tu pedido',
      alistado: 'Tu pedido está listo para salir',
      despachado: 'Tu pedido va en camino',
      entregado: 'Pedido entregado',
      cancelado: 'Pedido cancelado',
    }[p.estado];
  });

  pasos = computed(() => {
    const p = this.s();
    if (!p) return [];
    const orden = ['por_alistar', 'alistado', 'despachado', 'entregado'];
    const i = orden.indexOf(p.estado);
    return [
      { titulo: 'Recibimos tu pedido', detalle: this.fecha(p.creado_at), hecho: i >= 0, actual: false },
      { titulo: 'Lo alistamos', detalle: p.alistado_at && i >= 1 ? this.fecha(p.alistado_at) : '', hecho: i >= 1, actual: i === 0 },
      {
        titulo: 'Va en camino',
        detalle: i >= 2 ? [p.en_ruta_at ? this.fecha(p.en_ruta_at) : '', p.mensajero ? 'Te lo lleva ' + p.mensajero : ''].filter(Boolean).join(' · ') : '',
        hecho: i >= 2, actual: i === 1,
      },
      { titulo: 'Entregado', detalle: p.entregado_at ? this.fecha(p.entregado_at) : '', hecho: i >= 3, actual: i === 2 },
    ];
  });

  telefonoTienda = computed(() => {
    const t = (this.s()?.telefonos ?? '').split(/[-,/]/)[0]?.replace(/\D/g, '');
    return t && t.length >= 7 ? t : '';
  });

  ngOnInit(): void {
    void this.cargar();
    // Mientras la página esté abierta, se revisa cada minuto
    this.reloj = setInterval(() => {
      if (document.visibilityState === 'visible' && this.s()?.estado !== 'entregado') void this.cargar();
    }, 60000);
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
  }

  private async cargar(): Promise<void> {
    const codigo = this.route.snapshot.paramMap.get('codigo') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(codigo)) {
      this.cargando.set(false);
      return;
    }
    const { data } = await this.sb.client.rpc('seguimiento', { p_codigo: codigo });
    this.cargando.set(false);
    if (data) {
      const d = data as Seguimiento;
      this.s.set({ ...d, canal: d.canal ?? (d.local ? 'local' : 'domicilio') });
      this.actualizado.set('revisado a las ' + formatoHoraCO(new Date().toISOString()));
    }
  }

  async calificar(p: Seguimiento): Promise<void> {
    const codigo = this.route.snapshot.paramMap.get('codigo') ?? '';
    this.enviando.set(true);
    this.errorCal.set('');
    const { error } = await this.sb.client.rpc('calificar_entrega', { p_codigo: codigo, p_estrellas: this.estrellas(), p_comentario: this.comentario.trim() });
    this.enviando.set(false);
    if (error) return this.errorCal.set((error.message ?? '').replace(/^.*?ERROR:\s*/, ''));
    this.s.set({ ...p, calificacion: { estrellas: this.estrellas(), comentario: this.comentario.trim() || null } });
  }

  variante(i: { color: string | null; talla: string | null }): string {
    return [i.color, i.talla].filter(Boolean).join(' · ');
  }

  whatsapp(p: Seguimiento): string {
    const tel = (p.vendedora_telefono ?? '').replace(/\D/g, '');
    const num = tel.length === 10 ? '57' + tel : tel;
    return `https://wa.me/${num}?text=${encodeURIComponent(`Hola ${p.vendedora ?? ''}, te escribo por mi pedido #${p.id}.`)}`;
  }

  fecha(iso: string): string {
    return formatoFechaCO(iso, { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + formatoHoraCO(iso);
  }

  fechaLarga(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'long', year: 'numeric' });
  }
}
