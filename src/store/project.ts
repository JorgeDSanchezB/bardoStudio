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
import {
  FASE3_CONFIG_DEFECTO,
  type Asignacion,
  type Fase3Config,
  type Fase3Resumen,
  type Pista,
} from "@/lib/fase3/tipos";
import { asignarPistas, matchDePista, resumirAsignaciones } from "@/lib/fase3/asignar";
import {
  FASE4_PARAMS_DEFECTO,
  type BloqueMusica,
  type Fase4Params,
  type Mezcla,
} from "@/lib/fase4/tipos";
import type { ExportInfo } from "@/lib/fase6/informe";
import { saveAnalysis } from "@/lib/idb";

export type Phase1Status = "empty" | "analyzing" | "review" | "approved" | "error";
export type Fase2Status = "idle" | "running" | "review" | "approved" | "error";
export type FaseSimpleStatus = "idle" | "review" | "approved" | "error";

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
  /** epoch ms de la aprobación (para el informe PDF) */
  aprobadaEn: number | null;
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
  aprobadaEn: null,
  progreso: null,
};

// ---------------- Fase 3: biblioteca musical + asignación ----------------

export interface Fase3Estado {
  status: FaseSimpleStatus;
  /** volátil: se re-pide a /api/music-library en cada carga */
  catalogo: Pista[] | null;
  asignaciones: Asignacion[] | null;
  resumen: Fase3Resumen | null;
  error: string | null;
  aprobadaEn: number | null;
}

const fase3Inicial: Fase3Estado = {
  status: "idle",
  catalogo: null,
  asignaciones: null,
  resumen: null,
  error: null,
  aprobadaEn: null,
};

// ---------------- Fase 4: mezcla automática ----------------

export interface Fase4Estado {
  status: FaseSimpleStatus;
  params: Fase4Params;
  configDefaults: Fase4Params | null;
  paramsTouched: boolean;
  aprobadaEn: number | null;
  /** volátil: no se persiste (se recalcula al abrir la fase) */
  mezcla: Mezcla | null;
}

const fase4Inicial: Fase4Estado = {
  status: "idle",
  params: FASE4_PARAMS_DEFECTO,
  configDefaults: null,
  paramsTouched: false,
  aprobadaEn: null,
  mezcla: null,
};

// ---------------- Fase 5: editor de mezcla ----------------

export interface Fase5Estado {
  status: FaseSimpleStatus;
  /** bloques editables (materializados desde la mezcla aprobada) */
  bloques: BloqueMusica[] | null;
  /** copia de los parámetros con los que se materializó */
  params: Fase4Params | null;
  ediciones: number;
  detalleEdiciones: string[];
  aprobadaEn: number | null;
}

const fase5Inicial: Fase5Estado = {
  status: "idle",
  bloques: null,
  params: null,
  ediciones: 0,
  detalleEdiciones: [],
  aprobadaEn: null,
};

// ---------------- Fase 6: exportación y reporte ----------------

export interface Fase6Params {
  normalizar: boolean;
  incluirStems: boolean;
  colaFinalSeg: number;
}

export interface Fase6Estado {
  status: FaseSimpleStatus;
  params: Fase6Params;
  configDefaults: Fase6Params | null;
  paramsTouched: boolean;
  exportaciones: ExportInfo[];
  informePdf: { bytes: number; creadoEn: number } | null;
  error: string | null;
  aprobadaEn: number | null;
}

