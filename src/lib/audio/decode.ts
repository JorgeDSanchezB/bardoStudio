import type { Grid } from "./peaks";

export interface DecodeProbeInfo {
  sampleRate: number;
  channels: number;
  bytesPerSec: number;
}

interface DecodeEvents {
  onProbe?: (info: DecodeProbeInfo) => void;
  onSkip?: (bytes: number) => void;
}

export interface DecodedChunk {
  startSample: number;
  samples: Float32Array;
  sampleRate: number;
}

function concatFloat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function mixdown(buf: AudioBuffer): Float32Array {
  const n = buf.length;
  const out = new Float32Array(n);
  const ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  if (ch > 1) {
    const inv = 1 / ch;
    for (let i = 0; i < n; i++) out[i] *= inv;
  }
  return out;
}

/**
 * Decodificación por BLOQUES para formatos comprimidos (MP3/M4A/OGG…).
 * - Estima bytes/segundo con una sonda de 512 KB.
 * - Decodifica cada rebanada de bytes por separado (decodeAudioData resamplea
 *   a la tasa del contexto: la duración decodificada es la referencia temporal).
 * - Mantiene un "carry" para que cada bloque cedido esté alineado a `grid.hop`
 *   (los índices de cubetas/ventanas siguen siendo globales y sin costuras).
 * - Los bloques que fallen se omiten (se notifica vía onSkip) y quedan como
 *   huecos de −100 dB en la envolvente (visibles como silencio en la UI).
 */
export async function* iterateDecodedChunks(
  blob: Blob,
  opts: { chunkSeconds: number },
  gridOf: (sampleRate: number) => Grid,
  ev: DecodeEvents
): AsyncGenerator<DecodedChunk> {
  const AudioCtx: typeof AudioContext = window.AudioContext;
  const ctx = new AudioCtx();

  let sampleRate = 0;
  let bps = 0;
  let pos = 0;

  // Sonda inicial: tasa real del contexto + bytes por segundo del archivo
  const probeBytes = Math.min(blob.size, 512 * 1024);
  if (probeBytes > 0) {
    const probeAb = await blob.slice(0, probeBytes).arrayBuffer();
    try {
      const b = await ctx.decodeAudioData(probeAb);
      sampleRate = b.sampleRate;
      bps = probeBytes / Math.max(0.05, b.duration);
      ev.onProbe?.({
        sampleRate,
        channels: b.numberOfChannels,
        bytesPerSec: bps,
      });
      pos = probeBytes;
    } catch {
      bps = 20000; // ~160 kbps de respaldo
      ev.onSkip?.(probeBytes);
    }
  }
  if (!sampleRate || !bps || !Number.isFinite(bps) || bps <= 0) {
    sampleRate = ctx.sampleRate;
    bps = 20000;
  }

  const grid = gridOf(sampleRate);
  const chunkBytes = Math.max(1 << 20, Math.round(bps * opts.chunkSeconds));

  let carry: Float32Array<ArrayBufferLike> = new Float32Array(0);
  let accSamples = 0;

  try {
    while (pos < blob.size) {
      const end = Math.min(blob.size, pos + chunkBytes);
      const before = pos;
      const ab = await blob.slice(pos, end).arrayBuffer();
      pos = end;

      let buf: AudioBuffer;
      try {
        buf = await ctx.decodeAudioData(ab);
      } catch {
        ev.onSkip?.(end - before);
        continue;
      }

      const mono: Float32Array<ArrayBufferLike> = mixdown(buf);
      const pending =
        carry.length === 0 ? mono : concatFloat(carry, mono);
      const usable = Math.floor(pending.length / grid.hop) * grid.hop;
      if (usable > 0) {
        yield {
          startSample: accSamples,
          samples: pending.subarray(0, usable),
          sampleRate,
        };
        accSamples += usable;
        carry = usable < pending.length ? pending.slice(usable) : new Float32Array(0);
      } else {
        carry = pending;
      }
    }

    // Bloque final parcial (no alineado): cierra la envolvente hasta el final
    if (carry.length > 0) {
      yield { startSample: accSamples, samples: carry, sampleRate };
      accSamples += carry.length;
    }
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/**
 * Respaldo para archivos comprimidos cuyo troceado falla: decodifica TODO el
 * archivo a 8 kHz (RAM ~691 MB por cada 3 h; solo se usa como último recurso y
 * la UI lo advierte). Devuelve la mezcla mono completa.
 */
export async function fullDecodeAt8k(
  blob: Blob
): Promise<{ samples: Float32Array; sampleRate: number; channels: number }> {
  const OfflineCtx: typeof OfflineAudioContext = window.OfflineAudioContext;
  const octx = new OfflineCtx(2, 1, 8000);
  const ab = await blob.arrayBuffer();
  const buf = await octx.decodeAudioData(ab);
  return {
    samples: mixdown(buf),
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
  };
}
