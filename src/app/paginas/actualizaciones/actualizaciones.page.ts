import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SupabaseService, UserRole, rolesDe } from '../../core/services/supabase.service';
import { formatoFechaCO } from '../../shared/fecha-colombia';
import { SkeletonComponent } from '../../shared/skeleton/skeleton.component';

interface Seccion { titulo: string; texto?: string; pasos?: string[]; puntos?: string[] }
interface Novedad {
  id: string;
  fecha: string;
  titulo: string;
  cuerpo: string;
  roles?: UserRole[];
  secciones?: Seccion[];
  enlace?: { texto: string; url: string };
}

/**
 * Todo lo nuevo de la app, explicado: para qué sirve, cómo se usa y qué tener en
 * cuenta. Sale de assets/novedades.json: para anunciar algo nuevo basta con agregarlo ahí.
 */
@Component({
  selector: 'app-actualizaciones',
  standalone: true,
  imports: [SkeletonComponent, RouterLink],
  host: { class: 'jt' },
  styleUrls: ['../../shared/jasta-tablero.scss'],
  styles: [
    `
      .page { max-width: 760px; }
      .lista { display: flex; flex-direction: column; gap: 14px; }
      .nov { padding: 18px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); scroll-margin-top: 80px; }
      .nov.sel { border-color: var(--oro); box-shadow: 0 0 0 3px var(--oro-wash); }
      .cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--text-muted); }
      .nuevo { padding: 2px 8px; border-radius: 999px; background: var(--oro-wash); color: var(--oro-texto); font-weight: 700; font-size: 11.5px; }
      h2 { margin: 6px 0 6px; font-size: 18px; line-height: 1.3; }
      .resumen { margin: 0; font-size: 14.5px; line-height: 1.5; color: var(--text-soft); }
      h3 { margin: 16px 0 6px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-muted); }
      p.txt { margin: 0; font-size: 14.5px; line-height: 1.55; }
      ol, ul { margin: 0; padding-left: 22px; font-size: 14.5px; line-height: 1.55; }
      li + li { margin-top: 4px; }
      .ir { display: inline-flex; margin-top: 14px; }
      .vacio { padding: 30px 16px; text-align: center; color: var(--text-soft); }
    `,
  ],
  template: `
    <div class="page">
      <div class="head">
        <div><p class="fecha">Lo nuevo de la app, explicado</p><h1>Actualizaciones</h1></div>
      </div>
      @if (visibles().length) {
        <div class="lista">
          @for (n of visibles(); track n.id) {
            <article class="nov" [id]="'n-' + n.id" [class.sel]="n.id === elegida()">
              <div class="cab">
                <span>{{ fecha(n.fecha) }}</span>
                @if (esNueva(n)) { <span class="nuevo">Nuevo</span> }
                @if (n.roles?.length) { <span>· Para {{ para(n) }}</span> }
              </div>
              <h2>{{ n.titulo }}</h2>
              <p class="resumen">{{ n.cuerpo }}</p>
              @for (s of n.secciones ?? []; track s.titulo) {
                <h3>{{ s.titulo }}</h3>
                @if (s.texto) { <p class="txt">{{ s.texto }}</p> }
                @if (s.pasos?.length) { <ol>@for (p of s.pasos; track $index) { <li>{{ p }}</li> }</ol> }
                @if (s.puntos?.length) { <ul>@for (p of s.puntos; track $index) { <li>{{ p }}</li> }</ul> }
              }
              @if (n.enlace; as e) { <a class="b ir" [routerLink]="e.url">{{ e.texto }}</a> }
            </article>
          }
        </div>
      } @else {
        @if (cargando()) { <app-skeleton variante="filas" [cantidad]="6"></app-skeleton> } @else { <p class="vacio">{{ 'Todavía no hay actualizaciones.' }}</p> }
      }
    </div>
  `,
})
export class ActualizacionesPage implements OnInit {
  private sb = inject(SupabaseService);
  private route = inject(ActivatedRoute);

  todas = signal<Novedad[]>([]);
  cargando = signal(true);
  elegida = signal<string | null>(null);

  /** Cada quien ve las de todo el equipo y las de sus roles (el admin, todas) */
  private roles = signal<UserRole[]>([]);
  visibles = computed(() => {
    const mios = this.roles();
    const admin = mios.includes('admin');
    return this.todas().filter((n) => admin || !n.roles?.length || n.roles.some((r) => mios.includes(r)));
  });

  async ngOnInit(): Promise<void> {
    this.elegida.set(this.route.snapshot.queryParamMap.get('n'));
    void this.sb.getCurrentProfile().then((p) => this.roles.set(p ? rolesDe(p) : []));
    try {
      const r = await fetch('assets/novedades.json?v=' + Date.now(), { cache: 'no-store' });
      this.todas.set((await r.json()) as Novedad[]);
    } catch {
      /* sin internet */
    }
    this.cargando.set(false);
    const id = this.elegida();
    if (id) setTimeout(() => document.getElementById('n-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  esNueva(n: Novedad): boolean {
    return Date.now() - new Date(n.fecha + 'T12:00:00-05:00').getTime() < 7 * 864e5;
  }

  para(n: Novedad): string {
    const nombres: Record<UserRole, string> = {
      admin: 'admins', vendedor: 'vendedores', domiciliario: 'domiciliarios', despachador: 'despacho',
      venta_local: 'venta en local', recolector: 'recolectores',
    };
    return (n.roles ?? []).map((r) => nombres[r] ?? r).join(', ');
  }

  fecha(f: string): string {
    return formatoFechaCO(f + 'T12:00:00-05:00', { weekday: 'long', day: 'numeric', month: 'long' });
  }
}
