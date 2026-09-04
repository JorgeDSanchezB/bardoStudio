import type { Grid } from "./peaks";

/** Cabecera RIFF/WAVE parseada de forma secuencial (sin cargar el archivo). */
export interface WavHeaderInfo {
  audioFormat: number; // 1 = PCM, 3 = IEEE float, 0xFFFE = extensible
  channels: number;
  sampleRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
  totalFrames: number;
  durationSec: number;
}

const ID_RIFF = 0x52494646; // "RIFF"
const ID_WAVE = 0x57415645; // "WAVE"
const ID_FMT = 0x666d7420; // "fmt "
const ID_DATA = 0x64617461; // "data"

/**
 * Lee la cabecera leyendo solo el primer megabyte del Blob.
 * Devuelve null si el archivo no es un WAV PCM simple soportado
 * (el llamador caerá al decodificador por bloques del navegador).
 */
export async function readWavHeader(blob: Blob): Promise<WavHeaderInfo | null> {
  const headLen = Math.min(blob.size, 1 << 20);
  const dv = new DataView(await blob.slice(0, headLen).arrayBuffer());
  if (dv.byteLength < 44) return null;
  if (dv.getUint32(0, false) !== ID_RIFF) return null;
  if (dv.getUint32(8, false) !== ID_WAVE) return null;

  let off = 12;
  let fmt: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    blockAlign: number;
    bitsPerSample: number;
  } | null = null;
  let data: { offset: number; size: number } | null = null;

  while (off + 8 <= dv.byteLength) {
    const id = dv.getUint32(off, false);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === ID_FMT) {
      const audioFormat = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sampleRate = dv.getUint32(body + 4, true);
      let blockAlign = dv.getUint16(body + 12, true);
      const bitsPerSample = dv.getUint16(body + 14, true);
      if (blockAlign === 0 && bitsPerSample > 0) {
        blockAlign = Math.max(1, Math.ceil(bitsPerSample / 8) * channels);
      }
      const ok =
        (audioFormat === 1 || audioFormat === 3 || audioFormat === 0xfffe) &&
        channels >= 1 &&
        channels <= 8 &&
        sampleRate >= 4000 &&
        sampleRate <= 384000 &&
        [8, 16, 24, 32].includes(bitsPerSample) &&
        (audioFormat !== 3 || bitsPerSample === 32);
      if (ok) fmt = { audioFormat, channels, sampleRate, blockAlign, bitsPerSample };
    } else if (id === ID_DATA) {
      const size2 = Math.min(size, Math.max(0, blob.size - body));
      data = { offset: body, size: size2 };
      break; // "data" puede aparecer tras otros chunks; con fmt basta
    }
    if (body + size > dv.byteLength) break; // chunk gigante no cacheable en 1 MB
    off = body + size + (size & 1);
  }

  if (!fmt || !data || data.size === 0) return null;
  const totalFrames = Math.floor(data.size / fmt.blockAlign);
  if (totalFrames <= 0) return null;
  return {
    ...fmt,
    dataOffset: data.offset,
    dataSize: data.size,
    totalFrames,
    durationSec: totalFrames / fmt.sampleRate,
  };
}

function readInt24(dv: DataView, bytePos: number): number {
  const b0 = dv.getUint8(bytePos);
  const b1 = dv.getUint8(bytePos + 1);
  const b2 = dv.getUint8(bytePos + 2);
  let v = b0 | (b1 << 8) | (b2 << 16);
  if (v & 0x800000) v |= ~0xffffff; // signo
  return v;
}

/** Decodifica un rango PCM a Float32 mono (mezcla de canales por promedio). */
export function decodePcmToMono(
  dv: DataView,
  h: WavHeaderInfo,
  frames: number
): Float32Array {
  const out = new Float32Array(frames);
  const ch = h.channels;
  const inv = 1 / ch;
  const bytes = h.bitsPerSample / 8;
  switch (h.bitsPerSample) {
    case 16: {
      for (let f = 0; f < frames; f++) {
        let acc = 0;
        const base = f * ch * 2;
        for (let c = 0; c < ch; c++) acc += dv.getInt16(base + c * 2, true);
        out[f] = (acc * inv) / 32768;
      }
      break;
    }
    case 8: {
      for (let f = 0; f < frames; f++) {
        let acc = 0;
        const base = f * ch;
        for (let c = 0; c < ch; c++) acc += dv.getUint8(base + c) - 128;
        out[f] = acc * inv / 128;
      }
      break;
    }
    case 24: {
      for (let f = 0; f < frames; f++) {
        let acc = 0;
        const base = f * ch * 3;
        for (let c = 0; c < ch; c++) acc += readInt24(dv, base + c * 3);
        out[f] = (acc * inv) / 8388608;
      }
      break;
    }
    case 32: {
      if (h.audioFormat === 3) {
        for (let f = 0; f < frames; f++) {
          let acc = 0;
          const base = f * ch * 4;
          for (let c = 0; c < ch; c++) acc += dv.getFloat32(base + c * 4, true);
          out[f] = acc * inv;
        }
      } else {
        for (let f = 0; f < frames; f++) {
          let acc = 0;
          const base = f * ch * 4;
          for (let c = 0; c < ch; c++) acc += dv.getInt32(base + c * 4, true);
          out[f] = (acc * inv) / 2147483648;
        }
      }
      break;
    }
    default:
      break;
  }
  void bytes;
  return out;
}

/**
 * Lee el chunk "data" de forma SECUENCIAL en bloques (nunca el archivo
 * completo): cada bloque es un múltiplo de `grid.hop` para que las cubetas
 * de picos y ventanas de envolvente queden alineadas globalmente.
 */
export async function* iterateWavChunks(
  blob: Blob,
  h: WavHeaderInfo,
  grid: Grid,
  chunkSeconds: number
): AsyncGenerator<{ startSample: number; samples: Float32Array }> {
  const baseFrames = Math.round(chunkSeconds * h.sampleRate);
  const chunkFrames = Math.max(
    grid.hop,
    Math.round(baseFrames / grid.hop) * grid.hop
  );
  let pos = 0;
  while (pos < h.totalFrames) {
    const n = Math.min(chunkFrames, h.totalFrames - pos);
    const byteStart = h.dataOffset + pos * h.blockAlign;
    const byteLen = n * h.blockAlign;
    const ab = await blob.slice(byteStart, byteStart + byteLen).arrayBuffer();
    const dv = new DataView(ab);
    yield { startSample: pos, samples: decodePcmToMono(dv, h, n) };
    pos += n;
  }
}
