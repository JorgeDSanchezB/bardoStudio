// Tipos compartidos del pipeline de análisis de audio (Fase 1).
// Todo el procesamiento es por bloques: nunca se carga el archivo completo
// decodificado en memoria.

export interface AnalysisOptions {
  /** Picos de forma de onda calculados por segundo (min/max por cubeta) */
  peaksPerSec: number;
  /** Ventana de la envolvente RMS, en segundos (para detección de silencios) */
  envelopeHopSec: number;
  /** Duración objetivo del bloque para archivos largos (≤ 5 min) */
  chunkSecondsLong: number;
  /** Duración del bloque para archivos cortos (feedback granular) */
  chunkSecondsShort: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  peaksPerSec: 50,
  envelopeHopSec: 0.1,
  chunkSecondsLong: 300,
  chunkSecondsShort: 60,
};

export interface AudioMeta {
  sampleRate: number;
  channels: number;
  format: "wav" | "decoded";
}

export interface ProgressInfo {
  chunkIndex: number;
  totalChunks: number | null;
  doneSec: number;
  totalSec: number | null;
  chunkSeconds: number;
  /** RAM aproximada usada por bloque (bytes) */
  ramBytes: number;
}

export interface AnalyzeResult {
  sampleRate: number;
  channels: number;
  format: "wav" | "decoded";
  totalSamples: number;
  durationSec: number;
  totalChunks: number;
  skippedChunks: number;
  chunkSeconds: number;
}
