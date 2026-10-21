import { Component } from '@angular/core';
import { BarraMovilComponent } from '../../shared/barra-movil/barra-movil.component';
import { ItemNav, NavMovilComponent } from '../../shared/nav-movil/nav-movil.component';
import { RouterOutlet } from '@angular/router';
import { addIcons } from 'ionicons';
import { bookOutline, peopleCircleOutline, personCircleOutline, receiptOutline } from 'ionicons/icons';

@Component({
  selector: 'app-local-layout',
  standalone: true,
  imports: [RouterOutlet, BarraMovilComponent, NavMovilComponent],
  templateUrl: './local-layout.component.html',
  styleUrls: ['./local-layout.component.scss'],
})
export class LocalLayoutComponent {
  /** Todas las secciones del área (en "Más" del celular) */
  readonly secciones: ItemNav[] = [
    { label: 'Ventas', path: '/local', icon: 'receipt-outline' },
    { label: 'Catálogo', path: '/local/catalogo', icon: 'book-outline' },
    { label: 'Clientes', path: '/local/clientes', icon: 'people-circle-outline' },
    { label: 'Mi perfil', path: '/local/perfil', icon: 'person-circle-outline' },
  ];
  /** Las que se ven siempre en la barra de abajo */
  readonly principales = this.secciones.slice(0, 3);

  constructor() {
    addIcons({ bookOutline, peopleCircleOutline, personCircleOutline, receiptOutline });
  }
}
