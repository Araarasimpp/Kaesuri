import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import * as XLSX from 'xlsx';
import { SupabaseService } from '../../core/services/supabase.service';
import { LOGO_ROTULO, RotuloService } from '../../shared/rotulo.service';

import { avisar, confirmar } from '../../shared/dialogo';
interface Configuracion {
  nombre_negocio: string;
  telefonos: string | null;
  redes: string | null;
  texto_garantia: string | null;
  stock_bajo_umbral: number;
}

interface Zona {
  id: string;
  nombre: string;
  valor: number;
}

@Component({
  selector: 'app-configuracion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuracion.page.html',
  styleUrls: ['./configuracion.page.scss'],
})
export class ConfiguracionPage implements OnInit {
  loading = true;
  guardando = false;
  guardadoOk = false;
  errorMsg = '';

  form: Configuracion = {
    nombre_negocio: '',
    telefonos: '',
    redes: '',
    texto_garantia: '',
    stock_bajo_umbral: 5,
  };

  zonas: Zona[] = [];
  nuevaZonaNombre = '';
  nuevaZonaValor: number | null = null;
  guardandoZona = false;

  exportando = false;

  /** Logo que se imprime en el rótulo (vista previa). */
  readonly logoRotulo: SafeUrl;
  readonly hoy = new Date().toISOString();

  constructor(
    private supabase: SupabaseService,
    private rotulos: RotuloService,
    private cdr: ChangeDetectorRef,
    sanitizer: DomSanitizer
  ) {
    // El logo es una imagen embebida (data URL); se marca como segura para la vista previa.
    this.logoRotulo = sanitizer.bypassSecurityTrustUrl(LOGO_ROTULO);
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.cargar(), this.cargarZonas()]);
  }

  async cargar(): Promise<void> {
    this.loading = true;
    const { data, error } = await this.supabase.client
      .from('configuracion')
      .select('nombre_negocio, telefonos, redes, texto_garantia, stock_bajo_umbral')
      .eq('id', true)
      .single();

    if (!error && data) {
      this.form = data as Configuracion;
    }
    this.loading = false;
    this.cdr.detectChanges();
  }

  async guardar(): Promise<void> {
    this.errorMsg = '';
    this.guardadoOk = false;

    if (!this.form.nombre_negocio.trim()) {
      this.errorMsg = 'El nombre del negocio es obligatorio.';
      return;
    }

    this.guardando = true;
    const { error } = await this.supabase.client.from('configuracion').update(this.form).eq('id', true);

    this.guardando = false;

    if (error) {
      this.errorMsg = 'No se pudo guardar. Intenta de nuevo.';
    } else {
      this.guardadoOk = true;
    }
    this.cdr.detectChanges();
  }

  /** Imprime un rótulo de ejemplo con lo que está escrito en el formulario (aunque no se haya guardado). */
  imprimirRotuloPrueba(): void {
    this.rotulos.imprimirPrueba({
      nombre_negocio: this.form.nombre_negocio || 'Mi negocio',
      telefonos: this.form.telefonos,
      redes: this.form.redes,
      texto_garantia: this.form.texto_garantia,
    });
  }

  fechaRotulo(): string {
    return this.rotulos.fecha(this.hoy);
  }

  // ---------- Zonas de domicilio ----------

  async cargarZonas(): Promise<void> {
    const { data, error } = await this.supabase.client.from('zonas_domicilio').select('id, nombre, valor').order('nombre');

    if (!error && data) {
      this.zonas = data as Zona[];
    }
    this.cdr.detectChanges();
  }

  async agregarZona(): Promise<void> {
    if (!this.nuevaZonaNombre.trim() || this.nuevaZonaValor == null) return;

    this.guardandoZona = true;
    const { error } = await this.supabase.client.from('zonas_domicilio').insert({
      nombre: this.nuevaZonaNombre.trim(),
      valor: this.nuevaZonaValor,
    });
    this.guardandoZona = false;

    if (!error) {
      this.nuevaZonaNombre = '';
      this.nuevaZonaValor = null;
      await this.cargarZonas();
    }
    this.cdr.detectChanges();
  }

  async actualizarZona(zona: Zona): Promise<void> {
    await this.supabase.client.from('zonas_domicilio').update({ nombre: zona.nombre, valor: zona.valor }).eq('id', zona.id);
  }

  async eliminarZona(zona: Zona): Promise<void> {
    const confirmado = await confirmar(`¿Eliminar la zona "${zona.nombre}"?`);
    if (!confirmado) return;

    const { error } = await this.supabase.client.from('zonas_domicilio').delete().eq('id', zona.id);

    if (!error) {
      await this.cargarZonas();
    }
  }

  // ---------- Exportar datos ----------

  async exportarDatos(): Promise<void> {
    this.exportando = true;
    this.cdr.detectChanges();

    const [pedidosRes, productosRes, cuadresRes] = await Promise.all([
      this.supabase.client
        .from('pedidos')
        .select(
          'numero, estado, cliente_nombre, cliente_telefono, direccion, barrio, total, valor_domicilio, comision, metodo_pago, monto_efectivo, monto_transferencia, created_at, entregado_at'
        )
        .order('created_at', { ascending: false }),
      this.supabase.client
        .from('productos')
        .select('nombre, sku, categoria, costo, precio_base, precio_sugerido, stock, activo')
        .order('nombre'),
      this.supabase.client
        .from('cuadres')
        .select('fecha, cantidad_pedidos, total_efectivo, total_transferencia, total_domicilios, total_a_entregar, estado')
        .order('fecha', { ascending: false }),
    ]);

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(pedidosRes.data ?? []), 'Pedidos');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(productosRes.data ?? []), 'Productos');
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(cuadresRes.data ?? []), 'Cuadres');

    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(libro, `respaldo_kaesuri_${hoy}.xlsx`);

    this.exportando = false;
    this.cdr.detectChanges();
  }
}
