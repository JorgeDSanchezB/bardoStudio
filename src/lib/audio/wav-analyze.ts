import { readWavHeader, iterateWavChunks, type WavHeaderInfo } from "./wav";
import { computeStats, makeGrid, pickChunkSeconds, type ChunkStats } from "./peaks";
import type { AnalysisOptions, AnalyzeResult, AudioMeta, ProgressInfo } from "./types";

export type WavEmitMessage =
  | { type: "header"; header: WavHeaderInfo }
  | { type: "meta"; meta: AudioMeta }
  | { type: "chunk"; stats: ChunkStats }
  | { type: "progress"; progress: ProgressInfo }
  | { type: "done"; result: AnalyzeResult }
  | { type: "error"; message: string };

/** emisor devuelve false para cancelar el análisis */
export type WavEmitter = (m: WavEmitMessage) => boolean;

/**
 * Análisis WAV puro por bloques (usable dentro de un Web Worker o en el hilo
 * principal como respaldo). Nunca carga el archivo completo: lee rebanadas
 * secuenciales del Blob y libera cada bloque tras calcular sus estadísticas.
 */
export async function analyzeWavInline(
  blob: Blob,
  opts: AnalysisOptions,
  emit: WavEmitter
): Promise<AnalyzeResult> {
  const header = await readWavHeader(blob);
  if (!header) throw new Error("WAV no soportado (se requiere PCM/float simple)");

  const grid = makeGrid(header.sampleRate, opts);
  const chunkSeconds = pickChunkSeconds(header.durationSec, opts);
  const chunkFrames = Math.max(
    grid.hop,
    Math.round((chunkSeconds * header.sampleRate) / grid.hop) * grid.hop
  );
  const totalChunks = Math.max(1, Math.ceil(header.totalFrames / chunkFrames));

  if (!emit({ type: "header", header })) throw new Error("cancelado");
  if (
    !emit({
      type: "meta",
      meta: {
        sampleRate: header.sampleRate,
        channels: header.channels,
        format: "wav",
      },
    })
  )
    throw new Error("cancelado");

  let i = 0;
  for await (const c of iterateWavChunks(blob, header, grid, chunkSeconds)) {
    const stats = computeStats(c.samples, c.startSample, grid);
    if (!emit({ type: "chunk", stats })) throw new Error("cancelado");
    const doneSamples = c.startSample + c.samples.length;
    const ramBytes =
      c.samples.length * 4 + // bloque mono decodificado
      c.samples.length * header.blockAlign; // bytes crudos leídos
    if (
      !emit({
        type: "progress",
        progress: {
          chunkIndex: i + 1,
          totalChunks,
          doneSec: doneSamples / header.sampleRate,
          totalSec: header.durationSec,
          chunkSeconds: c.samples.length / header.sampleRate,
          ramBytes,
        },
      })
    )
      throw new Error("cancelado");
    i++;
  }

  return {
    sampleRate: header.sampleRate,
    channels: header.channels,
    format: "wav",
    totalSamples: header.totalFrames,
    durationSec: header.durationSec,
    totalChunks,
    skippedChunks: 0,
    chunkSeconds: chunkFrames / header.sampleRate,
  };
}
