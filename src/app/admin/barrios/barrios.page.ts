import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { confirmar } from '../../shared/dialogo';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

interface Zona {
  id: string;
  nombre: string;
  valor: number;
}

/** Quita tildes y mayúsculas para buscar ("normandia" encuentra "Normandía") */
function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Barrios y tarifas de domicilio (antes estaban en Configuración). Al crear un
 * pedido, el vendedor elige el barrio y el valor del domicilio se autocompleta.
 */
@Component({
  selector: 'app-barrios',
  standalone: true,
  imports: [SkeletonComponent, CommonModule, FormsModule],
  templateUrl: './barrios.page.html',
  styleUrls: ['./barrios.page.scss'],
})
export class BarriosPage implements OnInit {
  loading = true;
  zonas: Zona[] = [];
  busqueda = '';
  nuevaZonaNombre = '';
  nuevaZonaValor: number | null = null;
  guardandoZona = false;
  errorMsg = '';

  constructor(
    private supabase: SupabaseService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.cargarZonas();
  }

  get filtradas(): Zona[] {
    const q = normalizar(this.busqueda);
    return q ? this.zonas.filter((z) => normalizar(z.nombre).includes(q)) : this.zonas;
  }

  async cargarZonas(): Promise<void> {
    const { data, error } = await this.supabase.client.from('zonas_domicilio').select('id, nombre, valor').order('nombre');
    if (!error && data) this.zonas = data as Zona[];
    this.loading = false;
    this.cdr.detectChanges();
  }

  async agregarZona(): Promise<void> {
    const nombre = this.nuevaZonaNombre.trim();
    if (!nombre || this.nuevaZonaValor == null) return;
    this.errorMsg = '';
    if (this.zonas.some((z) => normalizar(z.nombre) === normalizar(nombre))) {
      this.errorMsg = `"${nombre}" ya está en la lista.`;
      this.busqueda = nombre;
      return;
    }

    this.guardandoZona = true;
    const { error } = await this.supabase.client.from('zonas_domicilio').insert({ nombre, valor: this.nuevaZonaValor });
    this.guardandoZona = false;

    if (error) {
      this.errorMsg = 'No se pudo agregar el barrio. Intenta de nuevo.';
    } else {
      this.nuevaZonaNombre = '';
      this.nuevaZonaValor = null;
      await this.cargarZonas();
    }
    this.cdr.detectChanges();
  }

  async actualizarZona(zona: Zona): Promise<void> {
    await this.supabase.client.from('zonas_domicilio').update({ nombre: zona.nombre, valor: zona.valor }).eq('id', zona.id);
  }

  porId(_: number, z: Zona): string {
    return z.id;
  }

  async eliminarZona(zona: Zona): Promise<void> {
    const confirmado = await confirmar(`¿Eliminar el barrio "${zona.nombre}"?`);
    if (!confirmado) return;

    const { error } = await this.supabase.client.from('zonas_domicilio').delete().eq('id', zona.id);
    if (!error) await this.cargarZonas();
  }
}
