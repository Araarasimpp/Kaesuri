// Reglas de contraseña de la app (las mismas que se configuran en Supabase Auth).
export const REGLA_CLAVE = 'Mínimo 8 caracteres, con letras y números';

export function problemaClave(clave: string, correo = ''): string {
  if (clave.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[a-zA-ZñÑ]/.test(clave) || !/\d/.test(clave)) return 'La contraseña debe tener letras y números.';
  const usuario = correo.split('@')[0]?.toLowerCase();
  if (usuario && usuario.length >= 4 && clave.toLowerCase().includes(usuario)) return 'La contraseña no puede contener tu correo.';
  if (/^(.)\1+$/.test(clave) || /12345678|password|contraseña|jyb123|qwerty/i.test(clave)) return 'Esa contraseña es muy fácil de adivinar.';
  return '';
}
