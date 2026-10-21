// src/app/shared/dialogo.ts
// Reemplazo de confirm() y alert() del navegador por ventanas propias con el
// estilo de la app. Son funciones sueltas (no hace falta inyectar nada):
//
//   if (!(await confirmar('¿Eliminar este producto?', { peligro: true }))) return;
//   avisar('Pedido creado con éxito');
//
// Se dibujan directamente en <body>, así que funcionan desde cualquier página.

export interface OpcionesConfirmar {
  titulo?: string;
  aceptar?: string;
  cancelar?: string;
  /** Pinta el botón de aceptar en rojo (acciones destructivas). */
  peligro?: boolean;
}

const ESTILOS_ID = 'k-dialogo-estilos';

function asegurarEstilos(): void {
  if (document.getElementById(ESTILOS_ID)) return;
  const style = document.createElement('style');
  style.id = ESTILOS_ID;
  style.textContent = `
    .k-dialogo-fondo {
      position: fixed; inset: 0; z-index: 10000;
      background: var(--k-overlay, rgba(22,22,26,.45));
      display: flex; align-items: center; justify-content: center;
      padding: 20px; box-sizing: border-box;
      animation: k-dialogo-entrar .14s ease-out;
    }
    .k-dialogo {
      width: 100%; max-width: 400px;
      background: var(--k-card-bg, #fff); color: var(--k-text, #16161a);
      border: 1px solid var(--k-border, #e6e6ea); border-radius: 14px;
      box-shadow: var(--k-shadow-lg, 0 16px 40px rgba(22,22,26,.16));
      font-family: var(--k-font, system-ui, sans-serif);
      padding: 20px; box-sizing: border-box;
    }
    .k-dialogo h2 { margin: 0 0 6px; font-size: 17px; font-weight: 700; }
    .k-dialogo p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--k-text-soft, #5b5b66); white-space: pre-line; }
    .k-dialogo-acciones { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
    .k-dialogo button {
      height: 40px; padding: 0 16px; border-radius: 8px; font-size: 14px; font-weight: 600;
      font-family: inherit; cursor: pointer;
    }
    .k-dialogo .k-btn-cancelar { border: 1px solid var(--k-border-strong, #d9d9df); background: var(--k-card-bg, #fff); color: var(--k-text, #16161a); }
    .k-dialogo .k-btn-aceptar { border: none; background: var(--k-role, #0f7b5f); color: var(--k-on-role, #fff); }
    .k-dialogo .k-btn-aceptar.peligro { background: var(--k-coral, #b91c1c); color: #fff; }
    @media (max-width: 480px) {
      .k-dialogo-fondo { align-items: flex-end; padding: 12px; }
      .k-dialogo-acciones button { flex: 1; height: 44px; }
    }
    @keyframes k-dialogo-entrar { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .k-dialogo-fondo { animation: none; } }
  `;
  document.head.appendChild(style);
}

function abrir(mensaje: string, conCancelar: boolean, op: OpcionesConfirmar = {}): Promise<boolean> {
  asegurarEstilos();
  return new Promise((resolve) => {
    const anterior = document.activeElement as HTMLElement | null;
    const fondo = document.createElement('div');
    fondo.className = 'k-dialogo-fondo';

    const caja = document.createElement('div');
    caja.className = 'k-dialogo';
    caja.setAttribute('role', conCancelar ? 'alertdialog' : 'dialog');
    caja.setAttribute('aria-modal', 'true');

    const titulo = document.createElement('h2');
    titulo.id = 'k-dialogo-titulo-' + Date.now();
    titulo.textContent = op.titulo ?? (conCancelar ? 'Confirmar' : 'Aviso');
    caja.setAttribute('aria-labelledby', titulo.id);

    const texto = document.createElement('p');
    texto.textContent = mensaje;

    const acciones = document.createElement('div');
    acciones.className = 'k-dialogo-acciones';

    const cerrar = (valor: boolean) => {
      document.removeEventListener('keydown', teclas, true);
      fondo.remove();
      anterior?.focus?.();
      resolve(valor);
    };

    const teclas = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cerrar(false);
      }
    };

    if (conCancelar) {
      const btnCancelar = document.createElement('button');
      btnCancelar.type = 'button';
      btnCancelar.className = 'k-btn-cancelar';
      btnCancelar.textContent = op.cancelar ?? 'Cancelar';
      btnCancelar.onclick = () => cerrar(false);
      acciones.appendChild(btnCancelar);
    }

    const btnAceptar = document.createElement('button');
    btnAceptar.type = 'button';
    btnAceptar.className = 'k-btn-aceptar' + (op.peligro ? ' peligro' : '');
    btnAceptar.textContent = op.aceptar ?? (conCancelar ? 'Aceptar' : 'Entendido');
    btnAceptar.onclick = () => cerrar(true);
    acciones.appendChild(btnAceptar);

    caja.append(titulo, texto, acciones);
    fondo.appendChild(caja);
    fondo.addEventListener('click', (e) => {
      if (e.target === fondo) cerrar(false);
    });
    document.addEventListener('keydown', teclas, true);
    document.body.appendChild(fondo);
    btnAceptar.focus();
  });
}

/** Pregunta sí/no. Devuelve true si la persona acepta. */
export function confirmar(mensaje: string, opciones?: OpcionesConfirmar): Promise<boolean> {
  return abrir(mensaje, true, opciones);
}

/** Muestra un aviso con un solo botón. */
export function avisar(mensaje: string, titulo?: string): Promise<boolean> {
  return abrir(mensaje, false, { titulo });
}
