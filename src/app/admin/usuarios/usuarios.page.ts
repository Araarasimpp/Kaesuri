import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, UserRole } from '../../core/services/supabase.service';
import { PresenciaService } from '../../core/services/presencia.service';

import { avisar, confirmar } from '../../shared/dialogo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';
interface UsuarioFila {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  role: UserRole;
  roles: UserRole[];
  activo: boolean;
  created_at: string;
  /** Cuenta borrada: queda solo el nombre para el historial */
  eliminado_at: string | null;
}

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [SkeletonComponent, CommonModule, FormsModule],
  templateUrl: './usuarios.page.html',
  styleUrls: ['./usuarios.page.scss'],
})
export class UsuariosPage implements OnInit, OnDestroy {
  loading = true;
  usuarios: UsuarioFila[] = [];
  /** Activo, ausente o desconectado (punto en la inicial, como en Discord) */
  presencia = inject(PresenciaService);
  busqueda = '';
  /** Solo las cuentas que no se usan (no entran hace más de 60 días) */
  soloSinUsar = false;
  /** Último ingreso de cada cuenta (id → fecha) */
  ultimo: Record<string, string | null> = {};
  miId: string | null = null;
  guardandoId: string | null = null;

  private canal: RealtimeChannel | null = null;

  readonly roles: { valor: UserRole; etiqueta: string }[] = [
    { valor: 'admin', etiqueta: 'Admin' },
    { valor: 'despachador', etiqueta: 'Despachador' },
    { valor: 'vendedor', etiqueta: 'Vendedor' },
    { valor: 'domiciliario', etiqueta: 'Domiciliario' },
    { valor: 'venta_local', etiqueta: 'Venta local' },
    { valor: 'recolector', etiqueta: 'Recolector' },
  ];

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const user = await this.supabase.getCurrentUser();
    this.miId = user?.id ?? null;
    await this.cargarUsuarios();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('usuarios-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => {
          this.cargarUsuarios();
        }
      )
      .subscribe();
  }

  async cargarUsuarios(): Promise<void> {
    this.loading = true;
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, nombre, email, telefono, role, roles, activo, created_at, eliminado_at')
      .order('nombre');

    if (!error && data) {
      this.usuarios = (data as UsuarioFila[]).filter((u) => !u.eliminado_at);
      void this.supabase.client.rpc('usuarios_ultimo_ingreso').then(({ data: d }) => {
        if (d) { this.ultimo = d as Record<string, string | null>; this.cdr.detectChanges(); }
      });
      void this.presencia.cargarVistos(this.usuarios.map((u) => u.id));
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  /** No ha entrado en 60 días (o nunca, y la cuenta tiene más de 60 días) */
  sinUsar(u: UsuarioFila): boolean {
    const limite = Date.now() - 60 * 86_400_000;
    const f = this.ultimo[u.id];
    return f ? new Date(f).getTime() < limite : new Date(u.created_at).getTime() < limite;
  }

  ultimoTexto(u: UsuarioFila): string {
    const f = this.ultimo[u.id];
    if (!f) return 'Nunca';
    const dias = Math.floor((Date.now() - new Date(f).getTime()) / 86_400_000);
    return dias <= 0 ? 'Hoy' : dias === 1 ? 'Ayer' : `Hace ${dias} días`;
  }

  async borrar(u: UsuarioFila): Promise<void> {
    if (u.id === this.miId) return;
    const t = prompt(`¿Borrar la cuenta de ${u.nombre}? Pierde el acceso a la app y se borran sus datos personales. No se puede deshacer.\n\nPara confirmar escribe BORRAR:`);
    if (t?.trim().toUpperCase() !== 'BORRAR') return;
    this.guardandoId = u.id;
    const { data, error } = await this.supabase.client.rpc('eliminar_cuenta', { p_usuario: u.id });
    this.guardandoId = null;
    if (error) {
      await avisar(error.message, 'No se pudo borrar');
      return;
    }
    await avisar(data === 'borrada' ? `Cuenta de ${u.nombre} borrada.` : `Cuenta de ${u.nombre} borrada. Su nombre queda en sus pedidos y cuadres viejos.`);
    await this.cargarUsuarios();
  }

  get filtrados(): UsuarioFila[] {
    const base = this.soloSinUsar ? this.usuarios.filter((u) => this.sinUsar(u)) : this.usuarios;
    if (!this.busqueda.trim()) return base;
    const q = this.busqueda.trim().toLowerCase();
    return base.filter(
      (u) =>
        u.nombre.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)
    );
  }

  /** Una persona puede tener varios roles (por ejemplo vendedor y domiciliario), pero al menos uno */
  async alternarRol(usuario: UsuarioFila, rol: UserRole): Promise<void> {
    if (usuario.id === this.miId) return;
    const roles = usuario.roles.includes(rol) ? usuario.roles.filter((r) => r !== rol) : [...usuario.roles, rol];
    if (!roles.length) {
      await avisar('Cada usuario necesita al menos un rol.');
      return;
    }

    this.guardandoId = usuario.id;
    usuario.roles = roles;
    const { error } = await this.supabase.client
      .from('profiles')
      .update({ roles })
      .eq('id', usuario.id);

    this.guardandoId = null;

    if (error) {
      await this.cargarUsuarios();
    } else {
      this.cdr.detectChanges();
    }
  }

  async toggleActivo(usuario: UsuarioFila): Promise<void> {
    if (usuario.id === this.miId) return;

    const nuevoEstado = !usuario.activo;
    const confirmado = await confirmar(
      nuevoEstado
        ? `¿Reactivar a ${usuario.nombre}?`
        : `¿Desactivar a ${usuario.nombre}? No podrá iniciar sesión hasta que lo reactives.`
    );
    if (!confirmado) return;

    this.guardandoId = usuario.id;
    const { error } = await this.supabase.client
      .from('profiles')
      .update({ activo: nuevoEstado })
      .eq('id', usuario.id);

    this.guardandoId = null;

    if (!error) {
      await this.cargarUsuarios();
    } else {
      this.cdr.detectChanges();
    }
  }

  etiquetaRol(role: UserRole): string {
    return this.roles.find((r) => r.valor === role)?.etiqueta ?? role;
  }

  inicial(nombre: string): string {
    return nombre.charAt(0).toUpperCase();
  }
}