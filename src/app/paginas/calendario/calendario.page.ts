import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../shared/toast/toast.service';
import { mensajeError, pesos } from '../../shared/formato';
import { confirmar } from '../../shared/dialogo';
import { hoyColombiaISO } from '../../shared/fecha-colombia';
import { FechaEspecial, fechasEntre } from '../../shared/fechas-colombia';

interface Venta { dia: string; pedidos: number; vendido: number; local: number; ganancia: number | null }
interface CajaDia { dia: string; diferencia: number; contado: number; recoger: number; entregado: boolean; recibido: boolean; quien: string | null }
interface Pago { dia: string; tipo: 'vence' | 'pagado' | 'cobrado'; titulo: string; detalle: string | null; valor: number; url: string }
interface Recordatorio { id: number; titulo: string; nota: string | null; hora: string | null; fecha: string; repetir: 'no' | 'semanal' | 'mensual' | 'anual'; equipo: boolean; dia: string; mio: boolean; de: string | null; hecho: boolean }
interface Pendientes { deudas_vencidas: number; comisiones: number; vendedores: number; por_cobrar: number }
interface Datos { admin: boolean; caja: boolean; ventas: Venta[]; cajas: CajaDia[]; pagos: Pago[]; pendientes: Pendientes | null; recordatorios: Recordatorio[] }
interface Celda { dia: string; num: number; delMes: boolean; hoy: boolean; finde: boolean }

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aFecha = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), 12);

/**
 * Calendario (diseño Liquid Glass): ventas de cada día, caja del local, pagos, fechas especiales y
 * festivos de Colombia y recordatorios que avisan al celular.
 */
@Component({
  selector: 'app-calendario',
  standalone: true,
  imports: [FormsModule, RouterLink],
  styleUrls: ['./calendario.page.scss'],
  templateUrl: './calendario.page.html',
})
export class CalendarioPage implements OnInit {
  private sb = inject(SupabaseService);
  /** Área donde está (cada una tiene su prefijo): /admin, /local, /vendedor… */
  private raiz = '/' + inject(Router).url.split(/[/?]/)[1];
  private toast = inject(ToastService);

  pesos = pesos;
  semana = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  hoy = hoyColombiaISO();
  mes = signal(aFecha(this.hoy).getMonth());
  anio = signal(aFecha(this.hoy).getFullYear());
  sel = signal(this.hoy);
  datos = signal<Datos | null>(null);
  cargando = signal(true);
  error = signal('');

  titulo = computed(() => `${MESES[this.mes()]} ${this.anio()}`);

