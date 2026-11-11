import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, refreshOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { VisorService } from '../../shared/visor/visor.service';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
import { urlsComprobantes } from '../../shared/comprobantes';
import { mensajeError, pesos } from '../../shared/formato';
import { formatoFechaCO, formatoHoraCO } from '../../shared/fecha-colombia';
import { TransferenciasAlertaService } from '../../shared/transferencias-alerta/transferencias-alerta.service';

interface Transferencia {
  id: string; numero: number; estado: 'por_revisar' | 'llego' | 'no_llego'; canal: 'domicilio' | 'local'; cliente: string | null; telefono: string | null;
  total: number; transferencia: number; esperado: number; tipo: string | null; entregado_at: string;
  comprobantes: string[]; domiciliario: string | null; vendedor: string | null;
  revisada_at: string | null; revisada_por: string | null; nota: string | null;
}
type Filtro = 'por_revisar' | 'no_llego' | 'revisadas';

/**
 * Transferencias por revisar: cada pago presencial con transferencia (domicilio o local) queda aquí
 * hasta que el admin mira en el banco y confirma que sí llegó.
 */
@Component({
  selector: 'app-transferencias',
  standalone: true,
  imports: [FormsModule, IonIcon, SkeletonComponent],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 820px; }
      .resumen { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px 18px; border-radius: var(--radius-lg); background: var(--danger-wash); }
      .resumen.ok { background: var(--ok-wash); }
      .resumen span { font-size: 13px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--danger); }
      .resumen.ok span { color: var(--efectivo-texto); }
      .resumen strong { display: block; font-family: var(--mono-font); font-size: 26px; }
      .resumen small { font-size: 13px; color: var(--text-soft); }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chips button { height: 34px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); color: var(--text-soft); font: inherit; font-size: 13.5px; cursor: pointer; }
      .chips button.on { border-color: var(--accent); background: var(--accent-wash); color: var(--accent); font-weight: 650; }
      .lista { display: flex; flex-direction: column; gap: 10px; }
      .tr { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .tr.por_revisar { border-color: var(--danger); box-shadow: inset 4px 0 0 var(--danger); }
      .tr.vieja { animation: parpadeo 1.6s ease-in-out infinite; }
      @keyframes parpadeo { 50% { box-shadow: inset 4px 0 0 var(--danger), 0 0 0 3px var(--danger-wash); } }
      .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .cab h3 { margin: 0; font-size: 15px; }
      .cab small { display: block; margin-top: 2px; font-size: 12.5px; color: var(--text-muted); }
      .valor { text-align: right; }
      .valor strong { display: block; font-family: var(--mono-font); font-size: 22px; }
      .valor small { font-size: 12px; color: var(--text-muted); }
      .tag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: var(--surface-2); color: var(--text-soft); }
      .tag.local { background: var(--oro-wash); color: var(--oro-texto); }
      .espera { font-size: 12.5px; font-weight: 650; color: var(--danger); }
      .fotos { display: flex; gap: 8px; flex-wrap: wrap; }
      .foto { width: 64px; height: 64px; padding: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--surface-2); cursor: zoom-in; }
      .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .sin-foto { font-size: 12.5px; color: var(--oro-texto); }
      .acciones { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .acciones .b { height: 44px; font-size: 14.5px; }
      .resultado { margin: 0; padding: 8px 10px; border-radius: var(--radius-sm); font-size: 13px; background: var(--ok-wash); color: var(--efectivo-texto); }
      .resultado.mal { background: var(--danger-wash); color: var(--danger); }
      .link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; }
      .vacio-txt { margin: 0; padding: 24px 0; text-align: center; font-size: 14px; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Pagos presenciales por transferencia</p><h1>Transferencias</h1></div>
        <button class="b b-icono" aria-label="Actualizar" (click)="cargar()"><ion-icon name="refresh-outline"></ion-icon></button>
      </div>

      <div class="resumen" [class.ok]="!alerta.n()">
        @if (alerta.n()) {
          <div><span>Por revisar en el banco</span><strong>{{ pesos(alerta.valor()) }}</strong>
            <small>{{ alerta.n() }} {{ alerta.n() === 1 ? 'transferencia' : 'transferencias' }} · la más vieja hace {{ hace(alerta.desde()) }}</small></div>
        } @else {
          <div><span>Todo revisado</span><small>No hay transferencias pendientes. Cuando registren un pago por transferencia te llega un aviso.</small></div>
        }
      </div>
      <p class="ayuda" style="margin: 0">Abre la app de tu banco, busca cada transferencia por el valor y la hora, y confirma aquí si llegó. Mientras quede alguna sin revisar te llega un aviso cada 30 minutos.</p>

      <div class="chips" role="group" aria-label="Qué transferencias ver">
        <button type="button" [class.on]="filtro() === 'por_revisar'" (click)="cambiar('por_revisar')">Por revisar{{ alerta.n() ? ' (' + alerta.n() + ')' : '' }}</button>
        <button type="button" [class.on]="filtro() === 'no_llego'" (click)="cambiar('no_llego')">No llegaron</button>
        <button type="button" [class.on]="filtro() === 'revisadas'" (click)="cambiar('revisadas')">Revisadas (15 días)</button>
      </div>

      <div class="lista">
        @for (t of lista(); track t.id) {
          <article class="tr" [class]="'tr ' + t.estado" [class.vieja]="t.estado === 'por_revisar' && horas(t.entregado_at) >= 2">
            <div class="cab">
              <div>
                <h3>{{ t.cliente || 'Cliente' }}</h3>
                <small><span class="tag" [class.local]="t.canal === 'local'">{{ t.canal === 'local' ? 'Venta del local' : 'Domicilio' }}</span>
                  #{{ t.numero }} · {{ cuando(t.entregado_at) }}</small>
                <small>{{ t.canal === 'local' ? (t.vendedor ? 'Vendió ' + t.vendedor : 'Venta del local') : 'Entregó ' + (t.domiciliario || '—') }}</small>
                @if (t.estado === 'por_revisar') { <span class="espera">Esperando hace {{ hace(t.entregado_at) }}</span> }
              </div>
              <div class="valor">
                <strong>{{ pesos(t.esperado) }}</strong>
                @if (t.tipo === 'mixto') { <small>Mixto: pedido {{ pesos(t.total) }}</small> }
              </div>
            </div>
            @if (t.comprobantes.length) {
              <div class="fotos">
                @for (f of t.comprobantes; track f; let i = $index) {
                  <button type="button" class="foto" (click)="verFotos(t, i)" [attr.aria-label]="'Ver comprobante ' + (i + 1)">
                    @if (fotos()[f]; as u) { <img [src]="u" alt="" loading="lazy" /> }
                  </button>
                }
              </div>
            } @else { <span class="sin-foto">Sin foto del comprobante</span> }

            @if (t.estado === 'por_revisar') {
              <div class="acciones">
                <button class="b" [disabled]="ocupado() === t.id" (click)="noLlego(t)">✗ No llegó</button>
                <button class="b b-ok" [disabled]="ocupado() === t.id" (click)="llego(t)">✓ Sí llegó</button>
              </div>
            } @else if (t.estado === 'llego') {
              <p class="resultado">✓ Confirmada por {{ t.revisada_por }} · {{ cuando(t.revisada_at!) }}</p>
            } @else {
              <p class="resultado mal">✗ No llegó ({{ t.revisada_por }} · {{ cuando(t.revisada_at!) }}): {{ t.nota }}</p>
              <div><button class="link" (click)="llego(t)">Ya llegó: marcar como recibida</button></div>
            }
          </article>
        } @empty {
          @if (cargando()) { <app-skeleton variante="filas" [cantidad]="3"></app-skeleton> }
          @else { <p class="vacio-txt">{{ filtro() === 'por_revisar' ? '¡Listo! No hay transferencias por revisar.' : filtro() === 'no_llego' ? 'Ninguna transferencia marcada como no recibida.' : 'No hay transferencias revisadas en los últimos 15 días.' }}</p> }
        }
      </div>
    </div>

  `,
})
export class TransferenciasPage implements OnInit, OnDestroy {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);
  alerta = inject(TransferenciasAlertaService);

  lista = signal<Transferencia[]>([]);
  filtro = signal<Filtro>('por_revisar');
  cargando = signal(true);
  ocupado = signal<string | null>(null);
  fotos = signal<Record<string, string>>({});
  pesos = pesos;
  /** Para que "hace X min" se actualice solo */
  private ahora = signal(Date.now());
  private reloj?: ReturnType<typeof setInterval>;
  pendientes = computed(() => this.lista().filter((t) => t.estado === 'por_revisar').length);

  constructor() {
    addIcons({ closeOutline, refreshOutline });
  }

  ngOnInit(): void {
    void this.cargar();
    this.reloj = setInterval(() => {
      this.ahora.set(Date.now());
      if (this.filtro() === 'por_revisar') void this.cargar(true);
    }, 60_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.reloj);
  }

  cambiar(f: Filtro): void {
    this.filtro.set(f);
    this.lista.set([]);
    this.cargando.set(true);
    void this.cargar();
  }

  async cargar(silencioso = false): Promise<void> {
    const { data, error } = await this.sb.client.rpc('transferencias_lista', { p_estado: this.filtro() });
    this.cargando.set(false);
    void this.alerta.refrescar();
    if (error) {
      if (!silencioso) this.toast.error(mensajeError(error));
      return;
    }
    const lista = (data ?? []) as Transferencia[];
    this.lista.set(lista);
    const faltan = lista.flatMap((t) => t.comprobantes).filter((f) => !this.fotos()[f]);
    if (faltan.length) {
      const urls = await urlsComprobantes(this.sb.client, faltan);
      this.fotos.update((m) => ({ ...m, ...Object.fromEntries(faltan.map((f, i) => [f, urls[i]])) }));
    }
  }

  async llego(t: Transferencia): Promise<void> {
    await this.revisar(t, true, null);
  }

  async noLlego(t: Transferencia): Promise<void> {
    const nota = prompt(`¿Qué pasó con la transferencia de ${pesos(t.esperado)}? (Ej: no aparece en el banco, llegó menos)`)?.trim();
    if (!nota) return;
    await this.revisar(t, false, nota);
  }

  private async revisar(t: Transferencia, llego: boolean, nota: string | null): Promise<void> {
    this.ocupado.set(t.id);
    const { error } = await this.sb.client.rpc('revisar_transferencia', { p_pedido: t.id, p_llego: llego, p_nota: nota });
    this.ocupado.set(null);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(llego ? `Listo: ${pesos(t.esperado)} confirmada` : 'Marcada como no recibida. Le avisamos a quien la registró.');
    await this.cargar();
  }

  verFotos(t: Transferencia, i: number): void {
    void urlsComprobantes(this.sb.client, t.comprobantes).then((urls) =>
      this.visor.abrir(urls.map((url, k) => ({ url, titulo: `${t.cliente ?? 'Cliente'} · ${pesos(t.esperado)}${urls.length > 1 ? ' · ' + (k + 1) : ''}` })), i)
    );
  }

  horas(iso: string): number {
    return (this.ahora() - new Date(iso).getTime()) / 3_600_000;
  }

  hace(iso: string | null): string {
    if (!iso) return '—';
    const min = Math.max(0, Math.floor((this.ahora() - new Date(iso).getTime()) / 60_000));
    if (min < 60) return min <= 1 ? '1 minuto' : `${min} minutos`;
    const h = Math.floor(min / 60);
    if (h < 24) return h === 1 ? '1 hora' : `${h} horas`;
    const d = Math.floor(h / 24);
    return d === 1 ? '1 día' : `${d} días`;
  }

  cuando(iso: string): string {
    return formatoFechaCO(iso, { day: 'numeric', month: 'short' }) + ' ' + formatoHoraCO(iso);
  }
}
