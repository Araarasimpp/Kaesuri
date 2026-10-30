import { Component } from '@angular/core';
import { BarraMovilComponent } from '../../shared/barra-movil/barra-movil.component';
import { ItemNav, NavMovilComponent } from '../../shared/nav-movil/nav-movil.component';
import { RouterOutlet } from '@angular/router';
import { addIcons } from 'ionicons';
import { personCircleOutline, walletOutline, sparklesOutline } from 'ionicons/icons';

@Component({
  selector: 'app-recolector-layout',
  standalone: true,
  imports: [RouterOutlet, BarraMovilComponent, NavMovilComponent],
  templateUrl: './recolector-layout.component.html',
  styleUrls: ['./recolector-layout.component.scss'],
})
export class RecolectorLayoutComponent {
  /** Todas las secciones del área (en "Más" del celular) */
  readonly secciones: ItemNav[] = [
    { label: 'Bases y compras', path: '/recolector', icon: 'wallet-outline' },
    { label: 'Actualizaciones', path: '/recolector/actualizaciones', icon: 'sparkles-outline' },
    { label: 'Mi perfil', path: '/recolector/perfil', icon: 'person-circle-outline' },
  ];
  /** Las que se ven siempre en la barra de abajo */
  readonly principales = this.secciones.slice(0, 1);

  constructor() {
    addIcons({ sparklesOutline, personCircleOutline, walletOutline });
  }
}
