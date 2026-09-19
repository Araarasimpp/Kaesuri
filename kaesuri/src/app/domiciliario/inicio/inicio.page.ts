import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '../../core/services/supabase.service';
import { EntregarPedidoComponent } from '../entregar-pedido/entregar-pedido.component';

interface PedidoRuta {
  id: string;
  numero: number;
  cliente_nombre: string;
  cliente_telefono: string | null;
  direccion: string;
  barrio: string | null;
  total: number;
  observaciones: string | null;
}

@Component({
  selector: 'app-inicio-domiciliario',
  standalone: true,
  imports: [CommonModule, RouterLink, EntregarPedidoComponent],
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
})
export class InicioDomiciliarioPage implements OnInit, OnDestroy {
  loading = true;
  pedidos: PedidoRuta[] = [];
  pedidoEntregando: PedidoRuta | null = null;

  private canal: RealtimeChannel | null = null;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.cargarPedidos();
    this.suscribirRealtime();
  }

  ngOnDestroy(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
    }
  }

  private suscribirRealtime(): void {
    this.canal = this.supabase.client
      .channel('mis-pedidos-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos' },
        () => this.cargarPedidos()
      )
      .subscribe();
  }

  async cargarPedidos(): Promise<void> {
    this.loading = true;
    const user = await this.supabase.getCurrentUser();

    if (!user) {
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    const { data, error } = await this.supabase.client
      .from('pedidos')
      .select('id, numero, cliente_nombre, cliente_telefono, direccion, barrio, total, observaciones')
      .eq('domiciliario_id', user.id)
      .eq('estado', 'en_ruta')
      .order('created_at', { ascending: true });

    if (!error && data) {
      this.pedidos = data as PedidoRuta[];
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  abrirEntrega(pedido: PedidoRuta): void {
    this.pedidoEntregando = pedido;
  }

  cerrarEntrega(): void {
    this.pedidoEntregando = null;
  }

  async onEntregado(): Promise<void> {
    this.pedidoEntregando = null;
    await this.cargarPedidos();
  }

  async logout(): Promise<void> {
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }

  formatoMoneda(valor: number): string {
    return valor.toLocaleString('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    });
  }
}