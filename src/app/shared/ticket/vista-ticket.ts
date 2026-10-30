// Vista del ticket dentro de la app (sin abrir otra ventana: en el iPhone con la app instalada,
// una ventana nueva se devuelve a la app y no deja imprimir).
// Muestra el ticket como imagen y deja compartirlo (imprimir por AirPrint, la app de la impresora,
// WhatsApp…) o imprimirlo con la impresión del celular.

const ESTILO = `
#vista-ticket { position: fixed; inset: 0; z-index: 99999; display: flex; flex-direction: column; align-items: center; gap: 14px;
  padding: calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom)); background: rgba(15, 23, 42, .72); overflow-y: auto; }
#vista-ticket .papel { width: min(320px, 100%); flex-shrink: 0; background: #fff; border-radius: 6px; box-shadow: 0 12px 40px rgba(0, 0, 0, .35); }
#vista-ticket img { display: block; width: 100%; height: auto; }
#vista-ticket .acciones { width: min(320px, 100%); display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
#vista-ticket button { height: 48px; border: 0; border-radius: 12px; font: 600 15px system-ui, -apple-system, sans-serif; cursor: pointer; }
#vista-ticket .pri { background: #0f7a5c; color: #fff; }
#vista-ticket .sec { background: #fff; color: #0f172a; }
#vista-ticket .ayuda { margin: 0; color: #e2e8f0; font: 13px/1.4 system-ui, -apple-system, sans-serif; text-align: center; }
@media print {
  @page { size: 58mm auto; margin: 0; }
  body > *:not(#vista-ticket) { display: none !important; }
  #vista-ticket { position: static; padding: 0; background: none; overflow: visible; }
  #vista-ticket .acciones, #vista-ticket .ayuda { display: none !important; }
  #vista-ticket .papel { width: 58mm; box-shadow: none; border-radius: 0; }
}`;

export function mostrarTicket(png: Blob, nombre: string): void {
  document.getElementById('vista-ticket')?.remove();
  const url = URL.createObjectURL(png);
  const archivo = new File([png], nombre, { type: 'image/png' });
  const puedeCompartir = !!navigator.canShare?.({ files: [archivo] });
  const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const raiz = document.createElement('div');
  raiz.id = 'vista-ticket';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-label', 'Ticket de la venta');
  raiz.innerHTML = `<style>${ESTILO}</style>
    <div class="papel"><img alt="Ticket de la venta" /></div>
    <div class="acciones">
      ${puedeCompartir ? '<button type="button" class="pri" data-a="compartir">Compartir / imprimir</button>' : ''}
      <button type="button" class="${puedeCompartir ? 'sec' : 'pri'}" data-a="imprimir">Imprimir con el celular</button>
      <button type="button" class="sec" data-a="cerrar">Cerrar</button>
    </div>
    ${puedeCompartir ? '<p class="ayuda">En "Compartir" eliges Imprimir (AirPrint), la app de tu impresora, o lo mandas por WhatsApp.</p>' : ''}
    ${iphone ? '<p class="ayuda">En iPhone no se puede imprimir por Bluetooth (solo en Android). Sirve una impresora con AirPrint; o compártelo a la app de tu impresora.</p>' : ''}`;
  raiz.querySelector('img')!.src = url;

  const cerrar = () => {
    raiz.remove();
    URL.revokeObjectURL(url);
    removeEventListener('keydown', tecla);
  };
  const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar();
  addEventListener('keydown', tecla);

  raiz.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.dataset['a'];
    if (e.target === raiz || a === 'cerrar') cerrar();
    else if (a === 'imprimir') print();
    else if (a === 'compartir') void navigator.share({ files: [archivo], title: nombre }).catch(() => undefined);
  });
  document.body.appendChild(raiz);
}
