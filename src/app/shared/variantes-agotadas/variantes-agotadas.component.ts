import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { SupabaseService } from '../../core/services/supabase.service';
import { mensajeError } from '../formato';

interface ColorVar { nombre: string; hex: string | null; disponible: boolean }

/**
 * Marcar colores y tallas agotados de un producto: dejan de salir en el catálogo y no se pueden
 * pedir. Se tocan para pasar de "Hay" a "Agotado" y viceversa.
 */
@Component({
  selector: 'app-variantes-agotadas',
  standalone: true,
  styles: [
    `
      .grupo { display: flex; flex-direction: column; gap: 8px; }
      .grupo h3 { margin: 0; font-size: 13px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }
      .ops { display: flex; flex-wrap: wrap; gap: 8px; }
      .op { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 6px 12px; border: 1px solid var(--border-strong); border-radius: 999px;
        background: var(--surface); color: var(--text); font: inherit; font-size: 14px; cursor: pointer; }
      .op i { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(0,0,0,.15); flex-shrink: 0; }
      .op small { font-size: 11.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--ok-wash); color: var(--efectivo-texto); }
      .op.agotado { border-style: dashed; color: var(--text-muted); background: var(--surface-2); }
      .op.agotado span { text-decoration: line-through; }
      .op.agotado small { background: var(--danger-wash); color: var(--danger); }
      .resumen { margin: 0; font-size: 13.5px; color: var(--text-soft); }
    `,
  ],
  template: `
    <button class="velo" aria-label="Cerrar" (click)="cerrar.emit()"></button>
    <div class="hoja hoja-centro" role="dialog" aria-labelledby="t-var">
      <div class="hoja-head"><h2 id="t-var">Colores y tallas · {{ nombre }}</h2></div>
      <div class="hoja-body">
        <p class="ayuda" style="margin: 0">Toca un color o una talla para marcarlo como <strong>agotado</strong>. Deja de salir en el catálogo y no se puede pedir hasta que lo vuelvas a marcar como disponible.</p>
        @if (cargando()) {
          <p class="resumen">Cargando…</p>
        } @else {
          @if (colores().length) {
            <div class="grupo">
              <h3>Colores</h3>
              <div class="ops">
                @for (c of colores(); track c.nombre; let i = $index) {
                  <button type="button" class="op" [class.agotado]="!c.disponible" [attr.aria-pressed]="!c.disponible" (click)="alternarColor(i)">
                    <i [style.background]="c.hex || '#ccc'"></i><span>{{ c.nombre }}</span><small>{{ c.disponible ? 'Hay' : 'Agotado' }}</small>
                  </button>
                }
              </div>
            </div>
          }
          @if (tallas().length) {
            <div class="grupo">
              <h3>Tallas</h3>
              <div class="ops">
                @for (t of tallas(); track t) {
                  <button type="button" class="op" [class.agotado]="agotadas().has(t)" [attr.aria-pressed]="agotadas().has(t)" (click)="alternarTalla(t)">
                    <span>{{ t }}</span><small>{{ agotadas().has(t) ? 'Agotada' : 'Hay' }}</small>
                  </button>
                }
              </div>
            </div>
          }
          @if (!colores().length && !tallas().length) { <p class="resumen">Este producto no tiene colores ni tallas. Se agregan en Productos.</p> }
          @if (todoAgotado()) { <p class="error" style="margin: 0">Con todo agotado, el producto sale como agotado en el catálogo.</p> }
        }
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </div>
      <div class="hoja-pie">
        <button class="b" (click)="cerrar.emit()">Cancelar</button>
        <button class="b b-pri" [disabled]="guardando() || cargando()" (click)="guardar()">{{ guardando() ? 'Guardando…' : 'Guardar' }}</button>
      </div>
    </div>
  `,
})
export class VariantesAgotadasComponent implements OnInit {
  @Input({ required: true }) productoId!: string;
  @Input() nombre = '';
  @Output() cerrar = new EventEmitter<void>();
  @Output() guardado = new EventEmitter<number>();
  private sb = inject(SupabaseService);

  colores = signal<ColorVar[]>([]);
  tallas = signal<string[]>([]);
  agotadas = signal<Set<string>>(new Set());
  cargando = signal(true);
  guardando = signal(false);
  error = signal('');
  todoAgotado = computed(() => {
    const c = this.colores();
    const t = this.tallas();
    return (c.length > 0 && c.every((x) => !x.disponible)) || (t.length > 0 && t.every((x) => this.agotadas().has(x)));
  });

  async ngOnInit(): Promise<void> {
    const { data, error } = await this.sb.client
      .from('productos')
      .select('tallas, tallas_agotadas, colores:producto_colores(nombre, hex, disponible, orden, id)')
      .eq('id', this.productoId)
      .single();
    this.cargando.set(false);
    if (error) return this.error.set(mensajeError(error));
    const d = data as { tallas: string[] | null; tallas_agotadas: string[] | null; colores: (ColorVar & { orden: number; id: number })[] };
    this.colores.set([...(d.colores ?? [])].sort((a, b) => a.orden - b.orden || a.id - b.id).map((c) => ({ nombre: c.nombre, hex: c.hex, disponible: c.disponible !== false })));
    this.tallas.set(d.tallas ?? []);
    this.agotadas.set(new Set(d.tallas_agotadas ?? []));
  }

  alternarColor(i: number): void {
    this.colores.update((l) => l.map((c, j) => (j === i ? { ...c, disponible: !c.disponible } : c)));
  }

  alternarTalla(t: string): void {
    this.agotadas.update((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    const colAg = this.colores().filter((c) => !c.disponible).map((c) => c.nombre);
    const talAg = this.tallas().filter((t) => this.agotadas().has(t));
    const { error } = await this.sb.client.rpc('guardar_variantes_agotadas', { p_producto: this.productoId, p_colores_agotados: colAg, p_tallas_agotadas: talAg });
    this.guardando.set(false);
    if (error) return this.error.set(mensajeError(error));
    this.guardado.emit(colAg.length + talAg.length);
  }
}
