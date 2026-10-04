// Historial de actividad: quién creó, editó o eliminó pedidos, productos,
// cuadres, usuarios, zonas y configuración. Lo llena la base de datos
// (tabla "auditoria", solo visible para el admin).

import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../core/services/supabase.service';
import { finDiaColombia, hoyColombiaISO, inicioDiaColombia } from '../../shared/fecha-colombia';

interface Registro {
  id: number;
  created_at: string;
  usuario_id: string | null;
  usuario_nombre: string | null;
  usuario_rol: string | null;
  accion: string;
  tabla: string;
  registro_id: string | null;
  resumen: string | null;
  cambios: Record<string, any> | null;
}

interface Cambio {
  campo: string;
  antes: string;
  despues: string;
}

const TAMANO_PAGINA = 50;

const TABLAS: Record<string, string> = {
  pedidos: 'Pedidos',
  productos: 'Productos',
  cuadres: 'Cuadres',
  profiles: 'Usuarios',
  zonas_domicilio: 'Zonas de domicilio',
  configuracion: 'Configuración',
};

const CAMPOS: Record<string, string> = {
  estado: 'Estado',
  domiciliario_id: 'Domiciliario',
  vendedor_id: 'Vendedor',
  confirmado_por: 'Recibido por',
  confirmado_at: 'Recibido el',
  rotulo_impreso_at: 'Rótulo impreso',
  entregado_at: 'Entregado el',
  metodo_pago: 'Método de pago',
  comprobante_url: 'Comprobante',
  cuadre_id: 'Cuadre',
  total: 'Total',
  valor_domicilio: 'Domicilio',
  comision: 'Comisión',
  cliente_nombre: 'Cliente',
  cliente_telefono: 'Teléfono',
  direccion: 'Dirección',
  barrio: 'Barrio',
  observaciones: 'Observaciones',
  nombre: 'Nombre',
  sku: 'SKU',
  categoria: 'Categoría',
  stock: 'Stock',
  costo: 'Costo',
  precio_base: 'Precio base',
  precio_sugerido: 'Precio sugerido',
  activo: 'Activo',
  imagen_url: 'Foto',
  role: 'Rol',
  telefono: 'Teléfono',
  email: 'Correo',
  valor: 'Valor',
  nombre_negocio: 'Nombre del negocio',
  telefonos: 'Teléfonos',
  redes: 'Redes',
  texto_garantia: 'Texto de garantía',
  stock_bajo_umbral: 'Umbral de stock bajo',
  cantidad_pedidos: 'Pedidos',
  total_efectivo: 'Efectivo',
  total_transferencia: 'Transferencia',
  total_domicilios: 'Domicilios',
};

const DINERO = new Set(['total', 'valor_domicilio', 'comision', 'costo', 'precio_base', 'precio_sugerido', 'valor', 'total_efectivo', 'total_transferencia', 'total_domicilios']);
const PERSONAS = new Set(['domiciliario_id', 'vendedor_id', 'confirmado_por']);
const FECHAS = new Set(['confirmado_at', 'rotulo_impreso_at', 'entregado_at']);
const OCULTOS = new Set(['id', 'created_at', 'total_general', 'total_a_entregar', 'cerrado_at', 'numero']);

@Component({
  selector: 'app-actividad',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './actividad.page.html',
  styleUrls: ['./actividad.page.scss'],
})
export class ActividadPage implements OnInit {
  loading = true;
  cargandoMas = false;
  registros: Registro[] = [];
  total = 0;
  abiertoId: number | null = null;

  fecha = hoyColombiaISO();
  tabla = 'todas';
  usuarioId = 'todos';
  usuarios: { id: string; nombre: string }[] = [];
  readonly tablas = Object.entries(TABLAS).map(([valor, etiqueta]) => ({ valor, etiqueta }));

  private nombres = new Map<string, string>();

  constructor(private supabase: SupabaseService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    const { data } = await this.supabase.client.from('profiles').select('id, nombre').order('nombre');
    this.usuarios = (data as any[]) ?? [];
    this.nombres = new Map(this.usuarios.map((u) => [u.id, u.nombre]));
    await this.cargar();
  }