const fase6Inicial: Fase6Estado = {
  status: "idle",
  params: { normalizar: true, incluirStems: true, colaFinalSeg: 3 },
  configDefaults: null,
  paramsTouched: false,
  exportaciones: [],
  informePdf: null,
  error: null,
  aprobadaEn: null,
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
  /** epoch ms de la aprobación de la Fase 1 (informe PDF) */
  approvedAt: number | null;
  fase2: Fase2Estado;
  fase3: Fase3Estado;
  fase4: Fase4Estado;
  fase5: Fase5Estado;
  fase6: Fase6Estado;
  /** config fase3 sembrada desde /api/config */
  configFase3: Fase3Config | null;
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
    fase3?: unknown;
    fase4?: unknown;
    fase6?: unknown;
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
  // ---- Fase 3 ----
  setCatalogoFase3: (pistas: Pista[]) => void;
  autoAsignarFase3: () => void;
  setPistaManualFase3: (escenaId: string, pistaId: string) => void;
  aprobarFase3: () => void;
  reabrirFase3: () => void;
  rehacerFase3: () => void;
  fallarFase3: (msg: string) => void;
  // ---- Fase 4 ----
  seedConfigFase4: (d: Fase4Params) => void;
  setParamsFase4: (p: Partial<Fase4Params>) => void;
  restaurarParamsFase4: () => void;
  setMezclaFase4: (m: Mezcla) => void;
  aprobarFase4: () => void;
  reabrirFase4: () => void;
  // ---- Fase 5 ----
  materializarFase5: (bloques: BloqueMusica[], params: Fase4Params) => void;
  aplicarEdicionFase5: (bloques: BloqueMusica[], detalle: string) => void;
  aprobarFase5: () => void;
  reabrirFase5: () => void;
  // ---- Fase 6 ----
  seedConfigFase6: (d: Fase6Params) => void;
  setParamsFase6: (p: Partial<Fase6Params>) => void;
  addExportFase6: (info: ExportInfo) => void;
  setInformeFase6: (bytes: number) => void;
  fallarFase6: (msg: string) => void;
  aprobarFase6: () => void;
  reabrirFase6: () => void;
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
  approvedAt: null,
  fase2: fase2Inicial,
  fase3: fase3Inicial,
  fase4: fase4Inicial,
  fase5: fase5Inicial,
  fase6: fase6Inicial,
  configFase3: null,
  progress: null,
  analysis: null,
  playheadSec: 0,
  error: null,
  sourceMissing: false,
};

function normalizarConfigFase3(bruto: unknown): Fase3Config {
  const d = FASE3_CONFIG_DEFECTO;
  if (!bruto || typeof bruto !== "object") return d;
  const c = bruto as Partial<Fase3Config>;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    duracionMinBloqueSeg: num(
      c.duracionMinBloqueSeg,
      d.duracionMinBloqueSeg,
      5,
      600
    ),
    penalizacionFatigaMin: num(
      c.penalizacionFatigaMin,
      d.penalizacionFatigaMin,
      1,
      60
    ),
  };
}

function normalizarParamsFase4(bruto: unknown): Fase4Params {
  const d = FASE4_PARAMS_DEFECTO;
  const c =
    bruto && typeof bruto === "object"
      ? (bruto as Partial<Fase4Params>)
      : {};
  const num = (
    v: unknown,
    def: number,
    min: number,
    max: number
  ): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    nivelMusicaDb: num(c.nivelMusicaDb, d.nivelMusicaDb, -30, -8),
    rangoDinamicoDb: num(c.rangoDinamicoDb, d.rangoDinamicoDb, 0, 12),
    profundidadDuckingDb: num(
      c.profundidadDuckingDb,
      d.profundidadDuckingDb,
      2,
      18
    ),
    ataqueMs: num(c.ataqueMs, d.ataqueMs, 20, 600),
    liberacionMs: num(c.liberacionMs, d.liberacionMs, 100, 2000),
    crossfadeSeg: num(c.crossfadeSeg, d.crossfadeSeg, 0.5, 8),
    hincharSilenciosDb: num(
      c.hincharSilenciosDb,
      d.hincharSilenciosDb,
      0,
      12
    ),
  };
}

