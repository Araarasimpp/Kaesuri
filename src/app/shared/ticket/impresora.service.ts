import { Injectable, signal } from '@angular/core';

// Servicios BLE que usan las impresoras térmicas baratas (Goojprt PT-210, MTP-II, "BlueTooth Printer"…)
const SERVICIOS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
];
/** Bytes por envío: 20 cabe en cualquier conexión BLE, aunque no se haya negociado un paquete más grande */
const TROZO = 20;
const CLAVE_RAWBT = 'jyb-ticket-rawbt';

/* Tipos mínimos de Web Bluetooth (no vienen en lib.dom) */
interface Caracteristica {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse?(v: BufferSource): Promise<void>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue(v: BufferSource): Promise<void>;
}
interface Dispositivo {
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<Servidor>; disconnect(): void };
  addEventListener(t: 'gattserverdisconnected', f: () => void): void;
}
interface Servidor { getPrimaryServices(): Promise<{ getCharacteristics(): Promise<Caracteristica[]> }[]> }
interface Bluetooth { requestDevice(o: object): Promise<Dispositivo>; getAvailability?(): Promise<boolean> }

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Impresora de tickets por Bluetooth desde el celular.
 * - Android con Chrome (o la app instalada): se conecta directo por Bluetooth (BLE).
 * - Si la impresora solo tiene Bluetooth clásico, o el navegador no tiene Bluetooth: se manda a la
 *   app RawBT (Android, gratis), que sí habla con esas impresoras.
 * - iPhone: Safari no permite Bluetooth en páginas web; queda la vista previa (o el navegador Bluefy).
 */
@Injectable({ providedIn: 'root' })
export class ImpresoraService {
  readonly nombre = signal<string | null>(null);
  readonly conectada = signal(false);
  /** Usar siempre RawBT (la impresora es de Bluetooth clásico) */
  readonly usarRawbt = signal(leer(CLAVE_RAWBT) === '1');

  private disp: Dispositivo | null = null;
  private car: Caracteristica | null = null;

  get bluetooth(): Bluetooth | null {
    return (navigator as unknown as { bluetooth?: Bluetooth }).bluetooth ?? null;
  }
  get esAndroid(): boolean {
    return /android/i.test(navigator.userAgent);
  }
  get esIphone(): boolean {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  ponerRawbt(v: boolean): void {
    this.usarRawbt.set(v);
    try { localStorage.setItem(CLAVE_RAWBT, v ? '1' : '0'); } catch { /* sin almacenamiento */ }
  }

  /** Imprime los bytes ESC/POS. Debe llamarse desde un toque (el navegador lo exige para elegir la impresora). */
  async imprimir(bytes: Uint8Array): Promise<'bluetooth' | 'rawbt'> {
    if (this.usarRawbt() || !this.bluetooth) {
      if (!this.esAndroid) throw new Error(this.esIphone
        ? 'En iPhone el navegador no deja usar Bluetooth. Usa "Ver ticket" o abre la app en el navegador Bluefy.'
        : 'Este navegador no tiene Bluetooth. Usa Chrome en Android.');
      this.rawbt(bytes);
      return 'rawbt';
    }
    const car = await this.caracteristica();
    const conRespuesta = car.properties.write;
    for (let i = 0; i < bytes.length; i += TROZO) {
      const trozo = bytes.slice(i, i + TROZO);
      if (conRespuesta) await (car.writeValueWithResponse ? car.writeValueWithResponse(trozo) : car.writeValue(trozo));
      else { await (car.writeValueWithoutResponse ? car.writeValueWithoutResponse(trozo) : car.writeValue(trozo)); await esperar(8); }
    }
    return 'bluetooth';
  }

  /** Elige y conecta la impresora (si hace falta) antes de armar el ticket: el navegador solo deja
   *  abrir la lista de impresoras justo después de un toque */
  async preparar(): Promise<void> {
    if (!this.usarRawbt() && this.bluetooth) await this.caracteristica();
  }

  olvidar(): void {
    try { this.disp?.gatt?.disconnect(); } catch { /* ya estaba desconectada */ }
    this.disp = null;
    this.car = null;
    this.nombre.set(null);
    this.conectada.set(false);
  }

  private async caracteristica(): Promise<Caracteristica> {
    if (this.car && this.disp?.gatt?.connected) return this.car;
    if (!this.disp) {
      try {
        this.disp = await this.bluetooth!.requestDevice({ acceptAllDevices: true, optionalServices: SERVICIOS });
      } catch (e) {
        if ((e as Error)?.name === 'NotFoundError') throw new Error('No elegiste ninguna impresora.');
        throw e;
      }
      this.disp.addEventListener('gattserverdisconnected', () => { this.conectada.set(false); this.car = null; });
    }
    const servidor = await this.conectar(this.disp);
    const servicios = await servidor.getPrimaryServices().catch(() => []);
    for (const s of servicios) {
      const cars = await s.getCharacteristics().catch(() => [] as Caracteristica[]);
      const c = cars.find((x) => x.properties.writeWithoutResponse || x.properties.write);
      if (c) {
        this.car = c;
        this.nombre.set(this.disp.name ?? 'Impresora');
        this.conectada.set(true);
        return c;
      }
    }
    const nombre = this.disp.name ?? 'Esa impresora';
    this.olvidar();
    throw new Error(`${nombre} no deja imprimir por Bluetooth directo (es de Bluetooth clásico). Activa "Imprimir con la app RawBT".`);
  }

  private async conectar(d: Dispositivo): Promise<Servidor> {
    let error: unknown;
    for (let i = 0; i < 3; i++) {
      try { return await d.gatt!.connect(); } catch (e) { error = e; await esperar(400); }
    }
    this.olvidar();
    throw new Error('No se pudo conectar con la impresora. Revisa que esté prendida y cerca. ' + ((error as Error)?.message ?? ''));
  }

  /** Abre RawBT con el ticket (Android) */
  private rawbt(bytes: Uint8Array): void {
    let bin = '';
    for (const x of bytes) bin += String.fromCharCode(x);
    location.href = `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
  }
}

function leer(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