  private consulta(desde: number): any {
    let q: any = this.supabase.client.from('auditoria').select('*', { count: 'exact' });
    if (this.fecha) {
      q = q.gte('created_at', inicioDiaColombia(this.fecha).toISOString()).lte('created_at', finDiaColombia(this.fecha).toISOString());
    }
    if (this.tabla !== 'todas') q = q.eq('tabla', this.tabla);
    if (this.usuarioId !== 'todos') q = q.eq('usuario_id', this.usuarioId);
    return q.order('created_at', { ascending: false }).range(desde, desde + TAMANO_PAGINA - 1);
  }

  async cargar(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    const { data, count } = await this.consulta(0);
    this.registros = (data as Registro[]) ?? [];
    this.total = count ?? this.registros.length;
    this.loading = false;
    this.cdr.detectChanges();
  }

  async cargarMas(): Promise<void> {
    this.cargandoMas = true;
    this.cdr.detectChanges();
    const { data } = await this.consulta(this.registros.length);
    this.registros = this.registros.concat((data as Registro[]) ?? []);
    this.cargandoMas = false;
    this.cdr.detectChanges();
  }

  get hayMas(): boolean {
    return this.registros.length < this.total;
  }

  alternar(r: Registro): void {
    this.abiertoId = this.abiertoId === r.id ? null : r.id;
  }

  etiquetaTabla(t: string): string {
    return TABLAS[t] ?? t;
  }

  etiquetaRol(rol: string | null): string {
    const r: Record<string, string> = { admin: 'Admin', vendedor: 'Vendedor', domiciliario: 'Domiciliario', despachador: 'Despachador' };
    return rol ? r[rol] ?? rol : '';
  }

  /** Frase corta: "cambió el estado a Entregado", "asignó a Santiago"... */
  descripcion(r: Registro): string {
    if (r.accion !== 'editó' || !r.cambios) return r.accion;
    const c = r.cambios;
    if (r.tabla === 'pedidos') {
      if (c['estado']) return `cambió el estado a ${this.valor('estado', c['estado'].despues)}`;
      if (c['domiciliario_id']) return `asignó a ${this.valor('domiciliario_id', c['domiciliario_id'].despues)}`;
      if (c['rotulo_impreso_at']) return 'imprimió el rótulo de';
      if (c['cuadre_id']) return 'incluyó en un cuadre';
    }
    if (r.tabla === 'cuadres' && c['estado']?.despues === 'confirmado') return 'recibió el';
    if (r.tabla === 'productos' && Object.keys(c).length === 1 && c['stock']) {
      return `cambió el stock (${c['stock'].antes} → ${c['stock'].despues}) de`;
    }
    if (r.tabla === 'profiles' && c['role']) return `cambió el rol a ${this.valor('role', c['role'].despues)} de`;
    return 'editó';
  }

  detalles(r: Registro): Cambio[] {
    if (!r.cambios) return [];
    const salida: Cambio[] = [];
    for (const [campo, v] of Object.entries(r.cambios)) {
      if (OCULTOS.has(campo)) continue;
      if (r.accion === 'editó') {
        salida.push({ campo: CAMPOS[campo] ?? campo, antes: this.valor(campo, v?.antes), despues: this.valor(campo, v?.despues) });
      } else if (v !== null && v !== '' && CAMPOS[campo]) {
        salida.push({ campo: CAMPOS[campo], antes: '', despues: this.valor(campo, v) });
      }
    }
    return salida;
  }

  private valor(campo: string, v: any): string {
    if (v === null || v === undefined || v === '') return '—';
    if (PERSONAS.has(campo)) return this.nombres.get(v) ?? 'Usuario';
    if (DINERO.has(campo)) return Number(v).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    if (FECHAS.has(campo)) return this.fechaHora(v);
    if (campo === 'estado') {
      const e: Record<string, string> = { pendiente: 'Pendiente', en_ruta: 'En ruta', entregado: 'Entregado', cancelado: 'Cancelado', confirmado: 'Recibido' };
      return e[v] ?? v;
    }
    if (campo === 'role') return this.etiquetaRol(v);
    if (campo === 'imagen_url' || campo === 'comprobante_url') return 'archivo';
    if (campo === 'cuadre_id') return 'asignado';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    return String(v);
  }

  fechaHora(iso: string): string {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    });
  }

  hora(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  }
}
