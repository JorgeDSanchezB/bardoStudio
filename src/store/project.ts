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
import { saveAnalysis } from "@/lib/idb";

export type Phase1Status = "empty" | "analyzing" | "review" | "approved" | "error";

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
  progress: null,
  analysis: null,
  playheadSec: 0,
  error: null,
  sourceMissing: false,
};

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
      }),
    }
  )
);