  /** 6 semanas, de lunes a domingo */
  celdas = computed<Celda[]>(() => {
    const primero = new Date(this.anio(), this.mes(), 1, 12);
    const inicio = new Date(this.anio(), this.mes(), 1 - ((primero.getDay() + 6) % 7), 12);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i, 12);
      const s = iso(d);
      return { dia: s, num: d.getDate(), delMes: d.getMonth() === this.mes(), hoy: s === this.hoy, finde: d.getDay() === 0 || d.getDay() === 6 };
    });
  });
  desde = computed(() => this.celdas()[0].dia);
  hasta = computed(() => this.celdas()[41].dia);

  // Todo agrupado por día
  especiales = computed(() => fechasEntre(this.desde(), this.hasta()));
  ventasDia = computed(() => new Map((this.datos()?.ventas ?? []).map((v) => [v.dia, v])));
  cajaDia = computed(() => new Map((this.datos()?.cajas ?? []).map((c) => [c.dia, { ...c, diferencia: Number(c.diferencia) }])));
  pagosDia = computed(() => this.agrupar(this.datos()?.pagos ?? []));
  recDia = computed(() => this.agrupar(this.datos()?.recordatorios ?? []));
  /** Para la intensidad del color de ventas */
  maxVenta = computed(() => Math.max(1, ...(this.datos()?.ventas ?? []).map((v) => Number(v.vendido))));

  /** Fechas comerciales que se vienen (en su ventana de aviso) */
  proximas = computed(() => {
    const hoy = aFecha(this.hoy);
    const fin = iso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 21, 12));
    const out: (FechaEspecial & { faltan: number })[] = [];
    for (const [dia, l] of fechasEntre(this.hoy, fin)) {
      const faltan = Math.round((aFecha(dia).getTime() - hoy.getTime()) / 86400000);
      for (const f of l) if (f.consejo && faltan <= (f.avisar ?? 10)) out.push({ ...f, faltan });
    }
    return out.sort((a, b) => a.faltan - b.faltan).slice(0, 3);
  });
  recHoy = computed(() => (this.recDia().get(this.hoy) ?? []).filter((r) => !r.hecho));

  // Día elegido
  selEspeciales = computed(() => this.especiales().get(this.sel()) ?? []);
  selVenta = computed(() => this.ventasDia().get(this.sel()) ?? null);
  selCaja = computed(() => this.cajaDia().get(this.sel()) ?? null);
  selPagos = computed(() => this.pagosDia().get(this.sel()) ?? []);
  selRec = computed(() => this.recDia().get(this.sel()) ?? []);
  selTitulo = computed(() => {
    const d = aFecha(this.sel());
    const t = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  });

  // Formulario de recordatorio
  form = signal<{ id: number | null } | null>(null);
  fTitulo = '';
  fNota = '';
  fFecha = '';
  fHora = '';
  fRepetir: Recordatorio['repetir'] = 'no';
  fEquipo = false;
  guardando = signal(false);

  ngOnInit(): void {
    void this.cargar();
  }

  private agrupar<T extends { dia: string }>(l: T[]): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const x of l) m.set(x.dia, [...(m.get(x.dia) ?? []), x]);
    return m;
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    const { data, error } = await this.sb.client.rpc('calendario', { p_desde: this.desde(), p_hasta: this.hasta() });
    this.cargando.set(false);
    if (error) {
      this.error.set(mensajeError(error));
      return;
    }
    this.error.set('');
    this.datos.set(data as Datos);
  }

  mover(n: number): void {
    const d = new Date(this.anio(), this.mes() + n, 1, 12);
    this.mes.set(d.getMonth());
    this.anio.set(d.getFullYear());
    this.sel.set(iso(d));
    void this.cargar();
  }

  irHoy(): void {
    const d = aFecha(this.hoy);
    const cambia = d.getMonth() !== this.mes() || d.getFullYear() !== this.anio();
    this.mes.set(d.getMonth());
    this.anio.set(d.getFullYear());
    this.sel.set(this.hoy);
    if (cambia) void this.cargar();
  }

  elegir(c: Celda): void {
    if (!c.delMes) {
      const d = aFecha(c.dia);
      this.mes.set(d.getMonth());
      this.anio.set(d.getFullYear());
      void this.cargar();
    }
    this.sel.set(c.dia);
    setTimeout(() => document.getElementById('cal-dia')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  /** Intensidad 0-4 del color de ventas del día */
  nivel(dia: string): number {
    const v = this.ventasDia().get(dia);
    if (!v || !Number(v.vendido)) return 0;
    return Math.max(1, Math.ceil((Number(v.vendido) / this.maxVenta()) * 4));
  }

  estadoCaja(dia: string): '' | 'ok' | 'falta' | 'sobra' {
    const c = this.cajaDia().get(dia);
    if (!c) return '';
    return c.diferencia === 0 ? 'ok' : c.diferencia < 0 ? 'falta' : 'sobra';
  }

  festivo(dia: string): boolean {
    return (this.especiales().get(dia) ?? []).some((f) => f.tipo === 'festivo');
  }
  comercial(dia: string): boolean {
    return (this.especiales().get(dia) ?? []).some((f) => f.tipo === 'comercial');
  }
  quincena(dia: string): boolean {
    return (this.especiales().get(dia) ?? []).some((f) => f.tipo === 'pago');
  }
  hayPago(dia: string): string {
    const l = this.pagosDia().get(dia);
    if (!l) return '';
    return l.some((p) => p.tipo === 'vence') ? 'vence' : 'pagado';
  }
  hayRec(dia: string): boolean {
    return (this.recDia().get(dia) ?? []).some((r) => !r.hecho);
  }

  faltanTxt(n: number): string {
    return n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`;
  }

  repetirTxt(r: Recordatorio): string {
    return { no: '', semanal: 'Cada semana', mensual: 'Cada mes', anual: 'Cada año' }[r.repetir];
  }

  horaTxt(h: string | null): string {
    if (!h) return '';
    const [hh, mm] = h.split(':').map(Number);
    return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'a. m.' : 'p. m.'}`;
  }

  // ------------------------------------------------------------- Recordatorios
  nuevo(): void {
    this.fTitulo = '';
    this.fNota = '';
    this.fFecha = this.sel();
    this.fHora = '';
    this.fRepetir = 'no';
    this.fEquipo = false;
    this.form.set({ id: null });
  }

  editar(r: Recordatorio): void {
    this.fTitulo = r.titulo;
    this.fNota = r.nota ?? '';
    this.fFecha = r.fecha;
    this.fHora = r.hora ?? '';
    this.fRepetir = r.repetir;
    this.fEquipo = r.equipo;
    this.form.set({ id: r.id });
  }

  async guardar(): Promise<void> {
    if (!this.fTitulo.trim()) return this.toast.error('Escribe qué hay que recordar');
    if (!this.fFecha) return this.toast.error('Elige el día');
    this.guardando.set(true);
    const { error } = await this.sb.client.rpc('guardar_recordatorio', {
      p_id: this.form()?.id ?? null, p_titulo: this.fTitulo.trim(), p_nota: this.fNota.trim(), p_fecha: this.fFecha,
      p_hora: this.fHora || null, p_repetir: this.fRepetir, p_equipo: this.fEquipo,
    });
    this.guardando.set(false);
    if (error) return this.toast.error(mensajeError(error));
    this.toast.ok(this.form()?.id ? 'Recordatorio actualizado' : 'Recordatorio creado: te avisamos ese día');
    this.form.set(null);
    await this.cargar();
  }

  async borrar(r: Recordatorio): Promise<void> {
    if (!(await confirmar(`¿Borrar "${r.titulo}"${r.repetir !== 'no' ? ' (todas las veces que se repite)' : ''}?`, { peligro: true }))) return;
    const { error } = await this.sb.client.rpc('borrar_recordatorio', { p_id: r.id });
    if (error) return this.toast.error(mensajeError(error));
    this.form.set(null);
    await this.cargar();
  }

  async marcar(r: Recordatorio): Promise<void> {
    const hecho = !r.hecho;
    // Se ve al instante; si falla, se recarga
    this.datos.update((d) => d && { ...d, recordatorios: d.recordatorios.map((x) => (x.id === r.id && x.dia === r.dia ? { ...x, hecho } : x)) });
    const { error } = await this.sb.client.rpc('marcar_recordatorio', { p_id: r.id, p_dia: r.dia, p_hecho: hecho });
    if (error) {
      this.toast.error(mensajeError(error));
      await this.cargar();
    }
  }

  /** Enlace a una sección dentro del área; en Venta local, las ventas son su inicio */
  ruta(seccion: string): string {
    return this.raiz === '/local' && seccion === 'ventas-local' ? '/local' : `${this.raiz}/${seccion}`;
  }
}
