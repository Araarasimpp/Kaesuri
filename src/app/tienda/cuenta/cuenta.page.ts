import { Component, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { ClienteDireccion, ClienteService, Compra, Favorito } from '../../core/services/cliente.service';
import { CAPTCHA_ACTIVO, CaptchaComponent } from '../../shared/captcha/captcha.component';
import { RecortarFotoComponent } from '../../shared/recortar-foto/recortar-foto.component';
import { REGLA_CLAVE, problemaClave } from '../../shared/clave';
import { PAISES, bandera, errorTelefono, limpiarNombre } from '../../shared/paises';
import { mensajeError, pesos, urlMini } from '../../shared/formato';
import { confirmar } from '../../shared/dialogo';

type Modo = 'entrar' | 'crear' | 'confirmar' | 'olvide' | 'codigo-clave' | 'nueva-clave';

function normal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Mi cuenta (clientes de la tienda): ingresar, crear cuenta, recuperar la contraseña,
 * y ya adentro sus datos y sus direcciones guardadas para comprar más rápido.
 */
@Component({
  selector: 'app-cuenta',
  standalone: true,
  imports: [FormsModule, CaptchaComponent, RecortarFotoComponent],
  styles: [
    `
      :host { display: block; position: relative; height: 100dvh; background: #f4f5f8; color: #12141a; font-family: var(--ui-font, system-ui, sans-serif); }
      .cc-scroll { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
      .cc-barra { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; padding: calc(12px + env(safe-area-inset-top)) 16px 12px; background: #fff; border-bottom: 1px solid #e6e8ee; }
      .cc-barra button { width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 50%; background: #f1f2f6; color: inherit; font-size: 20px; cursor: pointer; }
      .cc-barra h1 { margin: 0; font-size: 18px; font-weight: 700; }
      .cc-caja { max-width: 520px; margin: 0 auto; padding: 18px 16px calc(40px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; }
      .cc-tarjeta { background: #fff; border: 1px solid #e6e8ee; border-radius: 18px; padding: 18px; }
      .cc-tarjeta h2 { margin: 0 0 4px; font-size: 17px; font-weight: 700; }
      .cc-tarjeta .cc-sub { margin: 0 0 14px; font-size: 13.5px; color: #5b6070; line-height: 1.45; }
      .cc-tabs { display: grid; grid-template-columns: 1fr 1fr; padding: 4px; border-radius: 14px; background: #eceef3; margin-bottom: 16px; }
      .cc-tabs button { height: 40px; border: 0; border-radius: 11px; background: transparent; color: #5b6070; font: inherit; font-size: 14.5px; font-weight: 600; cursor: pointer; }
      .cc-tabs button.on { background: #fff; color: #12141a; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
      form, .cc-form { display: flex; flex-direction: column; gap: 12px; }
      label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: #3b3f4c; }
      label small { font-weight: 400; color: #8a8f9c; }
      input, select { height: 46px; padding: 0 14px; border: 1px solid #d6d9e1; border-radius: 12px; background: #fff; color: #12141a; font: inherit; font-size: 16px; font-weight: 400; box-sizing: border-box; width: 100%; }
      input:focus, select:focus { outline: 2px solid #6b4fe033; border-color: #6b4fe0; }
      .cc-tel { display: grid; grid-template-columns: 112px 1fr; gap: 8px; }
      .cc-codigo { text-align: center; letter-spacing: .4em; font-size: 22px; font-weight: 700; font-family: var(--mono-font, monospace); }
      .cc-pri { height: 50px; border: 0; border-radius: 14px; background: #6b4fe0; color: #fff; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer; }
      .cc-pri:disabled { opacity: .6; cursor: progress; }
      .cc-sec { height: 46px; border: 1px solid #d6d9e1; border-radius: 14px; background: #fff; color: #12141a; font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
      .cc-link { border: 0; background: none; padding: 0; color: #6b4fe0; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; text-align: left; }
      .cc-centro { text-align: center; }
      .cc-error { margin: 0; padding: 10px 12px; border-radius: 10px; background: #fdecec; color: #c92a2a; font-size: 13.5px; }
      .cc-ok { margin: 0; padding: 10px 12px; border-radius: 10px; background: #e6f7ee; color: #1a7f4b; font-size: 13.5px; line-height: 1.45; }
      .cc-hola { display: flex; align-items: center; gap: 14px; }
      .cc-avatar { width: 54px; height: 54px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; background: #6b4fe0; color: #fff; font-size: 20px; font-weight: 700; }
      .cc-hola strong { display: block; font-size: 18px; }
      .cc-hola small { display: block; font-size: 13px; color: #5b6070; }
      .cc-seccion-cab { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
      .cc-seccion-cab h2 { margin: 0; }
      .cc-dirs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .cc-dir { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; padding: 14px; border: 1px solid #e6e8ee; border-radius: 14px; }
      .cc-dir.cc-principal { border-color: #6b4fe0; background: #f6f3ff; }
      .cc-dir .cc-pin { color: #6b4fe0; display: grid; padding-top: 1px; }
      .cc-dir strong { display: flex; align-items: center; gap: 6px; font-size: 15px; }
      .cc-dir .cc-lin { display: block; font-size: 13px; color: #5b6070; line-height: 1.4; }
      .cc-chip { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #6b4fe0; color: #fff; font-size: 11px; font-weight: 700; vertical-align: 2px; }
      .cc-acciones { display: flex; gap: 16px; margin-top: 8px; }
      .cc-acciones .cc-link { font-size: 13px; }
      .cc-acciones .cc-link.cc-peligro { color: #c92a2a; }
      .cc-etiquetas { display: flex; gap: 8px; }
      .cc-etiquetas button { height: 36px; padding: 0 14px; border: 1px solid #d6d9e1; border-radius: 999px; background: #fff; color: #3b3f4c; font: inherit; font-size: 14px; cursor: pointer; }
      .cc-etiquetas button.on { border-color: #6b4fe0; background: #f0ecff; color: #6b4fe0; font-weight: 700; }
      .cc-barrio { position: relative; }
      .cc-sug { position: absolute; left: 0; right: 0; top: 100%; z-index: 5; margin: 4px 0 0; padding: 4px; list-style: none; background: #fff; border: 1px solid #d6d9e1; border-radius: 12px; box-shadow: 0 10px 24px rgba(0,0,0,.12); max-height: 240px; overflow-y: auto; }
      .cc-sug button { width: 100%; display: flex; justify-content: space-between; gap: 10px; padding: 10px; border: 0; border-radius: 8px; background: none; color: #12141a; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
      .cc-sug button:hover { background: #f1f2f6; }
      .cc-sug small { color: #8a8f9c; white-space: nowrap; }
      .cc-barrio-ok { margin: 4px 0 0; font-size: 12.5px; color: #1a7f4b; font-weight: 600; }
      .cc-check { flex-direction: row; align-items: center; gap: 10px; font-weight: 500; }
      .cc-check input { width: 20px; height: 20px; accent-color: #6b4fe0; }
      .cc-vacio { margin: 0; padding: 14px; border: 1px dashed #d6d9e1; border-radius: 14px; text-align: center; font-size: 14px; color: #5b6070; }
      .cc-ico-bolsa { width: 40px; height: 40px; flex-shrink: 0; display: grid; place-items: center; border-radius: 12px; background: #f0ecff; color: #6b4fe0; }
      .cc-proximo { display: flex; align-items: center; gap: 12px; color: #5b6070; font-size: 14px; }
      .cc-proximo b { color: #12141a; }
      .cc-salir { color: #c92a2a; }
      .cc-compras { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .cc-compra { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) 18px; gap: 12px; align-items: center; padding: 12px; border: 1px solid #e6e8ee; border-radius: 14px;
        background: #fff; color: #12141a; font: inherit; text-align: left; cursor: pointer; }
      .cc-compra svg { color: #8a8f9c; }
      .cc-compra-fotos { display: flex; }
      .cc-compra-fotos .cc-mini + .cc-mini { margin-left: -14px; }
      .cc-mini { width: 46px; height: 46px; flex-shrink: 0; border-radius: 12px; background: #f0ecff; overflow: hidden; box-shadow: 0 0 0 2px #fff; }
      .cc-mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .cc-mini-g { width: 54px; height: 54px; }
      .cc-compra-txt strong { display: block; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cc-compra-txt small { display: block; font-size: 12.5px; color: #5b6070; }
      .cc-estado { display: inline-block; margin-bottom: 3px; font-size: 12px; font-weight: 700; color: #6b4fe0; }
      .cc-estado[data-e='entregado'] { color: #1a7f4b; }
      .cc-estado[data-e='cancelado'] { color: #c92a2a; }
      .cc-estado[data-e='por_pagar'] { color: #b45309; }
      .cc-velo { position: absolute; inset: 0; z-index: 40; border: 0; padding: 0; background: rgba(10, 12, 20, .45); }
      .cc-hoja { position: absolute; z-index: 41; left: 50%; bottom: 0; transform: translateX(-50%); width: min(560px, 100vw); box-sizing: border-box; max-height: 92dvh; overflow-y: auto;
        padding: 18px 18px calc(20px + env(safe-area-inset-bottom)); border-radius: 24px 24px 0 0; background: #fff; display: flex; flex-direction: column; gap: 16px;
        animation: cc-sube .28s cubic-bezier(.2, .9, .3, 1.05); }
      @keyframes cc-sube { from { transform: translate(-50%, 40px); opacity: 0; } }
      .cc-hoja-cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .cc-hoja-cab h2 { margin: 0; font-size: 20px; }
      .cc-hoja-cab small { color: #5b6070; font-size: 13px; }
      .cc-cerrar { width: 36px; height: 36px; flex-shrink: 0; border: 0; border-radius: 50%; background: #f1f2f6; color: #12141a; font-size: 15px; cursor: pointer; }
      .cc-linea { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .cc-linea li { position: relative; display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 12px; padding-bottom: 16px; }
      .cc-linea li:last-child { padding-bottom: 0; }
      .cc-linea li::before { content: ''; position: absolute; left: 10px; top: 22px; bottom: 0; width: 2px; background: #e3e5ec; }
      .cc-linea li:last-child::before { display: none; }
      .cc-linea li.cc-hecho::before { background: #6b4fe0; }
      .cc-punto { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; border: 2px solid #d6d9e1; background: #fff; color: #fff; box-sizing: border-box; }
      .cc-hecho .cc-punto { border-color: #6b4fe0; background: #6b4fe0; }
      .cc-actual .cc-punto { box-shadow: 0 0 0 5px #6b4fe022; }
      .cc-linea strong { display: block; font-size: 14.5px; color: #8a8f9c; font-weight: 600; }
      .cc-hecho strong { color: #12141a; }
      .cc-linea small { display: block; font-size: 12.5px; color: #5b6070; }
      .cc-cancelado .cc-actual .cc-punto { border-color: #c92a2a; background: #c92a2a; }
      .cc-items { list-style: none; margin: 0; padding: 12px 0 0; border-top: 1px solid #eceef3; display: flex; flex-direction: column; gap: 10px; }
      .cc-items li { display: grid; grid-template-columns: 54px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
      .cc-it-txt span { display: block; font-size: 14px; font-weight: 600; }
      .cc-it-txt small { display: block; font-size: 12.5px; color: #5b6070; }
      .cc-it-v { font-weight: 700; font-size: 14px; white-space: nowrap; }
      .cc-tot { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid #eceef3; font-size: 14.5px; }
      .cc-tot div { display: flex; justify-content: space-between; }
      .cc-tot-fin { font-size: 18px; font-weight: 800; }
      .cc-entrega { margin: 0; font-size: 13.5px; color: #3b3f4c; }
      .cc-a { display: grid; place-items: center; text-decoration: none; }
      .cc-bloque { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; border-top: 1px solid #eceef3; }
      .cc-bloque h3 { margin: 0; font-size: 16px; }
      .cc-calif { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 14px; background: #f7f6fc; }
      .cc-calif strong { font-size: 14px; }
      .cc-calif-prod { display: flex; align-items: center; gap: 10px; }
      .cc-calif-prod .cc-mini { width: 40px; height: 40px; border-radius: 10px; box-shadow: none; }
      .cc-estrellas { display: flex; gap: 4px; }
      .cc-estrellas button { width: 40px; height: 40px; padding: 0; border: 0; background: none; color: #d6d9e1; font-size: 30px; line-height: 1; cursor: pointer; transition: transform 120ms ease; }
      .cc-estrellas button.on { color: #f5a524; }
      .cc-estrellas button:active { transform: scale(.85); }
      .cc-cta-calif { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px; border: 1.5px solid #f5a524; border-radius: 14px; background: #fff8eb; color: #12141a; font: inherit; text-align: left; cursor: pointer; }
      .cc-cta-est { color: #f5a524; font-size: 18px; letter-spacing: 1px; white-space: nowrap; }
      .cc-cta-calif strong { display: block; font-size: 15px; }
      .cc-cta-calif small { display: block; font-size: 12.5px; color: #5b6070; }
      .cc-ya-calif { margin: 0; font-size: 13.5px; color: #3b3f4c; }
      .cc-ya-calif b, .cc-mis-est { color: #f5a524; letter-spacing: 1px; }
      .cc-falta-calif { color: #b45309; font-weight: 700; }
      .cc-it-txt .cc-mis-est { color: #f5a524; letter-spacing: 1px; }
      .cc-ayuda-btns { display: flex; flex-direction: column; gap: 8px; }
      .cc-wa { display: flex; align-items: center; justify-content: center; gap: 8px; height: 48px; border-radius: 14px; background: #25d366; color: #fff; font-weight: 700; text-decoration: none; }
      .cc-motivos { display: flex; flex-wrap: wrap; gap: 8px; }
      .cc-motivos button { min-height: 38px; padding: 6px 14px; border: 1px solid #d6d9e1; border-radius: 999px; background: #fff; color: #3b3f4c; font: inherit; font-size: 13.5px; cursor: pointer; }
      .cc-motivos button.on { border-color: #6b4fe0; background: #f0ecff; color: #6b4fe0; font-weight: 700; }
      textarea { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #d6d9e1; border-radius: 12px; font: inherit; font-size: 15px; resize: vertical; }
      .cc-reporte { margin: 0; padding: 10px 12px; border-radius: 12px; background: #fff4e5; font-size: 13.5px; line-height: 1.4; }
      .cc-reporte small { display: block; margin-top: 2px; color: #8a4b00; font-size: 12px; }
      .cc-reporte.cc-resuelto { background: #e6f7ee; }
      .cc-reporte.cc-resuelto small { color: #1a7f4b; }
      .cc-respuesta { display: block; margin-top: 6px; padding-top: 6px; border-top: 1px solid #00000014; font-size: 13.5px; }
      .cc-avatar { overflow: hidden; }
      .cc-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .cc-hola .cc-link { margin-top: 4px; font-size: 13px; }
      .cc-avatar-g { width: 72px; height: 72px; font-size: 24px; }
      .cc-foto-fila { display: flex; align-items: center; gap: 14px; }
      .cc-foto-acc { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
      .cc-foto-acc small { font-size: 12px; color: #8a8f9c; }
      .cc-subir { cursor: pointer; }
      .cc-obl { color: #c92a2a; }
      .cc-pasos { list-style: none; margin: 0 0 16px; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .cc-pasos li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; background: #f4f5f8; color: #8a8f9c; font-size: 13.5px; font-weight: 600; }
      .cc-pasos li b { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: #e3e5ec; color: #5b6070; font-size: 12.5px; }
      .cc-pasos li.on { background: #f0ecff; color: #12141a; }
      .cc-pasos li.on b { background: #6b4fe0; color: #fff; }
      .cc-pasos li.ok b { background: #1a7f4b; color: #fff; }
      .cc-menu { display: flex; flex-direction: column; gap: 2px; }
      .cc-menu h2 { margin-bottom: 8px; }
      .cc-menu button { display: grid; grid-template-columns: 40px minmax(0, 1fr) 18px; gap: 12px; align-items: center; width: 100%; padding: 10px 4px; border: 0; border-top: 1px solid #eceef3;
        background: none; color: #12141a; font: inherit; text-align: left; cursor: pointer; }
      .cc-menu button:first-of-type { border-top: 0; }
      .cc-menu strong { display: block; font-size: 15px; }
      .cc-menu small { display: block; font-size: 12.5px; color: #5b6070; }
      .cc-menu-ico { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 12px; background: #f0ecff; color: #6b4fe0; }
      .cc-menu-fl { color: #8a8f9c; }
      .cc-menu-salir strong { color: #c92a2a; }
      .cc-menu-salir .cc-menu-ico { background: #fdecec; color: #c92a2a; }
      input:disabled { background: #f4f5f8; color: #5b6070; }
      .cc-google { width: 100%; height: 50px; display: flex; align-items: center; justify-content: center; gap: 10px; border: 1px solid #d6d9e1; border-radius: 14px; background: #fff;
        color: #12141a; font: inherit; font-size: 15.5px; font-weight: 650; cursor: pointer; }
      .cc-google:disabled { opacity: .6; }
      .cc-o { display: flex; align-items: center; gap: 10px; margin: 14px 0; color: #8a8f9c; font-size: 12.5px; }
      .cc-o::before, .cc-o::after { content: ''; flex: 1; height: 1px; background: #e6e8ee; }
      .cc-falta { margin: 0; padding: 10px 12px; border-radius: 10px; background: #fff4e5; color: #8a4b00; font-size: 13.5px; line-height: 1.45; }
      .cc-cuenta-n { padding: 2px 9px; border-radius: 999px; background: #f0ecff; color: #6b4fe0; font-weight: 700; font-size: 12px; }
      .cc-favs { display: grid; grid-auto-flow: column; grid-auto-columns: 132px; gap: 10px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
      .cc-favs::-webkit-scrollbar { display: none; }
      .cc-fav { position: relative; display: flex; flex-direction: column; gap: 6px; }
      .cc-fav-foto { position: relative; width: 132px; height: 132px; padding: 0; border: 0; border-radius: 14px; background: #f0ecff; overflow: hidden; cursor: pointer; }
      .cc-fav-foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .cc-agot .cc-fav-foto img { opacity: .45; }
      .cc-fav-agot { position: absolute; left: 6px; bottom: 6px; padding: 2px 8px; border-radius: 999px; background: #12141acc; color: #fff; font-size: 11px; font-weight: 700; }
      .cc-fav-corazon { position: absolute; top: 6px; right: 6px; width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 50%; background: #fff; color: #e03170;
        box-shadow: 0 2px 8px rgba(0,0,0,.15); cursor: pointer; }
      .cc-fav-txt { padding: 0; border: 0; background: none; color: #12141a; font: inherit; text-align: left; cursor: pointer; }
      .cc-fav-txt span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; line-height: 1.3; }
      .cc-fav-txt b { display: block; margin-top: 2px; font-size: 14px; }
    `,
  ],
  template: `
    <div class="cc-scroll">
    <header class="cc-barra">
      <button type="button" (click)="atras()" [attr.aria-label]="vista() !== 'inicio' && c.perfil() && !incompleta() ? 'Volver a Mi cuenta' : 'Volver a la tienda'">←</button>
      <h1>{{ titulo() }}</h1>
    </header>

    <div class="cc-caja">
      @if (!c.listo()) {
        <div class="cc-tarjeta cc-centro"><p class="cc-sub" style="margin: 0">Cargando…</p></div>
      } @else if (modo() === 'nueva-clave') {
        <!-- Llegó desde el correo de "olvidé mi contraseña" -->
        <div class="cc-tarjeta">
          <h2>Crea tu nueva contraseña</h2>
          <p class="cc-sub">{{ regla }}.</p>
          <div class="cc-form">
            <label>Nueva contraseña<input type="password" autocomplete="new-password" [(ngModel)]="clave" /></label>
            <label>Repítela<input type="password" autocomplete="new-password" [(ngModel)]="clave2" /></label>
            @if (error()) { <p class="cc-error" role="alert">{{ error() }}</p> }
            <button class="cc-pri" [disabled]="ocupado()" (click)="guardarClaveNueva()">{{ ocupado() ? 'Guardando…' : 'Guardar contraseña' }}</button>
          </div>
        </div>
      } @else if (c.perfil(); as p) {
        <!-- ===== Adentro ===== -->
        @if (porRecortar(); as archivo) {
          <app-recortar-foto [archivo]="archivo" [guardando]="subiendo()" (recortada)="subirFoto($event)" (cancelar)="porRecortar.set(null)"></app-recortar-foto>
        }
        @if (aviso()) { <p class="cc-ok" role="status">{{ aviso() }}</p> }

        @if (incompleta()) {
          <!-- Recién creada: los datos obligatorios de una vez -->
          <div class="cc-tarjeta">
            <ol class="cc-pasos" aria-label="Pasos">
              <li [class.on]="!datosListos()" [class.ok]="datosListos()"><b>{{ datosListos() ? '✓' : '1' }}</b>Tus datos</li>
              <li [class.on]="datosListos()"><b>2</b>Tu dirección</li>
            </ol>
            @if (!datosListos()) {
              <h2>Completa tu cuenta</h2>
              <p class="cc-sub">Una sola vez: así tus pedidos salen listos y te podemos avisar cómo van.</p>
              <div class="cc-form">
            <div class="cc-foto-fila">
              <span class="cc-avatar cc-avatar-g" aria-hidden="true">@if (p.avatar_url) { <img [src]="p.avatar_url" alt="" referrerpolicy="no-referrer" /> } @else { {{ iniciales(p.nombre || p.email || '?') }} }</span>
              <div class="cc-foto-acc">
                <label class="cc-link cc-subir">{{ subiendo() ? 'Subiendo…' : p.avatar_url ? 'Cambiar foto' : 'Agregar foto de perfil' }}<input type="file" accept="image/*" (change)="elegirFoto($event)" hidden /></label>
                @if (p.avatar_url) { <button type="button" class="cc-link cc-peligro" (click)="quitarFoto()">Quitar foto</button> }
                <small>Opcional · se ve en tu cuenta</small>
              </div>
            </div>
            <label><span>Nombre completo <span class="cc-obl">*</span></span><input autocomplete="name" [ngModel]="nombre" (ngModelChange)="nombre = limpiar($event)" /></label>
            <label><span>Celular <span class="cc-obl">*</span></span>
              <div class="cc-tel">
                <select [(ngModel)]="prefijo" aria-label="Indicativo">
                  @for (x of paises; track x.iso) { <option [value]="x.prefijo">{{ bandera(x.iso) }} +{{ x.prefijo }}</option> }
                </select>
                <input type="tel" inputmode="numeric" autocomplete="tel-national" [(ngModel)]="telefono" />
              </div>
            </label>
            <label><span>Documento <span class="cc-obl">*</span> <small>(para tus facturas y envíos a otras ciudades)</small></span>
              <div class="cc-tel">
                <select [(ngModel)]="tipoDoc" aria-label="Tipo de documento">
                  <option value="CC">CC</option><option value="CE">CE</option><option value="NIT">NIT</option><option value="PP">Pasaporte</option><option value="TI">TI</option>
                </select>
                <input inputmode="numeric" [(ngModel)]="documento" placeholder="Número" />
              </div>
            </label>
            @if (errorDatos()) { <p class="cc-error" role="alert">{{ errorDatos() }}</p> }
                <button class="cc-pri" [disabled]="ocupado()" (click)="guardarDatos()">{{ ocupado() ? 'Guardando…' : 'Continuar' }}</button>
              </div>
            } @else {
              <h2>¿A dónde te llevamos tus pedidos?</h2>
              <p class="cc-sub">Tu dirección principal. Después puedes agregar más (trabajo, otra casa…).</p>
              <div class="cc-form">
              <div class="cc-etiquetas" role="group" aria-label="Nombre de la dirección">
                @for (e of ['Casa', 'Trabajo', 'Otra']; track e) {
                  <button type="button" [class.on]="dEtiqueta === e" (click)="dEtiqueta = e">{{ e }}</button>
                }
              </div>
              <label>Dirección<input autocomplete="street-address" maxlength="200" [(ngModel)]="dDireccion" placeholder="Ej: Cra 45 # 12-30 apto 201" /></label>
              <label class="cc-barrio">Barrio <small>(si no eres de Cali, escribe tu ciudad)</small>
                <input autocomplete="off" [ngModel]="dBarrio()" (ngModelChange)="escribirBarrio($event)" (focus)="enBarrio.set(true)" (blur)="salirBarrio()" placeholder="Ej: San Fernando" />
                @if (sugerencias().length) {
                  <ul class="cc-sug" role="listbox">
                    @for (b of sugerencias(); track b.barrio) {
                      <li><button type="button" (mousedown)="$event.preventDefault()" (click)="elegirBarrio(b.barrio)"><span>{{ b.barrio }}</span><small>domicilio {{ pesos(b.domicilio) }}</small></button></li>
                    }
                  </ul>
                }
                @if (barrioOk()) { <span class="cc-barrio-ok">✓ {{ barrioOk() }}</span> }
              </label>
              <label>Indicaciones <small>(opcional)</small><input maxlength="200" [(ngModel)]="dIndicaciones" placeholder="Ej: casa esquinera, portón negro" /></label>
              <label class="cc-check"><input type="checkbox" [(ngModel)]="dPrincipal" />Usar como dirección principal</label>
                @if (errorDir()) { <p class="cc-error" role="alert">{{ errorDir() }}</p> }
                <button class="cc-pri" [disabled]="ocupado()" (click)="guardarDireccion()">{{ ocupado() ? 'Guardando…' : 'Terminar' }}</button>
                <button class="cc-link cc-centro" (click)="volverADatos()">← Volver a mis datos</button>
              </div>
            }
          </div>
        } @else {
          @switch (vista()) {
            @case ('inicio') {
              <div class="cc-tarjeta cc-hola">
                <span class="cc-avatar" aria-hidden="true">@if (p.avatar_url) { <img [src]="p.avatar_url" alt="" referrerpolicy="no-referrer" /> } @else { {{ iniciales(p.nombre || p.email || '?') }} }</span>
                <div><strong>Hola, {{ primerNombre(p.nombre) || 'cliente' }}</strong><small>{{ p.email }}</small>
                  <button class="cc-link" (click)="irA('perfil')">Editar perfil</button></div>
              </div>
        <section class="cc-tarjeta" aria-labelledby="t-compras">
          <div class="cc-seccion-cab"><h2 id="t-compras">Mis compras</h2>
            @if (compras().length > 3) { <button class="cc-link" (click)="verTodas.set(!verTodas())">{{ verTodas() ? 'Ver menos' : 'Ver todas (' + compras().length + ')' }}</button> }</div>
          @if (cargandoCompras()) {
            <p class="cc-sub" style="margin: 0">Cargando tus compras…</p>
          } @else if (compras().length) {
            <ul class="cc-compras">
              @for (x of (verTodas() ? compras() : compras().slice(0, 3)); track x.fecha) {
                <li><button type="button" class="cc-compra" (click)="abrirCompra(x)">
                  <span class="cc-compra-fotos">
                    @for (it of (x.items ?? []).slice(0, 3); track $index) {
                      <span class="cc-mini">@if (urlMini(it.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> }</span>
                    }
                  </span>
                  <span class="cc-compra-txt">
                    <span class="cc-estado" [attr.data-e]="x.estado">{{ estadoTexto(x) }}@if (puedeCalificar(x)) { <span class="cc-falta-calif"> · Califícala</span> }</span>
                    <strong>{{ resumenItems(x) }}</strong>
                    <small>{{ fechaCorta(x.fecha) }} · {{ pesos(x.total) }}</small>
                  </span>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
                </button></li>
              }
            </ul>
          } @else {
            <p class="cc-vacio">Todavía no tienes compras. Cuando pidas con tu cuenta, aquí ves cada pedido y en qué va.</p>
          }
        </section>

        <section class="cc-tarjeta" aria-labelledby="t-favs">
          <div class="cc-seccion-cab"><h2 id="t-favs">Mis favoritos</h2>@if (favoritos().length) { <small class="cc-cuenta-n">{{ favoritos().length }}</small> }</div>
          @if (favoritos().length) {
            <div class="cc-favs">
              @for (f of favoritos(); track f.id) {
                <div class="cc-fav" [class.cc-agot]="f.agotado">
                  <button type="button" class="cc-fav-foto" (click)="verProducto(f.id)" [attr.aria-label]="'Ver ' + f.nombre">
                    @if (urlMini(f.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> }
                    @if (f.agotado) { <span class="cc-fav-agot">Agotado</span> }
                  </button>
                  <button type="button" class="cc-fav-corazon" (click)="quitarFavorito(f)" [attr.aria-label]="'Quitar ' + f.nombre + ' de favoritos'">
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 3 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 19 5 21 8.6 19.6 11.8 17.5 16.4 12 21 12 21Z"/></svg>
                  </button>
                  <button type="button" class="cc-fav-txt" (click)="verProducto(f.id)"><span>{{ f.nombre }}</span><b>{{ pesos(f.precio) }}</b></button>
                </div>
              }
            </div>
          } @else {
            <p class="cc-vacio">Toca el corazón de los productos que te gusten y aquí los encuentras siempre.</p>
          }
        </section>

              <section class="cc-tarjeta cc-menu" aria-labelledby="t-config">
                <h2 id="t-config">Configuración</h2>
                <button type="button" (click)="irA('perfil')"><span class="cc-menu-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></span><span><strong>Mi perfil</strong><small>Foto, nombre, celular y documento</small></span><svg class="cc-menu-fl" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
                <button type="button" (click)="irA('direcciones')"><span class="cc-menu-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg></span><span><strong>Mis direcciones</strong><small>{{ p.direcciones.length }} {{ p.direcciones.length === 1 ? 'guardada' : 'guardadas' }}</small></span><svg class="cc-menu-fl" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
                <button type="button" (click)="irA('tarjetas')"><span class="cc-menu-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/></svg></span><span><strong>Mis tarjetas</strong><small>{{ (p.tarjetas?.length ?? 0) ? (p.tarjetas!.length + (p.tarjetas!.length === 1 ? ' guardada' : ' guardadas')) : 'Ninguna guardada' }}</small></span><svg class="cc-menu-fl" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
                <button type="button" (click)="irA('seguridad')"><span class="cc-menu-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10" width="15" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><span><strong>Seguridad</strong><small>Contraseña de tu cuenta</small></span><svg class="cc-menu-fl" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
                <button type="button" class="cc-menu-salir" (click)="salir()"><span class="cc-menu-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg></span><span><strong>Cerrar sesión</strong></span></button>
              </section>

              <button class="cc-pri" (click)="volver()">Seguir comprando</button>
            }
            @case ('perfil') {
              <section class="cc-tarjeta" aria-labelledby="t-perfil">
                <h2 id="t-perfil">Mi perfil</h2>
                <p class="cc-sub">Salen llenos cada vez que compras.</p>
                <div class="cc-form">
            <div class="cc-foto-fila">
              <span class="cc-avatar cc-avatar-g" aria-hidden="true">@if (p.avatar_url) { <img [src]="p.avatar_url" alt="" referrerpolicy="no-referrer" /> } @else { {{ iniciales(p.nombre || p.email || '?') }} }</span>
              <div class="cc-foto-acc">
                <label class="cc-link cc-subir">{{ subiendo() ? 'Subiendo…' : p.avatar_url ? 'Cambiar foto' : 'Agregar foto de perfil' }}<input type="file" accept="image/*" (change)="elegirFoto($event)" hidden /></label>
                @if (p.avatar_url) { <button type="button" class="cc-link cc-peligro" (click)="quitarFoto()">Quitar foto</button> }
                <small>Opcional · se ve en tu cuenta</small>
              </div>
            </div>
            <label><span>Nombre completo <span class="cc-obl">*</span></span><input autocomplete="name" [ngModel]="nombre" (ngModelChange)="nombre = limpiar($event)" /></label>
            <label><span>Celular <span class="cc-obl">*</span></span>
              <div class="cc-tel">
                <select [(ngModel)]="prefijo" aria-label="Indicativo">
                  @for (x of paises; track x.iso) { <option [value]="x.prefijo">{{ bandera(x.iso) }} +{{ x.prefijo }}</option> }
                </select>
                <input type="tel" inputmode="numeric" autocomplete="tel-national" [(ngModel)]="telefono" />
              </div>
            </label>
            <label><span>Documento <span class="cc-obl">*</span> <small>(para tus facturas y envíos a otras ciudades)</small></span>
              <div class="cc-tel">
                <select [(ngModel)]="tipoDoc" aria-label="Tipo de documento">
                  <option value="CC">CC</option><option value="CE">CE</option><option value="NIT">NIT</option><option value="PP">Pasaporte</option><option value="TI">TI</option>
                </select>
                <input inputmode="numeric" [(ngModel)]="documento" placeholder="Número" />
              </div>
            </label>
            @if (errorDatos()) { <p class="cc-error" role="alert">{{ errorDatos() }}</p> }
                  <label>Correo <small>(con el que entras)</small><input [value]="p.email" disabled /></label>
                  <button class="cc-pri" [disabled]="ocupado()" (click)="guardarDatos()">{{ ocupado() ? 'Guardando…' : 'Guardar cambios' }}</button>
                </div>
              </section>
            }
            @case ('direcciones') {
        <section class="cc-tarjeta" aria-labelledby="t-dirs">
          <div class="cc-seccion-cab"><h2 id="t-dirs">Mis direcciones</h2>
            @if (!formDir() && p.direcciones.length < 10) { <button class="cc-link" (click)="nuevaDireccion()">+ Agregar</button> }</div>
          @if (formDir()) {
            <div class="cc-form">
              <div class="cc-etiquetas" role="group" aria-label="Nombre de la dirección">
                @for (e of ['Casa', 'Trabajo', 'Otra']; track e) {
                  <button type="button" [class.on]="dEtiqueta === e" (click)="dEtiqueta = e">{{ e }}</button>
                }
              </div>
              <label>Dirección<input autocomplete="street-address" maxlength="200" [(ngModel)]="dDireccion" placeholder="Ej: Cra 45 # 12-30 apto 201" /></label>
              <label class="cc-barrio">Barrio <small>(si no eres de Cali, escribe tu ciudad)</small>
                <input autocomplete="off" [ngModel]="dBarrio()" (ngModelChange)="escribirBarrio($event)" (focus)="enBarrio.set(true)" (blur)="salirBarrio()" placeholder="Ej: San Fernando" />
                @if (sugerencias().length) {
                  <ul class="cc-sug" role="listbox">
                    @for (b of sugerencias(); track b.barrio) {
                      <li><button type="button" (mousedown)="$event.preventDefault()" (click)="elegirBarrio(b.barrio)"><span>{{ b.barrio }}</span><small>domicilio {{ pesos(b.domicilio) }}</small></button></li>
                    }
                  </ul>
                }
                @if (barrioOk()) { <span class="cc-barrio-ok">✓ {{ barrioOk() }}</span> }
              </label>
              <label>Indicaciones <small>(opcional)</small><input maxlength="200" [(ngModel)]="dIndicaciones" placeholder="Ej: casa esquinera, portón negro" /></label>
              <label class="cc-check"><input type="checkbox" [(ngModel)]="dPrincipal" />Usar como dirección principal</label>
              @if (errorDir()) { <p class="cc-error" role="alert">{{ errorDir() }}</p> }
              <button class="cc-pri" [disabled]="ocupado()" (click)="guardarDireccion()">{{ ocupado() ? 'Guardando…' : 'Guardar dirección' }}</button>
              <button class="cc-sec" (click)="formDir.set(false)">Cancelar</button>
            </div>
          } @else if (p.direcciones.length) {
            <ul class="cc-dirs">
              @for (d of p.direcciones; track d.id) {
                <li class="cc-dir" [class.cc-principal]="d.principal">
                  <span class="cc-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg></span>
                  <div>
                    <strong>{{ d.etiqueta }}@if (d.principal) { <span class="cc-chip">Principal</span> }</strong>
                    <span class="cc-lin">{{ d.direccion }}</span>
                    <span class="cc-lin">{{ d.barrio }}{{ d.indicaciones ? ' · ' + d.indicaciones : '' }}</span>
                    <div class="cc-acciones">
                      <button class="cc-link" (click)="editarDireccion(d)">Editar</button>
                      @if (!d.principal) { <button class="cc-link" (click)="hacerPrincipal(d)">Usar como principal</button> }
                      <button class="cc-link cc-peligro" (click)="quitarDireccion(d)">Quitar</button>
                    </div>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <p class="cc-vacio">Todavía no tienes direcciones. Agrega una y saldrá lista cuando compres.</p>
          }
        </section>
            }
            @case ('tarjetas') {
              @if (p.tarjetas?.length) {
          <section class="cc-tarjeta" aria-labelledby="t-tarjetas">
            <h2 id="t-tarjetas">Mis tarjetas</h2>
            <p class="cc-sub">Las guarda Wompi (de Bancolombia); aquí solo vemos los últimos 4 números.</p>
            <ul class="cc-dirs">
              @for (tj of p.tarjetas!; track tj.id) {
                <li class="cc-dir">
                  <span class="cc-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h4"/></svg></span>
                  <div>
                    <strong>{{ tj.marca || 'Tarjeta' }} **** {{ tj.ultimos4 }}</strong>
                    <span class="cc-lin">Vence {{ tj.exp_mes }}/{{ tj.exp_anio }}</span>
                    <div class="cc-acciones"><button class="cc-link cc-peligro" (click)="quitarTarjeta(tj.id, tj.ultimos4)">Quitar</button></div>
                  </div>
                </li>
              }
            </ul>
          </section>
              } @else {
                <section class="cc-tarjeta"><h2>Mis tarjetas</h2>
                  <p class="cc-vacio">No tienes tarjetas guardadas. Cuando pagues con tarjeta en la tienda, marca "Guardar esta tarjeta" y la próxima vez pagas con un toque.</p></section>
              }
            }
            @case ('seguridad') {
              <section class="cc-tarjeta" aria-labelledby="t-seg">
                <h2 id="t-seg">Seguridad</h2>
                <p class="cc-sub">Cambia la contraseña con la que entras con tu correo ({{ p.email }}). Si entras con Google, aquí puedes crear una para entrar también con tu correo.</p>
                <div class="cc-form">
                  <label>Nueva contraseña <small>({{ regla }})</small><input type="password" autocomplete="new-password" [(ngModel)]="clave" /></label>
                  <label>Repítela<input type="password" autocomplete="new-password" [(ngModel)]="clave2" /></label>
                  @if (error()) { <p class="cc-error" role="alert">{{ error() }}</p> }
                  <button class="cc-pri" [disabled]="ocupado()" (click)="cambiarClaveCuenta()">{{ ocupado() ? 'Guardando…' : 'Cambiar contraseña' }}</button>
                </div>
              </section>
            }
          }
        }
      } @else if (c.sesion() && sb.perfil()) {
        <!-- Sesión del equipo en este celular -->
        <div class="cc-tarjeta">
          <h2>Estás con la cuenta del equipo</h2>
          <p class="cc-sub">Entraste como {{ sb.perfil()!.nombre }}. Para comprar como cliente, cierra esta sesión y entra con tu cuenta de cliente.</p>
          <button class="cc-sec" (click)="salir()">Cerrar sesión</button>
        </div>
      } @else if (!c.activo) {
        <!-- Cuentas de clientes todavía apagadas en Kaesuri -->
        <div class="cc-tarjeta">
          <h2>Muy pronto podrás crear tu cuenta</h2>
          <p class="cc-sub">Por ahora puedes comprar sin cuenta: elige tus productos y te contactamos para confirmar tu pedido.</p>
          <a class="cc-pri" href="/tienda">Ir a la tienda</a>
        </div>
      } @else {
        <!-- ===== Afuera: ingresar / crear cuenta ===== -->
        <div class="cc-tarjeta">
          @if (modo() === 'entrar' || modo() === 'crear') {
            <div class="cc-tabs" role="tablist">
              <button type="button" role="tab" [attr.aria-selected]="modo() === 'entrar'" [class.on]="modo() === 'entrar'" (click)="cambiarModo('entrar')">Ingresar</button>
              <button type="button" role="tab" [attr.aria-selected]="modo() === 'crear'" [class.on]="modo() === 'crear'" (click)="cambiarModo('crear')">Crear cuenta</button>
            </div>
          }

          @if (modo() === 'entrar' || modo() === 'crear') {
            @if (google()) {
              <button type="button" class="cc-google" (click)="conGoogle()" [disabled]="ocupado()">
                <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                Continuar con Google
              </button>
              <div class="cc-o"><span>o con tu correo</span></div>
            }
          }
          @switch (modo()) {
            @case ('entrar') {
              <form (ngSubmit)="entrar()">
                <label>Correo<input type="email" name="e" autocomplete="username" inputmode="email" autocapitalize="off" [(ngModel)]="email" /></label>
                <label>Contraseña<input type="password" name="c" autocomplete="current-password" [(ngModel)]="clave" /></label>
                <button type="button" class="cc-link" (click)="cambiarModo('olvide')">¿Olvidaste tu contraseña?</button>
                <app-captcha (token)="captcha.set($event)" />
                @if (error()) { <p class="cc-error" role="alert">{{ error() }}</p> }
                <button class="cc-pri" type="submit" [disabled]="ocupado() || (captchaActivo && !captcha())">{{ ocupado() ? 'Ingresando…' : 'Ingresar' }}</button>
              </form>
            }
            @case ('crear') {
              <p class="cc-sub">Guarda tus datos y direcciones, y compra en pocos toques.</p>
              <form (ngSubmit)="crear()">
                <label>Nombre completo<input name="n" autocomplete="name" [ngModel]="nombre" (ngModelChange)="nombre = limpiar($event)" /></label>
                <label>Celular
                  <div class="cc-tel">
                    <select name="pf" [(ngModel)]="prefijo" aria-label="Indicativo">
                      @for (x of paises; track x.iso) { <option [value]="x.prefijo">{{ bandera(x.iso) }} +{{ x.prefijo }}</option> }
                    </select>
                    <input name="t" type="tel" inputmode="numeric" autocomplete="tel-national" [(ngModel)]="telefono" />
                  </div>
                </label>
                <label>Correo<input name="e" type="email" autocomplete="email" inputmode="email" autocapitalize="off" [(ngModel)]="email" /></label>
                <label>Contraseña <small>({{ regla }})</small><input name="c" type="password" autocomplete="new-password" [(ngModel)]="clave" /></label>
                <label>Repite la contraseña<input name="c2" type="password" autocomplete="new-password" [(ngModel)]="clave2" /></label>
                <app-captcha (token)="captcha.set($event)" />
                @if (error()) { <p class="cc-error" role="alert">{{ error() }}</p> }
                <button class="cc-pri" type="submit" [disabled]="ocupado() || (captchaActivo && !captcha())">{{ ocupado() ? 'Creando…' : 'Crear cuenta' }}</button>
              </form>
            }
            @case ('confirmar') {
              <h2>Confirma tu correo</h2>
              <p class="cc-sub">Te enviamos un correo a <b>{{ email }}</b>. Ábrelo y toca el botón para activar tu cuenta. Si el correo trae un código de 6 números, escríbelo aquí.</p>
              <div class="cc-form">
                <input class="cc-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="codigo" placeholder="••••••" aria-label="Código" />
                @if (error()) { <p class="cc-error" role="alert">{{ error() }}</p> }
                @if (aviso()) { <p class="cc-ok" role="status">{{ aviso() }}</p> }
                <button class="cc-pri" [disabled]="ocupado() || codigo.length < 6" (click)="confirmarCodigo('signup')">Confirmar</button>
                <app-captcha (token)="captcha.set($event)" />
                <button class="cc-sec" [disabled]="espera() > 0 || ocupado() || (captchaActivo && !captcha())" (click)="reenviar()">{{ espera() > 0 ? 'Reenviar en ' + espera() + ' s' : '¿No llegó? Enviar de nuevo' }}</button>
                <button class="cc-link cc-centro" (click)="cambiarModo('entrar')">Ya la confirmé: ingresar</button>
              </div>
            }
            @case ('olvide') {
              <h2>Recupera tu contraseña</h2>
              <p class="cc-sub">Escribe tu correo y te enviamos cómo crear una nueva.</p>
              <form (ngSubmit)="olvide()">
                <label>Correo<input name="e" type="email" autocomplete="username" inputmode="email" autocapitalize="off" [(ngModel)]="email" /></label>
                <app-captcha (token)="captcha.set($event)" />
                @if (error()) { <p class="cc-error" role="alert">{{ error() }}</p> }
                <button class="cc-pri" type="submit" [disabled]="ocupado() || (captchaActivo && !captcha())">{{ ocupado() ? 'Enviando…' : 'Enviar' }}</button>
                <button type="button" class="cc-link cc-centro" (click)="cambiarModo('entrar')">Volver a ingresar</button>
              </form>
            }
            @case ('codigo-clave') {
              <h2>Revisa tu correo</h2>
              <p class="cc-sub">Te enviamos un correo a <b>{{ email }}</b>. Toca el botón del correo para crear tu nueva contraseña. Si trae un código de 6 números, escríbelo aquí con tu nueva contraseña.</p>
              <div class="cc-form">
                <input class="cc-codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" [(ngModel)]="codigo" placeholder="••••••" aria-label="Código" />
                <label>Nueva contraseña <small>({{ regla }})</small><input type="password" autocomplete="new-password" [(ngModel)]="clave" /></label>
                @if (error()) { <p class="cc-error" role="alert">{{ error() }}</p> }
                <button class="cc-pri" [disabled]="ocupado() || codigo.length < 6" (click)="confirmarCodigo('recovery')">Cambiar contraseña</button>
                <button class="cc-link cc-centro" (click)="cambiarModo('entrar')">Volver a ingresar</button>
              </div>
            }
          }
        </div>
      }
    </div>
    </div>

    <!-- Detalle de una compra (fuera del scroll para que cubra toda la pantalla) -->
    @if (compraSel(); as x) {
      <button class="cc-velo" aria-label="Cerrar" (click)="compraSel.set(null)"></button>
      <div class="cc-hoja" role="dialog" aria-labelledby="t-compra">
        <div class="cc-hoja-cab">
          <div><h2 id="t-compra">{{ estadoTexto(x) }}</h2><small>Pedido del {{ fechaLarga(x.fecha) }}</small></div>
          <button type="button" class="cc-cerrar" (click)="compraSel.set(null)" aria-label="Cerrar">✕</button>
        </div>
        <ol class="cc-linea" [class.cc-cancelado]="x.estado === 'cancelado'">
          @for (p of pasos(x); track p.t) {
            <li [class.cc-hecho]="p.hecho" [class.cc-actual]="p.actual">
              <span class="cc-punto" aria-hidden="true">@if (p.hecho) { <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg> }</span>
              <span><strong>{{ p.t }}</strong>@if (p.cuando) { <small>{{ p.cuando }}</small> } @else if (p.ayuda) { <small>{{ p.ayuda }}</small> }</span>
            </li>
          }
        </ol>
        <ul class="cc-items">
          @for (it of x.items ?? []; track $index) {
            <li>
              <span class="cc-mini cc-mini-g">@if (urlMini(it.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> }</span>
              <span class="cc-it-txt"><span>{{ it.nombre }}</span><small>{{ it.cantidad }} × {{ pesos(it.precio) }}{{ it.color ? ' · ' + it.color : '' }}{{ it.talla ? ' · ' + it.talla : '' }}</small>
                @if (it.mi_resena) { <small class="cc-mis-est" [attr.aria-label]="'Lo calificaste con ' + it.mi_resena + ' estrellas'">{{ estrellasTexto(it.mi_resena) }}</small> }</span>
              <span class="cc-it-v">{{ pesos(it.cantidad * it.precio) }}</span>
            </li>
          }
        </ul>
        <div class="cc-tot">
          @if (x.domicilio) { <div><span>Envío</span><span>{{ pesos(x.domicilio) }}</span></div> }
          <div class="cc-tot-fin"><span>Total</span><span>{{ pesos(x.total) }}</span></div>
        </div>
        @if (x.direccion) {
          <p class="cc-entrega"><b>Entrega:</b> {{ x.direccion }}{{ x.barrio ? ' · ' + x.barrio : '' }}</p>
        }
        <!-- Calificar la compra -->
        @if (puedeCalificar(x)) {
          @if (hojaModo() === 'calificar') {
            <section class="cc-bloque" aria-labelledby="t-calif">
              <h3 id="t-calif">Califica tu compra</h3>
              @if (!x.calif) {
                <div class="cc-calif">
                  <strong>¿Cómo te fue con la entrega?</strong>
                  <div class="cc-estrellas" role="radiogroup" aria-label="Estrellas de la entrega">
                    @for (n of [1, 2, 3, 4, 5]; track n) {
                      <button type="button" role="radio" [attr.aria-checked]="calEntrega() === n" [class.on]="n <= calEntrega()" (click)="calEntrega.set(n)" [attr.aria-label]="n + (n === 1 ? ' estrella' : ' estrellas')">★</button>
                    }
                  </div>
                  <input maxlength="300" [(ngModel)]="calEntregaTxt" placeholder="Cuéntanos (opcional)" aria-label="Comentario de la entrega" />
                </div>
              }
              @for (it of productosCalificables(x); track it.producto_id) {
                <div class="cc-calif">
                  <span class="cc-calif-prod"><span class="cc-mini">@if (urlMini(it.imagen_url); as u) { <img [src]="u" alt="" /> }</span><strong>{{ it.nombre }}</strong></span>
                  <div class="cc-estrellas" role="radiogroup" [attr.aria-label]="'Estrellas de ' + it.nombre">
                    @for (n of [1, 2, 3, 4, 5]; track n) {
                      <button type="button" role="radio" [attr.aria-checked]="calProd()[it.producto_id!] === n" [class.on]="n <= (calProd()[it.producto_id!] || 0)" (click)="ponerEstrellas(it.producto_id!, n)" [attr.aria-label]="n + (n === 1 ? ' estrella' : ' estrellas')">★</button>
                    }
                  </div>
                  <input maxlength="400" [ngModel]="calProdTxt[it.producto_id!] || ''" (ngModelChange)="calProdTxt[it.producto_id!] = $event" placeholder="¿Qué te pareció? (opcional, sale en la tienda)" [attr.aria-label]="'Opinión de ' + it.nombre" />
                </div>
              }
              @if (errorHoja()) { <p class="cc-error" role="alert">{{ errorHoja() }}</p> }
              <button class="cc-pri" [disabled]="ocupado()" (click)="enviarCalificacion(x)">{{ ocupado() ? 'Enviando…' : 'Enviar calificación' }}</button>
              <button class="cc-link cc-centro" (click)="hojaModo.set('detalle')">Cancelar</button>
            </section>
          } @else {
            <button type="button" class="cc-cta-calif" (click)="abrirCalificar(x)">
              <span class="cc-cta-est" aria-hidden="true">★★★★★</span><span><strong>{{ x.calif ? 'Califica tus productos' : 'Califica tu compra' }}</strong><small>{{ x.calif ? 'Ya calificaste la entrega (' + estrellasTexto(x.calif) + '). Faltan ' + productosCalificables(x).length + (productosCalificables(x).length === 1 ? ' producto' : ' productos') : 'Tu opinión ayuda a otros clientes' }}</small></span>
            </button>
          }
        } @else if (x.calif) {
          <p class="cc-ya-calif">Calificaste la entrega: <b>{{ estrellasTexto(x.calif) }}</b> · ¡Gracias!</p>
        }

        <!-- Pedir ayuda -->
        <section class="cc-bloque" aria-labelledby="t-ayuda">
          <h3 id="t-ayuda">¿Necesitas ayuda con este pedido?</h3>
          @for (a of x.ayudas ?? []; track a.fecha) {
            <p class="cc-reporte" [class.cc-resuelto]="a.estado !== 'abierta'"><b>{{ a.motivo }}</b>{{ a.mensaje ? ' · "' + a.mensaje + '"' : '' }}<small>{{ fechaCorta(a.fecha) }} · {{ a.estado === 'abierta' ? 'Recibido: te contactamos pronto' : '✓ Resuelto' }}</small>
              @if (a.respuesta) { <span class="cc-respuesta"><b>{{ a.resuelta_por || 'Variedades JYB' }}:</b> {{ a.respuesta }}</span> }</p>
          }
          @if (hojaModo() === 'ayuda') {
            <div class="cc-motivos" role="radiogroup" aria-label="¿Qué pasó?">
              @for (m of motivosAyuda(x); track m) {
                <button type="button" role="radio" [attr.aria-checked]="ayudaMotivo() === m" [class.on]="ayudaMotivo() === m" (click)="ayudaMotivo.set(m)">{{ m }}</button>
              }
            </div>
            <textarea rows="3" maxlength="600" [(ngModel)]="ayudaTxt" placeholder="Cuéntanos qué pasó (si es algo dañado, descríbelo)" aria-label="Mensaje"></textarea>
            @if (errorHoja()) { <p class="cc-error" role="alert">{{ errorHoja() }}</p> }
            <button class="cc-pri" [disabled]="ocupado()" (click)="enviarAyuda(x)">{{ ocupado() ? 'Enviando…' : 'Enviar' }}</button>
            <button class="cc-link cc-centro" (click)="hojaModo.set('detalle')">Cancelar</button>
          } @else {
            <div class="cc-ayuda-btns">
              @if (whatsappAyuda(x); as w) {
                <a class="cc-wa" [href]="w" target="_blank" rel="noopener">
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s1 2.6 1.1 2.7c.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>
                  Escribir por WhatsApp</a>
              }
              <button type="button" class="cc-sec" (click)="abrirAyuda()">Reportar un problema</button>
            </div>
          }
        </section>

        <div class="cc-form">
          @if (x.estado === 'por_pagar' && x.codigo) { <a class="cc-pri cc-a" [href]="'/pago/' + x.codigo">Pagar ahora</a> }
          @if (x.codigo) { <a class="cc-sec cc-a" [href]="'/' + x.ruta + '/' + x.codigo">Ver seguimiento</a> }
          @if ((x.items ?? []).length) { <button class="cc-pri" (click)="volverAComprar(x)">Volver a comprar</button> }
        </div>
      </div>
    }
  `,
})
export class CuentaPage implements OnInit, OnDestroy {
  sb = inject(SupabaseService);
  c = inject(ClienteService);
  private router = inject(Router);
  private ruta = inject(ActivatedRoute);
  @ViewChild(CaptchaComponent) private captchaCmp?: CaptchaComponent;

  readonly captchaActivo = CAPTCHA_ACTIVO;
  readonly regla = REGLA_CLAVE;
  readonly paises = PAISES;
  readonly bandera = bandera;
  readonly pesos = pesos;

  modo = signal<Modo>('entrar');
  captcha = signal('');
  ocupado = signal(false);
  error = signal('');
  errorDatos = signal('');
  errorDir = signal('');
  aviso = signal('');
  espera = signal(0);
  private reloj?: ReturnType<typeof setInterval>;
  private quitarEscucha?: () => void;

  // Formularios
  email = '';
  clave = '';
  clave2 = '';
  codigo = '';
  nombre = '';
  prefijo = '57';
  telefono = '';
  tipoDoc = 'CC';
  documento = '';

  // Dirección
  formDir = signal(false);
  private incompletaAntes = false;
  dId: number | null = null;
  dEtiqueta = 'Casa';
  dDireccion = '';
  dBarrio = signal('');
  dIndicaciones = '';
  dPrincipal = false;
  enBarrio = signal(false);
  private barrios = signal<{ barrio: string; domicilio: number }[]>([]);
  barrioOk = computed(() => {
    const n = normal(this.dBarrio());
    return this.barrios().find((b) => normal(b.barrio) === n)?.barrio ?? null;
  });
  sugerencias = computed(() => {
    const q = normal(this.dBarrio());
    if (!this.enBarrio() || this.barrioOk() || q.length < 2) return [];
    return this.barrios().filter((b) => normal(b.barrio).includes(q))
      .sort((a, b) => Number(!normal(a.barrio).startsWith(q)) - Number(!normal(b.barrio).startsWith(q)) || a.barrio.localeCompare(b.barrio)).slice(0, 6);
  });

  favoritos = signal<Favorito[]>([]);

  private async cargarFavoritos(): Promise<void> {
    if (!this.c.perfil()) return;
    this.favoritos.set(await this.c.misFavoritos());
  }

  async quitarFavorito(f: Favorito): Promise<void> {
    this.favoritos.update((l) => l.filter((x) => x.id !== f.id));
    await this.c.favorito(f.id, false);
    // El celular también lo olvida (la tienda lo lee al abrir)
    try {
      const loc = (JSON.parse(localStorage.getItem('tienda-favoritos') ?? '[]') as unknown[]).map(String).filter((x) => x !== f.id);
      localStorage.setItem('tienda-favoritos', JSON.stringify(loc));
    } catch { /* sin almacenamiento */ }
  }

  verProducto(id: string): void {
    const v = this.ruta.snapshot.queryParamMap.get('volver');
    const base = v && v.startsWith('/tienda') ? v.split('?')[0] : '/tienda';
    void this.router.navigate([base], { queryParams: { p: id } });
  }

  compras = signal<Compra[]>([]);
  cargandoCompras = signal(false);
  verTodas = signal(false);
  compraSel = signal<Compra | null>(null);
  readonly urlMini = urlMini;

  private async cargarCompras(): Promise<void> {
    if (!this.c.perfil()) return;
    this.cargandoCompras.set(true);
    try { this.compras.set(await this.c.compras()); } catch { this.compras.set([]); }
    this.cargandoCompras.set(false);
  }

  abrirCompra(x: Compra): void {
    this.hojaModo.set('detalle');
    this.errorHoja.set('');
    this.compraSel.set(x);
  }

  // ---------------------------------------------------------------- Calificar y pedir ayuda
  hojaModo = signal<'detalle' | 'calificar' | 'ayuda'>('detalle');
  errorHoja = signal('');
  calEntrega = signal(0);
  calEntregaTxt = '';
  calProd = signal<Record<string, number>>({});
  calProdTxt: Record<string, string> = {};
  ayudaMotivo = signal('');
  ayudaTxt = '';

  estrellasTexto(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  productosCalificables(x: Compra) {
    const vistos = new Set<string>();
    return (x.items ?? []).filter((i) => i.producto_id && !i.mi_resena && !vistos.has(i.producto_id) && vistos.add(i.producto_id));
  }
  /** Entregado y le falta calificar la entrega o algún producto */
  puedeCalificar(x: Compra): boolean {
    return x.estado === 'entregado' && x.canal !== 'local' && !!x.seguimiento && (!x.calif || this.productosCalificables(x).length > 0);
  }
  abrirCalificar(x: Compra): void {
    this.calEntrega.set(0);
    this.calEntregaTxt = '';
    this.calProd.set({});
    this.calProdTxt = {};
    this.errorHoja.set('');
    this.hojaModo.set('calificar');
    void x;
  }
  ponerEstrellas(id: string, n: number): void {
    this.calProd.update((m) => ({ ...m, [id]: n }));
  }
  async enviarCalificacion(x: Compra): Promise<void> {
    const entrega = !x.calif ? (this.calEntrega() ? { estrellas: this.calEntrega(), comentario: this.calEntregaTxt.trim() } : null) : null;
    const productos = Object.entries(this.calProd()).filter(([, e]) => e > 0).map(([id, e]) => ({ producto_id: id, estrellas: e, comentario: (this.calProdTxt[id] ?? '').trim() }));
    if (!entrega && !productos.length) return this.errorHoja.set('Toca las estrellas para calificar.');
    this.ocupado.set(true);
    try {
      await this.c.calificar(x, entrega, productos);
      await this.cargarCompras();
      const nueva = this.compras().find((c) => c.codigo === x.codigo && c.fecha === x.fecha) ?? null;
      this.compraSel.set(nueva);
      this.hojaModo.set('detalle');
      this.aviso.set('¡Gracias por calificar tu compra!');
    } catch (e) {
      this.errorHoja.set(mensajeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  motivosAyuda(x: Compra): string[] {
    if (x.estado === 'entregado') return ['Llegó dañado o incompleto', 'No funciona / garantía', 'Quiero cambiarlo o devolverlo', 'Me cobraron mal', 'Otro'];
    if (x.estado === 'cancelado') return ['¿Por qué lo cancelaron?', 'Me cobraron y se canceló', 'Otro'];
    return ['¿Cuándo me llega?', 'Quiero cambiar la dirección', 'Quiero cambiar o agregar productos', 'Quiero cancelarlo', 'Otro'];
  }
  abrirAyuda(): void {
    this.ayudaMotivo.set('');
    this.ayudaTxt = '';
    this.errorHoja.set('');
    this.hojaModo.set('ayuda');
  }
  async enviarAyuda(x: Compra): Promise<void> {
    if (!this.ayudaMotivo()) return this.errorHoja.set('Elige qué pasó.');
    if (this.ayudaMotivo() === 'Otro' && !this.ayudaTxt.trim()) return this.errorHoja.set('Cuéntanos qué pasó.');
    this.ocupado.set(true);
    try {
      await this.c.pedirAyuda(x, this.ayudaMotivo(), this.ayudaTxt.trim());
      await this.cargarCompras();
      const nueva = this.compras().find((c) => c.codigo === x.codigo && c.fecha === x.fecha) ?? null;
      this.compraSel.set(nueva);
      this.hojaModo.set('detalle');
      this.aviso.set('Recibimos tu mensaje. Te contactamos pronto por WhatsApp o llamada.');
    } catch (e) {
      this.errorHoja.set(mensajeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }
  /** WhatsApp con el pedido ya escrito */
  whatsappAyuda(x: Compra): string | null {
    const n = (x.whatsapp ?? '').replace(/\D/g, '');
    if (n.length < 10) return null;
    const num = n.length === 10 ? '57' + n : n;
    const nombre = this.primerNombre(this.c.perfil()?.nombre ?? '');
    const prods = (x.items ?? []).map((i) => `${i.cantidad} × ${i.nombre}`).join(', ');
    const txt = `Hola, soy ${nombre || 'cliente'}. Necesito ayuda con mi pedido${x.pedido ? ' #' + x.pedido : ''} del ${this.fechaCorta(x.fecha)} (${prods}).`;
    return `https://wa.me/${num}?text=${encodeURIComponent(txt)}`;
  }

  volverAComprar(x: Compra): void {
    this.c.volverAComprar(x);
    this.compraSel.set(null);
    this.volver();
  }

  estadoTexto(x: Compra): string {
    const m: Record<string, string> = {
      por_pagar: 'Esperando el pago', por_confirmar: 'Por confirmar', por_alistar: 'Confirmado', alistado: 'Listo para enviar',
      despachado: x.canal === 'local' ? 'Listo' : 'En camino', entregado: x.canal === 'local' ? 'Comprado en el local' : 'Entregado', cancelado: 'Cancelado',
    };
    return m[x.estado] ?? x.estado;
  }

  resumenItems(x: Compra): string {
    const it = x.items ?? [];
    if (!it.length) return 'Pedido';
    const n = it.reduce((s, i) => s + i.cantidad, 0);
    return it[0].nombre + (it.length > 1 ? ` y ${it.length - 1} más` : n > 1 ? ` (${n})` : '');
  }

  fechaCorta(f: string): string {
    return new Date(f).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
  }
  fechaLarga(f: string): string {
    return new Date(f).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
  }
  private cuando(f: string | null): string {
    return f ? new Date(f).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }) : '';
  }

  /** Línea de tiempo del pedido: hecho → confirmado → alistado → en camino → entregado */
  pasos(x: Compra): { t: string; hecho: boolean; actual: boolean; cuando: string; ayuda?: string }[] {
    if (x.canal === 'local') return [{ t: 'Comprado en el local', hecho: true, actual: true, cuando: this.cuando(x.fecha) }];
    const orden = ['por_pagar', 'por_confirmar', 'por_alistar', 'alistado', 'despachado', 'entregado'];
    const i = orden.indexOf(x.estado);
    const lista = [
      { t: 'Hiciste el pedido', f: x.fecha, n: 0 },
      ...(x.estado === 'por_pagar' ? [{ t: 'Pago', f: null, n: 1, ayuda: 'Falta completar el pago en línea' }] : []),
      { t: 'Confirmado', f: x.confirmado_at, n: 2, ayuda: 'La tienda te contacta para confirmarlo' },
      { t: 'Alistado', f: x.alistado_at, n: 3 },
      { t: 'En camino', f: x.enviado_at, n: 4 },
      { t: 'Entregado', f: x.entregado_at, n: 5 },
    ];
    if (x.estado === 'cancelado') {
      return [{ t: 'Hiciste el pedido', hecho: true, actual: false, cuando: this.cuando(x.fecha) }, { t: 'Cancelado', hecho: true, actual: true, cuando: '' }];
    }
    return lista.map((p) => {
      const hecho = p.n === 0 || i >= p.n;
      return { t: p.t, hecho, actual: false, cuando: hecho ? this.cuando(p.f) : '', ayuda: hecho ? undefined : (p as { ayuda?: string }).ayuda }
    }).map((p, k, arr) => ({ ...p, actual: p.hecho && !arr[k + 1]?.hecho }));
  }

  google = signal(false);

  // ---------------------------------------------------------------- Vistas de Mi cuenta
  vista = signal<'inicio' | 'perfil' | 'direcciones' | 'tarjetas' | 'seguridad'>('inicio');
  /** Recién creada (o le falta algo obligatorio): nombre, celular, documento y una dirección */
  incompleta = computed(() => {
    const p = this.c.perfil();
    return !!p && !(p.nombre && p.telefono && p.documento && p.direcciones.length);
  });
  private corrigiendoDatos = signal(false);
  datosListos = computed(() => {
    const p = this.c.perfil();
    return !!p && !!(p.nombre && p.telefono && p.documento) && !this.corrigiendoDatos();
  });
  titulo(): string {
    const p = this.c.perfil();
    if (!p) return this.modo() === 'crear' ? 'Crea tu cuenta' : 'Ingresa a tu cuenta';
    if (this.incompleta()) return 'Completa tu cuenta';
    return { inicio: 'Mi cuenta', perfil: 'Mi perfil', direcciones: 'Mis direcciones', tarjetas: 'Mis tarjetas', seguridad: 'Seguridad' }[this.vista()];
  }
  irA(v: 'perfil' | 'direcciones' | 'tarjetas' | 'seguridad'): void {
    this.aviso.set('');
    this.error.set('');
    this.errorDatos.set('');
    this.formDir.set(false);
    this.llenarDatos();
    this.vista.set(v);
    document.querySelector('.cc-scroll')?.scrollTo({ top: 0 });
  }
  atras(): void {
    if (this.c.perfil() && !this.incompleta() && this.vista() !== 'inicio') {
      this.vista.set('inicio');
      this.formDir.set(false);
      return;
    }
    this.volver();
  }
  volverADatos(): void {
    this.llenarDatos();
    this.corrigiendoDatos.set(true);
  }
  /** Paso 2 del registro: el formulario de la dirección principal, listo */
  private prepararDireccionAlta(): void {
    this.dId = null;
    this.dEtiqueta = 'Casa';
    this.dDireccion = '';
    this.dBarrio.set('');
    this.dIndicaciones = '';
    this.dPrincipal = true;
    this.errorDir.set('');
    void this.cargarBarrios();
  }

  // ---------------------------------------------------------------- Foto de perfil
  porRecortar = signal<File | null>(null);
  subiendo = signal(false);
  elegirFoto(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!archivo.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp)$/i.test(archivo.name)) {
      this.aviso.set('Elige una foto (JPG, PNG o HEIC).');
      return;
    }
    this.porRecortar.set(archivo);
  }
  async subirFoto(blob: Blob): Promise<void> {
    this.subiendo.set(true);
    try {
      await this.c.subirFoto(blob);
      this.porRecortar.set(null);
      this.aviso.set('Foto actualizada.');
    } catch (e) {
      this.aviso.set(mensajeError(e));
    } finally {
      this.subiendo.set(false);
    }
  }
  async quitarFoto(): Promise<void> {
    if (!(await confirmar('¿Quitar tu foto de perfil?', { aceptar: 'Quitar', cancelar: 'Volver', peligro: true }))) return;
    try {
      await this.c.ponerFoto(null);
      this.aviso.set('Foto quitada.');
    } catch (e) {
      this.aviso.set(mensajeError(e));
    }
  }

  async cambiarClaveCuenta(): Promise<void> {
    this.error.set('');
    const malo = problemaClave(this.clave, this.c.perfil()?.email ?? '');
    if (malo) return this.error.set(malo);
    if (this.clave !== this.clave2) return this.error.set('Las dos contraseñas no coinciden.');
    this.ocupado.set(true);
    const { error } = await this.c.cambiarClave(this.clave);
    this.ocupado.set(false);
    if (error) return this.error.set(this.traducir(error.message, error.status));
    this.clave = this.clave2 = '';
    this.vista.set('inicio');
    this.aviso.set('Listo, tu contraseña quedó cambiada.');
  }

  async conGoogle(): Promise<void> {
    this.ocupado.set(true);
    this.error.set('');
    const v = this.ruta.snapshot.queryParamMap.get('volver');
    const { error } = await this.c.entrarConGoogle(v && v.startsWith('/tienda') ? v : null);
    // Si todo va bien, el navegador se va a Google; si no, se queda aquí con el aviso
    if (error) {
      this.ocupado.set(false);
      this.error.set('No se pudo abrir Google. Intenta otra vez o entra con tu correo.');
    }
  }

  ngOnInit(): void {
    void this.c.googleDisponible().then((si) => this.google.set(si));
    const q = this.ruta.snapshot.queryParamMap;
    if (q.get('crear')) this.modo.set('crear');
    // Viene del correo para cambiar la contraseña
    const { data } = this.sb.client.auth.onAuthStateChange((evento) => {
      if (evento === 'PASSWORD_RECOVERY') this.modo.set('nueva-clave');
    });
    this.quitarEscucha = () => data.subscription.unsubscribe();
    // El enlace del correo abre esta página con ?nueva=1 y la sesión ya iniciada
    void this.c.asegurar().then(async () => {
      if (q.get('nueva') && this.c.sesion()) this.modo.set('nueva-clave');
      await this.c.cargar();
      this.llenarDatos();
    });
  }

  /** Al volver a Mi cuenta (la app reutiliza la pantalla): datos, compras y favoritos al día */
  private primera = true;
  ionViewWillEnter(): void {
    if (this.primera) { this.primera = false; return; }
    void this.c.cargar().then(() => {
      this.llenarDatos();
      void this.cargarCompras();
      void this.cargarFavoritos();
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
    this.quitarEscucha?.();
  }

  private llenarDatos(): void {
    const p = this.c.perfil();
    if (!p) return;
    if (this.incompleta() && this.datosListos() && !this.barrios().length) this.prepararDireccionAlta();
    if (!this.compras().length && !this.cargandoCompras()) void this.cargarCompras();
    if (!this.favoritos().length) void this.cargarFavoritos();
    this.nombre = p.nombre;
    this.prefijo = p.prefijo || '57';
    this.telefono = p.telefono ?? '';
    this.tipoDoc = p.tipo_doc || 'CC';
    this.documento = p.documento ?? '';
  }

  cambiarModo(m: Modo): void {
    this.modo.set(m);
    this.error.set('');
    this.aviso.set('');
    this.codigo = '';
  }

  volver(): void {
    const v = this.ruta.snapshot.queryParamMap.get('volver');
    void this.router.navigateByUrl(v && v.startsWith('/tienda') ? v : '/tienda');
  }

  limpiar(v: string): string {
    return limpiarNombre(v);
  }

  primerNombre(n: string): string {
    return (n || '').trim().split(/\s+/)[0] ?? '';
  }

  iniciales(n: string): string {
    const p = n.trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  private traducir(msg: string, status?: number): string {
    const m = msg.toLowerCase();
    if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
    if (m.includes('email not confirmed')) return 'Primero confirma tu correo: te enviamos un enlace al crear la cuenta.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Ese correo ya tiene cuenta. Ingresa o recupera tu contraseña.';
    if (m.includes('captcha')) return 'No pasó la verificación de seguridad. Inténtalo otra vez.';
    if (status === 429 || m.includes('rate limit') || m.includes('security purposes')) return 'Demasiados intentos. Espera un momento y vuelve a intentar.';
    if (m.includes('token') && (m.includes('expired') || m.includes('invalid'))) return 'Ese código no sirve o ya venció. Pide uno nuevo.';
    if (m.includes('password')) return 'Esa contraseña no es válida: usa al menos 8 caracteres con letras y números.';
    return 'No se pudo completar. Intenta de nuevo.';
  }

  private reiniciarCaptcha(): void {
    this.captchaCmp?.reiniciar();
    this.captcha.set('');
  }

  async entrar(): Promise<void> {
    if (!this.email.trim() || !this.clave) return this.error.set('Escribe tu correo y tu contraseña.');
    this.ocupado.set(true);
    this.error.set('');
    const { error } = await this.c.entrar(this.email, this.clave, this.captcha());
    this.reiniciarCaptcha();
    if (error) {
      this.ocupado.set(false);
      return this.error.set(this.traducir(error.message, error.status));
    }
    await this.c.cargar();
    this.ocupado.set(false);
    this.clave = '';
    this.llenarDatos();
  }

  async crear(): Promise<void> {
    if (!/\p{L}{2}/u.test(this.nombre)) return this.error.set('Escribe tu nombre.');
    const tel = this.telefono.replace(/\D/g, '');
    const malTel = !tel ? 'Escribe tu celular.' : errorTelefono(this.prefijo, tel);
    if (malTel) return this.error.set(malTel);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email.trim())) return this.error.set('Escribe un correo válido.');
    const malo = problemaClave(this.clave, this.email);
    if (malo) return this.error.set(malo);
    if (this.clave !== this.clave2) return this.error.set('Las dos contraseñas no coinciden.');
    this.ocupado.set(true);
    this.error.set('');
    const { data, error } = await this.c.registrar({ nombre: this.nombre, email: this.email, password: this.clave, prefijo: this.prefijo, telefono: tel }, this.captcha());
    this.reiniciarCaptcha();
    this.ocupado.set(false);
    if (error) {
      const m = error.message.toLowerCase();
      return this.error.set(m.includes('database error') || m.includes('no_autorizado') ? 'No se pudo crear la cuenta. Intenta de nuevo en un momento.' : this.traducir(error.message, error.status));
    }
    // Supabase no avisa si el correo ya existía (para no revelar cuentas): llega sin identidades
    if (data.user && !data.user.identities?.length) return this.error.set('Ese correo ya tiene cuenta. Ingresa o toca «¿Olvidaste tu contraseña?».');
    this.clave = '';
    this.clave2 = '';
    if (data.session) {
      await this.c.cargar();
      this.llenarDatos();
    } else {
      this.cambiarModo('confirmar');
      this.iniciarEspera();
    }
  }

  async confirmarCodigo(tipo: 'signup' | 'recovery'): Promise<void> {
    if (tipo === 'recovery') {
      const malo = problemaClave(this.clave, this.email);
      if (malo) return this.error.set(malo);
    }
    this.ocupado.set(true);
    this.error.set('');
    const { error } = await this.c.verificarCodigo(this.email, this.codigo, tipo);
    if (error) {
      this.ocupado.set(false);
      return this.error.set(this.traducir(error.message, error.status));
    }
    if (tipo === 'recovery') {
      const r = await this.c.cambiarClave(this.clave);
      if (r.error) {
        this.ocupado.set(false);
        return this.error.set(this.traducir(r.error.message, r.error.status));
      }
    }
    await this.c.cargar();
    this.ocupado.set(false);
    this.clave = '';
    this.llenarDatos();
    this.aviso.set(tipo === 'recovery' ? 'Listo, tu contraseña quedó cambiada.' : '¡Bienvenido! Tu cuenta quedó activa.');
  }

  async reenviar(): Promise<void> {
    this.ocupado.set(true);
    const { error } = await this.c.reenviarConfirmacion(this.email, this.captcha());
    this.reiniciarCaptcha();
    this.ocupado.set(false);
    if (error) return this.error.set(this.traducir(error.message, error.status));
    this.aviso.set('Te enviamos el correo otra vez.');
    this.iniciarEspera();
  }

  async olvide(): Promise<void> {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email.trim())) return this.error.set('Escribe tu correo.');
    this.ocupado.set(true);
    this.error.set('');
    const { error } = await this.c.recuperar(this.email, this.captcha());
    this.reiniciarCaptcha();
    this.ocupado.set(false);
    if (error) return this.error.set(this.traducir(error.message, error.status));
    this.cambiarModo('codigo-clave');
  }

  async guardarClaveNueva(): Promise<void> {
    const malo = problemaClave(this.clave);
    if (malo) return this.error.set(malo);
    if (this.clave !== this.clave2) return this.error.set('Las dos contraseñas no coinciden.');
    this.ocupado.set(true);
    const { error } = await this.c.cambiarClave(this.clave);
    this.ocupado.set(false);
    if (error) return this.error.set(this.traducir(error.message, error.status));
    this.clave = this.clave2 = '';
    history.replaceState(null, '', '/tienda/cuenta');
    this.modo.set('entrar');
    await this.c.cargar();
    this.llenarDatos();
    this.aviso.set('Listo, tu contraseña quedó cambiada.');
  }

  private iniciarEspera(): void {
    clearInterval(this.reloj);
    this.espera.set(60);
    this.reloj = setInterval(() => {
      this.espera.update((s) => s - 1);
      if (this.espera() <= 0) clearInterval(this.reloj);
    }, 1000);
  }

  // ---------- Adentro ----------
  async guardarDatos(): Promise<void> {
    this.errorDatos.set('');
    if (!/\p{L}{2}/u.test(this.nombre)) return this.errorDatos.set('Escribe tu nombre.');
    const tel = this.telefono.replace(/\D/g, '');
    const malTel = !tel ? 'Escribe tu celular.' : errorTelefono(this.prefijo, tel);
    if (malTel) return this.errorDatos.set(malTel);
    if (this.documento.replace(/[^0-9A-Za-z]/g, '').length < 5) return this.errorDatos.set('Escribe tu número de documento.');
    const enAlta = this.incompleta();
    this.ocupado.set(true);
    const { error } = await this.c.guardarDatos({ nombre: this.nombre, prefijo: this.prefijo, telefono: tel, tipo_doc: this.tipoDoc, documento: this.documento });
    this.ocupado.set(false);
    if (error) return this.errorDatos.set(mensajeError(error));
    this.corrigiendoDatos.set(false);
    if (enAlta) {
      this.prepararDireccionAlta();
      document.querySelector('.cc-scroll')?.scrollTo({ top: 0 });
      return;
    }
    this.vista.set('inicio');
    this.aviso.set('Tus datos quedaron guardados.');
  }

  private async cargarBarrios(): Promise<void> {
    if (this.barrios().length) return;
    const { data } = await this.sb.client.rpc('tienda_barrios');
    if (Array.isArray(data)) this.barrios.set(data as { barrio: string; domicilio: number }[]);
  }

  nuevaDireccion(): void {
    this.dId = null;
    this.dEtiqueta = (this.c.perfil()?.direcciones.length ?? 0) ? 'Trabajo' : 'Casa';
    this.dDireccion = '';
    this.dBarrio.set('');
    this.dIndicaciones = '';
    this.dPrincipal = !(this.c.perfil()?.direcciones.length ?? 0);
    this.abrirDir();
  }

  editarDireccion(d: ClienteDireccion): void {
    this.dId = d.id;
    this.dEtiqueta = d.etiqueta;
    this.dDireccion = d.direccion;
    this.dBarrio.set(d.barrio);
    this.dIndicaciones = d.indicaciones ?? '';
    this.dPrincipal = d.principal;
    this.abrirDir();
  }

  private abrirDir(): void {
    this.errorDir.set('');
    this.aviso.set('');
    this.enBarrio.set(false);
    this.formDir.set(true);
    void this.cargarBarrios();
  }

  escribirBarrio(v: string): void {
    this.dBarrio.set(v);
    this.enBarrio.set(true);
  }

  elegirBarrio(b: string): void {
    this.dBarrio.set(b);
    this.enBarrio.set(false);
  }

  salirBarrio(): void {
    setTimeout(() => this.enBarrio.set(false), 150);
  }

  async guardarDireccion(): Promise<void> {
    this.errorDir.set('');
    if (this.dDireccion.trim().length < 5) return this.errorDir.set('Escribe la dirección completa (calle, número y apto o casa).');
    const barrio = this.barrioOk();
    if (!barrio) return this.errorDir.set('Elige tu barrio de la lista. Si no eres de Cali, escribe solo el nombre de tu ciudad y elígela.');
    this.incompletaAntes = this.incompleta();
    this.ocupado.set(true);
    const { error } = await this.c.guardarDireccion({ id: this.dId, etiqueta: this.dEtiqueta, direccion: this.dDireccion, barrio, indicaciones: this.dIndicaciones, principal: this.dPrincipal });
    this.ocupado.set(false);
    if (error) return this.errorDir.set(mensajeError(error));
    const eraAlta = this.incompletaAntes;
    this.formDir.set(false);
    this.aviso.set(eraAlta ? '¡Listo! Tu cuenta quedó completa.' : 'Dirección guardada.');
    if (eraAlta) document.querySelector('.cc-scroll')?.scrollTo({ top: 0 });
  }

  async hacerPrincipal(d: ClienteDireccion): Promise<void> {
    const { error } = await this.c.guardarDireccion({ id: d.id, etiqueta: d.etiqueta, direccion: d.direccion, barrio: d.barrio, indicaciones: d.indicaciones ?? '', principal: true });
    if (error) this.aviso.set(mensajeError(error));
  }

  async quitarDireccion(d: ClienteDireccion): Promise<void> {
    if (!(await confirmar(`¿Quitar la dirección "${d.etiqueta}" (${d.direccion})?`, { aceptar: 'Quitar', cancelar: 'Volver', peligro: true }))) return;
    const { error } = await this.c.quitarDireccion(d.id);
    this.aviso.set(error ? mensajeError(error) : 'Dirección quitada.');
  }

  async quitarTarjeta(id: number, ultimos: string | null): Promise<void> {
    if (!(await confirmar(`¿Quitar la tarjeta terminada en ${ultimos ?? ''}? Para volver a usarla tendrás que escribir sus datos otra vez.`, { aceptar: 'Quitar', cancelar: 'Volver', peligro: true }))) return;
    const { error } = await this.c.quitarTarjeta(id);
    this.aviso.set(error ? mensajeError(error) : 'Tarjeta quitada.');
  }

  async salir(): Promise<void> {
    await this.c.salir();
    this.cambiarModo('entrar');
  }
}
