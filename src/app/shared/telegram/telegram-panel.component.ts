import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmarkCircle, copyOutline, paperPlaneOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { mensajeError } from '../formato';

interface Estado {
  conectado: boolean;
  bot: string | null;
  vinculado: boolean;
  grupos: { chat_id: number; titulo: string | null; mensajero_id: string; mensajero: string }[];
  despachadores: { usuario: string; telegram: string | null }[];
  mensajeros: Mensajero[];
}

interface Mensajero {
  id: string;
  nombre: string;
}

/**
 * Despacho por Telegram (como en Jasta).
 *  modo 'admin'  (Configuración): conectar el bot, vincular el grupo de cada
 *                domiciliario y la cuenta propia.
 *  modo 'perfil' (Mi perfil): solo vincular la cuenta de quien despacha.
 */
@Component({
  selector: 'app-telegram-panel',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon],
  styles: [
    `
      :host { display: block; }
      .pasos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .paso { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; padding: 14px 0; border-bottom: var(--perfora); }
      .paso:last-child { border-bottom: none; }
      .num { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 650;
        background: var(--surface-2); color: var(--text-soft); }
      .paso.hecho .num { background: var(--efectivo); color: #fff; }
      .paso h3 { margin: 2px 0 4px; font-size: 14.5px; font-weight: 650; }
      .paso p, .paso li { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-soft); }
      .paso ol { margin: 6px 0 0; padding-left: 18px; }
      .ok { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--efectivo); }
      .fila { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
      .fila .inp { flex: 1 1 260px; min-width: 0; font-family: var(--mono-font); font-size: 13px; }
      .codigo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding: 10px 12px; border-radius: var(--radius);
        background: var(--oro-wash); border: 1px solid var(--oro-soft); animation: aparecer 220ms var(--ease); }
      @keyframes aparecer { from { opacity: 0; transform: translateY(-4px); } }
      .codigo code { font-family: var(--mono-font); font-size: 16px; font-weight: 700; letter-spacing: 0.04em; }
      .codigo small { flex-basis: 100%; font-size: 12px; color: var(--text-soft); }
      .mensajeros { margin-top: 10px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
      .mens { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--border-soft); font-size: 13.5px; }
      .mens:last-child { border-bottom: none; }
      .mens .nom { flex: 1; min-width: 0; font-weight: 550; }
      .mens .grupo { font-size: 12px; color: var(--efectivo); }
      .mens .sin { font-size: 12px; color: var(--text-muted); }
      .mens .b { height: 32px; font-size: 12.5px; }
      a.b-tg { background: #229ed9; border-color: #229ed9; color: #fff; }
    `,
  ],
  template: `
    @if (estado(); as e) {
      @if (modo === 'perfil') {
        <!-- Solo la cuenta de quien despacha -->
        @if (!e.conectado) {
          <p class="ayuda">El admin todavía no ha conectado el bot de Telegram (Configuración → Telegram).</p>
        } @else if (e.vinculado) {
          <span class="ok"><ion-icon name="checkmark-circle"></ion-icon>Tu Telegram está vinculado. Ya puedes despachar mandando fotos de rótulos.</span>
          <div class="fila"><button class="b" (click)="vincularme()">Vincular otra cuenta de Telegram</button></div>
        } @else {
          <p class="ayuda">Vincula tu Telegram para despachar mandando la foto de cada rótulo al grupo del domiciliario.</p>
          <div class="fila"><button class="b b-pri" (click)="vincularme()" [disabled]="trabajando()">Vincular mi Telegram</button></div>
        }
        @if (enlace(); as l) {
          <div class="codigo">
            <a class="b b-tg" [href]="l" target="_blank" rel="noopener"><ion-icon name="paper-plane-outline"></ion-icon>Abrir Telegram y vincular</a>
            <small>Se abre el chat con &#64;{{ e.bot }}: toca <strong>Iniciar</strong>. El código vence en 30 minutos.</small>
          </div>
        }
      } @else {
        <ol class="pasos">
          <li class="paso" [class.hecho]="e.conectado">
            <span class="num">{{ e.conectado ? '✓' : '1' }}</span>
            <div>
              <h3>Conectar el bot</h3>
              @if (e.conectado && !cambiarToken()) {
                <span class="ok"><ion-icon name="checkmark-circle"></ion-icon>Conectado: &#64;{{ e.bot }}</span>
                <div class="fila"><button class="b" (click)="cambiarToken.set(true)">Cambiar de bot</button></div>
              } @else {
                <ol>
                  <li>En Telegram, abre <strong>&#64;BotFather</strong> y escribe <code>/newbot</code>.</li>
                  <li>Ponle un nombre (ej. "JYB Despachos") y un usuario que termine en "bot".</li>
                  <li>Copia el <strong>token</strong> que te da y pégalo aquí.</li>
                </ol>
                <div class="fila">
                  <input class="inp" type="password" autocomplete="off" [(ngModel)]="token" placeholder="123456789:AA…" aria-label="Token del bot" />
                  <button class="b b-pri" (click)="conectar()" [disabled]="trabajando() || !token.trim()">{{ trabajando() ? 'Conectando…' : 'Conectar' }}</button>
                </div>
              }
            </div>
          </li>

          <li class="paso" [class.hecho]="e.vinculado">
            <span class="num">{{ e.vinculado ? '✓' : '2' }}</span>
            <div>
              <h3>Vincular a quien despacha</h3>
              <p>Cada persona que va a subir fotos de rótulos vincula su Telegram (también desde <strong>Mi perfil</strong>). Solo sus fotos asignan pedidos.</p>
              @if (e.despachadores.length) {
                <p style="margin-top: 6px">Vinculados: {{ nombresDespachadores() }}</p>
              }
              @if (e.conectado) {
                <div class="fila"><button class="b" (click)="vincularme()" [disabled]="trabajando()">{{ e.vinculado ? 'Volver a vincular mi Telegram' : 'Vincular mi Telegram' }}</button></div>
                @if (enlace(); as l) {
                  <div class="codigo">
                    <a class="b b-tg" [href]="l" target="_blank" rel="noopener"><ion-icon name="paper-plane-outline"></ion-icon>Abrir Telegram y vincular</a>
                    <small>Se abre el chat con &#64;{{ e.bot }}: toca <strong>Iniciar</strong>. El código vence en 30 minutos.</small>
                  </div>
                }
              }
            </div>
          </li>

          <li class="paso" [class.hecho]="e.grupos.length > 0">
            <span class="num">{{ e.grupos.length ? '✓' : '3' }}</span>
            <div>
              <h3>Un grupo por domiciliario</h3>
              <ol>
                <li>Crea un grupo en Telegram con el domiciliario, quien despacha y &#64;{{ e.bot || 'tu bot' }}.</li>
                <li>Haz al bot <strong>administrador</strong> del grupo (así puede ver las fotos).</li>
                <li>Crea el código del domiciliario aquí y escríbelo en el grupo.</li>
              </ol>
              <div class="mensajeros">
                @for (m of e.mensajeros; track m.id) {
                  <div class="mens">
                    <span class="nom">{{ m.nombre }}</span>
                    @if (grupoDe(m.id); as g) { <span class="grupo">✓ {{ g.titulo || 'Grupo vinculado' }}</span> } @else { <span class="sin">Sin grupo</span> }
                    <button class="b" (click)="codigoGrupo(m)" [disabled]="!e.conectado || trabajando()">{{ grupoDe(m.id) ? 'Cambiar grupo' : 'Crear código' }}</button>
                  </div>
                } @empty {
                  <div class="mens"><span class="sin">No hay domiciliarios activos.</span></div>
                }
              </div>
              @if (codigo(); as c) {
                <div class="codigo">
                  <code>/vincular {{ c.codigo }}</code>
                  <button class="b" (click)="copiar('/vincular ' + c.codigo)"><ion-icon name="copy-outline"></ion-icon>Copiar</button>
                  <small>Escríbelo en el grupo de <strong>{{ c.mensajero }}</strong>. Vence en 30 minutos.</small>
                </div>
              }
            </div>
          </li>

          <li class="paso">
            <span class="num">4</span>
            <div>
              <h3>Despachar</h3>
              <p>Manda al grupo del domiciliario la foto de cada rótulo (con el código QR visible). El bot le asigna el pedido, lo pone <strong>En ruta</strong> en el orden de las fotos y responde con ✅. Si una foto no se lee, escribe el número del pedido. <code>/ruta</code> muestra lo que lleva.</p>
            </div>
          </li>
        </ol>
      }
    } @else {
      <p class="ayuda">Cargando…</p>
    }
  `,
})
export class TelegramPanelComponent implements OnInit {
  @Input() modo: 'admin' | 'perfil' = 'admin';

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  estado = signal<Estado | null>(null);
  trabajando = signal(false);
  cambiarToken = signal(false);
  enlace = signal<string | null>(null);
  codigo = signal<{ codigo: string; mensajero: string } | null>(null);
  token = '';

