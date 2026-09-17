import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonSpinner,
} from '@ionic/angular';
import { SupabaseService, Profile, UserRole } from '../../core/services/supabase.service';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonSpinner,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Usuarios</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-spinner *ngIf="loading"></ion-spinner>

      <ion-list *ngIf="!loading">
        <ion-item *ngFor="let u of usuarios">
          <ion-label>
            <h2>{{ u.nombre }}</h2>
            <p *ngIf="u.id === miId">(Tú)</p>
          </ion-label>
          <ion-select
            [(ngModel)]="u.role"
            (ionChange)="cambiarRol(u)"
            interface="popover"
            [disabled]="u.id === miId"
          >
            <ion-select-option value="admin">Admin</ion-select-option>
            <ion-select-option value="vendedor">Vendedor</ion-select-option>
            <ion-select-option value="domiciliario">Domiciliario</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class UsuariosPage implements OnInit {
  usuarios: Profile[] = [];
  loading = true;
  miId: string | null = null;

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const user = await this.supabase.getCurrentUser();
    this.miId = user?.id ?? null;
    await this.cargarUsuarios();
  }

  async cargarUsuarios() {
    this.loading = true;
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, nombre, telefono, role')
      .order('nombre');

    if (!error && data) {
      this.usuarios = data as Profile[];
    }
    this.loading = false;
  }

  async cambiarRol(usuario: Profile) {
    if (usuario.id === this.miId) {
      // No debería llegar aquí porque el select está deshabilitado,
      // pero se valida igual por si acaso.
      await this.cargarUsuarios();
      return;
    }

    const { error } = await this.supabase.client
      .from('profiles')
      .update({ role: usuario.role })
      .eq('id', usuario.id);

    if (error) {
      console.error('Error actualizando rol:', error.message);
      // Si falla (ej: perdió conexión), volvemos a cargar para no mostrar
      // un rol que en realidad no se guardó
      await this.cargarUsuarios();
    }
  }
}