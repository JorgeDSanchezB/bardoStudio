/**
 * Empaquetado binario del análisis de la Fase 1 (picos + envolvente) para
 * guardarlo junto al proyecto (archivo .an en el servidor o base64 dentro
 * del .bsproj) sin re-analizar al reabrir.
 *
 * Formato (little-endian):
 *   [0..3]   "BSAN" (magia)
 *   [4..7]   u32  versión (1)
 *   [8..11]  u32  nPeaks (número de cubetas de picos)
 *   [12..15] u32  nEnv   (número de muestras de envolvente)
 *   [16..]   f32 × nPeaks  peaksMin
 *   [..]     f32 × nPeaks  peaksMax
 *   [..]     f32 × nEnv    envDb
 */

export interface AnalysisEmpaquetable {
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  envDb: Float32Array;
}

export interface AnalysisDesempaquetado extends AnalysisEmpaquetable {
  nPeaks: number;
  nEnv: number;
}

const MAGIC = "BSAN";
const VERSION = 1;

export function empaquetarAnalysis(a: AnalysisEmpaquetable): ArrayBuffer {
  const nPeaks = a.peaksMin.length;
  const nEnv = a.envDb.length;
  if (a.peaksMax.length !== nPeaks) {
    throw new Error("peaksMin y peaksMax tienen longitudes distintas.");
  }
  const bytes = 16 + 4 * (2 * nPeaks + nEnv);
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) u8[i] = MAGIC.charCodeAt(i);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, nPeaks, true);
  dv.setUint32(12, nEnv, true);
  let o = 16;
  for (let i = 0; i < nPeaks; i++) dv.setFloat32(o + 4 * i, a.peaksMin[i], true);
  o += 4 * nPeaks;
  for (let i = 0; i < nPeaks; i++) dv.setFloat32(o + 4 * i, a.peaksMax[i], true);
  o += 4 * nPeaks;
  for (let i = 0; i < nEnv; i++) dv.setFloat32(o + 4 * i, a.envDb[i], true);
  return buf;
}

export function desempaquetarAnalysis(
  buf: ArrayBuffer
): AnalysisDesempaquetado | null {
  try {
    if (buf.byteLength < 16) return null;
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < 4; i++) {
      if (u8[i] !== MAGIC.charCodeAt(i)) return null;
    }
    if (dv.getUint32(4, true) !== VERSION) return null;
    const nPeaks = dv.getUint32(8, true);
    const nEnv = dv.getUint32(12, true);
    const esperado = 16 + 4 * (2 * nPeaks + nEnv);
    if (buf.byteLength !== esperado) return null;
    let o = 16;
    const peaksMin = new Float32Array(nPeaks);
    for (let i = 0; i < nPeaks; i++) peaksMin[i] = dv.getFloat32(o + 4 * i, true);
    o += 4 * nPeaks;
    const peaksMax = new Float32Array(nPeaks);
    for (let i = 0; i < nPeaks; i++) peaksMax[i] = dv.getFloat32(o + 4 * i, true);
    o += 4 * nPeaks;
    const envDb = new Float32Array(nEnv);
    for (let i = 0; i < nEnv; i++) envDb[i] = dv.getFloat32(o + 4 * i, true);
    return { peaksMin, peaksMax, envDb, nPeaks, nEnv };
  } catch {
    return null;
  }
}

/** ArrayBuffer → base64 (por trozos, para no desbordar la pila de String). */
export function ab2base64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let bin = "";
  const TROZO = 0x8000;
  for (let i = 0; i < u8.length; i += TROZO) {
    bin += String.fromCharCode(...u8.subarray(i, i + TROZO));
  }
  return btoa(bin);
}

/** base64 → ArrayBuffer (null si la cadena no es válida). */
export function base642ab(b64: string): ArrayBuffer | null {
  try {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  } catch {
    return null;
  }
}
