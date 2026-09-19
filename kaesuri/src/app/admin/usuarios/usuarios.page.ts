import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService, UserRole } from '../../core/services/supabase.service';

interface UsuarioFila {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  role: UserRole;
}

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './usuarios.page.html',
  styleUrls: ['./usuarios.page.scss'],
})
export class UsuariosPage implements OnInit, OnDestroy {
  loading = true;
  usuarios: UsuarioFila[] = [];
  busqueda = '';
  miId: string | null = null;
  guardandoId: string | null = null;

  private canal: RealtimeChannel | null = null;

  readonly roles: { valor: UserRole; etiqueta: string }[] = [
    { valor: 'admin', etiqueta: 'Admin' },
    { valor: 'vendedor', etiqueta: 'Vendedor' },
    { valor: 'domiciliario', etiqueta: 'Domiciliario' },
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
      .select('id, nombre, email, telefono, role')
      .order('nombre');

    if (!error && data) {
      this.usuarios = data as UsuarioFila[];
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  get filtrados(): UsuarioFila[] {
    if (!this.busqueda.trim()) return this.usuarios;
    const q = this.busqueda.trim().toLowerCase();
    return this.usuarios.filter(
      (u) =>
        u.nombre.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q)
    );
  }

  async cambiarRol(usuario: UsuarioFila, nuevoRol: UserRole): Promise<void> {
    if (usuario.id === this.miId || nuevoRol === usuario.role) return;

    this.guardandoId = usuario.id;
    const { error } = await this.supabase.client
      .from('profiles')
      .update({ role: nuevoRol })
      .eq('id', usuario.id);

    this.guardandoId = null;

    if (error) {
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