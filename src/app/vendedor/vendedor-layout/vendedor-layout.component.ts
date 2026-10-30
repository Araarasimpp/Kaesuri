import { Component } from '@angular/core';
import { BarraMovilComponent } from '../../shared/barra-movil/barra-movil.component';
import { ItemNav, NavMovilComponent } from '../../shared/nav-movil/nav-movil.component';
import { RouterOutlet } from '@angular/router';
import { addIcons } from 'ionicons';
import { bookOutline, homeOutline, personCircleOutline, trophyOutline, alertCircleOutline, cashOutline, storefrontOutline, peopleOutline, sparklesOutline } from 'ionicons/icons';

@Component({
  selector: 'app-vendedor-layout',
  standalone: true,
  imports: [RouterOutlet, BarraMovilComponent, NavMovilComponent],
  templateUrl: './vendedor-layout.component.html',
  styleUrls: ['./vendedor-layout.component.scss'],
})
export class VendedorLayoutComponent {
  /** Todas las secciones del área (en "Más" del celular) */
  readonly secciones: ItemNav[] = [
    { label: 'Inicio', path: '/vendedor', icon: 'home-outline' },
    { label: 'Catálogo', path: '/vendedor/catalogo', icon: 'book-outline' },
    { label: 'Ranking', path: '/vendedor/ranking', icon: 'trophy-outline' },
    { label: 'Novedades', path: '/vendedor/novedades', icon: 'alert-circle-outline' },
    { label: 'Mis comisiones', path: '/vendedor/comisiones', icon: 'cash-outline' },
    { label: 'Actualizaciones', path: '/vendedor/actualizaciones', icon: 'sparkles-outline' },
    { label: 'Mi perfil', path: '/vendedor/perfil', icon: 'person-circle-outline' },
    { label: 'Pedidos de la tienda', path: '/vendedor/pedidos-web', icon: 'storefront-outline' },
    { label: 'Recontactar', path: '/vendedor/recontactar', icon: 'people-outline' },
  ];
  /** Las que se ven siempre en la barra de abajo */
  readonly principales = this.secciones.slice(0, 3);

  constructor() {
    addIcons({ sparklesOutline, peopleOutline, storefrontOutline, cashOutline, alertCircleOutline, bookOutline, homeOutline, personCircleOutline, trophyOutline });
  }
}
