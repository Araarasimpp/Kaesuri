import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { Cuadre } from '../../shared/models/models';

type FiltroCuadre = 'todos' | 'pendiente' | 'confirmado';

@Component({
  selector: 'app-admin-cuadres',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cuadres.page.html',
  styleUrls: ['./cuadres.page.scss'],
})
export class AdminCuadresPage implements OnInit, OnDestroy {
  loading = true;
  cuadres: Cuadre[] = [];
  nombresPorId = new Map<string, string>();
  filtro: FiltroCuadre = 'pendiente';
  confirmandoId: string | null = null;

  private canal: RealtimeChannel | null = null;

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('admin-cuadres-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cuadres' }, () =>
        this.cargarTodo()
      )
      .subscribe();
  }

  async cargarTodo(): Promise<void> {
    this.loading = true;

    const [cuadresRes, perfilesRes] = await Promise.all([
      this.supabase.client.from('cuadres').select('*').order('fecha', { ascending: false }),
      this.supabase.client.from('profiles').select('id, nombre'),
    ]);

    if (!cuadresRes.error && cuadresRes.data) {
      this.cuadres = cuadresRes.data as Cuadre[];
    }
    if (!perfilesRes.error && perfilesRes.data) {
      this.nombresPorId = new Map(perfilesRes.data.map((p: any) => [p.id, p.nombre]));
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  get filtrados(): Cuadre[] {
    if (this.filtro === 'todos') return this.cuadres;
    return this.cuadres.filter((c) => c.estado === this.filtro);
  }

  get pendientesCount(): number {
    return this.cuadres.filter((c) => c.estado === 'pendiente').length;
  }

  nombreDomiciliario(id: string): string {
    return this.nombresPorId.get(id) ?? 'Desconocido';
  }

  async confirmarCuadre(cuadre: Cuadre): Promise<void> {
    this.confirmandoId = cuadre.id;
    const user = await this.supabase.getCurrentUser();

    const { error } = await this.supabase.client
      .from('cuadres')
      .update({
        estado: 'confirmado',
        confirmado_at: new Date().toISOString(),
        confirmado_por: user?.id ?? null,
      })
      .eq('id', cuadre.id);

    this.confirmandoId = null;

    if (!error) {
      await this.cargarTodo();
    } else {
      this.cdr.detectChanges();
    }
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }

  formatoFecha(fecha: string): string {
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}