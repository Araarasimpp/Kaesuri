import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ClienteDireccion, ClienteService, ClienteTarjeta, ConfigTarjeta } from '../core/services/cliente.service';
import { SupabaseService } from '../core/services/supabase.service';
import { recargoWompi } from '../shared/recargo-wompi';
import { mensajeError, pesos, urlImagen, urlMini } from '../shared/formato';
import { PAISES, bandera, errorTelefono, limpiarNombre, unirTelefono } from '../shared/paises';
import { SkeletonComponent } from '../shared/skeleton/skeleton.component';

interface Color { nombre: string; hex: string | null; imagen_url: string | null }
interface ProductoTienda {
  id: string; nombre: string; precio: number; imagen_url: string | null; tallas: string[]; colores: Color[];
  agotado: boolean; disponibles: number | null; categoria?: string | null;
  /** Puesto entre los 10 más vendidos de los últimos 30 días */
  top?: number | null;
  /** Promedio de estrellas y cuántas reseñas tiene */
  rating?: number | null; resenas?: number;
  /** Agregado en los últimos 15 días */
  nuevo?: boolean;
}
interface Resena { estrellas: number; comentario: string | null; cliente: string | null; fecha: string }
interface UltimoPedido { items: { producto_id: string; cantidad: number; color: string | null; talla: string | null }[]; fecha: string }
interface Cupon { codigo: string; tipo: 'porcentaje' | 'valor'; valor: number; minimo: number; descripcion: string | null }
interface Tienda {
  negocio: string | null; telefonos: string | null;
  vendedora: { id: string; nombre: string; telefono: string | null; foto_url?: string | null; bio?: string | null; destacados?: string[] } | null;
  /** Hay pago en línea (Wompi) activo */
  pagos_linea?: boolean;
  barrios: { barrio: string; domicilio: number }[];
  productos: ProductoTienda[];
}
interface Linea { producto_id: string; nombre: string; precio: number; imagen_url: string | null; cantidad: number; color: string | null; talla: string | null; max: number }
interface Hecho { id: number; total: number; domicilioPendiente: boolean; codigo: string; pagado?: boolean }

/** Marca de la tarjeta por sus primeros números */
function marcaDe(n: string): string {
  const d = n.replace(/\D/g, '');
  if (/^4/.test(d)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^3(0[0-5]|[68])/.test(d)) return 'Diners';
  return '';
}
function luhn(n: string): boolean {
  const d = n.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let s = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2) { x *= 2; if (x > 9) x -= 9; }
    s += x;
  }
  return s % 10 === 0;
}

function normal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Parecido entre dos textos (0 a 1) por pares de letras: aguanta errores de ortografía */
function parecido(a: string, b: string): number {
  const pares = (t: string) => { const out = new Map<string, number>(); for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); out.set(k, (out.get(k) ?? 0) + 1); } return out; };
  const x = pares(a.replace(/ /g, '')), y = pares(b.replace(/ /g, ''));
  let comun = 0, total = 0;
  for (const [k, n] of x) { comun += Math.min(n, y.get(k) ?? 0); total += n; }
  for (const n of y.values()) total += n;
  return total ? (2 * comun) / total : 0;
}

/**
 * Tienda pública (sin iniciar sesión): el catálogo que comparte cada vendedora
 * (/tienda/<nombre>-<id>) o el general (/tienda). Precios de venta sugeridos (fijos),
 * agotados con su etiqueta, carrito y datos de entrega. El pedido le llega a la
 * vendedora "por confirmar" (ver pedidos_web en la base).
 */
