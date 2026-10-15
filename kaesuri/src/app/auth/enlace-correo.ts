// Enlaces que manda Supabase por correo (recuperar contraseña, enlace mágico).
// Llegan con los datos en el "#" de la URL: #access_token=...&type=recovery
// o, si vencieron, #error=...&error_description=...
// Supabase lee la sesión por su cuenta (detectSessionInUrl); aquí solo se anota
// a qué pantalla hay que ir, porque Supabase borra el "#" después de leerlo.

const CLAVE_RECUPERAR = 'kaesuri-recuperar-clave';
const CLAVE_ERROR = 'kaesuri-error-enlace';

export function leerEnlaceDeCorreo(): void {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (!hash) return;
  const datos = new URLSearchParams(hash);
  const esRecuperacion = datos.get('type') === 'recovery' && datos.has('access_token');
  const error = datos.get('error_code') || datos.get('error');
  if (!esRecuperacion && !error) return;

  try {
    if (esRecuperacion) sessionStorage.setItem(CLAVE_RECUPERAR, '1');
    if (error) {
      const vencido = error === 'otp_expired' || /expired|invalid/i.test(datos.get('error_description') ?? '');
      sessionStorage.setItem(
        CLAVE_ERROR,
        vencido
          ? 'El enlace del correo ya venció o ya se usó. Pide uno nuevo con "¿Olvidaste tu contraseña?".'
          : 'No se pudo usar el enlace del correo. Pide uno nuevo con "¿Olvidaste tu contraseña?".'
      );
    }
  } catch {
    // sin almacenamiento disponible: se sigue normal
  }

  // El enlace siempre entra por el inicio para que app-init decida a dónde ir.
  if (window.location.pathname !== '/') {
    history.replaceState(null, '', '/' + window.location.hash);
  }
}

export function vieneDeRecuperacion(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_RECUPERAR) === '1';
  } catch {
    return false;
  }
}

export function terminarRecuperacion(): void {
  try {
    sessionStorage.removeItem(CLAVE_RECUPERAR);
  } catch {
    // nada
  }
}

/** Mensaje de un enlace vencido o inválido (se lee una sola vez). */
export function tomarErrorDeEnlace(): string | null {
  try {
    const msg = sessionStorage.getItem(CLAVE_ERROR);
    sessionStorage.removeItem(CLAVE_ERROR);
    return msg;
  } catch {
    return null;
  }
}

export function hayErrorDeEnlace(): boolean {
  try {
    return !!sessionStorage.getItem(CLAVE_ERROR);
  } catch {
    return false;
  }
}
