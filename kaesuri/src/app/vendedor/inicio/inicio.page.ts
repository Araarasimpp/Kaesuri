import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonButtons,
} from '@ionic/angular';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-inicio-vendedor',
  standalone: true,
  imports: [CommonModule, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonButtons],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Vendedor</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="logout()">Salir</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p>Bienvenido. Aquí irá el listado de pedidos y el botón para crear uno nuevo.</p>
    </ion-content>
  `,
})
export class InicioPage {
  constructor(private supabase: SupabaseService, private router: Router) {}

  async logout() {
    await this.supabase.logout();
    this.router.navigateByUrl('/auth/login');
  }
}