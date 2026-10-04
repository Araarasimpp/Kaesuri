import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { InstalarAppComponent } from './shared/instalar-app/instalar-app.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, InstalarAppComponent],
})
export class AppComponent {
  constructor() {}
}