@Component({
  selector: 'app-tienda',
  standalone: true,
  // El diseño de la tienda (tarjetas, banner, carrito) está en global.scss bajo app-tienda.tv2
  host: { class: 'tv2' },
  imports: [SkeletonComponent, FormsModule],
  styles: [
    `
      /* Ionic deja el body fijo y le pone contain: layout a la página (lo "fijo" queda pegado a ella):
         la página se queda quieta y lo que se desplaza es .scroll; la barra y las hojas quedan fijas en pantalla */
      :host { display: block; background: var(--bg); color: var(--text); }
      .scroll { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; }
      .caja { max-width: 1080px; margin: 0 auto; padding: calc(16px + env(safe-area-inset-top)) 16px calc(96px + env(safe-area-inset-bottom)); }
      .marca { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .filtros { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 0 12px; background: var(--bg); }
      .precio-fila { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .compartir-p { height: 36px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft);
        font: inherit; font-size: 13.5px; cursor: pointer; }
      .aviso-prod { margin: 0 0 10px; padding: 10px 12px; border-radius: var(--radius); background: var(--oro-wash); color: var(--oro-texto); font-size: 14px; }
      .cats { flex: 0 0 calc(100% + 32px); box-sizing: border-box; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 0 16px; -webkit-overflow-scrolling: touch; }
      .cats::-webkit-scrollbar { display: none; }
      .cats button { flex-shrink: 0; height: 36px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface);
        color: var(--text-soft); font: inherit; font-size: 13.5px; white-space: nowrap; cursor: pointer; }
      .cats button.on { border-color: var(--text); background: var(--text); color: var(--bg); font-weight: 650; }
      .cats small { margin-left: 5px; opacity: .65; font-variant-numeric: tabular-nums; }
      .filtros input { flex: 1; min-width: 0; height: 44px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-size: 15px; }
      .solo { flex-shrink: 0; height: 44px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface);
        color: var(--text-soft); font: inherit; font-size: 14px; cursor: pointer; }
      .solo.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
      .prod { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; }
      .foto { position: relative; display: block; width: 100%; aspect-ratio: 1; padding: 0; border: 0; background: #fff; cursor: pointer; }
      .foto img { width: 100%; height: 100%; object-fit: contain; padding: 8px; box-sizing: border-box; display: block; }
      .foto .ini { display: grid; place-items: center; width: 100%; height: 100%; background: var(--oro-wash); color: var(--oro-texto); font-size: 38px; font-weight: 650; }
      .prod.agot .foto img { opacity: .45; filter: grayscale(.6); }
      .etq-agot { position: absolute; top: 8px; left: 8px; padding: 3px 8px; border-radius: 6px; background: var(--danger); color: #fff; font-size: 11.5px; font-weight: 700; }
      .info { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px; flex: 1; }
      .info h2 { margin: 0; font-size: 13.5px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
      .precio { margin-top: auto; font-family: var(--mono-font); font-size: 16px; font-weight: 700; }
      .agregar { height: 38px; border: 0; border-radius: var(--radius-sm); background: var(--accent); color: #fff; font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
      .agregar:disabled { background: var(--surface-2); color: var(--text-muted); cursor: default; }
      .mas { display: block; margin: 16px auto 0; }
      .vacio { padding: 40px 16px; text-align: center; color: var(--text-soft); }
      .vacio strong { display: block; margin-bottom: 6px; font-size: 18px; color: var(--text); }
      .carrito { position: fixed; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 20;
        display: flex; align-items: center; justify-content: space-between; gap: 14px; width: min(520px, calc(100vw - 24px)); height: 56px; padding: 0 18px;
        border: 0; border-radius: 999px; background: var(--text); color: var(--bg); box-shadow: var(--shadow-pop); font: inherit; font-size: 15px; font-weight: 650; cursor: pointer; }
      .carrito strong { font-family: var(--mono-font); }
      .galeria { display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x mandatory; margin: 0 -2px; }
      .galeria img { flex: 0 0 86%; max-width: 360px; aspect-ratio: 1; object-fit: contain; border-radius: var(--radius); background: #fff; scroll-snap-align: start; }
      .desc { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-soft); white-space: pre-line; }
      .opciones { display: flex; flex-wrap: wrap; gap: 6px; }
      .op { min-height: 36px; padding: 0 12px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); border-radius: 999px;
        background: var(--surface); color: var(--text); font: inherit; font-size: 13.5px; cursor: pointer; }
      .op.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .op i { width: 14px; height: 14px; border-radius: 50%; background: var(--tono); box-shadow: 0 0 0 1px var(--border-strong); }
      .paso { display: inline-flex; align-items: center; gap: 8px; }
      .paso button { width: 36px; height: 36px; border: 1px solid var(--border-strong); border-radius: 10px; background: var(--surface); color: var(--text); font-size: 18px; cursor: pointer; }
      .paso button:disabled { opacity: .4; cursor: default; }
      .paso span { min-width: 24px; text-align: center; font-family: var(--mono-font); font-weight: 700; }
      .lineas { list-style: none; margin: 0; padding: 0; }
      .lineas li { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: var(--perfora); }
      .lineas img, .lineas .mini { width: 48px; height: 48px; border-radius: 8px; object-fit: contain; background: #fff; }
      .lineas .nom { font-size: 13.5px; font-weight: 600; line-height: 1.3; }
      .lineas small { display: block; font-size: 12px; color: var(--text-muted); }
      .lineas .der { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
      .quitar { border: 0; background: none; color: var(--danger); font: inherit; font-size: 12px; cursor: pointer; padding: 0; }
      .tel-grupo { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 6px; }
      .tel-grupo select { padding-right: 22px; text-overflow: ellipsis; }
      .error-campo { margin: 4px 0 0; font-size: 12.5px; color: var(--danger); }
      .obl { color: var(--danger); font-weight: 700; }
      input.mal, .tel-grupo input.mal { border-color: var(--danger) !important; }
      input.ok { border-color: var(--efectivo-texto) !important; }
      .barrio-campo { position: relative; }
      .sug-barrios { position: absolute; left: 0; right: 0; top: 100%; z-index: 30; list-style: none; margin: 4px 0 0; padding: 4px; max-height: 260px; overflow-y: auto;
        border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: 0 10px 28px rgba(0, 0, 0, .14); }
      .sug-barrios button { display: flex; justify-content: space-between; gap: 10px; width: 100%; padding: 11px 10px; border: 0; border-radius: 6px; background: none;
        color: var(--text); font: inherit; font-size: 14.5px; text-align: left; cursor: pointer; }
      .sug-barrios button:hover, .sug-barrios button:focus-visible { background: var(--hover); }
      .sug-barrios small { color: var(--text-muted); font-family: var(--mono-font); white-space: nowrap; }
      .barrio-ok { margin: 4px 0 0; font-size: 13px; color: var(--efectivo-texto); font-weight: 600; }
      .pista-barrio { display: block; margin: -2px 0 2px; font-size: 12.5px; line-height: 1.4; color: var(--text-muted); }
      .pista-barrio strong { color: var(--text-soft); }
      .link-wa { font-weight: 650; color: var(--efectivo-texto); }
      .barrio-falta { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--danger-wash); color: var(--text); font-size: 13.5px; }
      .barrio-falta strong { color: var(--danger); }
      .chips-barrio { display: flex; flex-wrap: wrap; gap: 6px; }
      .chips-barrio button { height: 34px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-size: 13.5px; cursor: pointer; }
      .totales { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 14px; }
      .totales div { display: flex; justify-content: space-between; gap: 10px; }
      .totales .fin { font-size: 16px; font-weight: 700; }
      .totales .num { font-family: var(--mono-font); }
      .nota { margin: 0; font-size: 12.5px; color: var(--text-muted); }
      .formas-pago { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .formas-pago button { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); text-align: left; cursor: pointer; font: inherit; }
      .formas-pago button strong { font-size: 14.5px; }
      .formas-pago button small { font-size: 12px; color: var(--text-muted); line-height: 1.3; }
      .formas-pago button.on { border-color: var(--accent); background: var(--accent-wash); box-shadow: inset 0 0 0 1px var(--accent); }
      .formas-pago button:disabled { opacity: .45; cursor: not-allowed; }
      .error { margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--danger-wash); color: var(--danger); font-size: 13.5px; }
      .listo { max-width: 520px; margin: 30px auto 0; padding: 26px 20px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); text-align: center; }
      .listo .ok { width: 56px; height: 56px; margin: 0 auto 10px; display: grid; place-items: center; border-radius: 50%; background: var(--ok-wash); color: var(--efectivo-texto); font-size: 28px; }
      .listo h2 { margin: 0 0 8px; font-size: 21px; }
      .listo p { margin: 0 0 10px; font-size: 15px; line-height: 1.5; color: var(--text-soft); }
      .wa { display: flex; align-items: center; justify-content: center; height: 48px; margin-top: 14px; border-radius: var(--radius); background: #25d366; color: #fff; font-weight: 650; text-decoration: none; }
      @media (max-width: 560px) { .rejilla { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }
    `,
  ],
  template: `
    <div class="scroll" #scroll>
    <div class="caja">
      <header class="marca">
        @if (cli.activo) {
        <button type="button" class="t-yo" (click)="irCuenta()">
          @if (cli.perfil(); as p) {
            <span class="t-yo-foto dentro" aria-hidden="true">@if (p.avatar_url) { <img [src]="p.avatar_url" alt="" referrerpolicy="no-referrer" /> } @else { {{ iniciales(p.nombre || p.email || '') }} }</span>
            <span class="t-yo-txt"><strong>Hola, {{ primerNombre(p.nombre || '') || 'bienvenido' }}</strong><small>Mi cuenta</small></span>
          } @else {
            <span class="t-yo-foto" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></span>
            <span class="t-yo-txt"><strong>Ingresar</strong><small>Entra o crea tu cuenta</small></span>
          }
        </button>
        } @else { <span></span> }
        <button type="button" class="t-icono-carrito" (click)="lineas().length && abrirCarrito()" [attr.aria-label]="'Mi pedido: ' + unidades() + ' productos'">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>
          @if (unidades()) { <span class="t-badge">{{ unidades() }}</span> }
        </button>
      </header>

      @if (hecho(); as h) {
        <section class="listo" role="status">
          <div class="ok" aria-hidden="true">✓</div>
          <h2>{{ h.pagado ? '¡Pago aprobado!' : '¡Recibimos tu pedido!' }}</h2>
          @if (h.pagado) {
            <p>Tu pedido quedó pagado. {{ t()?.vendedora ? primerNombre(t()!.vendedora!.nombre) : 'La tienda' }} te contacta al {{ telefonoMostrar() }} para coordinar el envío. Lo puedes seguir en Mi cuenta → Mis compras.</p>
          } @else {
          <p>{{ t()?.vendedora ? primerNombre(t()!.vendedora!.nombre) : 'La tienda' }} te va a llamar o escribir al {{ telefonoMostrar() }} para confirmarlo. Después de confirmado, te lo enviamos.</p>
          }
          <p><strong>Total: {{ pesos(h.total) }}</strong>{{ h.domicilioPendiente ? ' + domicilio (te lo confirman)' : ', domicilio incluido' }}</p>
          <a class="wa t-ver-pedido" [href]="'/pago/' + h.codigo">Ver mi pedido y su seguimiento →</a>
          @if (whatsapp(); as w) { <a class="wa" [href]="w" target="_blank" rel="noopener">Escribir por WhatsApp</a> }
          <button class="b mas" (click)="hecho.set(null)">Seguir viendo productos</button>
        </section>
      } @else if (t(); as tienda) {
        @if (avisoProducto()) { <p class="aviso-prod" role="status">{{ avisoProducto() }}</p> }
        @if (tienda.vendedora; as v) {
          @if ((v.foto_url || v.bio) && !q().trim() && !categoria() && !soloFavs()) {
            <section class="t-vend" aria-label="Tu asesora">
              @if (v.foto_url) { <img class="t-vend-foto" [src]="v.foto_url" alt="" referrerpolicy="no-referrer" /> } @else { <span class="t-vend-foto t-vend-ini" aria-hidden="true">{{ iniciales(v.nombre) }}</span> }
              <div class="t-vend-txt">
                <strong>{{ primerNombre(v.nombre) }} <small>· tu asesora</small></strong>
                @if (v.bio) { <p>{{ v.bio }}</p> }
              </div>
              @if (whatsappVendedora(); as w) { <a class="t-vend-wa" [href]="w" target="_blank" rel="noopener" aria-label="Escribir por WhatsApp">WhatsApp</a> }
            </section>
          }
        }
        @if (!q().trim() && !categoria() && !soloFavs()) {
          <section class="t-hero">
            <div class="t-hero-txt">
              <span class="t-pill">{{ masVendidos().length ? '🔥 Lo más pedido' : 'Nuevo' }}</span>
              <h2>Lo que buscas, en la puerta de tu casa</h2>
              <p>Pide en minutos y paga {{ t()?.pagos_linea ? 'al recibir o en línea' : 'al recibir' }}.</p>
              <button type="button" (click)="irAProductos()">Ver productos →</button>
            </div>
            @if (urlMini(heroImg()); as u) { <img [src]="u" alt="" /> }
          </section>
        }
        @if (ultimo(); as u) {
          @if (!q().trim() && !categoria() && !soloFavs() && !lineas().length) {
            <button type="button" class="t-repetir" (click)="repetir(u)">
              <span class="t-repetir-ico" aria-hidden="true">🔁</span>
              <span><strong>Repetir mi último pedido</strong><small>{{ resumenUltimo(u) }}</small></span>
              <span class="t-flecha" aria-hidden="true">›</span>
            </button>
          }
        }
        <div class="filtros">
          <input type="search" [ngModel]="q()" (ngModelChange)="q.set($event); limite.set(40)" placeholder="Buscar producto" aria-label="Buscar producto" />
          <button type="button" class="solo" [class.on]="soloDisp()" [attr.aria-pressed]="soloDisp()" (click)="soloDisp.set(!soloDisp())">Disponibles</button>
          @if (favs().size) {
            <button type="button" class="solo" [class.on]="soloFavs()" [attr.aria-pressed]="soloFavs()" (click)="soloFavs.set(!soloFavs())">♥ Favoritos</button>
          }
          @if (categorias().length > 1) {
            <div class="cats t-cats" role="group" aria-label="Categorías">
              <button type="button" [class.on]="!categoria()" [attr.aria-pressed]="!categoria()" (click)="elegirCategoria(null)"><span class="t-cat-ico" aria-hidden="true">🛍️</span><span class="t-cat-nom">Todo</span></button>
              @for (c of categorias(); track c.nombre) {
                <button type="button" [class.on]="categoria() === c.nombre" [attr.aria-pressed]="categoria() === c.nombre" (click)="elegirCategoria(c.nombre)"><span class="t-cat-ico" aria-hidden="true">{{ icono(c.nombre) }}</span><span class="t-cat-nom">{{ c.nombre }}</span></button>
              }
            </div>
          }
        </div>
        @if (!q().trim() && !categoria() && !soloFavs() && destacados().length) {
          <section class="tienda-top t-dest" aria-labelledby="t-dest">
            <h2 id="t-dest">⭐ Recomendados por {{ primerNombre(tienda.vendedora!.nombre) }}</h2>
            <div class="tienda-carrusel">
              @for (p of destacados(); track p.id) {
                <button type="button" class="tienda-mini" (click)="abrir(p)">
                  @if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <span class="ini">{{ p.nombre.charAt(0) }}</span> }
                  <span class="nom">{{ p.nombre }}</span><strong>{{ pesos(p.precio) }}</strong>
                </button>
              }
            </div>
          </section>
        }
        @if (!q().trim() && !categoria() && masVendidos().length >= 3) {
          <section class="tienda-top" aria-labelledby="t-top">
            <h2 id="t-top">🔥 Lo más vendido</h2>
            <div class="tienda-carrusel">
              @for (p of masVendidos(); track p.id) {
                <button type="button" class="tienda-mini" (click)="abrir(p)">
                  @if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <span class="ini">{{ p.nombre.charAt(0) }}</span> }
                  <span class="puesto">#{{ p.top }}</span>
                  <span class="nom">{{ p.nombre }}</span><strong>{{ pesos(p.precio) }}</strong>
                </button>
              }
            </div>
          </section>
        }
        <div class="t-titulo" id="t-productos"><h2>{{ soloFavs() ? 'Tus favoritos' : categoria() || (q().trim() ? 'Resultados' : 'Todos los productos') }}</h2><span>{{ filtrados().length }}</span></div>
        <div class="rejilla">
          @for (p of filtrados().slice(0, limite()); track p.id) {
            <article class="prod" [class.agot]="p.agotado">
              <button type="button" class="foto" (click)="abrir(p)" [attr.aria-label]="'Ver ' + p.nombre">
                @if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" decoding="async" /> } @else { <span class="ini">{{ p.nombre.charAt(0) }}</span> }
                @if (p.agotado) { <span class="etq-agot">Agotado</span> } @else if (p.top && p.top <= 3) { <span class="t-best">Más vendido</span> } @else if (p.nuevo) { <span class="t-best t-nuevo">Nuevo</span> }
              </button>
              <button type="button" class="t-fav" [class.on]="favs().has(p.id)" (click)="alternarFav(p)" [attr.aria-label]="(favs().has(p.id) ? 'Quitar de' : 'Agregar a') + ' favoritos'" [attr.aria-pressed]="favs().has(p.id)">{{ favs().has(p.id) ? '♥' : '♡' }}</button>
              <div class="info">
                <h2 (click)="abrir(p)">{{ p.nombre }}</h2>
                @if (p.resenas) { <span class="t-rating" [attr.aria-label]="p.rating + ' de 5 estrellas, ' + p.resenas + ' reseñas'"><b>★</b> {{ p.rating }} <small>({{ p.resenas }})</small></span> }
                <div class="t-precio-fila">
                  <span class="precio">{{ pesos(p.precio) }}</span>
                  @if (enCarrito(p)) { <span class="t-en-pedido" aria-label="Ya está en tu pedido">✓</span> }
                </div>
              </div>
            </article>
          } @empty {
            <p class="vacio" style="grid-column: 1 / -1">No encontramos productos con esa búsqueda.</p>
          }
        </div>
        @if (filtrados().length > limite()) {
          <button class="b mas" (click)="limite.set(limite() + 40)">Ver más productos ({{ filtrados().length - limite() }})</button>
        }
      } @else {
        <div class="vacio">
          @if (cargando()) { <app-skeleton variante="tarjetas" [cantidad]="6"></app-skeleton> } @else { <strong>Este catálogo no existe</strong>Pídele el enlace de nuevo a quien te lo compartió. }
        </div>
      }
    </div>
    </div>

    @if (avisoAgregado()) { <p class="t-toast" role="status">{{ avisoAgregado() }}</p> }
    @if (lineas().length && !verCarrito() && !sel() && !hecho()) {
      <button class="carrito" (click)="abrirCarrito()">
        <span>🛍️ Ver mi pedido · {{ unidades() }} {{ unidades() === 1 ? 'producto' : 'productos' }}</span><strong>{{ pesos(subtotal()) }} →</strong>
      </button>
    }

    @if (sel(); as p) {
      <div class="t-pantalla" role="dialog" aria-modal="true" [attr.aria-label]="p.nombre">
        <div class="t-barra">
          <button type="button" class="t-circ" (click)="cerrarPantalla()" aria-label="Volver">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
          </button>
          <span class="t-barra-tit">Detalle</span>
          <span class="t-barra-der">
            <button type="button" class="t-circ" [class.fav-on]="favs().has(p.id)" (click)="alternarFav(p)" [attr.aria-label]="(favs().has(p.id) ? 'Quitar de' : 'Agregar a') + ' favoritos'" [attr.aria-pressed]="favs().has(p.id)">{{ favs().has(p.id) ? '♥' : '♡' }}</button>
            <button type="button" class="t-circ" (click)="compartirProducto(p)" aria-label="Compartir">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>
            </button>
          </span>
        </div>
        <div class="t-pantalla-body" #detalle>
          <div class="t-foto-grande">
            <div class="t-fotos" #fotosCaja (scroll)="alDeslizar(fotosCaja)">
              @for (f of fotos(); track f) { <img [src]="f" alt="" /> } @empty { <span class="ini">{{ p.nombre.charAt(0) }}</span> }
            </div>
            @if (p.agotado) { <span class="etq-agot">Agotado</span> } @else if (p.top && p.top <= 10) { <span class="t-best">Más vendido</span> } @else if (p.nuevo) { <span class="t-best t-nuevo">Nuevo</span> }
            @if (fotos().length > 1) { <span class="t-contador">{{ fotoI() + 1 }}/{{ fotos().length }}</span> }
          </div>
          @if (fotos().length > 1) {
            <div class="t-miniaturas">
              @for (f of fotos(); track f; let k = $index) {
                <button type="button" [class.on]="fotoI() === k" (click)="verFoto(fotosCaja, k)" [attr.aria-label]="'Foto ' + (k + 1)"><img [src]="f" alt="" loading="lazy" /></button>
              }
            </div>
          }
          <div class="t-det">
            <div class="t-det-cab">
              <span class="t-cat">{{ p.categoria || 'Producto' }}</span>
              @if (p.resenas) { <span class="t-rating"><b>★</b> {{ p.rating }} <small>({{ p.resenas }} {{ p.resenas === 1 ? 'reseña' : 'reseñas' }})</small></span> }
            </div>
            <h1 class="t-det-nom">{{ p.nombre }}</h1>
            <span class="precio">{{ pesos(p.precio) }}</span>
            @if (avisoCopiado()) { <p class="t-copiado" role="status">¡Enlace copiado!</p> }
            @if (descripcion()) {
              <div class="t-bloque"><h3>Descripción</h3><p class="desc">{{ descripcion() }}</p></div>
            }
            @if (p.colores.length) {
              <div class="t-bloque"><h3>Color{{ color() ? ': ' + color() : '' }}</h3>
                <div class="opciones">
                  @for (c of p.colores; track c.nombre) {
                    <button type="button" class="op" [class.on]="color() === c.nombre" (click)="elegirColor(c.nombre, fotosCaja)">
                      @if (c.hex) { <i [style.--tono]="c.hex"></i> }{{ c.nombre }}</button>
                  }
                </div>
              </div>
            }
            @if (p.tallas.length) {
              <div class="t-bloque"><h3>Talla</h3>
                <div class="opciones">
                  @for (tl of p.tallas; track tl) { <button type="button" class="op" [class.on]="talla() === tl" (click)="talla.set(tl)">{{ tl }}</button> }
                </div>
              </div>
            }
            @if (!p.agotado) {
              <div class="t-bloque t-cant"><h3>Cantidad</h3>
                <span class="paso">
                  <button type="button" (click)="cant.set(cant() - 1)" [disabled]="cant() <= 1" aria-label="Menos">−</button>
                  <span>{{ cant() }}</span>
                  <button type="button" (click)="cant.set(cant() + 1)" [disabled]="cant() >= maximo(p)" aria-label="Más">+</button>
                </span>
              </div>
            }
            @if (errorSel()) { <p class="error" role="alert">{{ errorSel() }}</p> }
            @if (resenas().length) {
              <div class="t-bloque"><h3>Reseñas</h3>
                <ul class="t-resenas">
                  @for (r of resenas().slice(0, verTodasResenas() ? 20 : 3); track $index) {
                    <li>
                      <div><span class="t-estr" [attr.aria-label]="r.estrellas + ' de 5 estrellas'">{{ '★★★★★'.slice(0, r.estrellas) }}<em>{{ '★★★★★'.slice(r.estrellas) }}</em></span>
                        <small>{{ r.cliente || 'Cliente' }} · {{ fechaCorta(r.fecha) }}</small></div>
                      @if (r.comentario) { <p>{{ r.comentario }}</p> }
                    </li>
                  }
                </ul>
                @if (resenas().length > 3 && !verTodasResenas()) { <button type="button" class="t-link" (click)="verTodasResenas.set(true)">Ver las {{ resenas().length }} reseñas</button> }
              </div>
            }
            @if (relacionados().length) {
              <section class="tienda-relac" aria-labelledby="t-rel">
                <h3 id="t-rel">Te puede gustar</h3>
                <div class="tienda-carrusel">
                  @for (r of relacionados(); track r.id) {
                    <button type="button" class="tienda-mini" (click)="abrir(r)">
                      @if (urlMini(r.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <span class="ini">{{ r.nombre.charAt(0) }}</span> }
                      <span class="nom">{{ r.nombre }}</span><strong>{{ pesos(r.precio) }}</strong>
                    </button>
                  }
                </div>
              </section>
            }
          </div>
        </div>
        <div class="t-pantalla-pie">
          @if (p.agotado) {
            <button class="b b-pri" disabled>Agotado</button>
          } @else {
            <button class="b t-btn-sec" (click)="agregarSel(p)">Agregar al carrito</button>
            <button class="b b-pri" (click)="comprarYa(p)">Comprar ahora</button>
          }
        </div>
      </div>
    }

    @if (verCarrito()) {
      <div class="t-pantalla" role="dialog" aria-modal="true" aria-labelledby="t-car">
        <div class="t-barra">
          <button type="button" class="t-circ" (click)="paso() === 'finalizar' ? volverAlCarrito() : cerrarPantalla()" aria-label="Volver">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
          </button>
          <span class="t-barra-tit" id="t-car">{{ paso() === 'finalizar' ? 'Finaliza tu compra' : 'Mi pedido' }}</span>
          <span class="t-barra-der"><span class="t-circ t-circ-num" aria-hidden="true">{{ unidades() }}</span></span>
        </div>

        @if (paso() === 'carrito') {
        <!-- ===== Paso 1: Mi pedido ===== -->
        <div class="t-pantalla-body t-carro-body">
          <ul class="lineas">
            @for (l of lineas(); track $index) {
              <li>
                @if (urlMini(l.imagen_url); as u) { <img [src]="u" alt="" /> } @else { <span class="mini"></span> }
                <span><span class="nom">{{ l.nombre }}</span>
                  @if (l.color || l.talla) { <small>{{ variante(l) }}</small> }
                  <small>{{ pesos(l.precio) }} c/u</small></span>
                <span class="der">
                  <span class="paso">
                    <button type="button" (click)="cambiar($index, -1)" aria-label="Menos">−</button>
                    <span>{{ l.cantidad }}</span>
                    <button type="button" (click)="cambiar($index, 1)" [disabled]="l.cantidad >= l.max" aria-label="Más">+</button>
                  </span>
                  <button class="quitar" (click)="quitar($index)" [attr.aria-label]="'Quitar ' + l.nombre">🗑 Quitar</button>
                </span>
              </li>
            } @empty {
              <li><span></span><span class="nota">Todavía no has agregado productos.</span><span></span></li>
            }
          </ul>
          <div class="totales">
            <div class="fin"><span>Productos ({{ unidades() }})</span><span class="num">{{ pesos(subtotal()) }}</span></div>
          </div>
          <p class="nota">En el siguiente paso eliges a dónde te lo llevamos y cómo pagas.</p>
        </div>
        <div class="t-pantalla-pie">
          <button class="b b-pri" (click)="irFinalizar()" [disabled]="!lineas().length">Continuar compra →</button>
        </div>
        } @else {
        <!-- ===== Paso 2: Finaliza tu compra (como en las tiendas en línea) ===== -->
        <div class="t-pantalla-body t-carro-body fc">
          <!-- Productos -->
          <ul class="fc-prods">
            @for (l of lineas(); track $index) {
              <li>
                <span class="fc-foto">@if (urlMini(l.imagen_url); as u) { <img [src]="u" alt="" /> }@if (l.cantidad > 1) { <b>{{ l.cantidad }}</b> }</span>
                <span class="fc-prod-txt"><span>{{ l.nombre }}</span>@if (l.color || l.talla) { <small>{{ variante(l) }}</small> }</span>
                <span class="fc-prod-v num">{{ pesos(l.precio * l.cantidad) }}</span>
              </li>
            }
          </ul>

          @if (cli.activo && cli.listo() && !cli.perfil()) {
            <div class="t-cuenta-aviso"><span>¿Tienes cuenta? Tus datos y direcciones salen solos.</span><button type="button" (click)="irCuenta()">Ingresar</button></div>
          }

          <!-- Forma de entrega -->
          <section class="fc-sec" aria-labelledby="fc-entrega">
            <h3 id="fc-entrega">Forma de entrega</h3>
            @if (dirElegida(); as d) {
              <div class="fc-dir">
                <svg class="fc-pin" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a7.5 7.5 0 0 0-7.5 7.5C4.5 15.1 12 22 12 22s7.5-6.9 7.5-12.5A7.5 7.5 0 0 0 12 2Zm0 10.2a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Z"/></svg>
                <span class="fc-dir-txt"><strong>{{ d.direccion }}</strong><small>{{ d.barrio }} · {{ d.etiqueta }}</small>
                  <button type="button" class="fc-link" (click)="verDirecciones.set(!verDirecciones())">{{ verDirecciones() ? 'Listo' : 'Cambiar dirección' }}</button></span>
              </div>
            }
            @if (verDirecciones() || !dirElegida()) {
              @if (misDirs().length) {
                <div class="t-mis-dirs" role="radiogroup" aria-label="Dirección de entrega">
                  @for (d of misDirs(); track d.id) {
                    <button type="button" role="radio" [attr.aria-checked]="dirSel() === d.id" [class.on]="dirSel() === d.id" (click)="usarDireccion(d); verDirecciones.set(false)">
                      <span class="radio" aria-hidden="true"></span>
                      <span><strong>{{ d.etiqueta }}{{ d.principal ? ' · principal' : '' }}</strong><small>{{ d.direccion }} · {{ d.barrio }}</small></span>
                    </button>
                  }
                  <button type="button" role="radio" [attr.aria-checked]="dirSel() === 'otra'" [class.on]="dirSel() === 'otra'" (click)="otraDireccion()">
                    <span class="radio" aria-hidden="true"></span><span><strong>Otra dirección</strong><small>Escríbela y, si quieres, la guardamos</small></span>
                  </button>
                </div>
              }
              @if (!misDirs().length || dirSel() === 'otra') {
          <div class="campo"><label for="td">Dirección <span class="obl">*</span></label>
            <input id="td" autocomplete="street-address" maxlength="200" required [class.mal]="intentado() && errDir()" [(ngModel)]="direccion" placeholder="Ej: Cra 45 # 12-30 apto 201" />
            @if (intentado() && errDir()) { <p class="error-campo">{{ errDir() }}</p> }</div>
          <div class="campo barrio-campo"><label for="tb">Barrio <span class="obl">*</span></label>
            <small class="pista-barrio">Escribe tu barrio y elígelo de la lista. <strong>Si no eres de Cali, escribe solo el nombre de tu ciudad</strong> (ej: Jamundí, Palmira, Yumbo), no el barrio.</small>
            <input id="tb" maxlength="120" autocomplete="off" required role="combobox" aria-autocomplete="list" [attr.aria-expanded]="sugerencias().length > 0"
              [class.mal]="intentado() && errBarrio()" [class.ok]="!!barrioElegido()" [ngModel]="barrio()" (ngModelChange)="escribirBarrio($event)"
              (focus)="enBarrio.set(true)" (blur)="salirBarrio()" placeholder="Ej: San Fernando, o Jamundí si no eres de Cali" />
            @if (sugerencias().length) {
              <ul class="sug-barrios" role="listbox">
                @for (b of sugerencias(); track b.barrio) {
                  <li role="option"><button type="button" (mousedown)="$event.preventDefault()" (click)="elegirBarrio(b.barrio)">
                    <span>{{ b.barrio }}</span><small>{{ pesos(b.domicilio) }}</small></button></li>
                }
              </ul>
            }
            @if (barrioElegido(); as b) {
              <p class="barrio-ok">✓ {{ b }} · domicilio {{ pesos(domicilio()!) }}</p>
            } @else if (barrio().trim().length >= 3 && (!enBarrio() || !sugerencias().length)) {
              <div class="barrio-falta" role="alert">
                <strong>No encontramos "{{ barrio().trim() }}" en la lista.</strong>
                @if (parecidos().length) {
                  <span>¿Es alguno de estos?</span>
                  <div class="chips-barrio">@for (b of parecidos(); track b.barrio) { <button type="button" (click)="elegirBarrio(b.barrio)">{{ b.barrio }}</button> }</div>
                }
                <span>Revisa cómo lo escribiste. Si no vives en Cali, escribe solo el nombre de tu ciudad o municipio, no el barrio.</span>
                @if (whatsappAyuda(); as w) { <a class="link-wa" [href]="w" target="_blank" rel="noopener">¿No aparece? Escríbenos por WhatsApp</a> }
              </div>
            } @else if (intentado() && errBarrio() && (!enBarrio() || !sugerencias().length)) { <p class="error-campo">{{ errBarrio() }}</p> }
          </div>
          @if (cli.perfil()) {
            <label class="t-guardar-dir"><input type="checkbox" [(ngModel)]="guardarDir" />Guardar esta dirección en mi cuenta</label>
          }
              }
            }
          </section>

          <!-- Quién recibe -->
          <section class="fc-sec" aria-labelledby="fc-recibe">
            <h3 id="fc-recibe">Quién recibe</h3>
            @if (contactoListo() && !editarContacto()) {
              <div class="fc-fila"><span><strong>{{ nombre }}</strong><small>Celular {{ telefonoMostrar() }}</small></span>
                <button type="button" class="fc-link" (click)="editarContacto.set(true)">Cambiar</button></div>
            } @else {
          <div class="campo"><label for="tn">Tu nombre <span class="obl">*</span></label>
            <input id="tn" autocomplete="name" required [class.mal]="intentado() && errNombre()" [ngModel]="nombre" (ngModelChange)="nombre = limpiar($event)" />
            @if (intentado() && errNombre()) { <p class="error-campo">{{ errNombre() }}</p> }</div>
          <div class="campo"><label for="tt">Celular <span class="obl">*</span></label>
            <div class="tel-grupo">
              <select [(ngModel)]="prefijo" aria-label="Indicativo del país">
                @for (p of paises; track p.iso) { <option [value]="p.prefijo">{{ bandera(p.iso) }} +{{ p.prefijo }} {{ p.nombre }}</option> }
              </select>
              <input id="tt" type="tel" inputmode="numeric" autocomplete="tel-national" required [class.mal]="intentado() && errTel()" [ngModel]="telefono" (ngModelChange)="cambioTel($event)" />
            </div>
            @if ((telefono || intentado()) && errTel()) { <p class="error-campo">{{ errTel() }}</p> }
          </div>
            }
          </section>

          <!-- Envío -->
          <section class="fc-sec" aria-labelledby="fc-envio">
            <h3 id="fc-envio">Envío</h3>
            <div class="fc-opcion on">
              <span class="fc-radio" aria-hidden="true"></span>
              <span class="fc-op-txt"><strong>{{ domicilio() !== null ? textoLlegada() : 'Domicilio' }}</strong><small>{{ domicilio() !== null ? 'Domicilio a ' + barrioOficial() : 'Elige tu barrio para ver el valor' }}</small></span>
              <span class="fc-op-v num">{{ domicilio() !== null ? (domicilio() ? pesos(domicilio()!) : 'Gratis') : '—' }}</span>
            </div>
          </section>

          <!-- Medios de pago -->
          <section class="fc-sec" aria-labelledby="fc-pago">
            <h3 id="fc-pago">Medios de pago</h3>
            <div class="fc-pagos" role="radiogroup" aria-label="Medio de pago">
              <button type="button" role="radio" class="fc-opcion" [attr.aria-checked]="formaPago() === 'contra_entrega'" [class.on]="formaPago() === 'contra_entrega'" (click)="formaPago.set('contra_entrega')">
                <span class="fc-radio" aria-hidden="true"></span>
                <span class="fc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/></svg></span>
                <span class="fc-op-txt"><strong>Pagar al recibir</strong><small>Efectivo o transferencia cuando te llegue</small></span>
              </button>
              @if (t()?.pagos_linea) {
              <button type="button" role="radio" class="fc-opcion" [attr.aria-checked]="formaPago() === 'en_linea'" [class.on]="formaPago() === 'en_linea'" (click)="formaPago.set('en_linea')">
                <span class="fc-radio" aria-hidden="true"></span>
                <span class="fc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/></svg></span>
                <span class="fc-op-txt"><strong>{{ tarjetasOn() ? 'Otros medios en línea' : 'Pagar ahora en línea' }}</strong><small>{{ tarjetasOn() ? 'PSE, Nequi, Daviplata o Bancolombia (en la página de Wompi)' : 'Tarjeta de crédito o débito, PSE, Nequi, Daviplata o Bancolombia' }}</small>
                  <span class="fc-marcas">@if (!tarjetasOn()) { <i>VISA</i><i>Mastercard</i> }<i>PSE</i><i>Nequi</i><i>Daviplata</i></span></span>
              </button>
              }
              @if (tarjetasOn()) {
                @for (tj of misTarjetas(); track tj.id) {
                  <button type="button" role="radio" class="fc-opcion fc-tj" [attr.aria-checked]="formaPago() === 'tarjeta' && tarjetaSel() === tj.id" [class.on]="formaPago() === 'tarjeta' && tarjetaSel() === tj.id" (click)="elegirTarjeta(tj.id)">
                    <span class="fc-radio" aria-hidden="true"></span>
                    <span class="fc-ico fc-marca" aria-hidden="true">{{ abrevMarca(tj.marca) }}</span>
                    <span class="fc-op-txt"><strong>{{ tj.marca || 'Tarjeta' }} **** {{ tj.ultimos4 }}</strong><small>Vence {{ tj.exp_mes }}/{{ tj.exp_anio }}</small></span>
                  </button>
                }
                <button type="button" role="radio" class="fc-opcion fc-tj" [attr.aria-checked]="formaPago() === 'tarjeta' && tarjetaSel() === 'nueva'" [class.on]="formaPago() === 'tarjeta' && tarjetaSel() === 'nueva'" (click)="elegirTarjeta('nueva')">
                  <span class="fc-radio" aria-hidden="true"></span>
                  <span class="fc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/></svg></span>
                  <span class="fc-op-txt"><strong>{{ misTarjetas().length ? 'Nueva tarjeta' : 'Tarjeta de crédito o débito' }}</strong><small>Visa, Mastercard, Amex o Diners · la puedes guardar</small></span>
                </button>
              }
            </div>
            @if (formaPago() === 'tarjeta' && tarjetaSel() === 'nueva') {
              <div class="fc-tarjeta">
                <div class="campo"><label for="tcn">Número de la tarjeta</label>
                  <div class="fc-num"><input id="tcn" inputmode="numeric" autocomplete="cc-number" maxlength="23" [ngModel]="tNumero()" (ngModelChange)="escribirNumero($event)" placeholder="0000 0000 0000 0000" />
                    @if (marcaTarjeta()) { <b>{{ marcaTarjeta() }}</b> }</div></div>
                <div class="campo"><label for="tct">Nombre como aparece en la tarjeta</label>
                  <input id="tct" autocomplete="cc-name" maxlength="60" [(ngModel)]="tTitular" /></div>
                <div class="fc-dos">
                  <div class="campo"><label for="tcv">Vence (MM/AA)</label>
                    <input id="tcv" inputmode="numeric" autocomplete="cc-exp" maxlength="5" [ngModel]="tVence" (ngModelChange)="escribirVence($event)" placeholder="08/29" /></div>
                  <div class="campo"><label for="tcc">Código de seguridad</label>
                    <input id="tcc" inputmode="numeric" autocomplete="cc-csc" maxlength="4" [(ngModel)]="tCvc" placeholder="CVC" /></div>
                </div>
                <label class="t-guardar-dir"><input type="checkbox" [(ngModel)]="tGuardar" />Guardar esta tarjeta para mis próximas compras</label>
              </div>
            }
            @if (formaPago() === 'tarjeta') {
              <div class="campo fc-cuotas"><label for="tcu">Cuotas</label>
                <select id="tcu" [ngModel]="cuotas()" (ngModelChange)="cuotas.set(+$event)">
                  @for (n of opcionesCuotas; track n) { <option [value]="n">{{ n === 1 ? '1 cuota (de contado)' : n + ' cuotas de ' + pesos(cuotaDe(n)) + ' aprox.' }}</option> }
                </select>
                <small class="nota">Con tarjeta débito siempre es 1 cuota. El interés de las cuotas lo pone tu banco.</small>
              </div>
              <p class="nota">Pagas seguro con <strong>Wompi</strong> (de Bancolombia): los datos de tu tarjeta van directo a Wompi y Variedades JYB nunca los ve. Al pagar aceptas el
                @if (cfgTarjeta()?.terminos) { <a [href]="cfgTarjeta()!.terminos" target="_blank" rel="noopener">reglamento de Wompi</a> } @else { reglamento de Wompi }
                y la @if (cfgTarjeta()?.datos) { <a [href]="cfgTarjeta()!.datos" target="_blank" rel="noopener">autorización de datos</a> } @else { autorización de datos }.</p>
            } @else if (enLinea()) { <p class="nota">Pagas seguro en <strong>Wompi</strong> (de Bancolombia). Con tarjeta de crédito eliges ahí en cuántas cuotas.</p> }
            @if (pagoMensaje()) { <p class="error" role="alert">{{ pagoMensaje() }}</p> }
          </section>

          @if (cli.perfil(); as p) {
            <!-- Facturación -->
            <section class="fc-sec" aria-labelledby="fc-fact">
              <button type="button" class="fc-fila fc-fila-btn" (click)="irCuenta()">
                <span><strong id="fc-fact" class="fc-h">Facturación</strong>
                  <small>{{ nombre || p.nombre }}{{ p.documento ? ' - ' + p.tipo_doc + ' ' + p.documento : ' · agrega tu documento (opcional)' }}</small></span>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
              </button>
            </section>
          }

          <!-- Indicaciones -->
          <section class="fc-sec">
          <div class="campo"><label for="to">Observaciones (opcional)</label>
            <input id="to" maxlength="300" [(ngModel)]="observaciones" placeholder="Ej: llamar antes, portería, después de las 3 pm" /></div>
          </section>

          <!-- Resumen -->
          <section class="fc-sec fc-resumen" aria-labelledby="fc-res">
            <h3 id="fc-res">Resumen de compra</h3>
            <div class="fc-r"><span>{{ unidades() === 1 ? 'Producto' : 'Productos (' + unidades() + ')' }}</span><span class="num">{{ pesos(subtotal()) }}</span></div>
            <div class="fc-r"><span>Envío</span><span class="num">{{ domicilio() !== null ? (domicilio() ? pesos(domicilio()!) : 'Gratis') : '—' }}</span></div>
            @if (descuento()) { <div class="fc-r fc-desc"><span>Cupón {{ cupon()!.codigo }}</span><span class="num">− {{ pesos(descuento()) }}</span></div> }
            @if (enLinea()) { <div class="fc-r"><span>Costo del pago en línea</span><span class="num">{{ domicilio() !== null ? pesos(recargo()) : '—' }}</span></div> }
          <div class="tienda-cupon fc-cupon">
            @if (cupon(); as c) {
              <div class="cupon-ok">
                <span>🎟️ Cupón <strong>{{ c.codigo }}</strong>{{ c.descripcion ? ' · ' + c.descripcion : '' }}
                  @if (descuento()) { <small>Te ahorras {{ pesos(descuento()) }}</small> } @else { <small class="falta">Es para compras desde {{ pesos(c.minimo) }}</small> }</span>
                <button type="button" class="link" (click)="quitarCupon()">Quitar</button>
              </div>
            } @else if (verCupon()) {
              <div class="cupon-form">
                <input [ngModel]="cuponTexto()" (ngModelChange)="cuponTexto.set($event.toUpperCase())" placeholder="Código del cupón" aria-label="Código del cupón" autocapitalize="characters" maxlength="30" />
                <button type="button" class="b" [disabled]="aplicando() || !cuponTexto().trim()" (click)="aplicarCupon()">{{ aplicando() ? '…' : 'Aplicar' }}</button>
              </div>
              @if (errorCupon()) { <p class="error-campo">{{ errorCupon() }}</p> }
            } @else {
              <button type="button" class="link" (click)="verCupon.set(true)">Ingresar código de cupón</button>
            }
          </div>

            <div class="fc-r fc-total"><span>Total</span><span class="num">{{ pesos(total()) }}</span></div>
            <p class="nota">{{ enLinea() ? 'Cuando se apruebe el pago, ' : 'Pagas al recibir. Antes de enviarlo, ' }}{{ t()?.vendedora ? primerNombre(t()!.vendedora!.nombre) : 'la tienda' }} te contacta para {{ enLinea() ? 'coordinar el envío' : 'confirmar tu pedido' }}.</p>
          </section>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="t-pantalla-pie fc-pie">
          <button type="button" class="fc-pie-total" (click)="irAlResumen()" aria-label="Ver resumen de compra">
            <span class="num">{{ pesos(total()) }}</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>
          </button>
          <button class="b b-pri" (click)="enviar()" [disabled]="enviando() || !lineas().length">{{ enviando() ? (formaPago() === 'tarjeta' ? 'Procesando el pago…' : enLinea() ? 'Abriendo el pago…' : 'Enviando…') : formaPago() === 'tarjeta' ? 'Pagar ' + pesos(total()) : enLinea() ? 'Pagar y finalizar' : 'Confirmar pedido' }}</button>
        </div>
        }
      </div>
    }
  `,
})
export class TiendaPage implements OnInit {
  sb = inject(SupabaseService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  cli = inject(ClienteService);
  /** Direcciones guardadas en la cuenta del cliente; cuál eligió para este pedido */
  misDirs = computed<ClienteDireccion[]>(() => this.cli.perfil()?.direcciones ?? []);
  dirSel = signal<number | 'otra' | null>(null);
  /** Paso del pedido: la lista de productos, luego "Finaliza tu compra" */
  paso = signal<'carrito' | 'finalizar'>('carrito');
  verDirecciones = signal(false);
  editarContacto = signal(false);
  dirElegida = computed(() => {
    const id = this.dirSel();
    return typeof id === 'number' ? this.misDirs().find((d) => d.id === id) ?? null : null;
  });
  total = computed(() => this.subtotal() - this.descuento() + (this.domicilio() ?? 0) + this.recargo());
  guardarDir = true;
  private datosCuentaPuestos = false;

  t = signal<Tienda | null>(null);
  cargando = signal(true);
  q = signal('');
  soloDisp = signal(false);
  categoria = signal<string | null>(null);
  limite = signal(40);
  lineas = signal<Linea[]>([]);
  verCarrito = signal(false);
  sel = signal<ProductoTienda | null>(null);
  descripcion = signal('');
  fotosExtra = signal<string[]>([]);
  color = signal<string | null>(null);
  talla = signal<string | null>(null);
  cant = signal(1);
  errorSel = signal('');
  barrio = signal('');
  /** El barrio tal como está en la tabla de domicilios (cuando lo eligió o lo escribió igual) */
  barrioElegido = signal<string | null>(null);
  enBarrio = signal(false);
  intentado = signal(false);
  error = signal('');
  enviando = signal(false);
  hecho = signal<Hecho | null>(null);
  /** Pagar al recibir o pagar ya en línea con Wompi (el cliente paga la comisión de Wompi) */
  /** Al recibir, con tarjeta aquí mismo (cuenta de cliente) o en Wompi (PSE, Nequi, Daviplata, tarjeta) */
  formaPago = signal<'contra_entrega' | 'en_linea' | 'tarjeta'>('contra_entrega');
  enLinea = computed(() => this.formaPago() !== 'contra_entrega');
  // ---- Tarjetas (Wompi): guardadas, nueva y cuotas
  cfgTarjeta = signal<ConfigTarjeta | null>(null);
  tarjetasOn = computed(() => !!this.cli.perfil() && !!this.cfgTarjeta()?.activo);
  misTarjetas = computed<ClienteTarjeta[]>(() => this.cli.perfil()?.tarjetas ?? []);
  tarjetaSel = signal<number | 'nueva' | null>(null);
  cuotas = signal(1);
  readonly opcionesCuotas = [1, 2, 3, 4, 6, 9, 12, 18, 24, 36];
  tNumero = signal('');
  tTitular = '';
  tVence = '';
  tCvc = '';
  tGuardar = true;
  pagoMensaje = signal('');
  /** Si el banco rechaza, el pedido ya quedó creado: el siguiente intento cobra el mismo pedido */
  private codigoPendiente: string | null = null;
  marcaTarjeta = computed(() => marcaDe(this.tNumero()));
  recargo = computed(() => (this.enLinea() && this.domicilio() !== null ? recargoWompi(this.subtotal() - this.descuento() + this.domicilio()!) : 0));
  /** Cupón de descuento (el valor final lo calcula el servidor al pedir) */
  cupon = signal<Cupon | null>(null);
  cuponTexto = signal('');
  verCupon = signal(false);
  aplicando = signal(false);
  errorCupon = signal('');
  descuento = computed(() => {
    const c = this.cupon();
    const sub = this.subtotal();
    if (!c || sub < Number(c.minimo)) return 0;
    return c.tipo === 'porcentaje' ? Math.round((sub * Math.min(Number(c.valor), 90)) / 100) : Math.min(Number(c.valor), sub);
  });
  /** Los 10 más vendidos (de los últimos 30 días) que hay disponibles */
  /** Los que eligió el vendedor para su catálogo (sin los agotados), en su orden */
  destacados = computed(() => {
    const t = this.t();
    const porId = new Map((t?.productos ?? []).map((p) => [p.id, p]));
    return (t?.vendedora?.destacados ?? []).map((id) => porId.get(id)).filter((p): p is ProductoTienda => !!p && !p.agotado);
  });
  masVendidos = computed(() => (this.t()?.productos ?? []).filter((p) => p.top && !p.agotado).sort((a, b) => a.top! - b.top!).slice(0, 10));
  /** Productos de la misma categoría (los más vendidos primero) */
  relacionados = computed(() => {
    const p = this.sel();
    if (!p) return [];
    const todos = (this.t()?.productos ?? []).filter((x) => x.id !== p.id && !x.agotado);
    const orden = (a: ProductoTienda, b: ProductoTienda) => (a.top ?? 99) - (b.top ?? 99);
    const misma = todos.filter((x) => (x.categoria ?? 'Otros') === (p.categoria ?? 'Otros')).sort(orden);
    const extra = misma.length < 4 ? todos.filter((x) => x.top && !misma.includes(x)).sort(orden) : [];
    return [...misma, ...extra].slice(0, 8);
  });

  async aplicarCupon(): Promise<void> {
    this.errorCupon.set('');
    this.aplicando.set(true);
    const { data, error } = await this.sb.client.rpc('tienda_cupon', { p_codigo: this.cuponTexto().trim(), p_subtotal: this.subtotal() });
    this.aplicando.set(false);
    if (error) {
      const m = mensajeError(error);
      return this.errorCupon.set(/cup[oó]n|compras desde/i.test(m) ? m : 'No pudimos revisar ese cupón. Intenta otra vez.');
    }
    this.cupon.set(data as Cupon);
    this.verCupon.set(false);
  }

  quitarCupon(): void {
    this.cupon.set(null);
    this.cuponTexto.set('');
  }

  nombre = '';
  telefono = '';
  prefijo = '57';
  direccion = '';
  observaciones = '';
  paises = PAISES;
  bandera = bandera;
  pesos = pesos;
  urlMini = urlMini;
  @ViewChild('scroll') private scroll?: ElementRef<HTMLElement>;
  /** Código del vendedor del enlace (primeros 8 caracteres de su id); null = catálogo general */
  private vendedoraId: string | null = null;
  private clave = 'tienda-carrito';
  /** Código al azar de este dispositivo, para contar visitas sin datos personales */
  private sesion = TiendaPage.sesionDispositivo();

  private static sesionDispositivo(): string {
    try {
      let s = localStorage.getItem('tienda-sesion');
      if (!s || !/^[a-z0-9]{12,40}$/.test(s)) {
        s = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('') + Date.now().toString(36);
        localStorage.setItem('tienda-sesion', s);
      }
      return s;
    } catch {
      return Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    }
  }

  /** Anota lo que pasa en el catálogo (para las estadísticas de el vendedor); si falla, no importa */
  private evento(tipo: 'visita' | 'ver' | 'agregar', producto: string | null = null): void {
    void this.sb.client.rpc('tienda_evento', { p_vendedor: this.vendedoraId, p_tipo: tipo, p_producto: producto, p_sesion: this.sesion }).then();
  }

  /** Categorías con productos, de la que más tiene a la que menos ("Otros" al final) */
  categorias = computed(() => {
    const n = new Map<string, number>();
    for (const p of this.t()?.productos ?? []) if (p.categoria) n.set(p.categoria, (n.get(p.categoria) ?? 0) + 1);
    return [...n].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => (a.nombre === 'Otros' ? 1 : b.nombre === 'Otros' ? -1 : b.n - a.n));
  });

