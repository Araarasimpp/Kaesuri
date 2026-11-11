import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { RecortarFotoComponent } from '../../shared/recortar-foto/recortar-foto.component';
import { mensajeError, pesos, urlMini } from '../../shared/formato';

interface Prod { id: string; nombre: string; precio: number; imagen_url: string | null; agotado: boolean }
interface Perfil { foto_url: string | null; bio: string | null; destacados: string[] }

const MAX = 8;

function normal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * "Mi catálogo": el vendedor pone su foto, una frase y hasta 8 productos destacados
 * que salen de primeros en su enlace de la tienda.
 */
@Component({
  selector: 'app-mi-catalogo',
  standalone: true,
  imports: [FormsModule, AvatarComponent, RecortarFotoComponent],
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 12px; }
      .mc-quien { display: flex; gap: 14px; align-items: center; }
      .mc-quien label { cursor: pointer; }
      .mc-quien input[type=file] { display: none; }
      .mc-quien .b { height: 34px; font-size: 13px; padding: 0 12px; }
      .mc-bio { width: 100%; min-height: 64px; resize: vertical; }
      .mc-cuenta { display: block; text-align: right; font-size: 12px; color: var(--text-muted); margin-top: 2px; }
      .mc-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .mc-lista li { display: grid; grid-template-columns: 22px 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 7px 0; border-bottom: var(--perfora); }
      .mc-lista li:last-child { border-bottom: 0; }
      .mc-lista.res li { grid-template-columns: 40px minmax(0, 1fr) auto; }
      .mc-n { font-size: 12px; font-weight: 700; color: var(--text-muted); text-align: center; }
      .mc-mini { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; background: var(--surface-2); display: grid; place-items: center; font-weight: 700; color: var(--text-muted); }
      .mc-nom { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13.5px; font-weight: 600; line-height: 1.3; }
      .mc-sub { display: block; font-size: 12px; color: var(--text-muted); }
      .mc-sub .agot { color: var(--danger); font-weight: 600; }
      .mc-btns { display: flex; gap: 4px; }
      .mc-btns button { width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text-soft); font: inherit; font-size: 15px; cursor: pointer; display: grid; place-items: center; }
      .mc-btns button:disabled { opacity: .35; cursor: default; }
      .mc-vacio { margin: 0; font-size: 13px; color: var(--text-muted); }
      .mc-pie { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .mc-sub-t { margin: 4px 0 0; font-size: 13px; font-weight: 650; color: var(--text-soft); }
    `,
  ],
  template: `
    <h2 class="seccion-titulo">Personaliza tu catálogo</h2>
    <p class="ayuda" style="margin: 0">Tus clientes ven tu foto y tu frase arriba de tu catálogo, y los productos que elijas salen de primeros.</p>

    <div class="mc-quien">
      <app-avatar [nombre]="yo()?.nombre ?? ''" [foto]="fotoVista()" [usuario]="yo()?.id" [tam]="64"></app-avatar>
      <div style="display: flex; gap: 6px; flex-wrap: wrap">
        <label class="b">{{ subiendo() ? 'Subiendo…' : 'Cambiar foto' }}
          <input type="file" accept="image/*,.heic,.heif" (change)="elegirFoto($event)" [disabled]="subiendo()" />
        </label>
        @if (foto()) { <button class="b" type="button" (click)="foto.set(null)">Usar la de mi perfil</button> }
      </div>
    </div>
    @if (porRecortar(); as archivo) {
      <app-recortar-foto [archivo]="archivo" [guardando]="subiendo()" (recortada)="subirFoto($event)" (cancelar)="porRecortar.set(null)"></app-recortar-foto>
    }

    <label>
      <span class="mc-sub-t">Tu frase</span>
      <textarea class="inp mc-bio" maxlength="160" [(ngModel)]="bio" placeholder="Ej: Hola, soy Valentina 👋 Te ayudo a escoger el regalo perfecto. Envíos el mismo día."></textarea>
      <small class="mc-cuenta">{{ bio.length }}/160</small>
    </label>

    <p class="mc-sub-t">Tus destacados ({{ elegidos().length }}/{{ max }})</p>
    @if (elegidos().length) {
      <ul class="mc-lista">
        @for (p of elegidos(); track p.id; let i = $index; let ultimo = $last) {
          <li>
            <span class="mc-n">{{ i + 1 }}</span>
            @if (urlMini(p.imagen_url); as u) { <img class="mc-mini" [src]="u" alt="" loading="lazy" /> } @else { <span class="mc-mini">{{ p.nombre.charAt(0) }}</span> }
            <div style="min-width: 0"><span class="mc-nom">{{ p.nombre }}</span><span class="mc-sub">{{ pesos(p.precio) }}@if (p.agotado) { · <span class="agot">Agotado: no sale mientras tanto</span> }</span></div>
            <div class="mc-btns">
              <button type="button" (click)="mover(i, -1)" [disabled]="i === 0" aria-label="Subir">↑</button>
              <button type="button" (click)="mover(i, 1)" [disabled]="ultimo" aria-label="Bajar">↓</button>
              <button type="button" (click)="quitar(p.id)" aria-label="Quitar">✕</button>
            </div>
          </li>
        }
      </ul>
    } @else {
      <p class="mc-vacio">Todavía no eliges. Si no eliges ninguno, tu catálogo muestra primero lo más vendido.</p>
    }

    @if (elegidos().length < max) {
      <input class="inp" type="search" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Buscar producto para destacar" aria-label="Buscar producto para destacar" />
      @if (q().trim()) {
        <ul class="mc-lista res">
          @for (p of encontrados(); track p.id) {
            <li>
              @if (urlMini(p.imagen_url); as u) { <img class="mc-mini" [src]="u" alt="" loading="lazy" /> } @else { <span class="mc-mini">{{ p.nombre.charAt(0) }}</span> }
              <div style="min-width: 0"><span class="mc-nom">{{ p.nombre }}</span><span class="mc-sub">{{ pesos(p.precio) }}@if (p.agotado) { · <span class="agot">Agotado</span> }</span></div>
              <button class="b b-pri" type="button" style="height: 34px; font-size: 13px" (click)="agregar(p.id)">Destacar</button>
            </li>
          } @empty {
            <li style="display: block"><p class="mc-vacio">{{ productos().length ? 'Ningún producto coincide.' : 'Cargando productos…' }}</p></li>
          }
        </ul>
      }
    }

    <div class="mc-pie">
      <button class="b b-pri" type="button" (click)="guardar()" [disabled]="guardando() || !cargado()">{{ guardando() ? 'Guardando…' : 'Guardar mi catálogo' }}</button>
    </div>
  `,
})
export class MiCatalogoComponent implements OnInit {
  sb = inject(SupabaseService);
  private toast = inject(ToastService);

  readonly max = MAX;
  pesos = pesos;
  urlMini = urlMini;

  cargado = signal(false);
  guardando = signal(false);
  subiendo = signal(false);
  porRecortar = signal<File | null>(null);
  productos = signal<Prod[]>([]);
  destacados = signal<string[]>([]);
  /** Quién soy (nombre, foto e id) */
  yo = signal<{ id: string; nombre: string; avatar_url: string | null } | null>(null);
  foto = signal<string | null>(null);
  bio = '';
  q = signal('');

  fotoVista = computed(() => this.foto() ?? this.yo()?.avatar_url ?? null);
  private porId = computed(() => new Map(this.productos().map((p) => [p.id, p])));
  elegidos = computed(() => this.destacados().map((id) => this.porId().get(id)).filter((p): p is Prod => !!p));
  encontrados = computed(() => {
    const palabras = normal(this.q()).split(/\s+/).filter(Boolean);
    const ya = new Set(this.destacados());
    return this.productos().filter((p) => !ya.has(p.id) && palabras.every((w) => normal(p.nombre).includes(w))).slice(0, 8);
  });

  async ngOnInit(): Promise<void> {
    const [perfil, tienda, yo] = await Promise.all([
      this.sb.client.rpc('mi_tienda_perfil'),
      this.sb.client.rpc('tienda', { p_vendedor: null }),
      this.sb.getCurrentProfile(),
    ]);
    if (yo) this.yo.set({ id: yo.id, nombre: yo.nombre, avatar_url: (yo as { avatar_url?: string | null }).avatar_url ?? null });
    if (perfil.error) return this.toast.error(mensajeError(perfil.error));
    const p = perfil.data as Perfil;
    this.foto.set(p.foto_url);
    this.bio = p.bio ?? '';
    this.destacados.set((p.destacados ?? []).map(String));
    this.productos.set((tienda.data as { productos: Prod[] } | null)?.productos ?? []);
    this.cargado.set(true);
  }

  agregar(id: string): void {
    if (this.destacados().length >= MAX) return;
    this.destacados.update((d) => [...d, id]);
    this.q.set('');
  }
  quitar(id: string): void {
    this.destacados.update((d) => d.filter((x) => x !== id));
  }
  mover(i: number, paso: number): void {
    this.destacados.update((d) => {
      const n = [...d];
      [n[i], n[i + paso]] = [n[i + paso], n[i]];
      return n;
    });
  }

  elegirFoto(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    if (!archivo.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp)$/i.test(archivo.name)) {
      return this.toast.error('Elige una foto (JPG, PNG o HEIC).');
    }
    this.porRecortar.set(archivo);
  }

  async subirFoto(blob: Blob): Promise<void> {
    const uid = this.yo()?.id;
    if (!uid) return;
    this.subiendo.set(true);
    try {
      const ruta = `${uid}/catalogo-${Date.now()}.jpg`;
      const { error } = await this.sb.client.storage.from('avatars').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      this.foto.set(this.sb.client.storage.from('avatars').getPublicUrl(ruta).data.publicUrl);
      this.porRecortar.set(null);
      await this.guardar();
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.subiendo.set(false);
    }
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    const { data, error } = await this.sb.client.rpc('mi_tienda_guardar', { p_foto_url: this.foto(), p_bio: this.bio, p_destacados: this.destacados() });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    const p = data as Perfil;
    this.destacados.set((p.destacados ?? []).map(String));
    this.toast.ok('Tu catálogo quedó guardado');
  }
}
