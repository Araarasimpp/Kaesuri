/** Enlace para abrir WhatsApp con el cliente (números colombianos de 10 dígitos llevan el 57) */
export function enlaceWhatsapp(telefono: string | null | undefined, mensaje = ''): string {
  const n = (telefono ?? '').replace(/\D/g, '');
  const num = n.length === 10 ? '57' + n : n;
  return `https://wa.me/${num}${mensaje ? '?text=' + encodeURIComponent(mensaje) : ''}`;
}

/** "a", "a y b", "a, b y c" */
export function enLista(cosas: string[]): string {
  if (cosas.length <= 1) return cosas[0] ?? '';
  return cosas.slice(0, -1).join(', ') + ' y ' + cosas[cosas.length - 1];
}

/**
 * Mensaje de seguimiento para el cliente (Clientes → Escribir por WhatsApp):
 * pregunta cómo le fue con lo que compró. Copiado de Jasta, con el nombre de Variedades JYB.
 */
export function mensajeSeguimiento(nombre: string, productos: string[]): string {
  const unicos = [...new Set(productos.map((p) => p.trim()).filter(Boolean))];
  const pedido = unicos.length ? enLista(unicos) : 'tu última compra';
  return `Hola ${nombre.trim()}, te hablamos de Variedades JYB. ¿Cómo te fue con tu pedido de ${pedido}?`;
}