  elegirCategoria(c: string | null): void {
    this.categoria.set(c);
    this.limite.set(40);
    this.scroll?.nativeElement.scrollTo({ top: 0 });
  }

  filtrados = computed(() => {
    const q = normal(this.q());
    const c = this.categoria();
    const f = this.soloFavs() ? this.favs() : null;
    return (this.t()?.productos ?? []).filter((p) => (!q || normal(p.nombre).includes(q)) && (!this.soloDisp() || !p.agotado) && (!c || p.categoria === c) && (!f || f.has(p.id)));
  });
  /** Favoritos del cliente (se guardan en su celular) */
  favs = signal<Set<string>>(TiendaPage.leerFavs());
  soloFavs = signal(false);
  /** Foto del banner: el más vendido con foto */
  heroImg = computed(() => this.masVendidos().find((p) => p.imagen_url)?.imagen_url ?? (this.t()?.productos ?? []).find((p) => p.imagen_url && !p.agotado)?.imagen_url ?? null);

  private static leerFavs(): Set<string> {
    try {
      return new Set((JSON.parse(localStorage.getItem('tienda-favoritos') ?? '[]') as unknown[]).map(String));
    } catch {
      return new Set();
    }
  }

  alternarFav(p: ProductoTienda): void {
    const n = new Set(this.favs());
    const on = !n.has(p.id);
    if (on) n.add(p.id);
    else n.delete(p.id);
    this.favs.set(n);
    if (!n.size) this.soloFavs.set(false);
    this.guardarFavsLocal(n);
    // Con cuenta: también queda en la cuenta (así los ve en cualquier celular)
    if (this.cli.perfil()) void this.cli.favorito(p.id, on);
    else if (on) this.avisar('♥ Guardado en este celular · ingresa a tu cuenta para tenerlos en cualquier lado');
  }
  private guardarFavsLocal(n: Set<string>): void {
    try {
      localStorage.setItem('tienda-favoritos', JSON.stringify([...n]));
    } catch { /* sin almacenamiento */ }
  }
  /** Al entrar con cuenta: los favoritos del celular se suben y se unen con los de la cuenta (una vez) */
  private favsUnidos = false;
  private async unirFavoritos(enCuenta: string[]): Promise<void> {
    if (this.favsUnidos) return;
    this.favsUnidos = true;
    const cuenta = new Set(enCuenta);
    const faltan = [...this.favs()].filter((id) => !cuenta.has(id));
    for (const id of faltan) {
      const r = await this.cli.favorito(id, true);
      if (r) r.forEach((x) => cuenta.add(x));
    }
    const todos = new Set([...cuenta]);
    this.favs.set(todos);
    this.guardarFavsLocal(todos);
  }

