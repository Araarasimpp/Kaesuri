// Lector robusto del QR del rótulo. Prueba en orden (y para en cuanto lee):
//  1. ZXing (lector fuerte, "tryHarder") sobre la foto tal cual
//  2. ZXing y jsQR con el contraste estirado (fotos lavadas, poca luz)
//  3. ZXing por zonas ampliadas al doble (cuando el QR sale pequeño en la foto)
// En fotos simuladas de celular + Telegram pasó de ~92 % (solo jsQR) a ~99,5 %.
import jsQR from 'npm:jsqr@1.4.0';
import { readBarcodes } from 'npm:zxing-wasm@2.2.4/reader';

type Imagen = { data: Uint8ClampedArray; width: number; height: number };

// También se aceptan los rótulos de Jasta (el bot los reconoce y los deja pasar sin responder)
const ES_PEDIDO = /KAESURI[\s:#-]*\d|JASTA[\s:#-]*\d/i;
const ok = (t: string | null | undefined) => (t && ES_PEDIDO.test(t) ? t : null);

/** Luminancia 0-255 con el contraste estirado entre los percentiles 2 % y 98 % */
function grisEstirado(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h;
  const g = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[g[i]]++;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) g[i] = (g[i] - lo) * k;
  return g;
}

/** Recorta y amplía (bilineal) una zona del gris */
function zona(g: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, cw: number, ch: number, escala: number) {
  const W = Math.round(cw * escala), H = Math.round(ch * escala);
  const o = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    const sy = y0 + y / escala, iy = Math.min(h - 2, Math.floor(sy)), fy = sy - iy;
    for (let x = 0; x < W; x++) {
      const sx = x0 + x / escala, ix = Math.min(w - 2, Math.floor(sx)), fx = sx - ix;
      const a = g[iy * w + ix], b = g[iy * w + ix + 1], c = g[(iy + 1) * w + ix], d = g[(iy + 1) * w + ix + 1];
      o[y * W + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return { g: o, w: W, h: H };
}

function aRGBA(g: Uint8ClampedArray, w: number, h: number): Imagen {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = g[i]; d[j + 3] = 255; }
  return { data: d, width: w, height: h };
}

async function zxing(im: Imagen): Promise<string | null> {
  try {
    const r = await readBarcodes(im as unknown as ImageData, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1, tryInvert: false });
    return ok(r[0]?.text);
  } catch (e) {
    console.error('zxing', e);
    return null;
  }
}

/** Devuelve el texto del QR del rótulo, o null si no se encontró */
export async function leerQrImagen(rgba: Uint8ClampedArray, w: number, h: number): Promise<string | null> {
  let t = await zxing({ data: rgba, width: w, height: h });
  if (t) return t;
  const g = grisEstirado(rgba, w, h);
  const norm = aRGBA(g, w, h);
  t = await zxing(norm);
  if (t) return t;
  t = ok(jsQR(norm.data, w, h, { inversionAttempts: 'attemptBoth' })?.data);
  if (t) return t;
  const cw = Math.round(w / 2), ch = Math.round(h / 2);
  for (const fy of [0, 0.5, 1]) {
    for (const fx of [0, 0.5, 1]) {
      const z = zona(g, w, h, Math.round((w - cw) * fx), Math.round((h - ch) * fy), cw, ch, 2);
      t = await zxing(aRGBA(z.g, z.w, z.h));
      if (t) return t;
    }
  }
  return null;
}