  nombresDespachadores = computed(() => (this.estado()?.despachadores ?? []).map((d) => d.usuario).join(', '));

  constructor() {
    addIcons({ checkmarkCircle, copyOutline, paperPlaneOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.rpc('telegram_estado');
    if (error) return this.toast.error(mensajeError(error));
    this.estado.set(data as Estado);
  }

  grupoDe(mensajeroId: string) {
    return this.estado()?.grupos.find((g) => g.mensajero_id === mensajeroId) ?? null;
  }

  async conectar(): Promise<void> {
    this.trabajando.set(true);
    try {
      const { data, error } = await this.sb.client.functions.invoke('telegram-config', { body: { token: this.token.trim() } });
      if (error) {
        // El mensaje claro viene en el cuerpo de la respuesta
        const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(cuerpo?.error ?? error.message);
      }
      this.token = '';
      this.cambiarToken.set(false);
      this.toast.ok(`Bot @${(data as { bot: string }).bot} conectado`);
      await this.cargar();
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.trabajando.set(false);
    }
  }

  async vincularme(): Promise<void> {
    this.trabajando.set(true);
    const { data, error } = await this.sb.client.rpc('telegram_codigo', { p_tipo: 'usuario' });
    this.trabajando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.enlace.set(`https://t.me/${this.estado()?.bot}?start=${data}`);
  }

  async codigoGrupo(m: Mensajero): Promise<void> {
    this.trabajando.set(true);
    const { data, error } = await this.sb.client.rpc('telegram_codigo', { p_tipo: 'grupo', p_mensajero: m.id });
    this.trabajando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.codigo.set({ codigo: String(data), mensajero: m.nombre });
  }

  async copiar(texto: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      this.toast.ok('Copiado');
    } catch {
      this.toast.error('No se pudo copiar: escríbelo a mano.');
    }
  }
}