  irAProductos(): void {
    document.getElementById('t-productos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  unidades = computed(() => this.lineas().reduce((s, l) => s + l.cantidad, 0));
  subtotal = computed(() => this.lineas().reduce((s, l) => s + l.cantidad * l.precio, 0));
  /** Domicilio de la tabla de barrios; null si el barrio no está (lo confirma el vendedor) */
  domicilio = computed(() => {
    const b = this.barrioElegido();
    const f = b ? (this.t()?.barrios ?? []).find((x) => x.barrio === b) : undefined;
    return f ? Number(f.domicilio) : null;
  });

  /** Barrios de la lista que empiezan o contienen lo que va escribiendo (hasta 6) */
  sugerencias = computed(() => {
    const q = normal(this.barrio());
    if (!this.enBarrio() || this.barrioElegido() || q.length < 2) return [];
    const lista = this.t()?.barrios ?? [];
    const puntos = (b: string) => {
      const n = normal(b);
      const partes = n.split(/ - |, | \/ /);
      if (n.startsWith(q) || partes.some((x) => x.startsWith(q))) return 3;
      if (n.split(' ').some((w) => w.startsWith(q))) return 2;
      if (n.includes(q)) return 1;
      return 0;
    };
    return lista.map((b) => ({ ...b, p: puntos(b.barrio) })).filter((b) => b.p > 0)
      .sort((a, b) => b.p - a.p || a.barrio.localeCompare(b.barrio)).slice(0, 6);
  });

  /** Si no está en la lista: los más parecidos (por si lo escribió distinto) */
  parecidos = computed(() => {
    const q = normal(this.barrio());
    if (q.length < 3) return [];
    return (this.t()?.barrios ?? [])
      .map((b) => {
        const n = normal(b.barrio);
        const partes = [n, ...n.split(/ - |, | \/ /)];
        const palabras = q.split(' ').filter((w) => w.length >= 3);
        const porPalabra = palabras.length ? palabras.filter((w) => n.includes(w)).length / palabras.length * 0.9 : 0;
        return { ...b, s: Math.max(porPalabra, ...partes.map((x) => parecido(q, x))) };
      })
      .filter((b) => b.s >= 0.45).sort((a, b) => b.s - a.s).slice(0, 4);
  });

  errNombre(): string {
    return /\p{L}/u.test(this.nombre) ? '' : 'Escribe tu nombre.';
  }
  errTel(): string {
    return !this.telefono ? 'Escribe tu celular.' : this.errorTel();
  }
  errDir(): string {
    return this.direccion.trim().length < 5 ? 'Escribe tu dirección completa (calle, número y apto o casa).' : '';
  }
  errBarrio(): string {
    if (this.barrio().trim().length < 2) return 'Escribe tu barrio.';
    if (!this.barrioElegido()) return 'Elige tu barrio de la lista. Si no eres de Cali, escribe solo el nombre de tu ciudad.';
    return '';
  }

  escribirBarrio(v: string): void {
    this.barrio.set(v);
    this.enBarrio.set(true);
    // Si lo escribió igual a uno de la lista (sin importar tildes o mayúsculas), queda elegido
    const n = normal(v);
    this.barrioElegido.set((this.t()?.barrios ?? []).find((x) => normal(x.barrio) === n)?.barrio ?? null);
  }

  elegirBarrio(b: string): void {
    this.barrio.set(b);
    this.barrioElegido.set(b);
    this.enBarrio.set(false);
  }

  salirBarrio(): void {
    // Un momento, para que alcance a tocar una sugerencia
    setTimeout(() => this.enBarrio.set(false), 150);
  }
  fotos = computed(() => {
    const p = this.sel();
    if (!p) return [];
    const c = p.colores.find((x) => x.nombre === this.color());
    const todas = [c?.imagen_url, p.imagen_url, ...this.fotosExtra()].map((f) => urlImagen(f)).filter((f): f is string => !!f);
    return [...new Set(todas)];
  });

  constructor() {
    // El carrito se guarda en este celular por si cierra la página
    effect(() => {
      const l = this.lineas();
      try {
        localStorage.setItem(this.clave, JSON.stringify(l));
      } catch {
        /* sin almacenamiento */
      }
    });
    // Estimado de entrega cada vez que cambia el barrio
    effect(() => {
      const b = this.barrioElegido();
      untracked(() => this.pedirEstimado(b));
    });
    // Con cuenta de cliente: sus favoritos (de la cuenta y de este celular) quedan unidos
    effect(() => {
      const p = this.cli.perfil();
      if (p) void untracked(() => this.unirFavoritos(p.favoritos ?? []));
    });
    // Con cuenta de cliente: ¿está activo el pago con tarjeta aquí mismo?
    effect(() => {
      if (this.cli.perfil() && !this.cfgTarjeta()) void untracked(() => this.cli.configTarjeta()).then((c) => this.cfgTarjeta.set(c));
    });
    // Si cambia el carrito, el pedido que quedó esperando pago ya no sirve: el siguiente intento crea uno nuevo
    effect(() => {
      this.lineas();
      this.codigoPendiente = null;
    });
    // Cliente con cuenta: sus datos y su dirección principal salen llenos (una vez, ya con la lista de barrios)
    effect(() => {
      const p = this.cli.perfil();
      const t = this.t();
      if (!p || !t || this.datosCuentaPuestos) return;
      this.datosCuentaPuestos = true;
      untracked(() => {
        if (p.nombre) this.nombre = p.nombre;
        if (p.telefono) { this.prefijo = p.prefijo || '57'; this.telefono = p.telefono; }
        const d = p.direcciones.find((x) => x.principal) ?? p.direcciones[0];
        if (d) this.usarDireccion(d);
        else this.dirSel.set('otra');
      });
    });
  }

  elegirTarjeta(id: number | 'nueva'): void {
    this.formaPago.set('tarjeta');
    this.tarjetaSel.set(id);
    this.pagoMensaje.set('');
    if (id === 'nueva') setTimeout(() => document.getElementById('tcn')?.focus(), 50);
  }
  escribirNumero(v: string): void {
    const d = v.replace(/\D/g, '').slice(0, 19);
    this.tNumero.set(d.replace(/(\d{4})(?=\d)/g, '$1 '));
  }
  escribirVence(v: string): void {
    const d = v.replace(/\D/g, '').slice(0, 4);
    this.tVence = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
  }
  abrevMarca(m: string | null): string {
    const x = (m || '').toUpperCase();
    return x.startsWith('VISA') ? 'VISA' : x.startsWith('MASTER') ? 'MC' : x.startsWith('AMEX') || x.startsWith('AMERICAN') ? 'AMEX' : x.startsWith('DINERS') ? 'DC' : '••';
  }
  cuotaDe(n: number): number {
    return Math.ceil(this.total() / n / 100) * 100;
  }
  /** Revisa la tarjeta nueva antes de crear el pedido */
  private errorTarjeta(): string {
    if (!luhn(this.tNumero())) return 'Revisa el número de la tarjeta.';
    if (this.tTitular.trim().length < 3) return 'Escribe el nombre como aparece en la tarjeta.';
    const m = /^(\d{2})\/(\d{2})$/.exec(this.tVence);
    if (!m || +m[1] < 1 || +m[1] > 12) return 'Escribe el vencimiento así: 08/29.';
    const hoy = new Date();
    const fin = new Date(2000 + +m[2], +m[1], 0);
    if (fin < new Date(hoy.getFullYear(), hoy.getMonth(), 1)) return 'Esa tarjeta ya está vencida.';
    if (!/^\d{3,4}$/.test(this.tCvc)) return 'Escribe el código de seguridad (3 o 4 números de atrás).';
    return '';
  }

  irCuenta(): void {
    void this.router.navigate(['/tienda/cuenta'], { queryParams: { volver: location.pathname + location.search } });
  }

  iniciales(n: string): string {
    const p = n.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '·';
  }

  /** Elige una dirección guardada: llena dirección y barrio (las indicaciones van en observaciones) */
  usarDireccion(d: ClienteDireccion): void {
    this.dirSel.set(d.id);
    this.direccion = d.direccion;
    this.escribirBarrio(d.barrio);
    this.enBarrio.set(false);
    // Las indicaciones de la dirección van en observaciones (y se quitan las de la dirección anterior)
    const sin = this.indicacionesPuestas ? this.observaciones.replace(' · ' + this.indicacionesPuestas, '').replace(this.indicacionesPuestas, '').replace(/^ · /, '').trim() : this.observaciones;
    this.observaciones = d.indicaciones ? (sin ? sin + ' · ' : '') + d.indicaciones : sin;
    this.indicacionesPuestas = d.indicaciones ?? '';
  }
  private indicacionesPuestas = '';

  otraDireccion(): void {
    if (this.indicacionesPuestas) {
      this.observaciones = this.observaciones.replace(' · ' + this.indicacionesPuestas, '').replace(this.indicacionesPuestas, '').replace(/^ · /, '').trim();
      this.indicacionesPuestas = '';
    }
    this.dirSel.set('otra');
    this.direccion = '';
    this.barrio.set('');
    this.barrioElegido.set(null);
    this.guardarDir = true;
    setTimeout(() => document.getElementById('td')?.focus(), 50);
  }

  /** Después del pedido: guarda en la cuenta la dirección nueva y el celular si no lo tenía */
  private async guardarEnCuenta(): Promise<void> {
    const p = this.cli.perfil();
    if (!p) return;
    try {
      if (!p.telefono || !p.nombre) {
        await this.cli.guardarDatos({ nombre: this.nombre.trim(), prefijo: this.prefijo, telefono: this.telefono, tipo_doc: p.tipo_doc, documento: p.documento ?? '' });
      }
      const nueva = !this.misDirs().length || this.dirSel() === 'otra';
      const yaEsta = this.misDirs().some((d) => d.direccion.trim().toLowerCase() === this.direccion.trim().toLowerCase() && d.barrio === this.barrioOficial());
      if (nueva && this.guardarDir && !yaEsta && this.barrioOficial()) {
        await this.cli.guardarDireccion({ id: null, etiqueta: this.misDirs().length ? 'Otra' : 'Casa', direccion: this.direccion.trim(), barrio: this.barrioOficial(), indicaciones: '', principal: !this.misDirs().length });
      }
    } catch { /* no es grave: el pedido ya quedó */ }
  }

  async ngOnInit(): Promise<void> {
    const codigo = this.route.snapshot.paramMap.get('codigo');
    if (codigo) {
      // Código del vendedor: los primeros 8 caracteres de su id al final del enlace
      const id = codigo.toLowerCase().match(/([0-9a-f]{8})$/)?.[1];
      if (!id) return this.cargando.set(false);
      this.vendedoraId = id;
    }
    this.clave = 'tienda-carrito-' + (this.vendedoraId ?? 'general');
    this.leerGuardados();
    try {
      const guardado = JSON.parse(localStorage.getItem(this.clave) ?? '[]') as Linea[];
      if (Array.isArray(guardado)) this.lineas.set(guardado);
    } catch {
      /* nada guardado */
    }
    const { data } = await this.sb.client.rpc('tienda', { p_vendedor: this.vendedoraId });
    this.cargando.set(false);
    if (!data) return;
    const t = data as Tienda;
    this.t.set(t);
    this.evento('visita');
    // El barrio guardado se vuelve a buscar ya con la lista de domicilios
    if (this.barrio()) { this.escribirBarrio(this.barrio()); this.enBarrio.set(false); }
    // Lo guardado se ajusta a lo que hay hoy (precio, agotados)
    const porId = new Map(t.productos.map((p) => [p.id, p]));
    this.lineas.update((ls) => ls.filter((l) => porId.has(l.producto_id) && !porId.get(l.producto_id)!.agotado)
      .map((l) => ({ ...l, precio: Number(porId.get(l.producto_id)!.precio), max: this.maximo(porId.get(l.producto_id)!) })));
    document.title = (t.vendedora ? 'Catálogo de ' + this.primerNombre(t.vendedora.nombre) : 'Catálogo') + ' · ' + (t.negocio || 'Variedades JYB');
    this.revisarEntrada();
  }

  /**
   * Lo que pide la entrada a la tienda: "Volver a comprar" (desde Mis compras) o un producto directo (?p=<id>).
   * Se revisa al abrir y cada vez que se vuelve a la tienda (la app reutiliza la pantalla que ya estaba abierta).
   */
  private revisarEntrada(): void {
    const t = this.t();
    if (!t) return;
    try {
      const rep = JSON.parse(sessionStorage.getItem('tienda-repetir') ?? 'null') as { items?: UltimoPedido['items'] } | null;
      if (rep?.items?.length) {
        sessionStorage.removeItem('tienda-repetir');
        this.repetir({ fecha: '', items: rep.items });
        return;
      }
    } catch { /* sin almacenamiento */ }
    const pid = new URLSearchParams(location.search).get('p');
    if (!pid || this.sel()?.id === pid) return;
    const directo = t.productos.find((x) => x.id === pid);
    if (directo) void this.abrir(directo);
    else this.avisoProducto.set('Ese producto ya no está disponible. Mira los demás 👇');
  }

  /** Al volver a la tienda desde Mi cuenta (pantalla reutilizada) */
  ionViewWillEnter(): void {
    this.revisarEntrada();
  }

  primerNombre(n: string): string {
    return n.trim().split(/\s+/)[0];
  }

  maximo(p: ProductoTienda): number {
    return Math.min(20, p.disponibles ?? 20);
  }

  enCarrito(p: ProductoTienda): boolean {
    return this.lineas().some((l) => l.producto_id === p.id);
  }

  /** Aviso cuando el enlace era de un producto que ya no está */
  avisoProducto = signal('');

  /** Comparte el producto abierto (con el mismo catálogo de el vendedor) */
  async compartirProducto(p: ProductoTienda): Promise<void> {
    const url = `${location.origin}${location.pathname}?p=${p.id}`;
    try {
      if (navigator.share) return void (await navigator.share({ title: p.nombre, text: `Mira este producto: ${p.nombre}`, url }));
      await navigator.clipboard.writeText(url);
      this.avisoCopiado.set(true);
      setTimeout(() => this.avisoCopiado.set(false), 2000);
    } catch { /* lo cerró */ }
  }
  avisoCopiado = signal(false);

  /** Pantallas completas (detalle y pedido): el botón atrás del celular las cierra */
  private enPantalla = false;
  private abrirPantalla(): void {
    if (this.enPantalla) return;
    this.enPantalla = true;
    try { history.pushState({ tiendaPantalla: true }, ''); } catch { /* sin historial */ }
  }
  /** Pasa a "Finaliza tu compra" (con su propio paso en el historial, para el botón atrás del celular) */
  irFinalizar(): void {
    if (!this.lineas().length) return;
    this.paso.set('finalizar');
    this.verDirecciones.set(false);
    this.editarContacto.set(!this.contactoListo());
    try { history.pushState({ tiendaPantalla: true, finalizar: true }, ''); } catch { /* sin historial */ }
    setTimeout(() => document.querySelector('.fc')?.scrollTo({ top: 0 }), 0);
  }
  volverAlCarrito(): void {
    if (history.state?.finalizar) return history.back();
    this.paso.set('carrito');
  }
  /** Nombre y celular ya están bien: se muestran en una línea con "Cambiar" */
  contactoListo(): boolean {
    return !this.errNombre() && !this.errTel();
  }
  /** Estimado de entrega aprendido de las entregas anteriores (por hora y barrio) */
  estimado = signal<{ cuando: 'hoy' | 'manana'; desde?: string; hasta?: string } | null>(null);
  private barrioEstimado = '';
  textoLlegada(): string {
    const e = this.estimado();
    if (!e?.desde || !e.hasta) return e?.cuando === 'manana' ? 'Llega mañana' : this.llegada();
    const [d, a] = [this.hora12(e.desde), this.hora12(e.hasta)];
    const rango = d.sufijo === a.sufijo ? `${d.h} y ${a.h} ${a.sufijo}` : `${d.h} ${d.sufijo} y ${a.h} ${a.sufijo}`;
    return `Llega ${e.cuando === 'hoy' ? 'hoy' : 'mañana'} entre ${rango}`;
  }
  private hora12(hhmm: string): { h: string; sufijo: string } {
    const [H, M] = hhmm.split(':').map(Number);
    return { h: `${H % 12 || 12}:${String(M).padStart(2, '0')}`, sufijo: H < 12 ? 'a. m.' : 'p. m.' };
  }
  private pedirEstimado(barrio: string | null): void {
    if (!barrio || barrio === this.barrioEstimado) return;
    this.barrioEstimado = barrio;
    void this.sb.client.rpc('tienda_estimado', { p_barrio: barrio }).then(({ data, error }) => {
      if (!error && this.barrioEstimado === barrio) this.estimado.set(data as { cuando: 'hoy' | 'manana'; desde?: string; hasta?: string });
    });
  }

  /** "Llega hoy" si pide antes de las 2 p. m. (no domingo); si no, el siguiente día hábil (si no hay estimado) */
  llegada(): string {
    const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const dia = ahora.getDay();
    if (dia !== 0 && ahora.getHours() < 14) return 'Llega hoy';
    const sig = (dia + 1) % 7;
    if (sig === 0) return 'Llega el lunes';
    return dia === 0 ? 'Llega mañana' : 'Llega mañana';
  }
  irAlResumen(): void {
    document.querySelector('.fc-resumen')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  cerrarPantalla(): void {
    if (this.enPantalla && history.state?.finalizar) {
      // Cierra los dos pasos de una
      this.paso.set('carrito');
      return history.go(-2);
    }
    if (this.enPantalla && history.state?.tiendaPantalla) return history.back();
    this.enPantalla = false;
    this.sel.set(null);
    this.verCarrito.set(false);
  }
  @HostListener('window:popstate')
  alVolver(): void {
    // Atrás desde "Finaliza tu compra" vuelve a la lista de productos
    if (this.verCarrito() && this.paso() === 'finalizar' && history.state?.tiendaPantalla) {
      this.paso.set('carrito');
      return;
    }
    this.enPantalla = false;
    this.sel.set(null);
    this.verCarrito.set(false);
  }
  abrirCarrito(): void {
    this.abrirPantalla();
    this.paso.set('carrito');
    this.sel.set(null);
    this.verCarrito.set(true);
  }

  /** Ícono de cada categoría (por palabras, así aguanta nombres parecidos) */
  icono(c: string): string {
    const n = normal(c);
    const mapa: [RegExp, string][] = [
      [/jug|beb|nin/, '🧸'], [/organiz/, '🗂️'], [/cocin/, '🍳'], [/herram/, '🔧'], [/bellez|cuidad/, '💄'], [/tecno|celul|electr/, '📱'],
      [/limpi/, '🧽'], [/hogar|casa/, '🏠'], [/carro|moto/, '🏍️'], [/ilumin|solar|luz|lampar/, '💡'], [/deport|camp/, '⛺'], [/bols|malet/, '🎒'],
      [/mascot/, '🐾'], [/ropa|moda/, '👕'], [/salud/, '💊'], [/oficin|escol/, '✏️'],
    ];
    return mapa.find(([r]) => r.test(n))?.[1] ?? '🛍️';
  }

  /** Foto que se ve en el detalle */
  fotoI = signal(0);
  alDeslizar(el: HTMLElement): void {
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== this.fotoI()) this.fotoI.set(i);
  }
  verFoto(el: HTMLElement, i: number): void {
    this.fotoI.set(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }
  elegirColor(c: string, el: HTMLElement): void {
    this.color.set(c);
    // La foto del color queda de primera
    this.fotoI.set(0);
    el.scrollTo({ left: 0 });
  }

  resenas = signal<Resena[]>([]);
  verTodasResenas = signal(false);
  fechaCorta(iso: string): string {
    return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
  }

  avisoAgregado = signal('');
  private avisar(t: string): void {
    this.avisoAgregado.set(t);
    setTimeout(() => this.avisoAgregado() === t && this.avisoAgregado.set(''), 2200);
  }

  /** Último pedido hecho desde este celular (para repetirlo) */
  ultimo = signal<UltimoPedido | null>(null);
  resumenUltimo(u: UltimoPedido): string {
    const porId = new Map((this.t()?.productos ?? []).map((p) => [p.id, p]));
    const nombres = u.items.map((i) => porId.get(i.producto_id)?.nombre).filter((x): x is string => !!x);
    const n = u.items.reduce((s, i) => s + i.cantidad, 0);
    return `${n} ${n === 1 ? 'producto' : 'productos'}` + (nombres.length ? ' · ' + nombres.slice(0, 2).join(', ') + (nombres.length > 2 ? '…' : '') : '');
  }
  repetir(u: UltimoPedido): void {
    const porId = new Map((this.t()?.productos ?? []).map((p) => [p.id, p]));
    let faltan = 0;
    for (const i of u.items) {
      const p = porId.get(i.producto_id);
      const colorOk = !i.color || !!p?.colores.some((c) => c.nombre === i.color);
      const tallaOk = !i.talla || !!p?.tallas.includes(i.talla);
      if (!p || p.agotado || !colorOk || !tallaOk) { faltan++; continue; }
      this.agregar(p, i.cantidad, i.color, i.talla);
    }
    if (!this.lineas().length) return this.avisar('Esos productos ya no están disponibles 😕');
    this.abrirCarrito();
    if (faltan) this.avisar(faltan === 1 ? 'Un producto ya no está disponible' : `${faltan} productos ya no están disponibles`);
  }
  private claveUltimo(): string {
    return 'tienda-ultimo-' + (this.vendedoraId ?? 'general');
  }
  /** Guarda el pedido y los datos del cliente en este celular */
  private guardarUltimo(): void {
    try {
      const u: UltimoPedido = { fecha: new Date().toISOString(), items: this.lineas().map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, color: l.color, talla: l.talla })) };
      localStorage.setItem(this.claveUltimo(), JSON.stringify(u));
      localStorage.setItem('tienda-datos', JSON.stringify({ nombre: this.nombre.trim(), prefijo: this.prefijo, telefono: this.telefono, direccion: this.direccion.trim(), barrio: this.barrioOficial() }));
      this.ultimo.set(u);
    } catch { /* sin almacenamiento */ }
  }
  private leerGuardados(): void {
    try {
      const u = JSON.parse(localStorage.getItem(this.claveUltimo()) ?? 'null') as UltimoPedido | null;
      if (u && Array.isArray(u.items) && u.items.length) this.ultimo.set(u);
      const d = JSON.parse(localStorage.getItem('tienda-datos') ?? 'null') as { nombre?: string; prefijo?: string; telefono?: string; direccion?: string; barrio?: string } | null;
      if (d) {
        this.nombre = d.nombre ?? '';
        this.prefijo = d.prefijo || '57';
        this.telefono = d.telefono ?? '';
        this.direccion = d.direccion ?? '';
        if (d.barrio) this.escribirBarrio(d.barrio);
        this.enBarrio.set(false);
      }
    } catch { /* nada guardado */ }
  }

