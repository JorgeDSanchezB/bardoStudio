import { readWavHeader, decodePcmToMono } from "@/lib/audio/wav";

/**
 * Extracción de PCM mono 16 kHz por rangos de tiempo:
 *  - WAV (incl. la demo): corte EXACTO por cabecera RIFF → RAM acotada, apto
 *    para narraciones de 3+ horas (nunca se decodifica el archivo completo).
 *  - Comprimidos (MP3/M4A/OGG): decodificación única a 16 kHz mono con caché
 *    de sesión (la UI avisa si el archivo es muy largo: conviene WAV).
 */

const SR_ASR = 16000;

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

/** Remuestreo lineal (suficiente para ASR y energía). */
export function remuestrear(input: Float32Array, srIn: number, srOut: number): Float32Array {
  if (srIn === srOut || input.length === 0) return input;
  const nOut = Math.max(1, Math.round((input.length * srOut) / srIn));
  const out = new Float32Array(nOut);
  const paso = srIn / srOut;
  for (let i = 0; i < nOut; i++) {
    const pos = i * paso;
    const i0 = Math.min(input.length - 1, Math.floor(pos));
    const i1 = Math.min(input.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

// caché de sesión para comprimidos (decodifica 1 vez a 16 k mono)
let cacheDecodificada: { clave: string; pcm: Float32Array } | null = null;

/** Duración (s) del audio decodificado en caché, para avisos de RAM. */
export function duracionCacheDecodificada(): number | null {
  return cacheDecodificada ? cacheDecodificada.pcm.length / SR_ASR : null;
}

export async function extraerPcm16k(
  blob: Blob,
  t0: number,
  t1: number,
  claveFuente = "src"
): Promise<Float32Array> {
  const cab = await readWavHeader(blob);
  if (cab) {
    // ---- ruta exacta WAV ----
    const sr = cab.sampleRate;
    const f0 = clampInt(t0 * sr, 0, cab.totalFrames);
    const f1 = clampInt(t1 * sr, f0, cab.totalFrames);
    if (f1 - f0 <= 0) return new Float32Array(0);
    const byteStart = cab.dataOffset + f0 * cab.blockAlign;
    const byteLen = (f1 - f0) * cab.blockAlign;
    const ab = await blob.slice(byteStart, byteStart + byteLen).arrayBuffer();
    const dv = new DataView(ab);
    const mono = decodePcmToMono(dv, cab, f1 - f0);
    return remuestrear(mono, sr, SR_ASR);
  }

  // ---- ruta comprimidos: decodificación única cacheada ----
  if (!cacheDecodificada || cacheDecodificada.clave !== claveFuente) {
    const OffCtx: typeof OfflineAudioContext = window.OfflineAudioContext;
    const octx = new OffCtx(1, SR_ASR, SR_ASR);
    const ab = await blob.arrayBuffer();
    const buf = await octx.decodeAudioData(ab);
    const n = buf.length;
    const mezcla = new Float32Array(n);
    const ch = buf.numberOfChannels;
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mezcla[i] += d[i];
    }
    if (ch > 1) {
      const inv = 1 / ch;
      for (let i = 0; i < n; i++) mezcla[i] *= inv;
    }
    cacheDecodificada = { clave: claveFuente, pcm: remuestrear(mezcla, buf.sampleRate, SR_ASR) };
  }
  const pcm = cacheDecodificada.pcm;
  const s0 = clampInt(t0 * SR_ASR, 0, pcm.length);
  const s1 = clampInt(t1 * SR_ASR, s0, pcm.length);
  return pcm.slice(s0, s1);
}