function normalizarParamsFase6(bruto: unknown): Fase6Params {
  const d = fase6Inicial.params;
  const c =
    bruto && typeof bruto === "object"
      ? (bruto as Partial<Fase6Params>)
      : {};
  const n = Number(c.colaFinalSeg);
  return {
    normalizar: typeof c.normalizar === "boolean" ? c.normalizar : d.normalizar,
    incluirStems:
      typeof c.incluirStems === "boolean" ? c.incluirStems : d.incluirStems,
    colaFinalSeg: Number.isFinite(n)
      ? Math.min(10, Math.max(1, n))
      : d.colaFinalSeg,
  };
}

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
        if (cfg.fase3 !== undefined) {
          set({ configFase3: normalizarConfigFase3(cfg.fase3) });
        }
        if (cfg.fase4 !== undefined) {
          const d = normalizarParamsFase4(cfg.fase4);
          set({
            fase4: {
              ...get().fase4,
              configDefaults: d,
              params: get().fase4.paramsTouched ? get().fase4.params : d,
            },
          });
        }
        if (cfg.fase6 !== undefined) {
          const d = normalizarParamsFase6(cfg.fase6);
          set({
            fase6: {
              ...get().fase6,
              configDefaults: d,
              params: get().fase6.paramsTouched ? get().fase6.params : d,
            },
          });
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

      approve: () => set({ status: "approved", approvedAt: Date.now() }),

      reopen: () => set({ status: "review", approvedAt: null }),

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
        set({
          fase2: {
            ...get().fase2,
            status: "approved",
            aprobadaEn: Date.now(),
          },
        }),

      reabrirFase2: () =>
        set({
          fase2: { ...get().fase2, status: "review", aprobadaEn: null },
          fase3: fase3Inicial,
          fase4: fase4Inicial,
          fase5: fase5Inicial,
          fase6: fase6Inicial,
        }),

      rehacerFase2: () =>
        set({
          fase2: {
            ...fase2Inicial,
            configFase2: get().fase2.configFase2,
          },
          fase3: fase3Inicial,
          fase4: fase4Inicial,
          fase5: fase5Inicial,
          fase6: fase6Inicial,
        }),

      // ---------- acciones de Fase 3 ----------

      setCatalogoFase3: (pistas) =>
        set({ fase3: { ...get().fase3, catalogo: pistas, error: null } }),

      autoAsignarFase3: () => {
        const s = get();
        const escenas = s.fase2.escenas;
        const pistas = s.fase3.catalogo;
        if (!pistas || escenas.length === 0) return;
        const cfg = s.configFase3 ?? FASE3_CONFIG_DEFECTO;
        const asignaciones = asignarPistas(escenas, pistas, cfg);
        const resumen = resumirAsignaciones(escenas, asignaciones);
        set({
          fase3: {
            ...s.fase3,
            asignaciones,
            resumen,
            // no degradar una fase ya aprobada (recarga con catálogo fresco)
            status: s.fase3.status === "approved" ? "approved" : "review",
            error: null,
          },
        });
      },

      setPistaManualFase3: (escenaId, pistaId) => {
        const s = get();
        if (!s.fase3.asignaciones) return;
        const escena = s.fase2.escenas.find((e) => e.id === escenaId);
        const pista = s.fase3.catalogo?.find((p) => p.id === pistaId);
        if (!escena || !pista) return;
        const asignaciones = s.fase3.asignaciones.map((a) =>
          a.escenaId === escenaId
            ? {
                ...a,
                pistaId,
                origen: "manual" as const,
                match: matchDePista(escena, pista),
              }
            : a
        );
        set({
          fase3: {
            ...s.fase3,
            asignaciones,
            resumen: resumirAsignaciones(s.fase2.escenas, asignaciones),
          },
        });
      },

      aprobarFase3: () =>
        set({
          fase3: { ...get().fase3, status: "approved", aprobadaEn: Date.now() },
        }),

      reabrirFase3: () =>
        set({
          fase3: { ...get().fase3, status: "review", aprobadaEn: null },
          fase4: fase4Inicial,
          fase5: fase5Inicial,
          fase6: fase6Inicial,
        }),

      rehacerFase3: () => {
        set({
          fase3: {
            ...get().fase3,
            asignaciones: null,
            resumen: null,
            status: "idle",
          },
          fase4: fase4Inicial,
          fase5: fase5Inicial,
          fase6: fase6Inicial,
        });
        get().autoAsignarFase3();
      },

      fallarFase3: (msg) =>
        set({ fase3: { ...get().fase3, status: "error", error: msg } }),

      // ---------- acciones de Fase 4 ----------

      seedConfigFase4: (d) =>
        set({
          fase4: {
            ...get().fase4,
            configDefaults: d,
            params: get().fase4.paramsTouched ? get().fase4.params : d,
          },
        }),

      setParamsFase4: (p) =>
        set({
          fase4: {
            ...get().fase4,
            params: { ...get().fase4.params, ...p },
            paramsTouched: true,
          },
        }),

      restaurarParamsFase4: () =>
        set({
          fase4: {
            ...get().fase4,
            params: get().fase4.configDefaults ?? FASE4_PARAMS_DEFECTO,
            paramsTouched: false,
          },
        }),

      setMezclaFase4: (m) => set({ fase4: { ...get().fase4, mezcla: m } }),

      aprobarFase4: () =>
        set({
          fase4: { ...get().fase4, status: "approved", aprobadaEn: Date.now() },
        }),

      reabrirFase4: () =>
        set({
          fase4: { ...get().fase4, status: "review", aprobadaEn: null },
          fase5: fase5Inicial,
          fase6: fase6Inicial,
        }),

      // ---------- acciones de Fase 5 ----------

      materializarFase5: (bloques, params) =>
        set({
          fase5: {
            status: "review",
            bloques,
            params,
            ediciones: 0,
            detalleEdiciones: [],
            aprobadaEn: null,
          },
        }),

      aplicarEdicionFase5: (bloques, detalle) => {
        const f = get().fase5;
        set({
          fase5: {
            ...f,
            bloques,
            ediciones: f.ediciones + 1,
            detalleEdiciones: [...f.detalleEdiciones, detalle].slice(-8),
          },
        });
      },

      aprobarFase5: () =>
        set({
          fase5: { ...get().fase5, status: "approved", aprobadaEn: Date.now() },
        }),

      reabrirFase5: () =>
        set({
          fase5: { ...get().fase5, status: "review", aprobadaEn: null },
          fase6: fase6Inicial,
        }),

      // ---------- acciones de Fase 6 ----------

      seedConfigFase6: (d) =>
        set({
          fase6: {
            ...get().fase6,
            configDefaults: d,
            params: get().fase6.paramsTouched ? get().fase6.params : d,
          },
        }),

      setParamsFase6: (p) =>
        set({
          fase6: {
            ...get().fase6,
            params: { ...get().fase6.params, ...p },
            paramsTouched: true,
          },
        }),

      addExportFase6: (info) =>
        set({
          fase6: {
            ...get().fase6,
            exportaciones: [...get().fase6.exportaciones, info].slice(-12),
            status: "review",
          },
        }),

      setInformeFase6: (bytes) =>
        set({
          fase6: {
            ...get().fase6,
            informePdf: { bytes, creadoEn: Date.now() },
          },
        }),

      fallarFase6: (msg) =>
        set({ fase6: { ...get().fase6, status: "error", error: msg } }),

      aprobarFase6: () =>
        set({
          fase6: { ...get().fase6, status: "approved", aprobadaEn: Date.now() },
        }),

      reabrirFase6: () =>
        set({ fase6: { ...get().fase6, status: "review", aprobadaEn: null } }),
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
        approvedAt: s.approvedAt,
        fase2: { ...s.fase2, progreso: null },
        fase3: { ...s.fase3, catalogo: null },
        fase4: { ...s.fase4, mezcla: null },
        fase5: s.fase5,
        fase6: s.fase6,
        configFase3: s.configFase3,
      }),
    }
  )
);