  @ViewChild('detalle') private detalle?: ElementRef<HTMLElement>;

  async abrir(p: ProductoTienda): Promise<void> {
    this.evento('ver', p.id);
    this.abrirPantalla();
    this.verCarrito.set(false);
    this.sel.set(p);
    this.fotoI.set(0);
    this.resenas.set([]);
    this.verTodasResenas.set(false);
    this.detalle?.nativeElement.scrollTo({ top: 0 });
    if (p.resenas) {
      void this.sb.client.rpc('tienda_resenas', { p_producto: p.id }).then(({ data }) => {
        if (this.sel()?.id === p.id && Array.isArray(data)) this.resenas.set(data as Resena[]);
      });
    }
    this.color.set(p.colores.length === 1 ? p.colores[0].nombre : null);
    this.talla.set(p.tallas.length === 1 ? p.tallas[0] : null);
    this.cant.set(1);
    this.errorSel.set('');
    this.descripcion.set('');
    this.fotosExtra.set([]);
    const { data } = await this.sb.client.rpc('tienda_producto', { p_id: p.id });
    if (this.sel()?.id !== p.id || !data) return;
    const d = data as { descripcion: string | null; imagenes: string[] };
    this.descripcion.set(d.descripcion ?? '');
    this.fotosExtra.set(d.imagenes ?? []);
  }

