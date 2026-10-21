/** "Negro · Talla M" (vacío si la línea no lleva color ni talla) */
export function variante(i: { color?: string | null; talla?: string | null }): string {
  return [i.color, i.talla ? 'Talla ' + i.talla : null].filter(Boolean).join(' · ');
}

/** "Camiseta (Negro · Talla M)" o solo el nombre */
export function nombreConVariante(nombre: string, i: { color?: string | null; talla?: string | null }): string {
  const v = variante(i);
  return v ? `${nombre} (${v})` : nombre;
}
