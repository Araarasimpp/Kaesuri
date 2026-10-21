import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, videocamOutline, filmOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { mensajeError } from '../formato';

export const MAX_VIDEOS = 3;
/** Igual al límite del bucket "videos" (el plan gratis de Supabase tiene poco espacio) */
export const MAX_MB_VIDEO = 20;

/**
 * Videos de un producto (para mostrarlos en el catálogo y compartirlos junto
 * con la foto). Se graban con la cámara o se eligen de la galería; se suben
 * tal cual al bucket público "videos".
 */
@Component({
  selector: 'app-videos-producto',
  standalone: true,
  host: { class: 'jt' },
  imports: [IonIcon],
  styles: [
    `
      :host { display: block; }
      .caja { display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1.5px dashed var(--border-strong); border-radius: var(--radius-lg); background: var(--surface); }
      .lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
      .video { position: relative; aspect-ratio: 9 / 16; max-height: 220px; border-radius: var(--radius); overflow: hidden; background: #111; border: 1px solid var(--border); animation: entra 200ms ease both; }
      @keyframes entra { from { opacity: 0; transform: scale(0.95); } }
      .video video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .quitar { position: absolute; top: 5px; right: 5px; width: 26px; height: 26px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%;
        background: rgba(20, 18, 14, 0.7); color: #fff; font-size: 15px; cursor: pointer; z-index: 1; }
      .subiendo { aspect-ratio: 9 / 16; max-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px;
        border-radius: var(--radius); background: var(--surface-2); color: var(--text-soft); font-size: 12px; text-align: center; }
      .subiendo .barra { width: 70%; height: 4px; border-radius: 2px; background: var(--selected); overflow: hidden; }
      .subiendo .barra span { display: block; height: 100%; width: 40%; background: var(--oro); border-radius: 2px; animation: va 1.1s ease-in-out infinite; }
      @keyframes va { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
      .botones { display: flex; gap: 8px; flex-wrap: wrap; }
      .botones label { cursor: pointer; }
      .botones input { display: none; }
      .pista { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.45; }
      .solo-pc { display: none; }
      @media (hover: hover) and (pointer: fine) { .solo-pc { display: inline-flex; } .solo-cel { display: none; } }
    `,
  ],
  template: `
    <div class="caja">
      @if (videos.length || subiendo()) {
        <div class="lista">
          @for (u of videos; track u; let i = $index) {
            <div class="video">
              <video [src]="u + '#t=0.1'" controls playsinline preload="metadata"></video>
              <button type="button" class="quitar" (click)="quitar(i)" [attr.aria-label]="'Quitar video ' + (i + 1)"><ion-icon name="close-outline"></ion-icon></button>
            </div>
          }
          @if (subiendo(); as s) {
            <div class="subiendo" aria-live="polite"><span>Subiendo video…</span><small>{{ s }}</small><span class="barra"><span></span></span></div>
          }
        </div>
      }
      @if (videos.length + (subiendo() ? 1 : 0) < max) {
        <div class="botones">
          <label class="b solo-cel"><ion-icon name="videocam-outline"></ion-icon>Grabar video
            <input type="file" accept="video/*" capture="environment" (change)="elegido($event)" [disabled]="!!subiendo()" /></label>
          <label class="b"><ion-icon name="film-outline"></ion-icon><span class="solo-cel">Galería</span><span class="solo-pc">Elegir video</span>
            <input type="file" accept="video/mp4,video/quicktime,video/webm,video/3gpp,video/x-m4v,video/*" (change)="elegido($event)" [disabled]="!!subiendo()" /></label>
        </div>
      }
      <p class="pista">Hasta {{ max }} videos de máximo {{ maxMb }} MB cada uno (unos 30–60 segundos grabando en 720p o 1080p).
        Se muestran en el catálogo y se comparten junto con la foto.</p>
    </div>
  `,
})
export class VideosProductoComponent {
  @Input() videos: string[] = [];
  @Output() cambio = new EventEmitter<string[]>();

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  readonly max = MAX_VIDEOS;
  readonly maxMb = MAX_MB_VIDEO;
  /** Texto del video que se está subiendo ('' = ninguno) */
  subiendo = signal('');

  constructor() {
    addIcons({ closeOutline, videocamOutline, filmOutline });
  }

  quitar(i: number): void {
    this.cambio.emit(this.videos.filter((_, k) => k !== i));
  }

  elegido(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void this.subir(f);
  }

  private async subir(f: File): Promise<void> {
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|3gp)$/i.test(f.name)) return this.toast.error('Elige un video (MP4 o MOV).');
    const mb = f.size / 1024 / 1024;
    if (mb > this.maxMb) {
      return this.toast.error(`El video pesa ${mb.toFixed(0)} MB y el máximo es ${this.maxMb} MB. Grábalo más corto o en menor calidad (720p).`);
    }
    this.subiendo.set(`${mb.toFixed(1)} MB`);
    try {
      const ext = (f.name.match(/\.(mp4|mov|m4v|webm|3gp)$/i)?.[1] ?? (f.type.includes('quicktime') ? 'mov' : 'mp4')).toLowerCase();
      const ruta = `productos/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const tipo = f.type || (ext === 'mov' ? 'video/quicktime' : 'video/mp4');
      const { error } = await this.sb.client.storage.from('videos').upload(ruta, f, { contentType: tipo, upsert: false });
      if (error) throw error;
      this.cambio.emit([...this.videos, this.sb.client.storage.from('videos').getPublicUrl(ruta).data.publicUrl]);
    } catch (e) {
      const m = mensajeError(e);
      this.toast.error(/exceeded|too large|maximum/i.test(m) ? `El video supera los ${this.maxMb} MB permitidos.` : 'No se pudo subir el video: ' + m);
    } finally {
      this.subiendo.set('');
    }
  }
}
