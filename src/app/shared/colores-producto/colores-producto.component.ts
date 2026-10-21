import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, cameraOutline, checkmark, closeOutline, trashOutline } from 'ionicons/icons';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../toast/toast.service';
import { ProductoColor } from '../models/models';
import { mensajeError, urlImagen, urlMini } from '../formato';
import { subirFoto } from '../fotos';

/** Colores de uso común para elegir de una vez (nombre + tono) */
export const COLORES_RAPIDOS: { nombre: string; hex: string }[] = [
  { nombre: 'Negro', hex: '#1b1b1b' },
  { nombre: 'Blanco', hex: '#f7f7f5' },
  { nombre: 'Gris', hex: '#8e9196' },
  { nombre: 'Rojo', hex: '#d0312d' },
  { nombre: 'Rosado', hex: '#f08cb8' },
  { nombre: 'Morado', hex: '#7d4fc1' },
  { nombre: 'Azul', hex: '#2f6fdb' },
  { nombre: 'Celeste', hex: '#7cc4f0' },
  { nombre: 'Verde', hex: '#2e9b5f' },
  { nombre: 'Amarillo', hex: '#f2c230' },
  { nombre: 'Naranja', hex: '#f08a2c' },
  { nombre: 'Café', hex: '#7a5134' },
  { nombre: 'Dorado', hex: '#c4920f' },
  { nombre: 'Plateado', hex: '#c0c4c9' },
];

interface Borrador {
  id: number | null;
  nombre: string;
  hex: string;
  imagen_url: string | null;
}

/**
 * Galería de colores de un producto (en la hoja de editar producto).
 * Cada color tiene nombre, tono y su propia foto. Se agregan, editan y quitan
 * aquí mismo; los cambios se guardan de una vez en Supabase.
 */
