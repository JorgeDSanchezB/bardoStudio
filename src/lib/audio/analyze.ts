import { analyzeWavInline, type WavEmitMessage } from "./wav-analyze";
import { readWavHeader } from "./wav";
import {
  computeStats,
  makeGrid,
  type ChunkStats,
  type Grid,
} from "./peaks";
import {
  iterateDecodedChunks,
  fullDecodeAt8k,
  type DecodeProbeInfo,
} from "./decode";
import type {
  AnalysisOptions,
  AnalyzeResult,
  AudioMeta,
  ProgressInfo,
} from "./types";

export interface AnalyzeHandlers {
  onMeta: (meta: AudioMeta) => void;
  onProgress: (progress: ProgressInfo) => void;
  onChunk: (stats: ChunkStats) => void;
  /** devuelve true para CANCELAR el análisis */
  cancel?: () => boolean;
}

const CANCELLED = "cancelado";

async function isCancelled(h: AnalyzeHandlers): Promise<boolean> {
  // respiro entre bloques para mantener la UI fluida
  await new Promise((r) => {
    setTimeout(r, 0);
  });
  return h.cancel?.() ?? false;
}

/** Análisis WAV vía Web Worker, con respaldo al hilo principal. */
async function analyzeWav(
  blob: Blob,
  opts: AnalysisOptions,
  h: AnalyzeHandlers
): Promise<AnalyzeResult> {
  const runInline = () => analyzeWavInline(blob, opts, (m: WavEmitMessage) => relay(m));

  const relay = (m: WavEmitMessage): boolean => {
    switch (m.type) {
      case "meta":
        h.onMeta(m.meta);
        break;
      case "progress":
        h.onProgress(m.progress);
        break;
      case "chunk":
        h.onChunk(m.stats);
        break;
      case "error":
        throw new Error(m.message);
      default:
        break;
    }
    return !(h.cancel?.() ?? false);
  };

  try {
    const worker = new Worker(new URL("./wav-worker.ts", import.meta.url), {
      type: "module",
    });
    return await new Promise<AnalyzeResult>((resolve, reject) => {
      const fail = (err: unknown) => {
        worker.terminate();
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      worker.onmessage = (e: MessageEvent<WavEmitMessage>) => {
        const m = e.data;
        if (m.type === "done") {
          worker.terminate();
          resolve(m.result);
          return;
        }
        if (m.type === "error") {
          fail(new Error(m.message));
          return;
        }
        let ok = true;
        try {
          ok = relay(m);
        } catch (err) {
          fail(err);
          return;
        }
        if (!ok) {
          worker.terminate();
          reject(new Error(CANCELLED));
        }
      };
      worker.onerror = () => {
        // El worker no se pudo cargar: respaldo en el hilo principal
        worker.terminate();
        runInline().then(resolve, reject);
      };
      worker.postMessage({ file: blob, opts });
    });
  } catch {
    // Worker no disponible en este entorno → análisis en línea
    return runInline();
  }
}

/** Análisis de formatos comprimidos por bloques (decodeAudioData). */
async function analyzeDecoded(
  blob: Blob,
  opts: AnalysisOptions,
  h: AnalyzeHandlers
): Promise<AnalyzeResult> {
  let sampleRate = 0;
  let channels = 1;
  let skippedBytes = 0;
  let chunkIndex = 0;
  let chunkSeconds = opts.chunkSecondsLong;
  let probe: DecodeProbeInfo | undefined;
  let doneSec = 0;

  const gridCache = new Map<number, Grid>();
  const gridOf = (sr: number): Grid => {
    let g = gridCache.get(sr);
    if (!g) {
      g = makeGrid(sr, opts);
      gridCache.set(sr, g);
    }
    return g;
  };

  const iter = iterateDecodedChunks(
    blob,
    { chunkSeconds: opts.chunkSecondsLong },
    gridOf,
    {
      onProbe: (info) => {
        probe = info;
      },
      onSkip: (bytes) => {
        skippedBytes += bytes;
      },
    }
  );

  let metaSent = false;
  for await (const c of iter) {
    sampleRate = c.sampleRate;
    const grid = gridOf(sampleRate);
    if (!metaSent) {
      channels = probe?.channels ?? 1;
      h.onMeta({ sampleRate, channels, format: "decoded" });
      metaSent = true;
    }
    const stats = computeStats(c.samples, c.startSample, grid);
    h.onChunk(stats);
    chunkIndex++;
    doneSec = (c.startSample + c.samples.length) / sampleRate;
    const totalSecEst = probe && probe.bytesPerSec > 0
      ? blob.size / probe.bytesPerSec
      : null;
    h.onProgress({
      chunkIndex,
      totalChunks: totalSecEst ? Math.ceil(totalSecEst / chunkSeconds) : null,
      doneSec,
      totalSec: totalSecEst,
      chunkSeconds,
      ramBytes: c.samples.length * 4,
    });
    if (await isCancelled(h)) throw new Error(CANCELLED);
  }

  // Respaldo: si el troceado falló demasiado, decodificación única a 8 kHz
  const estTotal = probe && probe.bytesPerSec > 0
    ? blob.size / probe.bytesPerSec
    : 0;
  const tooMuchSkipped = estTotal > 0 && doneSec < 0.5 * estTotal;
  if (tooMuchSkipped || (chunkIndex === 0 && blob.size > 0)) {
    const full = await fullDecodeAt8k(blob);
    sampleRate = full.sampleRate;
    channels = full.channels;
    const grid = gridOf(sampleRate);
    if (!metaSent) {
      h.onMeta({ sampleRate, channels, format: "decoded" });
      metaSent = true;
    }
    const total = full.samples.length;
    const blockFrames = Math.max(
      grid.hop,
      Math.round((opts.chunkSecondsLong * sampleRate) / grid.hop) * grid.hop
    );
    const totalChunks = Math.max(1, Math.ceil(total / blockFrames));
    let pos = 0;
    let i = 0;
    while (pos < total) {
      const n = Math.min(blockFrames, total - pos);
      const sub = full.samples.subarray(pos, pos + n);
      h.onChunk(computeStats(sub, pos, grid));
      i++;
      pos += n;
      h.onProgress({
        chunkIndex: i,
        totalChunks,
        doneSec: pos / sampleRate,
        totalSec: total / sampleRate,
        chunkSeconds: blockFrames / sampleRate,
        ramBytes: full.samples.length * 4,
      });
      if (await isCancelled(h)) throw new Error(CANCELLED);
    }
    return {
      sampleRate,
      channels,
      format: "decoded",
      totalSamples: total,
      durationSec: total / sampleRate,
      totalChunks,
      skippedChunks: 0,
      chunkSeconds: blockFrames / sampleRate,
    };
  }

  return {
    sampleRate,
    channels,
    format: "decoded",
    totalSamples: Math.round(doneSec * sampleRate),
    durationSec: doneSec,
    totalChunks: chunkIndex,
    skippedChunks: skippedBytes > 0 ? 1 : 0,
    chunkSeconds,
  };
}

/**
 * Punto de entrada del análisis de Fase 1.
 * WAV → parseo exacto por bloques (Web Worker). Otros formatos →
 * decodeAudioData por bloques con respaldo a 8 kHz.
 */
export async function analyzeAudio(
  blob: Blob,
  opts: AnalysisOptions,
  handlers: AnalyzeHandlers
): Promise<AnalyzeResult> {
  const header = await readWavHeader(blob);
  if (header) return analyzeWav(blob, opts, handlers);
  return analyzeDecoded(blob, opts, handlers);
}
