// src/app/shared/notificaciones/notificaciones.component.ts
// Campana de avisos. modo="sidebar": dentro del menú lateral (PC).
// modo="flotante": botón fijo arriba a la derecha (celular / layouts sin menú lateral).

import { Component, ElementRef, HostListener, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Notificacion, NotificacionesService } from '../../core/services/notificaciones.service';
import { PushService } from '../../core/services/push.service';

@Component({
  selector: 'app-notificaciones',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notificaciones.component.html',
  styleUrls: ['./notificaciones.component.scss'],
})
export class NotificacionesComponent implements OnInit {
  @Input() modo: 'sidebar' | 'flotante' = 'flotante';
  /** En los layouts móviles con botón de tema arriba a la derecha, la campana se corre a su izquierda. */
  @Input() junto = false;
  /** Oculta el texto "Avisos" (menú lateral contraído). */
  @Input() compacto = false;

  abierto = false;

  constructor(
    public avisos: NotificacionesService,
    public push: PushService,
    private router: Router,
    private host: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.avisos.iniciar();
  }

  @HostListener('document:click', ['$event'])
  cerrarAlTocarFuera(e: MouseEvent): void {
    if (this.abierto && !this.host.nativeElement.contains(e.target as Node)) this.abierto = false;
  }

  @HostListener('document:keydown.escape')
  cerrarConEscape(): void {
    this.abierto = false;
  }

  alternar(): void {
    this.abierto = !this.abierto;
  }

  async abrir(n: Notificacion): Promise<void> {
    this.abierto = false;
    await this.avisos.marcarLeida(n);
    const ruta = this.avisos.rutaPara(n);
    if (ruta) this.router.navigateByUrl(ruta);
  }

  hace(fecha: string): string {
    const seg = Math.max(0, (Date.now() - new Date(fecha).getTime()) / 1000);
    if (seg < 60) return 'ahora';
    const min = Math.floor(seg / 60);
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    if (d < 7) return d === 1 ? 'ayer' : `hace ${d} días`;
    return new Date(fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: 'America/Bogota' });
  }

  claseTipo(tipo: string): string {
    if (tipo.includes('cancelado') || tipo.includes('atrasado')) return 'tipo-alerta';
    if (tipo.includes('entregado') || tipo.includes('recibido')) return 'tipo-ok';
    if (tipo.includes('cuadre')) return 'tipo-cuadre';
    return 'tipo-pedido';
  }
}
