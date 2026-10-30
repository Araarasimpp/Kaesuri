import { Component, ElementRef, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { SupabaseService } from '../core/services/supabase.service';
import { mensajeError, pesos, urlImagen, urlMini } from '../shared/formato';
import { PAISES, bandera, errorTelefono, limpiarNombre, unirTelefono } from '../shared/paises';
import { SkeletonComponent } from '../shared/skeleton/skeleton.component';

interface Color { nombre: string; hex: string | null; imagen_url: string | null }
interface ProductoTienda {
  id: string; nombre: string; precio: number; imagen_url: string | null; tallas: string[]; colores: Color[];
  agotado: boolean; disponibles: number | null; categoria?: string | null;
}
interface Tienda {
  negocio: string | null; telefonos: string | null;
  vendedora: { id: string; nombre: string; telefono: string | null } | null;
  barrios: { barrio: string; domicilio: number }[];
  productos: ProductoTienda[];
}
interface Linea { producto_id: string; nombre: string; precio: number; imagen_url: string | null; cantidad: number; color: string | null; talla: string | null; max: number }
interface Hecho { id: number; total: number; domicilioPendiente: boolean }

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
  host: { class: 'jt' },
  imports: [SkeletonComponent, FormsModule],
  styles: [
    `
      /* Ionic deja el body fijo y le pone contain: layout a la página (lo "fijo" queda pegado a ella):
         la página se queda quieta y lo que se desplaza es .scroll; la barra y las hojas quedan fijas en pantalla */
      :host { display: block; background: var(--bg); color: var(--text); }
      .scroll { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; }
      .caja { max-width: 1080px; margin: 0 auto; padding: calc(16px + env(safe-area-inset-top)) 16px calc(96px + env(safe-area-inset-bottom)); }
      .marca { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .marca img { width: 44px; height: 44px; border-radius: 12px; background: #fff; object-fit: contain; }
      .marca h1 { margin: 0; font-size: 19px; line-height: 1.2; }
      .marca small { display: block; font-size: 13px; color: var(--text-soft); }
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
      .barrio-nuevo { margin: 6px 0 0; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--oro-wash); color: var(--oro-texto); font-size: 13px; line-height: 1.4; }
      .barrio-nuevo .link { border: 0; background: none; color: inherit; text-decoration: underline; font: inherit; cursor: pointer; padding: 0 0 0 4px; }
      .barrio-falta { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--danger-wash); color: var(--text); font-size: 13.5px; }
      .barrio-falta strong { color: var(--danger); }
      .chips-barrio { display: flex; flex-wrap: wrap; gap: 6px; }
      .chips-barrio button { height: 34px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; font-size: 13.5px; cursor: pointer; }
      .totales { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 14px; }
      .totales div { display: flex; justify-content: space-between; gap: 10px; }
      .totales .fin { font-size: 16px; font-weight: 700; }
      .totales .num { font-family: var(--mono-font); }
      .nota { margin: 0; font-size: 12.5px; color: var(--text-muted); }
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
        <img src="assets/icon/logo.png" alt="" />
        <div>
          <h1>{{ t()?.negocio || 'Variedades JYB' }}</h1>
          <small>{{ t()?.vendedora ? 'Catálogo de ' + primerNombre(t()!.vendedora!.nombre) : 'Catálogo' }} · Pide aquí y te lo llevamos</small>
        </div>
      </header>

      @if (hecho(); as h) {
        <section class="listo" role="status">
          <div class="ok" aria-hidden="true">✓</div>
          <h2>¡Recibimos tu pedido!</h2>
          <p>{{ t()?.vendedora ? primerNombre(t()!.vendedora!.nombre) : 'La tienda' }} te va a llamar o escribir al {{ telefonoMostrar() }} para confirmarlo. Después de confirmado, te lo enviamos.</p>
          <p><strong>Total: {{ pesos(h.total) }}</strong>{{ h.domicilioPendiente ? ' + domicilio (te lo confirman)' : ', domicilio incluido' }}</p>
          @if (whatsapp(); as w) { <a class="wa" [href]="w" target="_blank" rel="noopener">Escribir por WhatsApp</a> }
          <button class="b mas" (click)="hecho.set(null)">Seguir viendo productos</button>
        </section>
      } @else if (t(); as tienda) {
        @if (avisoProducto()) { <p class="aviso-prod" role="status">{{ avisoProducto() }}</p> }
        <div class="filtros">
          <input type="search" [ngModel]="q()" (ngModelChange)="q.set($event); limite.set(40)" placeholder="Buscar producto" aria-label="Buscar producto" />
          <button type="button" class="solo" [class.on]="soloDisp()" [attr.aria-pressed]="soloDisp()" (click)="soloDisp.set(!soloDisp())">Disponibles</button>
          @if (categorias().length > 1) {
            <div class="cats" role="group" aria-label="Categorías">
              <button type="button" [class.on]="!categoria()" [attr.aria-pressed]="!categoria()" (click)="elegirCategoria(null)">Todo</button>
              @for (c of categorias(); track c.nombre) {
                <button type="button" [class.on]="categoria() === c.nombre" [attr.aria-pressed]="categoria() === c.nombre" (click)="elegirCategoria(c.nombre)">{{ c.nombre }}<small>{{ c.n }}</small></button>
              }
            </div>
          }
        </div>
        <div class="rejilla">
          @for (p of filtrados().slice(0, limite()); track p.id) {
            <article class="prod" [class.agot]="p.agotado">
              <button type="button" class="foto" (click)="abrir(p)" [attr.aria-label]="'Ver ' + p.nombre">
                @if (urlMini(p.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" decoding="async" /> } @else { <span class="ini">{{ p.nombre.charAt(0) }}</span> }
                @if (p.agotado) { <span class="etq-agot">Agotado</span> }
              </button>
              <div class="info">
                <h2 (click)="abrir(p)">{{ p.nombre }}</h2>
                <span class="precio">{{ pesos(p.precio) }}</span>
                <button class="agregar" [disabled]="p.agotado" (click)="rapido(p)">{{ p.agotado ? 'Agotado' : enCarrito(p) ? 'Agregar otro' : 'Agregar' }}</button>
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

    @if (lineas().length && !verCarrito() && !sel() && !hecho()) {
      <button class="carrito" (click)="verCarrito.set(true)">
        <span>Ver mi pedido · {{ unidades() }} {{ unidades() === 1 ? 'producto' : 'productos' }}</span><strong>{{ pesos(subtotal()) }}</strong>
      </button>
    }

    @if (sel(); as p) {
      <button class="velo" aria-label="Cerrar" (click)="sel.set(null)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-prod">
        <div class="hoja-head"><h2 id="t-prod">{{ p.nombre }}</h2></div>
        <div class="hoja-body">
          <div class="galeria">
            @for (f of fotos(); track f) { <img [src]="f" alt="" loading="lazy" /> }
          </div>
          <div class="precio-fila">
            <span class="precio">{{ pesos(p.precio) }}</span>
            <button type="button" class="compartir-p" (click)="compartirProducto(p)">{{ avisoCopiado() ? '¡Enlace copiado!' : 'Compartir' }}</button>
          </div>
          @if (descripcion()) { <p class="desc">{{ descripcion() }}</p> }
          @if (p.colores.length) {
            <div class="campo"><span class="etq">Color</span>
              <div class="opciones">
                @for (c of p.colores; track c.nombre) {
                  <button type="button" class="op" [class.on]="color() === c.nombre" (click)="color.set(c.nombre)">
                    @if (c.hex) { <i [style.--tono]="c.hex"></i> }{{ c.nombre }}</button>
                }
              </div>
            </div>
          }
          @if (p.tallas.length) {
            <div class="campo"><span class="etq">Talla</span>
              <div class="opciones">
                @for (tl of p.tallas; track tl) { <button type="button" class="op" [class.on]="talla() === tl" (click)="talla.set(tl)">{{ tl }}</button> }
              </div>
            </div>
          }
          @if (!p.agotado) {
            <div class="campo"><span class="etq">Cantidad</span>
              <span class="paso">
                <button type="button" (click)="cant.set(cant() - 1)" [disabled]="cant() <= 1" aria-label="Menos">−</button>
                <span>{{ cant() }}</span>
                <button type="button" (click)="cant.set(cant() + 1)" [disabled]="cant() >= maximo(p)" aria-label="Más">+</button>
              </span>
            </div>
          }
          @if (errorSel()) { <p class="error" role="alert">{{ errorSel() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="sel.set(null)">Cerrar</button>
          <button class="b b-pri" [disabled]="p.agotado" (click)="agregarSel(p)">{{ p.agotado ? 'Agotado' : 'Agregar · ' + pesos(p.precio * cant()) }}</button>
        </div>
      </div>
    }

    @if (verCarrito()) {
      <button class="velo" aria-label="Cerrar" (click)="verCarrito.set(false)"></button>
      <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-car">
        <div class="hoja-head"><h2 id="t-car">Tu pedido</h2></div>
        <div class="hoja-body">
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
                  <button class="quitar" (click)="quitar($index)">Quitar</button>
                </span>
              </li>
            } @empty {
              <li><span></span><span class="nota">Todavía no has agregado productos.</span><span></span></li>
            }
          </ul>

          <p class="nota" style="margin: 4px 0 0">Los datos con <span class="obl">*</span> son obligatorios.</p>
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
          <div class="campo"><label for="td">Dirección <span class="obl">*</span></label>
            <input id="td" autocomplete="street-address" maxlength="200" required [class.mal]="intentado() && errDir()" [(ngModel)]="direccion" placeholder="Ej: Cra 45 # 12-30 apto 201" />
            @if (intentado() && errDir()) { <p class="error-campo">{{ errDir() }}</p> }</div>
          <div class="campo barrio-campo"><label for="tb">Barrio <span class="obl">*</span></label>
            <input id="tb" maxlength="120" autocomplete="off" required role="combobox" aria-autocomplete="list" [attr.aria-expanded]="sugerencias().length > 0"
              [class.mal]="intentado() && errBarrio()" [class.ok]="!!barrioElegido()" [ngModel]="barrio()" (ngModelChange)="escribirBarrio($event)"
              (focus)="enBarrio.set(true)" (blur)="salirBarrio()" placeholder="Escribe tu barrio y elígelo de la lista" />
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
            } @else if (barrioNoEsta()) {
              <p class="barrio-nuevo">Listo: te confirmamos el valor del domicilio a <strong>{{ barrio().trim() }}</strong> cuando te llamemos.
                <button type="button" class="link" (click)="barrioNoEsta.set(false); enBarrio.set(true)">Cambiar</button></p>
            } @else if (barrio().trim().length >= 3 && !enBarrio()) {
              <div class="barrio-falta" role="alert">
                <strong>No encontramos "{{ barrio().trim() }}" en la lista.</strong>
                @if (parecidos().length) {
                  <span>¿Es alguno de estos?</span>
                  <div class="chips-barrio">@for (b of parecidos(); track b.barrio) { <button type="button" (click)="elegirBarrio(b.barrio)">{{ b.barrio }}</button> }</div>
                }
                <button type="button" class="b" (click)="barrioNoEsta.set(true)">Mi barrio no está en la lista</button>
              </div>
            } @else if (intentado() && errBarrio() && !enBarrio()) { <p class="error-campo">{{ errBarrio() }}</p> }
          </div>
          <div class="campo"><label for="to">Observaciones (opcional)</label>
            <input id="to" maxlength="300" [(ngModel)]="observaciones" placeholder="Ej: llamar antes, portería, después de las 3 pm" /></div>

          <div class="totales">
            <div><span>Productos</span><span class="num">{{ pesos(subtotal()) }}</span></div>
            <div><span>Domicilio</span><span class="num">{{ domicilio() !== null ? pesos(domicilio()!) : barrioNoEsta() ? 'Te lo confirmamos' : 'Elige tu barrio' }}</span></div>
            <div class="fin"><span>Total</span><span class="num">{{ pesos(subtotal() + (domicilio() ?? 0)) }}</span></div>
          </div>
          <p class="nota">Pagas al recibir. Antes de enviarlo, {{ t()?.vendedora ? primerNombre(t()!.vendedora!.nombre) : 'la tienda' }} te contacta para confirmar tu pedido.</p>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
        <div class="hoja-pie">
          <button class="b" (click)="verCarrito.set(false)">Seguir comprando</button>
          <button class="b b-pri" (click)="enviar()" [disabled]="enviando() || !lineas().length">{{ enviando() ? 'Enviando…' : 'Hacer pedido' }}</button>
        </div>
      </div>
    }
  `,
})
export class TiendaPage implements OnInit {
  private sb = inject(SupabaseService);
  private route = inject(ActivatedRoute);

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
  /** El cliente dijo que su barrio no está: el domicilio se lo confirma la vendedora */
  barrioNoEsta = signal(false);
  enBarrio = signal(false);
  intentado = signal(false);
  error = signal('');
  enviando = signal(false);
  hecho = signal<Hecho | null>(null);

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

