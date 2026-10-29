import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { ElegirFotoComponent } from '../../shared/elegir-foto/elegir-foto.component';
import { QrPagoComponent } from '../../shared/qr-pago/qr-pago.component';
import { CuentaPago, olvidarCuentas } from '../../shared/qr-pago/cuentas-pago';
import { mensajeError } from '../../shared/formato';

type Borrador = Omit<CuentaPago, 'id'> & { id: number | null };

/** Configuración → Cuentas para transferencias: el QR que los domiciliarios le muestran al cliente (como en Jasta) */
@Component({
  selector: 'app-cuentas-pago-config',
  standalone: true,
  host: { class: 'jt' },
  imports: [FormsModule, ElegirFotoComponent, QrPagoComponent],
  styles: [
    `
      .lista { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
      .cuenta { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
      .cuenta.apagada { opacity: .6; }
      .fila { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .pie { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .pie .check { display: flex; gap: 6px; align-items: center; font-size: 13.5px; margin-right: auto; }
      @media (max-width: 640px) { .fila { grid-template-columns: 1fr; } }
    `,
  ],
  template: `
    <h2>Cuentas para recibir transferencias</h2>
    <p class="ayuda">Pon aquí el QR de cada cuenta (Bancolombia, Nequi, Daviplata…). Los domiciliarios lo abren en Mis entregas para que el cliente lo escanee y pague,
      con el valor del pedido en grande. Saca la foto o el pantallazo del QR desde la app del banco.</p>
    <div class="lista">
      @for (c of cuentas(); track $index) {
        <div class="cuenta" [class.apagada]="!c.activa">
          <div class="fila">
            <div class="campo"><label [for]="'cp-n' + $index">Banco o app</label><input [id]="'cp-n' + $index" [(ngModel)]="c.nombre" placeholder="Ej: Nequi" maxlength="60" /></div>
            <div class="campo"><label [for]="'cp-t' + $index">A nombre de</label><input [id]="'cp-t' + $index" [(ngModel)]="c.titular" placeholder="Ej: Variedades JYB" maxlength="80" /></div>
            <div class="campo"><label [for]="'cp-x' + $index">Número de cuenta o celular</label><input [id]="'cp-x' + $index" [(ngModel)]="c.numero" placeholder="Ej: 316 041 1587" maxlength="40" /></div>
          </div>
          <div class="campo">
            <span class="etq">Foto del QR</span>
            <app-elegir-foto [url]="c.qr_url" [titulo]="'QR ' + c.nombre" carpeta="cuentas" (cambio)="c.qr_url = $event"></app-elegir-foto>
          </div>
          <div class="pie">
            <label class="check"><input type="checkbox" [(ngModel)]="c.activa" />Activa (la ven los domiciliarios)</label>
            @if (c.id) { <button class="b" style="color: var(--danger)" (click)="borrar(c)" [disabled]="ocupado()">Eliminar</button> }
            <button class="b b-pri" (click)="guardar(c)" [disabled]="ocupado()">Guardar</button>
          </div>
        </div>
      }
    </div>
    <div class="acciones" style="margin-top: 12px">
      <button class="b" (click)="agregar()">+ Agregar cuenta</button>
      @if (hayGuardadas()) { <button class="b" (click)="probando.set(true)">Ver como lo ve el domiciliario</button> }
    </div>
    @if (probando()) { <app-qr-pago [total]="85000" titulo="Total del pedido" detalle="Así se ve (valor de ejemplo)" (cerrar)="probando.set(false)"></app-qr-pago> }
  `,
})
export class CuentasPagoConfigComponent implements OnInit {
  private sb = inject(SupabaseService);
  private toast = inject(ToastService);

  cuentas = signal<Borrador[]>([]);
  ocupado = signal(false);
  probando = signal(false);
  hayGuardadas = signal(false);

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  private async cargar(): Promise<void> {
    const { data, error } = await this.sb.client.from('cuentas_pago').select('*').order('orden').order('id');
    if (error) return;
    const lista = (data ?? []) as CuentaPago[];
    this.hayGuardadas.set(lista.some((c) => c.activa));
    this.cuentas.set(lista.length ? lista : [this.nueva(0)]);
  }

  private nueva(orden: number): Borrador {
    return { id: null, nombre: '', titular: '', numero: '', qr_url: null, activa: true, orden };
  }

  agregar(): void {
    this.cuentas.update((l) => [...l, this.nueva(l.length)]);
  }

  async guardar(c: Borrador): Promise<void> {
    if ((c.nombre ?? '').trim().length < 2) return this.toast.error('Escribe el banco o la app (ej: Nequi).');
    if (!c.qr_url && !(c.numero ?? '').trim()) return this.toast.error('Sube la foto del QR o escribe el número.');
    this.ocupado.set(true);
    const datos = {
      nombre: c.nombre.trim(), titular: c.titular?.trim() || null, numero: c.numero?.trim() || null,
      qr_url: c.qr_url, activa: c.activa, orden: c.orden, updated_at: new Date().toISOString(),
    };
    const r = c.id ? await this.sb.client.from('cuentas_pago').update(datos).eq('id', c.id) : await this.sb.client.from('cuentas_pago').insert(datos);
    this.ocupado.set(false);
    if (r.error) return this.toast.error(mensajeError(r.error));
    olvidarCuentas();
    this.toast.ok('Cuenta guardada');
    await this.cargar();
  }

  async borrar(c: Borrador): Promise<void> {
    if (!c.id || !confirm(`¿Eliminar la cuenta ${c.nombre}? Los domiciliarios dejan de ver su QR.`)) return;
    this.ocupado.set(true);
    const { error } = await this.sb.client.from('cuentas_pago').delete().eq('id', c.id);
    this.ocupado.set(false);
    if (error) return this.toast.error(mensajeError(error));
    olvidarCuentas();
    await this.cargar();
  }
}
