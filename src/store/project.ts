"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { makeGrid, type ChunkStats } from "@/lib/audio/peaks";
import { detectSilences, type SilenceRegion, type SilenceStats } from "@/lib/audio/silence";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  type AnalysisOptions,
  type AnalyzeResult,
  type AudioMeta,
  type ProgressInfo,
} from "@/lib/audio/types";
import {
  FASE2_CONFIG_DEFECTO,
  type Escena,
  type Fase2Aviso,
  type Fase2Config,
  type Fase2Progreso,
  type Fase2Resumen,
  type Segmento,
} from "@/lib/fase2/types";
import { saveAnalysis } from "@/lib/idb";

export type Phase1Status = "empty" | "analyzing" | "review" | "approved" | "error";
export type Fase2Status = "idle" | "running" | "review" | "approved" | "error";

export interface Fase2Estado {
  status: Fase2Status;
  segmentos: Segmento[];
  escenas: Escena[];
  bloquesHechos: number[];
  resumen: Fase2Resumen | null;
  avisos: Fase2Aviso[];
  error: string | null;
  /** sembrada desde /api/config (sección fase2 de config.json) */
  configFase2: Fase2Config | null;
  /** volátil: solo durante la ejecución */
  progreso: Fase2Progreso | null;
}

const fase2Inicial: Fase2Estado = {
  status: "idle",
  segmentos: [],
  escenas: [],
  bloquesHechos: [],
  resumen: null,
  avisos: [],
  error: null,
  configFase2: null,
  progreso: null,
};

export interface FileMeta {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  key: string;
}

export interface AnalysisData {
  sampleRate: number;
  channels: number;
  format: "wav" | "decoded";
  peaksPerSec: number;
  envelopeHopSec: number;
  peaksMin: Float32Array;
  peaksMax: Float32Array;
  envDb: Float32Array;
  /** crece durante el análisis; exacta al finalizar */
  durationSec: number;
}

export interface Thresholds {
  dbThreshold: number;
  minDurationSec: number;
  mergeGapSec: number;
}

interface ProjectState {
  // ---- persistido ----
  fileMeta: FileMeta | null;
  sourceKind: "demo" | "user" | null;
  status: Phase1Status;
  silences: SilenceRegion[];
  silenceStats: Pick<SilenceStats, "totalSilenceSec" | "speechRatio">;
  thresholds: Thresholds;
  thresholdsTouched: boolean;
  configDefaults: Thresholds | null;
  gridInfo: { peaksPerSec: number; envelopeHopSec: number } | null;
  analysisOpts: AnalysisOptions;
  savedResult: AnalyzeResult | null;
  analyzedAt: number | null;
  fase2: Fase2Estado;
  // ---- volátil ----
  progress: ProgressInfo | null;
  analysis: AnalysisData | null;
  playheadSec: number;
  error: string | null;
  sourceMissing: boolean;
}

interface ProjectActions {
  seedFromConfig: (cfg: {
    silencio?: { umbralDb?: number; duracionMinimaSeg?: number; fusionHuecosSeg?: number };
    analisis?: Partial<AnalysisOptions>;
    fase2?: unknown;
  }) => void;
  beginAnalysis: (meta: FileMeta, kind: "demo" | "user") => void;
  setMetaInfo: (meta: AudioMeta) => void;
  setProgress: (p: ProgressInfo) => void;
  appendChunk: (c: ChunkStats) => void;
  finishAnalysis: (result: AnalyzeResult) => void;
  cancelAnalysis: () => void;
  failAnalysis: (message: string) => void;
  setThresholds: (t: Partial<Thresholds>) => void;
  recomputeSilences: () => void;
  setPlayhead: (t: number) => void;
  approve: () => void;
  reopen: () => void;
  resetAll: () => void;
  restoreAnalysis: (a: AnalysisData) => void;
  setSourceMissing: (v: boolean) => void;
  // ---- Fase 2 ----
  iniciarFase2: () => void;
  setProgresoFase2: (p: Fase2Progreso) => void;
  bloqueFase2Hecho: (
    bloque: number,
    nuevos: Segmento[],
    bloquesHechos: number[],
    todos: Segmento[]
  ) => void;
  terminarFase2: (escenas: Escena[], resumen: Fase2Resumen, avisos: Fase2Aviso[]) => void;
  fallarFase2: (mensaje: string) => void;
  cancelarFase2: () => void;
  corregirTension: (id: string, tension: number) => void;
  restaurarTensiones: () => void;
  aprobarFase2: () => void;
  reabrirFase2: () => void;
  rehacerFase2: () => void;
}

export type ProjectStore = ProjectState & ProjectActions;

const grow = (arr: Float32Array, len: number, fill: number): Float32Array => {
  if (arr.length >= len) return arr;
  const out = new Float32Array(len);
  out.set(arr);
  if (fill !== 0) out.fill(fill, arr.length);
  return out;
};

const emptyStats = { totalSilenceSec: 0, speechRatio: 1 };

