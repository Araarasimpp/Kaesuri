/**
 * Celular: las hojas (detalle del pedido, editar producto, etc.) se cierran
 * arrastrándolas hacia abajo desde su encabezado, como en las apps de iPhone.
 * Todas las hojas tienen el mismo armado: <button class="velo"> seguido de
 * <… class="hoja"> con un <div class="hoja-head">; al soltar abajo se toca el
 * velo, que es lo que ya cierra cada hoja.
 */
export function activarArrastreDeHojas(): () => void {
  let hoja: HTMLElement | null = null;
  let velo: HTMLElement | null = null;
  let y0 = 0;
  let t0 = 0;
  let dy = 0;
  let arrastrando = false;

  const inicio = (e: TouchEvent): void => {
    if (window.innerWidth > 760 || e.touches.length !== 1) return;
    const head = (e.target as Element | null)?.closest?.('.hoja-head');
    const h = head?.closest('.hoja') as HTMLElement | null;
    const v = h?.previousElementSibling as HTMLElement | null;
    if (!h || !v?.classList.contains('velo')) return;
    hoja = h;
    velo = v;
    y0 = e.touches[0].clientY;
    t0 = performance.now();
    dy = 0;
    arrastrando = false;
  };

  const mover = (e: TouchEvent): void => {
    if (!hoja) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (!arrastrando && dy < 6) return;
    arrastrando = true;
    hoja.style.transition = 'none';
    hoja.style.animation = 'none';
    hoja.style.transform = `translate3d(0, ${dy}px, 0)`;
    if (velo) velo.style.opacity = String(Math.max(0, 1 - dy / 500));
  };

  const fin = (): void => {
    const h = hoja;
    const v = velo;
    hoja = velo = null;
    if (!h || !arrastrando) return;
    const rapido = dy / Math.max(performance.now() - t0, 1) > 0.6;
    h.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    if (dy > 110 || (rapido && dy > 30)) {
      h.style.transform = 'translate3d(0, 100%, 0)';
      if (v) {
        v.style.transition = 'opacity 220ms ease';
        v.style.opacity = '0';
      }
      setTimeout(() => v?.click(), 200);
    } else {
      h.style.transform = '';
      if (v) v.style.opacity = '';
      setTimeout(() => (h.style.transition = ''), 240);
    }
  };

  document.addEventListener('touchstart', inicio, { passive: true });
  document.addEventListener('touchmove', mover, { passive: true });
  document.addEventListener('touchend', fin, { passive: true });
  document.addEventListener('touchcancel', fin, { passive: true });
  return () => {
    document.removeEventListener('touchstart', inicio);
    document.removeEventListener('touchmove', mover);
    document.removeEventListener('touchend', fin);
    document.removeEventListener('touchcancel', fin);
  };
}
