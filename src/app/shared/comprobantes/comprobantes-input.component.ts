import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline, closeOutline, imagesOutline, receiptOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { VisorService } from '../visor/visor.service';
import { mensajeError } from '../formato';
import { subirComprobante } from '../comprobantes';

const MAX = 5;

/**
 * Foto(s) del comprobante de la transferencia: se toma con la cámara o se
 * elige de la galería (en el computador, archivo, arrastrar o pegar). Se suben
 * de una vez al bucket privado y se devuelven las rutas.
 */
@Component({
  selector: 'app-comprobantes-input',
  standalone: true,
  imports: [IonIcon],
  styles: [
    `
      :host { display: block; }
      .caja { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1.5px dashed var(--border-strong); border-radius: var(--radius-lg);
        background: var(--surface); transition: border-color 160ms var(--ease), background 160ms var(--ease); outline: none; }
      .caja.falta { border-color: var(--accent); background: var(--accent-wash); }
      .caja.encima { border-color: var(--accent); }
      .tit { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13.5px; font-weight: 600; }
      .tit ion-icon { font-size: 18px; color: var(--accent); }
      .tit .ok { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--efectivo-texto); }
      .tit .req { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--accent); }
      .fotos { display: flex; gap: 8px; flex-wrap: wrap; }
      .foto { position: relative; width: 74px; height: 74px; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border); background: var(--surface-2);
        animation: entra 200ms ease both; }
      @keyframes entra { from { opacity: 0; transform: scale(0.94); } }
      .foto > button.ver { width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; display: block; }
      .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .quitar { position: absolute; top: 3px; right: 3px; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%;
        background: rgba(20, 18, 14, 0.66); color: #fff; font-size: 14px; cursor: pointer; }
      .subiendo { width: 74px; height: 74px; display: grid; place-items: center; border-radius: var(--radius); background: var(--surface-2); font-size: 11.5px; color: var(--text-soft); }
      .botones { display: flex; gap: 8px; flex-wrap: wrap; }
      .botones label { cursor: pointer; }
      .botones input { display: none; }
      .pista { margin: 0; font-size: 12px; color: var(--text-muted); }
      .solo-pc { display: none; }
      @media (hover: hover) and (pointer: fine) { .solo-pc { display: inline-flex; } p.solo-pc { display: block; } .solo-cel { display: none; } }
    `,
  ],
  template: `
    <div class="caja" [class.falta]="!rutas.length" [class.encima]="encima()" tabindex="0" [attr.aria-label]="titulo"
      (dragover)="$event.preventDefault(); encima.set(true)" (dragleave)="encima.set(false)" (drop)="soltar($event)" (paste)="pegar($event)">
      <p class="tit"><ion-icon name="receipt-outline" aria-hidden="true"></ion-icon>{{ titulo }}
        @if (rutas.length) { <span class="ok">✓ {{ rutas.length === 1 ? '1 foto' : rutas.length + ' fotos' }}</span> } @else { <span class="req">Obligatorio</span> }
      </p>
      @if (rutas.length || subiendo()) {
        <div class="fotos">
          @for (r of rutas; track r; let i = $index) {
            <div class="foto">
              <button type="button" class="ver" (click)="ver(i)" [attr.aria-label]="'Ver comprobante ' + (i + 1)"><img [src]="previas()[r]" alt="" /></button>
              <button type="button" class="quitar" (click)="quitar(i)" [attr.aria-label]="'Quitar comprobante ' + (i + 1)"><ion-icon name="close-outline"></ion-icon></button>
            </div>
          }
          @if (subiendo()) { <div class="subiendo" aria-live="polite">Subiendo…</div> }
        </div>
      }
      @if (rutas.length + subiendo() < max) {
        <div class="botones">
          <label class="b solo-cel"><ion-icon name="camera-outline"></ion-icon>Tomar foto
            <input type="file" accept="image/*" capture="environment" (change)="elegidas($event)" /></label>
          <label class="b"><ion-icon name="images-outline"></ion-icon><span class="solo-cel">Galería</span><span class="solo-pc">Elegir archivo</span>
            <input type="file" accept="image/*" multiple (change)="elegidas($event)" /></label>
        </div>
      }
      <p class="pista">{{ pista }}<span class="solo-pc"> También puedes arrastrarla o pegarla (Ctrl+V).</span></p>
    </div>
  `,
})
export class ComprobantesInputComponent {
  @Input() rutas: string[] = [];
  @Input() titulo = 'Comprobante de la transferencia';
  @Input() pista = 'Foto o pantallazo donde se vea el valor y la fecha.';
  @Output() cambio = new EventEmitter<string[]>();

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  readonly max = MAX;
  subiendo = signal(0);
  encima = signal(false);
  /** Vista previa local de cada foto subida (sin volver a descargarla) */
  previas = signal<Record<string, string>>({});

  constructor() {
    addIcons({ cameraOutline, closeOutline, imagesOutline, receiptOutline });
  }

  ver(i: number): void {
    this.visor.abrir(this.rutas.map((r, k) => ({ url: this.previas()[r] ?? '', titulo: `Comprobante ${k + 1}` })), i);
  }

  quitar(i: number): void {
    this.cambio.emit(this.rutas.filter((_, k) => k !== i));
  }

  elegidas(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivos = Array.from(input.files ?? []);
    input.value = '';
    void this.subir(archivos);
  }

  soltar(ev: DragEvent): void {
    ev.preventDefault();
    this.encima.set(false);
    void this.subir(Array.from(ev.dataTransfer?.files ?? []));
  }

  pegar(ev: ClipboardEvent): void {
    const archivos = Array.from(ev.clipboardData?.items ?? []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (!archivos.length) return;
    ev.preventDefault();
    void this.subir(archivos);
  }

  private async subir(archivos: File[]): Promise<void> {
    const validas = archivos.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!validas.length) return archivos.length ? this.toast.error('Elige una foto del comprobante.') : undefined;
    const lote = validas.slice(0, Math.max(0, this.max - this.rutas.length - this.subiendo()));
    this.subiendo.update((n) => n + lote.length);
    const nuevas: string[] = [];
    for (const f of lote) {
      try {
        const ruta = await subirComprobante(this.sb.client, f);
        this.previas.update((m) => ({ ...m, [ruta]: URL.createObjectURL(f) }));
        nuevas.push(ruta);
      } catch (e) {
        this.toast.error('No se pudo subir el comprobante: ' + mensajeError(e));
      } finally {
        this.subiendo.update((n) => n - 1);
      }
    }
    if (nuevas.length) this.cambio.emit([...this.rutas, ...nuevas]);
  }
}