const initial: ProjectState = {
  fileMeta: null,
  sourceKind: null,
  status: "empty",
  silences: [],
  silenceStats: emptyStats,
  thresholds: { dbThreshold: -38, minDurationSec: 2, mergeGapSec: 0.25 },
  thresholdsTouched: false,
  configDefaults: null,
  gridInfo: null,
  analysisOpts: DEFAULT_ANALYSIS_OPTIONS,
  savedResult: null,
  analyzedAt: null,
  fase2: fase2Inicial,
  progress: null,
  analysis: null,
  playheadSec: 0,
  error: null,
  sourceMissing: false,
};

/** Fusiona la sección fase2 de config.json con los valores por defecto. */
function normalizarConfigFase2(bruto: unknown): Fase2Config {
  const d = FASE2_CONFIG_DEFECTO;
  if (!bruto || typeof bruto !== "object") return d;
  const c = bruto as Partial<Fase2Config> & {
    transcripcion?: Partial<Fase2Config["transcripcion"]>;
    emocion?: Partial<Fase2Config["emocion"]>;
  };
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    transcripcion: {
      idioma: typeof c.transcripcion?.idioma === "string" ? c.transcripcion.idioma : d.transcripcion.idioma,
      bloqueSegundos: num(c.transcripcion?.bloqueSegundos, d.transcripcion.bloqueSegundos, 60, 600),
      ajusteSilencioSeg: num(c.transcripcion?.ajusteSilencioSeg, d.transcripcion.ajusteSilencioSeg, 10, 120),
      asrMaxSeg: num(c.transcripcion?.asrMaxSeg, d.transcripcion.asrMaxSeg, 10, 29.5),
      reintentos: num(c.transcripcion?.reintentos, d.transcripcion.reintentos, 0, 5),
      pausaEntreSolicitudesMs: num(c.transcripcion?.pausaEntreSolicitudesMs, d.transcripcion.pausaEntreSolicitudesMs, 300, 10000),
    },
    escenaSegundos: num(c.escenaSegundos, d.escenaSegundos, 5, 120),
    loteEmocion: num(c.loteEmocion, d.loteEmocion, 4, 40),
    emocion: {
      pesosTexto: num(c.emocion?.pesosTexto, d.emocion.pesosTexto, 0, 1),
      pesosAudio: num(c.emocion?.pesosAudio, d.emocion.pesosAudio, 0, 1),
    },
  };
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      ...initial,

      seedFromConfig: (cfg) => {
        const s = get();
        const nextOpts: AnalysisOptions = {
          ...s.analysisOpts,
          ...(cfg.analisis ?? {}),
        };
        set({ analysisOpts: nextOpts });
        if (cfg.fase2 !== undefined) {
          set({ fase2: { ...get().fase2, configFase2: normalizarConfigFase2(cfg.fase2) } });
        }
        const sil = cfg.silencio ?? {};
        const defaults: Thresholds = {
          dbThreshold: sil.umbralDb ?? s.thresholds.dbThreshold,
          minDurationSec: sil.duracionMinimaSeg ?? s.thresholds.minDurationSec,
          mergeGapSec: sil.fusionHuecosSeg ?? s.thresholds.mergeGapSec,
        };
        set({ configDefaults: defaults });
        if (!s.thresholdsTouched) {
          set({ thresholds: defaults });
          get().recomputeSilences();
        }
      },

      beginAnalysis: (meta, kind) =>
        set({
          fileMeta: meta,
          sourceKind: kind,
          status: "analyzing",
          progress: null,
          analysis: null,
          gridInfo: null,
          silences: [],
          silenceStats: emptyStats,
          savedResult: null,
          analyzedAt: null,
          playheadSec: 0,
          error: null,
          sourceMissing: false,
        }),

      setMetaInfo: (meta) => {
        const opts = get().analysisOpts;
        const grid = makeGrid(meta.sampleRate, opts);
        set({
          gridInfo: { peaksPerSec: grid.perSec, envelopeHopSec: grid.hopSec },
          analysis: {
            sampleRate: meta.sampleRate,
            channels: meta.channels,
            format: meta.format,
            peaksPerSec: grid.perSec,
            envelopeHopSec: grid.hopSec,
            peaksMin: new Float32Array(0),
            peaksMax: new Float32Array(0),
            envDb: new Float32Array(0),
            durationSec: 0,
          },
        });
      },

      setProgress: (p) => set({ progress: p }),

      appendChunk: (c) => {
        const a = get().analysis;
        if (!a || c.nBuckets === 0) {
          if (a && c.nBuckets === 0) {
            set({ analysis: { ...a, durationSec: (c.startSample + c.sampleCount) / a.sampleRate } });
          }
          return;
        }
        const needB = c.startBucket + c.nBuckets;
        const needW = c.startWindow + c.nWindows;
        const peaksMin = grow(a.peaksMin, needB, 1);
        const peaksMax = grow(a.peaksMax, needB, -1);
        const envDb = grow(a.envDb, needW, -100);
        peaksMin.set(c.peaksMin, c.startBucket);
        peaksMax.set(c.peaksMax, c.startBucket);
        envDb.set(c.envDb, c.startWindow);
        set({
          analysis: {
            ...a,
            peaksMin,
            peaksMax,
            envDb,
            durationSec: (c.startSample + c.sampleCount) / a.sampleRate,
          },
        });
      },

      finishAnalysis: (result) => {
        const a = get().analysis;
        if (a) {
          set({
            analysis: { ...a, durationSec: result.durationSec },
          });
        }
        set({
          status: "review",
          progress: null,
          savedResult: result,
          analyzedAt: Date.now(),
        });
        get().recomputeSilences();
        // persistir arrays grandes en IndexedDB (fire-and-forget)
        const cur = get().analysis;
        const key = get().fileMeta?.key;
        if (cur && key) {
          void saveAnalysis(key, {
            peaksMin: cur.peaksMin,
            peaksMax: cur.peaksMax,
            envDb: cur.envDb,
            savedAt: Date.now(),
          }).catch(() => undefined);
        }
      },

      cancelAnalysis: () => {
        const hasData = get().analysis !== null && get().analysis!.durationSec > 0;
        set({
          status: hasData ? "review" : "empty",
          progress: null,
        });
      },

      failAnalysis: (message) =>
        set({ status: "error", error: message, progress: null }),

      setThresholds: (t) =>
        set({
          thresholds: { ...get().thresholds, ...t },
          thresholdsTouched: true,
        }),

      recomputeSilences: () => {
        const { analysis, thresholds } = get();
        if (!analysis || analysis.envDb.length === 0) {
          set({ silences: [], silenceStats: emptyStats });
          return;
        }
        const st = detectSilences(
          analysis.envDb,
          analysis.envelopeHopSec,
          thresholds.dbThreshold,
          thresholds.minDurationSec,
          thresholds.mergeGapSec
        );
        set({
          silences: st.regions,
          silenceStats: {
            totalSilenceSec: st.totalSilenceSec,
            speechRatio: st.speechRatio,
          },
        });
      },

      setPlayhead: (t) => set({ playheadSec: t }),

      approve: () => set({ status: "approved" }),

      reopen: () => set({ status: "review" }),

      resetAll: () => set({ ...initial }),

      restoreAnalysis: (a) => set({ analysis: a, progress: null }),

      setSourceMissing: (v) => set({ sourceMissing: v }),

      // ---------- acciones de Fase 2 ----------
      iniciarFase2: () =>
        set({
          fase2: {
            ...get().fase2,
            status: "running",
            error: null,
            progreso: null,
          },
        }),

      setProgresoFase2: (p) =>
        set({ fase2: { ...get().fase2, progreso: p } }),

      bloqueFase2Hecho: (bloque, nuevos, bloquesHechos, todos) =>
        set({
          fase2: {
            ...get().fase2,
            segmentos: todos,
            bloquesHechos,
            progreso: {
              ...((get().fase2.progreso ?? {
                etapa: "transcribiendo",
                bloque: bloque + 1,
                totalBloques: Math.max(bloque + 1, bloquesHechos.length),
                subInicio: 0,
                subFin: 0,
                frases: todos.length,
              })),
              frases: todos.length,
            },
          },
        }),

      terminarFase2: (escenas, resumen, avisos) =>
        set({
          fase2: {
            ...get().fase2,
            status: "review",
            escenas,
            resumen,
            avisos,
            progreso: null,
            error: null,
          },
        }),

      fallarFase2: (mensaje) =>
        set({
          fase2: {
            ...get().fase2,
            status: "error",
            error: mensaje,
            progreso: null,
          },
        }),

      cancelarFase2: () => {
        const f = get().fase2;
        set({
          fase2: {
            ...f,
            status: f.segmentos.length > 0 ? "review" : "idle",
            progreso: null,
          },
        });
      },

      corregirTension: (id, tension) =>
        set({
          fase2: {
            ...get().fase2,
            escenas: get().fase2.escenas.map((e) =>
              e.id === id
                ? { ...e, tension, corregido: true }
                : e
            ),
          },
        }),

      restaurarTensiones: () =>
        set({
          fase2: {
            ...get().fase2,
            escenas: get().fase2.escenas.map((e) => ({
              ...e,
              tension: e.tensionAuto,
              corregido: false,
            })),
          },
        }),

      aprobarFase2: () =>
        set({ fase2: { ...get().fase2, status: "approved" } }),

      reabrirFase2: () =>
        set({ fase2: { ...get().fase2, status: "review" } }),

      rehacerFase2: () =>
        set({
          fase2: {
            ...fase2Inicial,
            configFase2: get().fase2.configFase2,
          },
        }),
    }),
    {
      name: "bardo-project-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        fileMeta: s.fileMeta,
        sourceKind: s.sourceKind,
        status: s.status === "analyzing" ? "review" : s.status,
        silences: s.silences,
        silenceStats: s.silenceStats,
        thresholds: s.thresholds,
        thresholdsTouched: s.thresholdsTouched,
        configDefaults: s.configDefaults,
        gridInfo: s.gridInfo,
        analysisOpts: s.analysisOpts,
        savedResult: s.savedResult,
        analyzedAt: s.analyzedAt,
        fase2: { ...s.fase2, progreso: null },
      }),
    }
  )
);