@Component({
  selector: 'app-colores-producto',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, IonIcon],
  styles: [
    `
      :host { display: block; }
      .rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
      .color { position: relative; display: flex; flex-direction: column; gap: 6px; padding: 0; border: none; background: none;
        color: var(--text); text-align: left; cursor: pointer; animation: aparecer 260ms var(--ease) both; }
      @keyframes aparecer { from { opacity: 0; transform: scale(0.92) translateY(4px); } }
      .miniatura { position: relative; aspect-ratio: 1; border-radius: var(--radius); overflow: hidden; background: var(--surface-2);
        border: 1px solid var(--border); transition: transform 180ms var(--ease), box-shadow 180ms var(--ease), border-color 180ms; }
      .miniatura img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .miniatura .tono { position: absolute; inset: 0; }
      .color:active .miniatura { transform: scale(0.96); }
      @media (hover: hover) { .color:hover .miniatura { transform: translateY(-2px); box-shadow: var(--shadow-pop); } }
      .color.on .miniatura { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
      .punto { position: absolute; right: 6px; bottom: 6px; width: 16px; height: 16px; border-radius: 50%;
        border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); }
      .nombre { font-size: 12.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .agregar .miniatura { display: grid; place-items: center; border: 1.5px dashed var(--border-strong); background: transparent;
        color: var(--text-soft); font-size: 26px; }
      .agregar .nombre { color: var(--text-soft); }

      /* Editor que se despliega con transición de altura */
      .plegable { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 280ms var(--ease), margin 280ms var(--ease); margin-top: 0; }
      .plegable.abierto { grid-template-rows: 1fr; margin-top: 14px; }
      .plegable > div { overflow: hidden; min-height: 0; }
      .editor { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 14px; padding: 14px; border-radius: var(--radius-lg);
        background: var(--oro-wash); border: 1px solid var(--oro-soft); }
      .foto-editor { position: relative; width: 112px; aspect-ratio: 1; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border);
        background: var(--surface); display: grid; place-items: center; cursor: pointer; }
      .foto-editor img { width: 100%; height: 100%; object-fit: cover; animation: fundido 260ms ease both; }
      @keyframes fundido { from { opacity: 0; } }
      .foto-editor .vacia { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; color: var(--text-soft); text-align: center; padding: 6px; }
      .foto-editor .vacia ion-icon { font-size: 22px; }
      .foto-editor input { display: none; }
      .foto-editor .subiendo { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(255, 255, 255, 0.75); font-size: 12px; }
      .campos { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
      .muestras { display: flex; flex-wrap: wrap; gap: 7px; }
      .muestra { width: 26px; height: 26px; border-radius: 50%; padding: 0; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong);
        cursor: pointer; transition: transform 150ms var(--ease), box-shadow 150ms; }
      .muestra.on { box-shadow: 0 0 0 2px var(--accent); transform: scale(1.12); }
      .muestra.propio { position: relative; overflow: hidden; background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); }
      .muestra.propio input { position: absolute; inset: -6px; width: 40px; height: 40px; opacity: 0; cursor: pointer; }
      .acciones-editor { display: flex; gap: 8px; flex-wrap: wrap; }
      .acciones-editor .quitar { margin-right: auto; color: var(--danger); }
      .vacio-colores { margin: 0 0 10px; font-size: 13px; color: var(--text-soft); }
      @media (max-width: 520px) {
        .editor { grid-template-columns: 1fr; }
        .foto-editor { width: 100%; max-width: 220px; }
      }
      @media (prefers-reduced-motion: reduce) { .plegable, .color, .miniatura { transition: none; animation: none; } }
    `,
  ],
  template: `
    @if (!colores().length && !borrador()) {
      <p class="vacio-colores">¿Este producto viene en varios colores? Agrega cada uno con su foto y así salen en el catálogo.</p>
    }
    <div class="rejilla">
      @for (c of colores(); track c.id; let i = $index) {
        <button type="button" class="color" [class.on]="borrador()?.id === c.id" (click)="editar(c)" [style.animation-delay.ms]="i * 30">
          <span class="miniatura">
            @if (urlMini(c.imagen_url); as u) { <img [src]="u" alt="" loading="lazy" /> } @else { <span class="tono" [style.background]="c.hex || '#ddd'"></span> }
            @if (c.hex) { <span class="punto" [style.background]="c.hex"></span> }
          </span>
          <span class="nombre">{{ c.nombre }}</span>
        </button>
      }
      <button type="button" class="color agregar" (click)="nuevo()">
        <span class="miniatura"><ion-icon name="add-outline"></ion-icon></span>
        <span class="nombre">Agregar color</span>
      </button>
    </div>

    <div class="plegable" [class.abierto]="!!borrador()">
      <div>
        @if (borrador(); as b) {
          <div class="editor">
            <label class="foto-editor" [attr.aria-label]="b.imagen_url ? 'Cambiar foto del color' : 'Subir foto del color'">
              @if (urlImagen(b.imagen_url); as u) {
                <img [src]="u" alt="" />
              } @else {
                <span class="vacia"><ion-icon name="camera-outline"></ion-icon>Subir foto<br />de este color</span>
              }
              @if (subiendo()) { <span class="subiendo">Subiendo…</span> }
              <input type="file" accept="image/*" (change)="subirFoto($event)" />
            </label>
            <div class="campos">
              <div class="campo">
                <label for="cn">Nombre del color</label>
                <input id="cn" [(ngModel)]="b.nombre" maxlength="40" placeholder="Ej: Rojo, Azul cielo" />
              </div>
              <div class="muestras" role="group" aria-label="Tono">
                @for (r of rapidos; track r.hex) {
                  <button type="button" class="muestra" [class.on]="b.hex === r.hex" [style.background]="r.hex" [attr.aria-label]="r.nombre" [title]="r.nombre"
                    (click)="elegirRapido(r)"></button>
                }
                <span class="muestra propio" title="Otro tono" [class.on]="!esRapido(b.hex)">
                  <input type="color" [(ngModel)]="b.hex" aria-label="Otro tono" />
                </span>
              </div>
              <div class="acciones-editor">
                @if (b.id) {
                  <button type="button" class="b quitar" (click)="quitar(b)" [disabled]="guardando()"><ion-icon name="trash-outline"></ion-icon>Quitar</button>
                }
                <button type="button" class="b" (click)="borrador.set(null)">Cancelar</button>
                <button type="button" class="b b-pri" (click)="guardar(b)" [disabled]="guardando() || subiendo() || !b.nombre.trim()">
                  <ion-icon name="checkmark"></ion-icon>{{ guardando() ? 'Guardando…' : 'Guardar color' }}
                </button>
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class ColoresProductoComponent implements OnInit {
  @Input({ required: true }) productoId!: string;
  @Input() nombreProducto = '';
  /** Avisa cuando cambian (para refrescar la lista de productos) */
  @Output() cambio = new EventEmitter<ProductoColor[]>();

  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  readonly rapidos = COLORES_RAPIDOS;
  colores = signal<ProductoColor[]>([]);
  borrador = signal<Borrador | null>(null);
  subiendo = signal(false);
  guardando = signal(false);
  urlImagen = urlImagen;
  urlMini = urlMini;

  constructor() {
    addIcons({ addOutline, cameraOutline, checkmark, closeOutline, trashOutline });
  }

  async ngOnInit(): Promise<void> {
    const { data, error } = await this.sb.client
      .from('producto_colores')
      .select('*')
      .eq('producto_id', this.productoId)
      .order('orden')
      .order('id');
    if (error) return this.toast.error(mensajeError(error));
    this.colores.set((data ?? []) as ProductoColor[]);
  }

  nuevo(): void {
    this.borrador.set({ id: null, nombre: '', hex: '#1b1b1b', imagen_url: null });
  }

  editar(c: ProductoColor): void {
    if (this.borrador()?.id === c.id) return this.borrador.set(null);
    this.borrador.set({ id: c.id, nombre: c.nombre, hex: c.hex ?? '#1b1b1b', imagen_url: c.imagen_url });
  }

  esRapido(hex: string): boolean {
    return this.rapidos.some((r) => r.hex === hex);
  }

  elegirRapido(r: { nombre: string; hex: string }): void {
    const b = this.borrador();
    if (!b) return;
    // Si el nombre estaba vacío o era otro color rápido, se cambia por el nuevo
    const nombre = !b.nombre.trim() || this.rapidos.some((x) => x.nombre === b.nombre) ? r.nombre : b.nombre;
    this.borrador.set({ ...b, hex: r.hex, nombre });
  }

  async subirFoto(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    const b = this.borrador();
    if (!archivo || !b) return;
    this.subiendo.set(true);
    try {
      const url = await subirFoto(this.sb.client, archivo, `colores/${this.productoId}`);
      // Puede que mientras subía se haya cerrado o cambiado de color
      const actual = this.borrador();
      if (actual && actual.id === b.id) this.borrador.set({ ...actual, imagen_url: url });
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.subiendo.set(false);
    }
  }

  async guardar(b: Borrador): Promise<void> {
    const nombre = b.nombre.trim();
    if (!nombre) return;
    this.guardando.set(true);
    const datos = { nombre, hex: b.hex || null, imagen_url: b.imagen_url };
    const r = b.id
      ? await this.sb.client.from('producto_colores').update(datos).eq('id', b.id).select().single()
      : await this.sb.client
          .from('producto_colores')
          .insert({ ...datos, producto_id: this.productoId, orden: this.colores().length })
          .select()
          .single();
    this.guardando.set(false);
    if (r.error) return this.toast.error(mensajeError(r.error));
    const c = r.data as ProductoColor;
    this.colores.update((l) => (b.id ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c]));
    this.borrador.set(null);
    this.cambio.emit(this.colores());
    this.toast.ok(b.id ? `Color ${nombre} actualizado` : `Color ${nombre} agregado`);
  }

  async quitar(b: Borrador): Promise<void> {
    if (!b.id || !confirm(`¿Quitar el color ${b.nombre}?`)) return;
    this.guardando.set(true);
    const { error } = await this.sb.client.from('producto_colores').delete().eq('id', b.id);
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.colores.update((l) => l.filter((x) => x.id !== b.id));
    this.borrador.set(null);
    this.cambio.emit(this.colores());
  }
}