  private elegido(p: ProductoTienda): boolean {
    if (p.colores.length && !this.color()) return this.errorSel.set('Elige el color.'), false;
    if (p.tallas.length && !this.talla()) return this.errorSel.set('Elige la talla.'), false;
    this.agregar(p, this.cant(), this.color(), this.talla());
    return true;
  }

  /** Agrega y vuelve al catálogo */
  agregarSel(p: ProductoTienda): void {
    if (!this.elegido(p)) return;
    this.cerrarPantalla();
    this.avisar('✓ Agregado a tu pedido');
  }

  /** Agrega y abre de una vez el pedido para terminarlo */
  comprarYa(p: ProductoTienda): void {
    if (this.elegido(p)) this.abrirCarrito();
  }

  private agregar(p: ProductoTienda, cantidad: number, color: string | null, talla: string | null): void {
    this.evento('agregar', p.id);
    const max = this.maximo(p);
    this.lineas.update((ls) => {
      const i = ls.findIndex((l) => l.producto_id === p.id && l.color === color && l.talla === talla);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, cantidad: Math.min(max, l.cantidad + cantidad) } : l));
      return [...ls, { producto_id: p.id, nombre: p.nombre, precio: Number(p.precio), imagen_url: p.imagen_url, cantidad: Math.min(max, cantidad), color, talla, max }];
    });
  }

  cambiar(i: number, d: number): void {
    const l = this.lineas()[i];
    if (l.cantidad + d < 1) return this.quitar(i);
    this.lineas.update((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: Math.min(x.max, x.cantidad + d) } : x)));
  }

  quitar(i: number): void {
    this.lineas.update((ls) => ls.filter((_, k) => k !== i));
  }

  variante(l: Linea): string {
    return [l.color, l.talla].filter((x) => !!x).join(' · ');
  }

  limpiar(v: string): string {
    return limpiarNombre(v);
  }

  cambioTel(v: string): void {
    let n = (v ?? '').replace(/\D/g, '');
    if (this.prefijo === '57' && n.length > 10 && n.startsWith('57')) n = n.slice(2);
    this.telefono = n.slice(0, this.prefijo === '57' ? 10 : 14);
    const el = document.getElementById('tt') as HTMLInputElement | null;
    if (el && el.value !== this.telefono) el.value = this.telefono;
  }

  /** El barrio como está en la tabla de domicilios (si lo escribió distinto), o tal cual */
  barrioOficial(): string {
    return this.barrioElegido() ?? this.barrio().trim();
  }

  errorTel(): string {
    return errorTelefono(this.prefijo, this.telefono);
  }

  telefonoMostrar(): string {
    return this.prefijo === '57' ? this.telefono : '+' + this.prefijo + ' ' + this.telefono;
  }

  async enviar(): Promise<void> {
    this.error.set('');
    this.intentado.set(true);
    const falta = this.errNombre() || this.errTel() || this.errDir() || this.errBarrio();
    if (falta) {
      // Lleva al primer dato que falta
      const id = this.errNombre() ? 'tn' : this.errTel() ? 'tt' : this.errDir() ? 'td' : 'tb';
      document.getElementById(id)?.focus();
      return this.error.set('Revisa los datos marcados en rojo.');
    }
    // Con tarjeta: primero la tarjeta (si es nueva, Wompi la convierte en token) y después el pedido
    const conTarjeta = this.formaPago() === 'tarjeta';
    this.pagoMensaje.set('');
    if (conTarjeta && !this.tarjetaSel()) return this.pagoMensaje.set('Elige una tarjeta.');
    if (conTarjeta && this.tarjetaSel() === 'nueva') {
      const malo = this.errorTarjeta();
      if (malo) return this.pagoMensaje.set(malo);
    }
    this.enviando.set(true);
    let token: { id: string; brand: string; last_four: string; exp_month: string; exp_year: string; card_holder: string } | null = null;
    if (conTarjeta && this.tarjetaSel() === 'nueva') {
      try {
        const [mes, anio] = this.tVence.split('/');
        token = await this.cli.tokenizar({ numero: this.tNumero(), titular: this.tTitular, mes, anio, cvc: this.tCvc });
      } catch (e) {
        this.enviando.set(false);
        return this.pagoMensaje.set((e as Error).message);
      }
    }
    if (conTarjeta && this.codigoPendiente) return this.cobrarTarjeta(this.codigoPendiente, token, null);
    const { data, error } = await this.sb.client.rpc('tienda_pedir', {
      p_vendedor: this.vendedoraId, p_nombre: this.nombre.trim(), p_telefono: unirTelefono(this.prefijo, this.telefono),
      p_direccion: this.direccion.trim(), p_barrio: this.barrioOficial(), p_observaciones: this.observaciones.trim(),
      p_items: this.lineas().map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, color: l.color, talla: l.talla })),
      p_pago: this.enLinea() ? 'en_linea' : 'contra_entrega',
      p_cupon: this.cupon()?.codigo ?? null,
    });
    if (error) {
      this.enviando.set(false);
      return this.error.set(mensajeError(error));
    }
    const r = data as { id: number; codigo: string; subtotal: number; domicilio: number; domicilio_por_confirmar: boolean; pago: string };
    this.guardarUltimo();
    await this.guardarEnCuenta();
    if (conTarjeta) return this.cobrarTarjeta(r.codigo, token, r);
    if (r.pago === 'en_linea') {
      // El pedido ya quedó guardado: se va a Wompi a pagar (y si algo falla, la página del pago deja reintentar)
      this.lineas.set([]);
      this.cupon.set(null);
      const pago = await this.sb.client.functions.invoke('wompi-pagar', { body: { codigo: r.codigo, origen: location.origin } });
      const url = (pago.data as { url?: string } | null)?.url;
      location.assign(url && url.startsWith('https://checkout.wompi.co/') ? url : `/pago/${r.codigo}`);
      return;
    }
    this.enviando.set(false);
    this.hecho.set({ id: r.id, total: Number(r.subtotal) + Number(r.domicilio), domicilioPendiente: r.domicilio_por_confirmar, codigo: r.codigo });
    this.lineas.set([]);
    this.cupon.set(null);
    this.cerrarPantalla();
    this.scroll?.nativeElement.scrollTo({ top: 0 });
  }

  /** Cobra el pedido con la tarjeta elegida (guardada o nueva) sin salir de la tienda */
  private async cobrarTarjeta(codigo: string, token: { id: string; brand: string; last_four: string; exp_month: string; exp_year: string; card_holder: string } | null,
    r: { id: number; subtotal: number; domicilio: number; domicilio_por_confirmar: boolean } | null): Promise<void> {
    this.codigoPendiente = codigo;
    try {
      const sel = this.tarjetaSel();
      const res = await this.cli.pagarConTarjeta({
        codigo, cuotas: this.cuotas(),
        ...(typeof sel === 'number' ? { tarjeta_id: sel } : {
          token: token!.id, guardar: this.tGuardar,
          tarjeta: { marca: token!.brand, ultimos4: token!.last_four, titular: token!.card_holder, exp_mes: token!.exp_month, exp_anio: token!.exp_year },
        }),
      });
      if (res.guardada) void this.cli.cargar();
      if (res.pagado) {
        this.codigoPendiente = null;
        this.enviando.set(false);
        this.tNumero.set(''); this.tCvc = ''; this.tVence = ''; this.tTitular = '';
        this.hecho.set({ id: r?.id ?? 0, total: this.total(), domicilioPendiente: !!r?.domicilio_por_confirmar, codigo, pagado: true });
        this.lineas.set([]);
        this.cupon.set(null);
        this.cerrarPantalla();
        this.scroll?.nativeElement.scrollTo({ top: 0 });
        return;
      }
      if (res.estado === 'PENDING') {
        // El banco todavía no responde: la página del pedido muestra cuando se apruebe
        this.lineas.set([]);
        location.assign(`/pago/${codigo}`);
        return;
      }
      this.enviando.set(false);
      this.pagoMensaje.set('Tu banco no aprobó el pago' + (res.mensaje ? ` (${res.mensaje})` : '') + '. Intenta con otra tarjeta o elige otro medio de pago.');
    } catch (e) {
      this.enviando.set(false);
      this.pagoMensaje.set((e as Error).message);
    }
  }

  /** WhatsApp de la tienda para que el cliente pida ayuda con su barrio */
  whatsappAyuda(): string | null {
    const t = this.t();
    const tel = (t?.vendedora?.telefono ?? t?.telefonos?.split(/[-,/]/)[0] ?? '').replace(/\D/g, '');
    if (tel.length < 7) return null;
    const num = tel.length === 10 ? '57' + tel : tel;
    return `https://wa.me/${num}?text=${encodeURIComponent(`Hola, quiero hacer un pedido del catálogo pero no encuentro mi barrio: ${this.barrio().trim()}.`)}`;
  }

  whatsapp(): string | null {
    const t = this.t();
    const tel = (t?.vendedora?.telefono ?? t?.telefonos?.split(/[-,/]/)[0] ?? '').replace(/\D/g, '');
    if (tel.length < 7) return null;
    const num = tel.length === 10 ? '57' + tel : tel;
    return `https://wa.me/${num}?text=${encodeURIComponent(`Hola, acabo de hacer un pedido en el catálogo a nombre de ${this.nombre.trim()}.`)}`;
  }

  /** WhatsApp de el vendedor para preguntarle algo desde su catálogo */
  whatsappVendedora(): string | null {
    const v = this.t()?.vendedora;
    const tel = (v?.telefono ?? '').replace(/\D/g, '');
    if (!v || tel.length < 7) return null;
    const num = tel.length === 10 ? '57' + tel : tel;
    return `https://wa.me/${num}?text=${encodeURIComponent(`Hola ${this.primerNombre(v.nombre)}, vi tu catálogo y tengo una pregunta.`)}`;
  }
}