  /** Anota lo que pasa en el catálogo (para las estadísticas de la vendedora); si falla, no importa */
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
    return (this.t()?.productos ?? []).filter((p) => (!q || normal(p.nombre).includes(q)) && (!this.soloDisp() || !p.agotado) && (!c || p.categoria === c));
  });
  unidades = computed(() => this.lineas().reduce((s, l) => s + l.cantidad, 0));
  subtotal = computed(() => this.lineas().reduce((s, l) => s + l.cantidad * l.precio, 0));
  /** Domicilio de la tabla de barrios; null si el barrio no está (lo confirma la vendedora) */
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
    if (!this.barrioElegido() && !this.barrioNoEsta()) return 'Elige tu barrio de la lista o toca "Mi barrio no está en la lista".';
    return '';
  }

  escribirBarrio(v: string): void {
    this.barrio.set(v);
    this.barrioNoEsta.set(false);
    this.enBarrio.set(true);
    // Si lo escribió igual a uno de la lista (sin importar tildes o mayúsculas), queda elegido
    const n = normal(v);
    this.barrioElegido.set((this.t()?.barrios ?? []).find((x) => normal(x.barrio) === n)?.barrio ?? null);
  }

  elegirBarrio(b: string): void {
    this.barrio.set(b);
    this.barrioElegido.set(b);
    this.barrioNoEsta.set(false);
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
  }

  async ngOnInit(): Promise<void> {
    const codigo = this.route.snapshot.paramMap.get('codigo');
    if (codigo) {
      const id = codigo.toLowerCase().match(/([0-9a-f]{8})$/)?.[1];
      if (!id) return this.cargando.set(false);
      this.vendedoraId = id;
    }
    this.clave = 'tienda-carrito-' + (this.vendedoraId ?? 'general');
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
    // Lo guardado se ajusta a lo que hay hoy (precio, agotados)
    const porId = new Map(t.productos.map((p) => [p.id, p]));
    this.lineas.update((ls) => ls.filter((l) => porId.has(l.producto_id) && !porId.get(l.producto_id)!.agotado)
      .map((l) => ({ ...l, precio: Number(porId.get(l.producto_id)!.precio), max: this.maximo(porId.get(l.producto_id)!) })));
    document.title = (t.vendedora ? 'Catálogo de ' + this.primerNombre(t.vendedora.nombre) : 'Catálogo') + ' · ' + (t.negocio || 'Variedades JYB');
    // Enlace directo a un producto (?p=<id>): se abre solo
    const pid = this.route.snapshot.queryParamMap.get('p');
    const directo = pid ? t.productos.find((x) => x.id === pid) : undefined;
    if (directo) void this.abrir(directo);
    else if (pid) this.avisoProducto.set('Ese producto ya no está disponible. Mira los demás 👇');
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

  /** Comparte el producto abierto (con el mismo catálogo de la vendedora) */
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

  async abrir(p: ProductoTienda): Promise<void> {
    this.evento('ver', p.id);
    this.sel.set(p);
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

  /** Sin colores ni tallas se agrega directo; si tiene, se abre para elegir */
  rapido(p: ProductoTienda): void {
    if (p.agotado) return;
    if (p.colores.length > 1 || p.tallas.length > 1) return void this.abrir(p);
    this.agregar(p, 1, p.colores[0]?.nombre ?? null, p.tallas[0] ?? null);
  }

  agregarSel(p: ProductoTienda): void {
    if (p.colores.length && !this.color()) return this.errorSel.set('Elige el color.');
    if (p.tallas.length && !this.talla()) return this.errorSel.set('Elige la talla.');
    this.agregar(p, this.cant(), this.color(), this.talla());
    this.sel.set(null);
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
  private barrioOficial(): string {
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
    this.enviando.set(true);
    const { data, error } = await this.sb.client.rpc('tienda_pedir', {
      p_vendedor: this.vendedoraId, p_nombre: this.nombre.trim(), p_telefono: unirTelefono(this.prefijo, this.telefono),
      p_direccion: this.direccion.trim(), p_barrio: this.barrioOficial(), p_observaciones: this.observaciones.trim(),
      p_items: this.lineas().map((l) => ({ producto_id: l.producto_id, cantidad: l.cantidad, color: l.color, talla: l.talla })),
    });
    this.enviando.set(false);
    if (error) return this.error.set(mensajeError(error));
    const r = data as { id: number; subtotal: number; domicilio: number; domicilio_por_confirmar: boolean };
    this.hecho.set({ id: r.id, total: Number(r.subtotal) + Number(r.domicilio), domicilioPendiente: r.domicilio_por_confirmar });
    this.lineas.set([]);
    this.verCarrito.set(false);
    this.scroll?.nativeElement.scrollTo({ top: 0 });
  }

  whatsapp(): string | null {
    const t = this.t();
    const tel = (t?.vendedora?.telefono ?? t?.telefonos?.split(/[-,/]/)[0] ?? '').replace(/\D/g, '');
    if (tel.length < 7) return null;
    const num = tel.length === 10 ? '57' + tel : tel;
    return `https://wa.me/${num}?text=${encodeURIComponent(`Hola, acabo de hacer un pedido en el catálogo a nombre de ${this.nombre.trim()}.`)}`;
  }
}
