import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline, chevronBackOutline, chevronForwardOutline, closeOutline, imagesOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { VisorService } from '../visor/visor.service';
import { mensajeError, urlImagen, urlMini } from '../formato';
import { subirFoto } from '../fotos';

export const MAX_FOTOS = 12;

/**
 * Fotos adicionales de un producto (aparte de la principal y de los colores):
 * se agregan varias a la vez desde la cámara, la galería o el computador
 * (también arrastrando o pegando), se ordenan con las flechas y se quitan.
 */
@Component({
  selector: 'app-fotos-producto',
  standalone: true,
  host: { class: 'jt' },
  imports: [IonIcon],
  styles: [
    `
      :host { display: block; }
      .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; padding: 10px; border: 1.5px dashed var(--border-strong);
        border-radius: var(--radius-lg); background: var(--surface); transition: border-color 160ms var(--ease), background 160ms var(--ease); outline: none; }
      .rejilla.encima { border-color: var(--accent); background: var(--accent-wash); }
      .foto { position: relative; aspect-ratio: 1; border-radius: var(--radius); overflow: hidden; background: var(--surface-2); border: 1px solid var(--border);
        animation: entra 220ms ease both; }
      @keyframes entra { from { opacity: 0; transform: scale(0.94); } }
      .foto > button.ver { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
      .foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .acc { position: absolute; inset: auto 4px 4px 4px; display: flex; justify-content: space-between; gap: 4px; }
      .acc button, .quitar { width: 26px; height: 26px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%;
        background: rgba(20, 18, 14, 0.66); color: #fff; font-size: 15px; cursor: pointer; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
      .acc button:disabled { opacity: 0.3; cursor: default; }
      .quitar { position: absolute; top: 4px; right: 4px; }
      .num { position: absolute; top: 5px; left: 6px; font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); }
      .agregar { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1px dashed var(--border-strong);
        border-radius: var(--radius); background: var(--bg); color: var(--text-soft); font-size: 12px; font-weight: 550; cursor: pointer; text-align: center; padding: 6px; }
      .agregar ion-icon { font-size: 22px; }
      .agregar input { display: none; }
      .agregar.ocupado { opacity: 0.6; pointer-events: none; }
      .pista { margin: 6px 0 0; font-size: 12px; color: var(--text-muted); }
      .solo-pc { display: none; }
      @media (hover: hover) and (pointer: fine) { .solo-pc { display: block; } .solo-cel { display: none; } }
    `,
  ],
  template: `
    <div class="rejilla" [class.encima]="encima()" tabindex="0" aria-label="Fotos adicionales del producto"
      (dragover)="$event.preventDefault(); encima.set(true)" (dragleave)="encima.set(false)" (drop)="soltar($event)" (paste)="pegar($event)">
      @for (u of fotos; track u; let i = $index) {
        <div class="foto">
          <button type="button" class="ver" (click)="ver(i)" [attr.aria-label]="'Ver foto ' + (i + 1)"><img [src]="urlMini(u)" alt="" loading="lazy" /></button>
          <span class="num">{{ i + 1 }}</span>
          <button type="button" class="quitar" (click)="quitar(i)" [attr.aria-label]="'Quitar foto ' + (i + 1)"><ion-icon name="close-outline"></ion-icon></button>
          @if (fotos.length > 1) {
            <div class="acc">
              <button type="button" (click)="mover(i, -1)" [disabled]="i === 0" aria-label="Mover a la izquierda"><ion-icon name="chevron-back-outline"></ion-icon></button>
              <button type="button" (click)="mover(i, 1)" [disabled]="i === fotos.length - 1" aria-label="Mover a la derecha"><ion-icon name="chevron-forward-outline"></ion-icon></button>
            </div>
          }
        </div>
      }
      @if (subiendo()) {
        <div class="agregar ocupado" aria-live="polite">Subiendo {{ subiendo() }}…</div>
      }
      @if (fotos.length + subiendo() < max) {
        <label class="agregar solo-cel">
          <ion-icon name="camera-outline"></ion-icon>Tomar foto
          <input type="file" accept="image/*" capture="environment" (change)="elegidas($event)" />
        </label>
        <label class="agregar">
          <ion-icon name="images-outline"></ion-icon><span class="solo-cel">Galería</span><span class="solo-pc">Agregar fotos</span>
          <input type="file" accept="image/*" multiple (change)="elegidas($event)" />
        </label>
      }
    </div>
    <p class="pista">{{ fotos.length }} de {{ max }} fotos · <span class="solo-pc" style="display: inline">puedes arrastrarlas o pegarlas aquí · </span>se muestran después de la foto principal</p>
  `,
})
export class FotosProductoComponent {
  @Input() fotos: string[] = [];
  @Input() titulo = '';
  @Output() cambio = new EventEmitter<string[]>();

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  readonly max = MAX_FOTOS;
  subiendo = signal(0);
  encima = signal(false);
  urlImagen = urlImagen;
  urlMini = urlMini;

  constructor() {
    addIcons({ cameraOutline, chevronBackOutline, chevronForwardOutline, closeOutline, imagesOutline });
  }

  ver(i: number): void {
    this.visor.abrir(this.fotos.map((u, k) => ({ url: urlImagen(u) ?? '', titulo: `${this.titulo} · foto ${k + 1}` })), i);
  }

  quitar(i: number): void {
    this.cambio.emit(this.fotos.filter((_, k) => k !== i));
  }

  mover(i: number, d: number): void {
    const l = [...this.fotos];
    [l[i], l[i + d]] = [l[i + d], l[i]];
    this.cambio.emit(l);
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
    if (!validas.length) return archivos.length ? this.toast.error('Elige fotos (JPG, PNG o HEIC).') : undefined;
    const cupo = this.max - this.fotos.length - this.subiendo();
    if (validas.length > cupo) this.toast.error(`Máximo ${this.max} fotos: se suben solo ${Math.max(cupo, 0)}.`);
    const lote = validas.slice(0, Math.max(cupo, 0));
    this.subiendo.update((n) => n + lote.length);
    // Se suben a la vez; cada una se agrega al terminar, en el orden elegido
    const urls = await Promise.all(
      lote.map(async (f) => {
        try {
          return await subirFoto(this.sb.client, f, 'productos');
        } catch (e) {
          this.toast.error(mensajeError(e));
          return null;
        } finally {
          this.subiendo.update((n) => n - 1);
        }
      })
    );
    const nuevas = urls.filter((u): u is string => !!u);
    if (nuevas.length) this.cambio.emit([...this.fotos, ...nuevas]);
  }
}
