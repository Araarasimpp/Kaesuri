import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService, rolesDe } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { RecortarFotoComponent } from '../../shared/recortar-foto/recortar-foto.component';
import { TelegramPanelComponent } from '../../shared/telegram/telegram-panel.component';
import { mensajeError } from '../../shared/formato';

const ETIQUETA_ROL: Record<string, string> = {
  admin: 'Admin', despachador: 'Despachador', vendedor: 'Vendedor', domiciliario: 'Domiciliario', venta_local: 'Venta local', recolector: 'Recolector',
};

/** Mi perfil y mi seguridad (como en Jasta): nombre, teléfono, foto, contraseña y sesiones */
@Component({
  selector: 'app-perfil',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, AvatarComponent, RecortarFotoComponent, TelegramPanelComponent],
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 620px; }
      .panel { display: flex; flex-direction: column; gap: 14px; }
      .foto { display: flex; align-items: center; gap: 16px; }
      .foto label { cursor: pointer; }
      .foto input { display: none; }
      .roles { display: flex; gap: 6px; flex-wrap: wrap; }
      .fila { display: flex; gap: 8px; flex-wrap: wrap; }
    `,
  ],
  template: `
    <div class="page">
      <div class="head"><div><h1>Mi perfil</h1></div></div>

      <section class="panel">
        <div class="foto">
          <app-avatar [nombre]="nombre" [foto]="foto()" [tam]="72"></app-avatar>
          <div class="fila">
            <label class="b">{{ subiendo() ? 'Subiendo…' : 'Cambiar foto' }}
              <input type="file" accept="image/*" (change)="elegirFoto($event)" [disabled]="subiendo()" />
            </label>
            @if (foto()) {
              <button class="b" (click)="quitarFoto()">Quitar foto</button>
            }
          </div>
        </div>
        @if (porRecortar(); as archivo) {
          <app-recortar-foto [archivo]="archivo" [guardando]="subiendo()" (recortada)="subirFoto($event)" (cancelar)="porRecortar.set(null)"></app-recortar-foto>
        }
        <div class="campo"><label for="pn">Nombre</label><input id="pn" class="inp" [(ngModel)]="nombre" autocomplete="name" /></div>
        <div class="campo"><label for="pt">Teléfono</label><input id="pt" class="inp" type="tel" [(ngModel)]="telefono" autocomplete="tel" /></div>
        <div class="campo"><span class="etq">Correo</span><span class="suave">{{ sb.perfil()?.email }}</span></div>
        <div class="campo">
          <span class="etq">Roles</span>
          <span class="roles">
            @for (r of roles(); track r) { <span class="etiqueta on">{{ r }}</span> } @empty { <span class="suave">Sin rol asignado</span> }
          </span>
        </div>
        <div><button class="b b-pri" [disabled]="guardando()" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button></div>
      </section>

      @if (despacha()) {
        <section class="panel">
          <h2>Telegram</h2>
          <app-telegram-panel modo="perfil"></app-telegram-panel>
        </section>
      }

      <section class="panel">
        <h2>Contraseña</h2>
        <div class="fila-campos">
          <div class="campo"><label for="c1">Nueva contraseña</label><input id="c1" class="inp" type="password" autocomplete="new-password" [(ngModel)]="clave1" /></div>
          <div class="campo"><label for="c2">Repítela</label><input id="c2" class="inp" type="password" autocomplete="new-password" [(ngModel)]="clave2" /></div>
        </div>
        <p class="ayuda">Mínimo 8 caracteres. Mezcla letras y números.</p>
        <div><button class="b" [disabled]="cambiando()" (click)="cambiarClave()">{{ cambiando() ? 'Cambiando…' : 'Cambiar contraseña' }}</button></div>
      </section>

      <section class="panel">
        <h2>Sesiones</h2>
        <p class="ayuda">Si perdiste el celular o entraste en un computador ajeno, cierra la sesión en todos los dispositivos. Tendrás que volver a entrar.</p>
        <div><button class="b b-peligro" (click)="cerrarTodas()">Cerrar sesión en todos los dispositivos</button></div>
      </section>
    </div>
  `,
})
export class PerfilPage implements OnInit {
  sb = inject(SupabaseService);
  private toast = inject(ToastService);
  private router = inject(Router);

  nombre = '';
  telefono = '';
  clave1 = '';
  clave2 = '';
  foto = signal<string | null>(null);
  guardando = signal(false);
  subiendo = signal(false);
  /** Foto elegida que se está ajustando antes de subir */
  porRecortar = signal<File | null>(null);
  cambiando = signal(false);
  /** Admin y despachador despachan (pueden mandar fotos de rótulos a Telegram) */
  despacha = computed(() => {
    const p = this.sb.perfil();
    return !!p && rolesDe(p).some((r) => r === 'admin' || r === 'despachador');
  });
  roles = computed(() => {
    const p = this.sb.perfil();
    return p ? rolesDe(p).map((r) => ETIQUETA_ROL[r] ?? r) : [];
  });

  async ngOnInit(): Promise<void> {
    const u = await this.sb.getCurrentProfile();
    this.nombre = u?.nombre ?? '';
    this.telefono = u?.telefono ?? '';
    this.foto.set(u?.avatar_url ?? null);
  }

  private async guardarPerfil(avatar: string | null): Promise<boolean> {
    const id = this.sb.perfil()?.id;
    const nombre = this.nombre.trim();
    if (!id) return false;
    if (!nombre) {
      this.toast.error('Escribe tu nombre.');
      return false;
    }
    const { error } = await this.sb.client
      .from('profiles')
      .update({ nombre, telefono: this.telefono.trim() || null, avatar_url: avatar })
      .eq('id', id);
    if (error) {
      this.toast.error(mensajeError(error));
      return false;
    }
    await this.sb.recargarPerfil();
    return true;
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    if (await this.guardarPerfil(this.foto())) this.toast.ok('Perfil guardado');
    this.guardando.set(false);
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
    const uid = this.sb.perfil()?.id;
    if (!uid) return;
    this.subiendo.set(true);
    try {
      // Nombre nuevo cada vez: no reemplaza archivos y la foto nueva se ve de una vez (sin caché)
      const ruta = `${uid}/foto-${Date.now()}.jpg`;
      const { error } = await this.sb.client.storage.from('avatars').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      const url = this.sb.client.storage.from('avatars').getPublicUrl(ruta).data.publicUrl;
      if (await this.guardarPerfil(url)) {
        this.foto.set(url);
        this.porRecortar.set(null);
        this.toast.ok('Foto actualizada');
      }
    } catch (e) {
      this.toast.error(mensajeError(e));
    } finally {
      this.subiendo.set(false);
    }
  }

  async quitarFoto(): Promise<void> {
    if (await this.guardarPerfil(null)) this.foto.set(null);
  }

  async cambiarClave(): Promise<void> {
    if (this.clave1.length < 8) return this.toast.error('La contraseña debe tener al menos 8 caracteres.');
    if (this.clave1 !== this.clave2) return this.toast.error('Las contraseñas no coinciden.');
    this.cambiando.set(true);
    const { error } = await this.sb.cambiarClave(this.clave1);
    this.cambiando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.clave1 = this.clave2 = '';
    this.toast.ok('Contraseña cambiada');
  }

  async cerrarTodas(): Promise<void> {
    if (!confirm('Se cerrará tu sesión en todos los dispositivos, incluido este. ¿Continuar?')) return;
    await this.sb.client.auth.signOut({ scope: 'global' });
    this.sb.clearCachedProfile();
    void this.router.navigateByUrl('/auth/login');
  }
}
