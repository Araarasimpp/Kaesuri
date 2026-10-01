// Núcleo de transformaciones (puro, sin dependencias). Lo usa aplicar-rediseno.mjs.
// Adapta los estilos de las páginas que no se reescribieron a mano al nuevo tema.
function transformScss(src) {
  let s = src;

  // 1) Regla por regla (bloques internos sin llaves anidadas)
  s = s.replace(/([^{}]*)\{([^{}]*)\}/g, (all, sel, body) => {
    let b = body;
    const fondoTinta = /background:\s*var\(--k-ink\)/.test(b);
    const fondoAmbar = /background:\s*var\(--k-amber\)/.test(b);
    if (fondoTinta) {
      // Botones principales y tarjetas destacadas → color del rol
      b = b.replace(/background:\s*var\(--k-ink\)/g, 'background: var(--k-role)');
      b = b.replace(/color:\s*var\(--k-paper\)/g, 'color: var(--k-on-role)');
      b = b.replace(/color:\s*rgba\(247,\s*247,\s*245,\s*([\d.]+)\)/g, 'color: rgba(255, 255, 255, $1)');
    }
    if (fondoTinta) {
      b = b.replace(/border-color:\s*var\(--k-ink\)/g, 'border-color: var(--k-role)');
    }
    // Texto dentro de tarjetas rellenas del color del rol
    if (/destacada/.test(sel)) {
      b = b.replace(/color:\s*var\(--k-amber\)/g, 'color: var(--k-sol)');
      b = b.replace(/color:\s*rgba\((?:247,\s*247,\s*245|255,\s*255,\s*255),\s*0?\.[56]\d*\)/g, 'color: rgba(255, 255, 255, 0.82)');
    }
    // Foco, pestaña activa o selección → color del rol; el resto (alertas) sigue ámbar
    if (/:focus|\.active|activ|selec/.test(sel)) {
      b = b.replace(/border-color:\s*var\(--k-amber\)/g, 'border-color: var(--k-role-ink)');
      b = b.replace(/border-bottom-color:\s*var\(--k-amber\)/g, 'border-bottom-color: var(--k-role-ink)');
    }
    // Enlaces de navegación ("Ver todos") → color del rol, no ámbar
    if (/ver-todos|link|enlace/.test(sel)) {
      b = b.replace(/(^|[;\s{])color:\s*var\(--k-amber\)/g, '$1color: var(--k-role-ink)');
    }
    if (fondoAmbar) {
      // Rellenos ámbar → girasol, con texto oscuro legible
      b = b.replace(/background:\s*var\(--k-amber\)/g, 'background: var(--k-sol)');
      b = b.replace(/color:\s*var\(--k-ink\)/g, 'color: var(--k-on-sol)');
    }
    return sel + '{' + b + '}';
  });

  // 2) Acentos de foco / selección → color del rol
  s = s.replace(/inset 3px 0 0 var\(--k-amber\)/g, 'inset 3px 0 0 var(--k-role)');
  s = s.replace(/border-color:\s*var\(--k-ink\)/g, 'border-color: var(--k-role-ink)');
  s = s.replace(/color:\s*var\(--k-ink\)/g, 'color: var(--k-role-ink)');
  s = s.replace(/background:\s*var\(--k-paper\)/g, 'background: var(--k-card-bg)');
  s = s.replace(/color:\s*var\(--k-paper\)/g, 'color: var(--k-on-role)');

  // 3) Colores sueltos → tokens
  const mapa = [
    [/rgba\(47,\s*143,\s*130,\s*0?\.12\)/g, 'var(--k-teal-soft)'],
    [/rgba\(232,\s*163,\s*61,\s*0?\.15\)/g, 'var(--k-amber-soft)'],
    [/rgba\(232,\s*163,\s*61,\s*0?\.08\)/g, 'var(--k-amber-soft)'],
    [/rgba\(214,\s*95,\s*95,\s*0?\.12\)/g, 'var(--k-coral-soft)'],
    [/rgba\(18,\s*21,\s*28,\s*0?\.08\)/g, 'var(--k-hover)'],
    [/rgba\(18,\s*21,\s*28,\s*0?\.5\)/g, 'var(--k-overlay)'],
    [/0 8px 24px rgba\(18,\s*21,\s*28,\s*0?\.1[25]\)/g, 'var(--k-shadow-md)'],
    [/0 10px 30px rgba\(18,\s*21,\s*28,\s*0?\.35\)/g, 'var(--k-shadow-lg)'],
    [/rgba\(247,\s*247,\s*245,/g, 'rgba(255, 255, 255,'],
    [/#3b82f6\b/gi, 'var(--k-azul-ink)'],
    [/#2563eb\b/gi, 'var(--k-azul)'],
    [/#16a34a\b/gi, 'var(--k-whatsapp)'],
  ];
  for (const [re, val] of mapa) s = s.replace(re, val);

  return s;
}

function transformIndex(html) {
  let h = html;
  if (!/fonts\.googleapis\.com/.test(h)) {
    const fuente =
      '  <link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
      '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
      '  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap" rel="stylesheet" />\n';
    h = h.replace(/<\/head>/i, fuente + '</head>');
  }
  if (!/name="theme-color"/.test(h)) {
    h = h.replace(/<\/head>/i, '  <meta name="theme-color" content="#ffffff" />\n</head>');
  }
  h = h.replace(/<html lang="en">/, '<html lang="es">');
  return h;
}

if (typeof module !== 'undefined') module.exports = { transformScss, transformIndex };
