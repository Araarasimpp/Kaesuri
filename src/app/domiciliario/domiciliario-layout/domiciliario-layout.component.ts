import { Component } from '@angular/core';
import { BarraMovilComponent } from '../../shared/barra-movil/barra-movil.component';
import { ItemNav, NavMovilComponent } from '../../shared/nav-movil/nav-movil.component';
import { RouterOutlet } from '@angular/router';
import { addIcons } from 'ionicons';
import { homeOutline, personCircleOutline, trophyOutline, walletOutline } from 'ionicons/icons';

@Component({
  selector: 'app-domiciliario-layout',
  standalone: true,
  imports: [RouterOutlet, BarraMovilComponent, NavMovilComponent],
  templateUrl: './domiciliario-layout.component.html',
  styleUrls: ['./domiciliario-layout.component.scss'],
})
export class DomiciliarioLayoutComponent {
  /** Todas las secciones del área (en "Más" del celular) */
  readonly secciones: ItemNav[] = [
    { label: 'Entregas', path: '/domiciliario', icon: 'home-outline' },
    { label: 'Cuadres', path: '/domiciliario/cuadres', icon: 'wallet-outline' },
    { label: 'Ranking', path: '/domiciliario/ranking', icon: 'trophy-outline' },
    { label: 'Mi perfil', path: '/domiciliario/perfil', icon: 'person-circle-outline' },
  ];
  /** Las que se ven siempre en la barra de abajo */
  readonly principales = this.secciones.slice(0, 3);

  constructor() {
    addIcons({ homeOutline, personCircleOutline, trophyOutline, walletOutline });
  }
}
