import type { AnalysisOptions } from "./types";

/**
 * Rejilla de agregación global. Todas las cubetas (picos) y ventanas
 * (envolvente) están alineadas a índices GLOBALES de muestra, de modo que los
 * bloques procesados en streaming se pueden concatenar sin costuras.
 */
export interface Grid {
  /** muestras por cubeta de pico */
  spp: number;
  /** muestras por ventana de envolvente (múltiplo de spp) */
  hop: number;
  /** picos por segundo efectivos (sampleRate / spp) */
  perSec: number;
  /** duración efectiva de la ventana de envolvente */
  hopSec: number;
}

export function makeGrid(sampleRate: number, opts: AnalysisOptions): Grid {
  const spp = Math.max(1, Math.ceil(sampleRate / opts.peaksPerSec));
  const hopUnits = Math.max(
    1,
    Math.round((sampleRate * opts.envelopeHopSec) / spp)
  );
  const hop = spp * hopUnits;
  return {
    spp,
    hop,
    perSec: sampleRate / spp,
    hopSec: hop / sampleRate,
  };
}

/** Estadísticas de un bloque, con índices globales de cubeta/ventana. */
export interface ChunkStats {
  startBucket: number;
  nBuckets: number;
  startWindow: number;
  nWindows: number;
  startSample: number;
  sampleCount: number;
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  /** RMS en dBFS por ventana de envolvente (−100 = vacío) */
  envDb: Float32Array;
}

/**
 * Calcula picos min/max por cubeta y envolvente RMS (dBFS) por ventana para
 * un bloque de muestras mono que comienza en `startSample` (índice global).
 * Coste: O(n) con n = muestras del bloque.
 */
export function computeStats(
  samples: Float32Array,
  startSample: number,
  grid: Grid
): ChunkStats {
  const n = samples.length;
  if (n === 0) {
    return {
      startBucket: Math.floor(startSample / grid.spp),
      nBuckets: 0,
      startWindow: Math.floor(startSample / grid.hop),
      nWindows: 0,
      startSample,
      sampleCount: 0,
      peaksMin: new Float32Array(0),
      peaksMax: new Float32Array(0),
      envDb: new Float32Array(0),
    };
  }
  const endSample = startSample + n;
  const startBucket = Math.floor(startSample / grid.spp);
  const endBucket = Math.floor((endSample - 1) / grid.spp);
  const nBuckets = endBucket - startBucket + 1;
  const startWindow = Math.floor(startSample / grid.hop);
  const endWindow = Math.floor((endSample - 1) / grid.hop);
  const nWindows = endWindow - startWindow + 1;

  const peaksMin = new Float32Array(nBuckets).fill(1);
  const peaksMax = new Float32Array(nBuckets).fill(-1);
  const sums = new Float64Array(nWindows);
  const cnts = new Uint32Array(nWindows);

  const invSpp = 1 / grid.spp;
  const invHop = 1 / grid.hop;
  for (let i = 0; i < n; i++) {
    const g = startSample + i;
    const v = samples[i];
    const b = Math.floor(g * invSpp) - startBucket;
    if (v < peaksMin[b]) peaksMin[b] = v;
    if (v > peaksMax[b]) peaksMax[b] = v;
    const w = Math.floor(g * invHop) - startWindow;
    sums[w] += v * v;
    cnts[w]++;
  }

  const envDb = new Float32Array(nWindows);
  for (let w = 0; w < nWindows; w++) {
    envDb[w] = cnts[w] > 0 ? rmsToDb(sums[w] / cnts[w]) : -100;
  }
  return {
    startBucket,
    nBuckets,
    startWindow,
    nWindows,
    startSample,
    sampleCount: n,
    peaksMin,
    peaksMax,
    envDb,
  };
}

/** RMS lineal → dBFS, redondeado a 0.1 dB, acotado a [−100, 0]. */
export function rmsToDb(rms: number): number {
  if (rms <= 0) return -100;
  const db = 10 * Math.log10(rms + 1e-12);
  return Math.max(-100, Math.min(0, Math.round(db * 10) / 10));
}

/**
 * Elige la duración de bloque: archivos cortos usan bloques menores para dar
 * progreso granular; archivos de horas usan bloques ≤ 5 minutos (RAM acotada).
 */
export function pickChunkSeconds(
  durationSec: number,
  opts: AnalysisOptions
): number {
  if (durationSec <= 900) return Math.min(opts.chunkSecondsShort, 60);
  if (durationSec <= 1800) return 120;
  return Math.min(opts.chunkSecondsLong, 300);
}
