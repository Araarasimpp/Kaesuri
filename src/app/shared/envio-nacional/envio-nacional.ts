/** Transportadoras para envíos a otras ciudades y la página donde el cliente rastrea su guía */
export const TRANSPORTADORAS: { nombre: string; rastreo: string }[] = [
  { nombre: 'Servientrega', rastreo: 'https://www.servientrega.com/wps/portal/rastreo-envio' },
  { nombre: 'Interrapidísimo', rastreo: 'https://www.interrapidisimo.com/sigue-tu-envio/' },
  { nombre: 'Coordinadora', rastreo: 'https://coordinadora.com/rastreo/rastreo-de-guia/' },
  { nombre: 'Envía', rastreo: 'https://envia.co/' },
  { nombre: 'TCC', rastreo: 'https://www.tcc.com.co/' },
  { nombre: 'Otra', rastreo: '' },
];

export function urlRastreo(transportadora: string | null | undefined): string {
  return TRANSPORTADORAS.find((t) => t.nombre === transportadora)?.rastreo ?? '';
}

export const DEPARTAMENTOS = [
  'Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bogotá D.C.', 'Bolívar', 'Boyacá', 'Caldas', 'Caquetá', 'Casanare', 'Cauca', 'Cesar',
  'Chocó', 'Córdoba', 'Cundinamarca', 'Guainía', 'Guaviare', 'Huila', 'La Guajira', 'Magdalena', 'Meta', 'Nariño', 'Norte de Santander',
  'Putumayo', 'Quindío', 'Risaralda', 'San Andrés y Providencia', 'Santander', 'Sucre', 'Tolima', 'Valle del Cauca', 'Vaupés', 'Vichada',
];

/** Mensaje para el cliente cuando su paquete sale */
export function mensajeGuia(p: { numero: number; cliente_nombre: string; transportadora?: string | null; guia?: string | null; destino_ciudad?: string | null }): string {
  const nombre = (p.cliente_nombre || '').split(' ')[0];
  const url = urlRastreo(p.transportadora);
  return `Hola ${nombre}, tu pedido #${p.numero} ya salió por ${p.transportadora ?? 'la transportadora'} hacia ${p.destino_ciudad ?? 'tu ciudad'}. `
    + `Tu número de guía es ${p.guia ?? ''}.${url ? ` Puedes rastrearlo aquí: ${url}` : ''} ¡Gracias por tu compra!`;
}
