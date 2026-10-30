import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cameraOutline, cloudUploadOutline, imagesOutline, trashOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { VisorService } from '../visor/visor.service';
import { mensajeError, urlImagen } from '../formato';
import { subirFoto } from '../fotos';

/**
 * Foto de un producto sin escribir direcciones:
 *  celular → "Tomar foto" (cámara) o "Elegir de la galería"
 *  computador → "Elegir archivo", arrastrar la foto encima o pegarla (Ctrl+V)
 * La foto se achica, se sube a Supabase y se devuelve su dirección.
 */
@Component({
  selector: 'app-elegir-foto',
  host: { class: 'jt' },
  standalone: true,
  imports: [IonIcon],
  styles: [
    `
      :host { display: block; }
      .zona { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 14px; align-items: center; padding: 12px; border: 1.5px dashed var(--border-strong);
        border-radius: var(--radius-lg); background: var(--surface); transition: border-color 160ms var(--ease), background 160ms var(--ease); outline: none; }
      .zona:focus-visible { border-color: var(--accent); }
      .zona.encima { border-color: var(--accent); background: var(--accent-wash); }
      .previa { position: relative; width: 132px; aspect-ratio: 1; border-radius: var(--radius); overflow: hidden; background: var(--surface-2);
        display: grid; place-items: center; padding: 0; border: 1px solid var(--border); cursor: zoom-in; }
      .previa img { width: 100%; height: 100%; object-fit: cover; display: block; animation: fundido 260ms ease both; }
      @keyframes fundido { from { opacity: 0; transform: scale(0.98); } }
      .previa.vacia { cursor: default; color: var(--text-muted); font-size: 30px; }
      .subiendo { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255, 255, 255, 0.78); color: var(--text); font-size: 12.5px; font-weight: 600; }
      .lado { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
      .botones { display: flex; gap: 8px; flex-wrap: wrap; }
      .botones label.b { cursor: pointer; }
      .botones input { display: none; }
      .quitar { color: var(--danger); }
      .pista { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4; }
      .solo-pc { display: none; }
      .solo-cel { display: inline-flex; }
      @media (hover: hover) and (pointer: fine) { .solo-pc { display: inline-flex; } p.solo-pc { display: block; } .solo-cel { display: none; } }
      @media (max-width: 420px) {
        .zona { grid-template-columns: 1fr; justify-items: start; }
        .previa { width: 100%; max-width: 220px; }
      }
    `,
  ],
  template: `
    <div class="zona" [class.encima]="encima()" tabindex="0" aria-label="Foto del producto"
      (dragover)="arrastrando($event, true)" (dragleave)="encima.set(false)" (drop)="soltar($event)" (paste)="pegar($event)">
      @if (urlImagen(url); as u) {
        <button type="button" class="previa" (click)="ver(u)" aria-label="Ver la foto en grande">
          <img [src]="u" alt="" />
          @if (subiendo()) { <span class="subiendo">Subiendo…</span> }
        </button>
      } @else {
        <span class="previa vacia" aria-hidden="true">
          <ion-icon name="images-outline"></ion-icon>
          @if (subiendo()) { <span class="subiendo">Subiendo…</span> }
        </span>
      }
      <div class="lado">
        <div class="botones">
          <label class="b solo-cel">
            <ion-icon name="camera-outline"></ion-icon>Tomar foto
            <input type="file" accept="image/*" capture="environment" (change)="elegido($event)" [disabled]="subiendo()" />
          </label>
          <label class="b">
            <ion-icon [name]="'images-outline'" class="solo-cel"></ion-icon><ion-icon name="cloud-upload-outline" class="solo-pc"></ion-icon>
            <span class="solo-cel">Elegir de la galería</span><span class="solo-pc">Elegir archivo</span>
            <input type="file" accept="image/*" (change)="elegido($event)" [disabled]="subiendo()" />
          </label>
          @if (url) {
            <button type="button" class="b quitar" (click)="cambio.emit(null)" [disabled]="subiendo()"><ion-icon name="trash-outline"></ion-icon>Quitar</button>
          }
        </div>
        <p class="pista solo-pc">o arrastra una foto aquí, o cópiala y pégala con Ctrl+V</p>
      </div>
    </div>
  `,
})
export class ElegirFotoComponent {
  /** Dirección de la foto actual (o null) */
  @Input() url: string | null = null;
  @Input() titulo = '';
  /** Carpeta del bucket donde se guarda */
  @Input() carpeta = 'productos';
  @Output() cambio = new EventEmitter<string | null>();

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private visor = inject(VisorService);

  subiendo = signal(false);
  encima = signal(false);
  urlImagen = urlImagen;

  constructor() {
    addIcons({ cameraOutline, cloudUploadOutline, imagesOutline, trashOutline });
  }

  ver(u: string): void {
    this.visor.abrir([{ url: u, titulo: this.titulo }]);
  }

  elegido(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (archivo) void this.subir(archivo);
  }

  arrastrando(ev: DragEvent, encima: boolean): void {
    ev.preventDefault();
    this.encima.set(encima);
  }

  soltar(ev: DragEvent): void {
    ev.preventDefault();
    this.encima.set(false);
    const archivo = Array.from(ev.dataTransfer?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (archivo) void this.subir(archivo);
    else this.toast.error('Suelta una foto (JPG, PNG o WEBP).');
  }

  pegar(ev: ClipboardEvent): void {
    const item = Array.from(ev.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
    const archivo = item?.getAsFile();
    if (!archivo) return;
    ev.preventDefault();
    void this.subir(archivo);
  }

  private async subir(archivo: File): Promise<void> {
    if (!archivo.type.startsWith('image/') && !/\.(heic|heif)$/i.test(archivo.name)) {
      return this.toast.error('Elige una foto (JPG, PNG o HEIC).');
    }
    this.subiendo.set(true);
    try {
      this.cambio.emit(await subirFoto(this.sb.client, archivo, this.carpeta));
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.subiendo.set(false);
    }
  }
}
