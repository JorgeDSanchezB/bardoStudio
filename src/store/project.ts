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
import type {
  SfxCategoria,
  SfxConfig,
  SfxDef,
  SfxDefectos,
  SfxEvento,
  SfxResumen,
} from "@/lib/sfx/tipos";
import { SFX_DEFECTOS } from "@/lib/sfx/tipos";
import type { ProyectoGuardado } from "@/lib/proyecto/tipos";
import { saveAnalysis } from "@/lib/idb";
import { esAnimo } from "@/lib/fase2/types";

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

// ---------------- Fase 2.5: efectos de sonido (SFX) ----------------

export interface FaseSfxEstado {
  status: FaseSimpleStatus;
  /** eventos detectados (y editables) sobre la línea de tiempo */
  eventos: SfxEvento[];
  resumen: SfxResumen | null;
  /** config en vigor (sembrada desde /api/sfx-config; editable en el panel) */
  config: SfxConfig | null;
  /** biblioteca (id → archivo/duración); volátil pero persistida por robustez */
  biblioteca: SfxDef[] | null;
  configTouched: boolean;
  error: string | null;
  aprobadaEn: number | null;
}

const faseSfxInicial: FaseSfxEstado = {
  status: "idle",
  eventos: [],
  resumen: null,
  config: null,
  biblioteca: null,
  configTouched: false,
  error: null,
  aprobadaEn: null,
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
  /** proyecto guardado en el servidor local (.bsproj/db/proyectos) */
  proyecto: {
    id: string;
    nombre: string;
    creadoEn: number;
    guardadoEn: number;
  } | null;
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
  faseSfx: FaseSfxEstado;
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
  // ---- proyecto guardado (estilo Camtasia) ----
  /** aplica un proyecto guardado (.bsproj o del servidor) sobre el estado */
  aplicarProyecto: (p: ProyectoGuardado) => boolean;
  /** marca el proyecto actual como guardado (id/nombre/fechas) */
  marcarProyectoGuardado: (meta: {
    id: string;
    nombre: string;
    creadoEn: number;
    guardadoEn: number;
  }) => void;
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
  // ---- Fase 2.5 (SFX) ----
  /** siembra config+biblioteca desde /api/sfx-config (no pisa una config editada) */
  seedConfigSfx: (cfg: { config: SfxConfig; biblioteca: SfxDef[] }) => void;
  /** aplica el resultado de la detección (worker o inline) */
  aplicarDeteccionSfx: (eventos: SfxEvento[], resumen: SfxResumen) => void;
  fallarSfx: (msg: string) => void;
  /** vuelve a «idle» para re-detectar (conserva config/biblioteca) */
  reiniciarSfx: () => void;
  ajustarSfxEvento: (
    id: string,
    patch: Partial<Pick<SfxEvento, "activo" | "sfxId" | "volumenDb" | "inicio">>
  ) => void;
  eliminarSfxEvento: (id: string) => void;
  añadirSfxEvento: (ev: SfxEvento) => void;
  activarTodosSfx: (activo: boolean) => void;
  eliminarTodosSfx: () => void;
  /** edits del panel de palabras clave */
  ajustarCategoriaSfx: (
    categoria: string,
    patch: Partial<Pick<SfxCategoria, "etiqueta" | "sfxId" | "activo" | "volumenDb" | "palabras">>
  ) => void;
  añadirCategoriaSfx: (cat: SfxCategoria) => void;
  eliminarCategoriaSfx: (categoria: string) => void;
  setDefectosSfx: (patch: Partial<SfxDefectos>) => void;
  /** reemplaza la config completa (importar JSON / restaurar servidor) */
  reemplazarConfigSfx: (config: SfxConfig) => void;
  aprobarFaseSfx: () => void;
  reabrirFaseSfx: () => void;
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
  proyecto: null,
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
  faseSfx: faseSfxInicial,
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

// ---------------- Validación profunda de proyectos guardados ----------------
// Un .bsproj (o la copia del servidor) puede venir editado a mano o de otra
// versión: se normaliza campo a campo y se descarta lo inválido sin lanzar.

const numO = (
  v: unknown,
  def: number,
  min = -Infinity,
  max = Infinity
): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

const strO = (v: unknown, def: string, max = 400): string =>
  typeof v === "string" ? v.slice(0, max) : def;

const boolO = (v: unknown, def = false): boolean =>
  typeof v === "boolean" ? v : def;

function filaObjeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function validarSegmento(v: unknown): Segmento | null {
  const f = filaObjeto(v);
  if (!f || typeof f.id !== "string") return null;
  const inicio = Number(f.inicio);
  const fin = Number(f.fin);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) {
    return null;
  }
  return {
    id: f.id,
    bloque: Math.trunc(numO(f.bloque, 0, 0, 1_000_000)),
    inicio,
    fin,
    texto: strO(f.texto, ""),
  };
}

function validarEscena(v: unknown): Escena | null {
  const f = filaObjeto(v);
  if (!f || typeof f.id !== "string") return null;
  const inicio = Number(f.inicio);
  const fin = Number(f.fin);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) {
    return null;
  }
  return {
    id: f.id,
    n: Math.trunc(numO(f.n, 1, 1, 100_000)),
    inicio,
    fin,
    texto: strO(f.texto, ""),
    energia: Math.trunc(numO(f.energia, 50, 0, 100)),
    tensionAuto: Math.trunc(numO(f.tensionAuto, 50, 0, 100)),
    tension: Math.trunc(numO(f.tension, 50, 0, 100)),
    corregido: boolO(f.corregido),
    animo: esAnimo(f.animo) ? f.animo : "neutro",
    fuente:
      f.fuente === "llm" || f.fuente === "heuristico" || f.fuente === "energia"
        ? f.fuente
        : "heuristico",
    razon: typeof f.razon === "string" ? f.razon.slice(0, 400) : undefined,
  };
}

function validarSilencio(v: unknown): SilenceRegion | null {
  const f = filaObjeto(v);
  if (!f) return null;
  const start = Number(f.start);
  const end = Number(f.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return {
    id: strO(f.id, `sil-${start}-${end}`, 60),
    start,
    end,
  };
}

function validarAsignacion(v: unknown): Asignacion | null {
  const f = filaObjeto(v);
  if (
    !f ||
    typeof f.escenaId !== "string" ||
    typeof f.pistaId !== "string"
  ) {
    return null;
  }
  return {
    escenaId: f.escenaId,
    pistaId: f.pistaId,
    match: Math.trunc(numO(f.match, 0, 0, 100)),
    origen: f.origen === "manual" ? "manual" : "auto",
  };
}

function validarBloque(v: unknown): BloqueMusica | null {
  const f = filaObjeto(v);
  if (
    !f ||
    typeof f.id !== "string" ||
    typeof f.pistaId !== "string"
  ) {
    return null;
  }
  const inicio = Number(f.inicio);
  const fin = Number(f.fin);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) {
    return null;
  }
  return {
    id: f.id,
    pistaId: f.pistaId,
    inicio,
    fin,
    fadeInSeg: numO(f.fadeInSeg, 0, 0, 30),
    fadeOutSeg: numO(f.fadeOutSeg, 0, 0, 30),
    muted: boolO(f.muted),
    origen: f.origen === "edicion" ? "edicion" : "auto",
    // punto de entrada en la pista (recorte de borde estilo Camtasia)
    offsetOrigen: numO(f.offsetOrigen, 0, 0, 24 * 3600),
  };
}

function validarExport(v: unknown): ExportInfo | null {
  const f = filaObjeto(v);
  if (!f) return null;
  const tipo =
    f.tipo === "mezcla" || f.tipo === "voz" || f.tipo === "musica"
      ? f.tipo
      : null;
  if (!tipo || typeof f.nombre !== "string") return null;
  return {
    tipo,
    nombre: f.nombre.slice(0, 200),
    bytes: numO(f.bytes, 0, 0, 2 ** 40),
    durSec: numO(f.durSec, 0, 0, 24 * 3600),
    rmsDb: numO(f.rmsDb, -60, -120, 0),
    picoDb: numO(f.picoDb, -3, -120, 6),
    creadoEn: numO(f.creadoEn, 0, 0, 4102444800000),
  };
}

// ---------------- Validación SFX (Fase 2.5) ----------------

function validarSfxEvento(v: unknown): SfxEvento | null {
  const f = filaObjeto(v);
  if (!f) return null;
  if (typeof f.id !== "string" || !f.id) return null;
  const categoria = strO(f.categoria, "", 64);
  const sfxId = strO(f.sfxId, "", 64);
  if (!categoria || !sfxId) return null;
  return {
    id: f.id.slice(0, 80),
    palabra: strO(f.palabra, "", 40),
    categoria,
    sfxId,
    inicio: numO(f.inicio, 0, 0, 24 * 3600),
    durSec: numO(f.durSec, 1, 0.05, 600),
    volumenDb: numO(f.volumenDb, -12, -60, 6),
    confidencia: numO(f.confidencia, 0.5, 0, 1),
    origen: f.origen === "manual" ? "manual" : "auto",
    activo: boolO(f.activo, true),
  };
}

function normalizarSfxDefectos(v: unknown): SfxDefectos {
  const f = filaObjeto(v) ?? {};
  return {
    nivelDb: numO(f.nivelDb, SFX_DEFECTOS.nivelDb, -60, 6),
    crossfadeSeg: numO(f.crossfadeSeg, SFX_DEFECTOS.crossfadeSeg, 0, 3),
    minSeparacionSeg: numO(
      f.minSeparacionSeg,
      SFX_DEFECTOS.minSeparacionSeg,
      0,
      30
    ),
    respetarDucking: boolO(f.respetarDucking, true),
    maxEventos: Math.trunc(numO(f.maxEventos, SFX_DEFECTOS.maxEventos, 1, 1000)),
  };
}

/** Normaliza una config SFX arbitraria (importar JSON, servidor, .bsproj). */
export function normalizarConfigSfx(v: unknown): SfxConfig | null {
  const f = filaObjeto(v);
  if (!f || !Array.isArray(f.categorias)) return null;
  const categorias: SfxCategoria[] = [];
  for (const c of f.categorias.slice(0, 120)) {
    const o = filaObjeto(c);
    if (!o) continue;
    const categoria = strO(o.categoria, "", 64);
    const sfxId = strO(o.sfxId, "", 64);
    if (!categoria || !sfxId) continue;
    const palabras = Array.isArray(o.palabras)
      ? o.palabras
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .map((p) => p.slice(0, 40))
          .slice(0, 60)
      : [];
    if (palabras.length === 0) continue;
    categorias.push({
      categoria,
      etiqueta: strO(o.etiqueta, categoria, 80),
      sfxId,
      activo: boolO(o.activo, true),
      volumenDb:
        typeof o.volumenDb === "number" && Number.isFinite(o.volumenDb)
          ? numO(o.volumenDb, -12, -60, 6)
          : null,
      palabras,
    });
  }
  if (categorias.length === 0) return null;
  return {
    version: numO(f.version, 1, 1, 99),
    defectos: normalizarSfxDefectos(f.defectos),
    categorias,
  };
}

function validarSfxDef(v: unknown): SfxDef | null {
  const f = filaObjeto(v);
  if (!f) return null;
  if (typeof f.id !== "string" || !f.id) return null;
  const archivo = strO(f.archivo, "", 140);
  if (!archivo.startsWith("/")) return null;
  return {
    id: f.id.slice(0, 64),
    nombre: strO(f.nombre, f.id, 80),
    archivo,
    durSec: numO(f.durSec, 1, 0.05, 600),
    etiquetas: Array.isArray(f.etiquetas)
      ? f.etiquetas.filter((e): e is string => typeof e === "string").slice(0, 8)
      : undefined,
  };
}


function validarResumenFase2(v: unknown): Fase2Resumen | null {
  const f = filaObjeto(v);
  if (!f) return null;
  const r: Fase2Resumen = {
    motorTranscripcion: strO(f.motorTranscripcion, "—", 80),
    motorEmocion: strO(f.motorEmocion, "—", 80),
    duracionSec: numO(f.duracionSec, 0, 0, 24 * 3600),
    bloques: Math.trunc(numO(f.bloques, 0, 0, 100_000)),
    solicitudesAsr: Math.trunc(numO(f.solicitudesAsr, 0, 0, 1_000_000)),
    segmentos: Math.trunc(numO(f.segmentos, 0, 0, 1_000_000)),
    escenas: Math.trunc(numO(f.escenas, 0, 0, 100_000)),
    caracteres: Math.trunc(numO(f.caracteres, 0, 0, 100_000_000)),
  };
  return r;
}

function validarResumenFase3(v: unknown): Fase3Resumen | null {
  const f = filaObjeto(v);
  if (!f) return null;
  return {
    pistasUsadas: Math.trunc(numO(f.pistasUsadas, 0, 0, 1000)),
    cambios: Math.trunc(numO(f.cambios, 0, 0, 100_000)),
    auto: Math.trunc(numO(f.auto, 0, 0, 100_000)),
    manual: Math.trunc(numO(f.manual, 0, 0, 100_000)),
    tiempoMusicaSec: numO(f.tiempoMusicaSec, 0, 0, 24 * 3600),
  };
}

function validarSavedResult(v: unknown): AnalyzeResult | null {
  const f = filaObjeto(v);
  if (!f) return null;
  const sampleRate = numO(f.sampleRate, 0, 8000, 192000);
  const durationSec = numO(f.durationSec, 0, 0, 24 * 3600);
  if (sampleRate < 8000 || durationSec <= 0) return null;
  return {
    sampleRate: Math.trunc(sampleRate),
    channels: Math.trunc(numO(f.channels, 1, 1, 8)),
    format: f.format === "decoded" ? "decoded" : "wav",
    totalSamples: Math.trunc(numO(f.totalSamples, 0, 0, 2 ** 40)),
    durationSec,
    totalChunks: Math.trunc(numO(f.totalChunks, 1, 1, 1_000_000)),
    skippedChunks: Math.trunc(numO(f.skippedChunks, 0, 0, 1_000_000)),
    chunkSeconds: numO(f.chunkSeconds, 60, 1, 600),
  };
}

/** Estado persistido ya validado (forma exacta de partialize). */
interface EstadoValidado {
  proyecto: ProjectState["proyecto"];
  fileMeta: FileMeta | null;
  sourceKind: "demo" | "user" | null;
  status: Phase1Status;
  silences: SilenceRegion[];
  silenceStats: { totalSilenceSec: number; speechRatio: number };
  thresholds: Thresholds;
  thresholdsTouched: boolean;
  configDefaults: Thresholds | null;
  gridInfo: { peaksPerSec: number; envelopeHopSec: number } | null;
  analysisOpts: AnalysisOptions;
  savedResult: AnalyzeResult | null;
  analyzedAt: number | null;
  approvedAt: number | null;
  fase2: Fase2Estado;
  faseSfx: FaseSfxEstado;
  fase3: Fase3Estado;
  fase4: Fase4Estado;
  fase5: Fase5Estado;
  fase6: Fase6Estado;
  configFase3: Fase3Config | null;
}

/** Valida el «estado» de un ProyectoGuardado; null si es irrecuperable. */
function validarEstadoProyecto(bruto: unknown): EstadoValidado | null {
  const f = filaObjeto(bruto);
  if (!f) return null;

  // ---- Fase 1 ----
  const fm = filaObjeto(f.fileMeta);
  const fileMeta: FileMeta | null =
    fm && typeof fm.name === "string" && Number(fm.size) > 0 && typeof fm.key === "string"
      ? {
          name: fm.name.slice(0, 200),
          size: numO(fm.size, 0, 0, 2 ** 40),
          type: strO(fm.type, "audio/*", 60),
          lastModified: numO(fm.lastModified, 0, 0, 4102444800000),
          key: fm.key.slice(0, 200),
        }
      : null;
  if (!fileMeta) return null;

  const sourceKind =
    f.sourceKind === "demo" || f.sourceKind === "user" ? f.sourceKind : null;
  const savedResult = validarSavedResult(f.savedResult);
  let status: Phase1Status;
  if (f.status === "approved") status = "approved";
  else if (f.status === "error") status = "error";
  else if (f.status === "analyzing" || f.status === "review") status = "review";
  else status = savedResult ? "review" : "empty";
  if (status === "review" && !savedResult) status = "empty";

  const silences = (Array.isArray(f.silences) ? f.silences : [])
    .map(validarSilencio)
    .filter((s): s is SilenceRegion => s !== null)
    .slice(0, 20_000);
  const ss = filaObjeto(f.silenceStats);
  const silenceStats = {
    totalSilenceSec: numO(ss?.totalSilenceSec, 0, 0, 24 * 3600),
    speechRatio: numO(ss?.speechRatio, 1, 0, 1),
  };
  const th = filaObjeto(f.thresholds);
  const thresholds: Thresholds = {
    dbThreshold: numO(th?.dbThreshold, -38, -80, 0),
    minDurationSec: numO(th?.minDurationSec, 2, 0.05, 60),
    mergeGapSec: numO(th?.mergeGapSec, 0.25, 0, 10),
  };
  const cd = filaObjeto(f.configDefaults);
  const configDefaults: Thresholds | null = cd
    ? {
        dbThreshold: numO(cd.dbThreshold, -38, -80, 0),
        minDurationSec: numO(cd.minDurationSec, 2, 0.05, 60),
        mergeGapSec: numO(cd.mergeGapSec, 0.25, 0, 10),
      }
    : null;
  const gi = filaObjeto(f.gridInfo);
  const gridInfo = gi
    ? {
        peaksPerSec: Math.trunc(numO(gi.peaksPerSec, 50, 5, 200)),
        envelopeHopSec: numO(gi.envelopeHopSec, 0.1, 0.02, 1),
      }
    : null;
  const ao = filaObjeto(f.analysisOpts);
  const d = DEFAULT_ANALYSIS_OPTIONS;
  const analysisOpts: AnalysisOptions = {
    peaksPerSec: Math.trunc(numO(ao?.peaksPerSec, d.peaksPerSec, 5, 200)),
    envelopeHopSec: numO(ao?.envelopeHopSec, d.envelopeHopSec, 0.02, 1),
    chunkSecondsLong: numO(ao?.chunkSecondsLong, d.chunkSecondsLong, 30, 600),
    chunkSecondsShort: numO(ao?.chunkSecondsShort, d.chunkSecondsShort, 5, 120),
  };

  // ---- Fase 2 ----
  const f2 = filaObjeto(f.fase2) ?? {};
  const segmentos = (Array.isArray(f2.segmentos) ? f2.segmentos : [])
    .map(validarSegmento)
    .filter((s): s is Segmento => s !== null)
    .slice(0, 100_000);
  const escenas = (Array.isArray(f2.escenas) ? f2.escenas : [])
    .map(validarEscena)
    .filter((e): e is Escena => e !== null)
    .slice(0, 10_000);
  const bloquesHechos = (Array.isArray(f2.bloquesHechos) ? f2.bloquesHechos : [])
    .map((n) => Math.trunc(numO(n, -1, -1, 100_000)))
    .filter((n) => n >= 0);
  const avisos: Fase2Aviso[] = (Array.isArray(f2.avisos) ? f2.avisos : [])
    .map(filaObjeto)
    .filter((a): a is Record<string, unknown> => a !== null && typeof a.texto === "string")
    .map((a): Fase2Aviso => ({
      nivel:
        a.nivel === "info" || a.nivel === "aviso" || a.nivel === "error"
          ? a.nivel
          : "info",
      texto: String(a.texto).slice(0, 400),
    }))
    .slice(0, 50);
  const status2: Fase2Status =
    f2.status === "approved" && escenas.length > 0
      ? "approved"
      : f2.status === "error"
        ? "error"
        : escenas.length > 0
          ? "review"
          : "idle";
  const fase2: Fase2Estado = {
    status: status2,
    segmentos,
    escenas,
    bloquesHechos,
    resumen: validarResumenFase2(f2.resumen),
    avisos,
    error: typeof f2.error === "string" ? f2.error.slice(0, 400) : null,
    configFase2: normalizarConfigFase2(f2.configFase2),
    aprobadaEn:
      status2 === "approved" ? numO(f2.aprobadaEn, 0, 0, 4102444800000) : null,
    progreso: null,
  };

  // ---- Fase 3 ----
  const f3 = filaObjeto(f.fase3) ?? {};
  const asignaciones = (Array.isArray(f3.asignaciones) ? f3.asignaciones : [])
    .map(validarAsignacion)
    .filter((a): a is Asignacion => a !== null)
    .slice(0, 10_000);
  const status3: FaseSimpleStatus =
    f3.status === "approved" && asignaciones.length > 0
      ? "approved"
      : f3.status === "error"
        ? "error"
        : asignaciones.length > 0
          ? "review"
          : "idle";
  const fase3: Fase3Estado = {
    status: status3,
    catalogo: null,
    asignaciones: status3 === "idle" ? null : asignaciones,
    resumen: validarResumenFase3(f3.resumen),
    error: typeof f3.error === "string" ? f3.error.slice(0, 400) : null,
    aprobadaEn:
      status3 === "approved" ? numO(f3.aprobadaEn, 0, 0, 4102444800000) : null,
  };

  // ---- Fase 4 ----
  const f4 = filaObjeto(f.fase4) ?? {};
  const status4: FaseSimpleStatus =
    f4.status === "approved"
      ? "approved"
      : f4.status === "error"
        ? "error"
        : f4.status === "review"
          ? "review"
          : "idle";
  const fase4: Fase4Estado = {
    status: status4,
    params: normalizarParamsFase4(f4.params),
    configDefaults: filaObjeto(f4.configDefaults)
      ? normalizarParamsFase4(f4.configDefaults)
      : null,
    paramsTouched: boolO(f4.paramsTouched),
    aprobadaEn:
      status4 === "approved" ? numO(f4.aprobadaEn, 0, 0, 4102444800000) : null,
    mezcla: null,
  };

  // ---- Fase 5 ----
  const f5 = filaObjeto(f.fase5) ?? {};
  const bloques = (Array.isArray(f5.bloques) ? f5.bloques : [])
    .map(validarBloque)
    .filter((b): b is BloqueMusica => b !== null)
    .slice(0, 5000);
  const status5: FaseSimpleStatus =
    f5.status === "approved"
      ? "approved"
      : f5.status === "error"
        ? "error"
        : bloques.length > 0
          ? "review"
          : "idle";
  const fase5: Fase5Estado = {
    status: status5,
    bloques: status5 === "idle" ? null : bloques,
    params: filaObjeto(f5.params) ? normalizarParamsFase4(f5.params) : null,
    ediciones: Math.trunc(numO(f5.ediciones, 0, 0, 100_000)),
    detalleEdiciones: (
      Array.isArray(f5.detalleEdiciones) ? f5.detalleEdiciones : []
    )
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.slice(0, 200))
      .slice(0, 8),
    aprobadaEn:
      status5 === "approved" ? numO(f5.aprobadaEn, 0, 0, 4102444800000) : null,
  };

  // ---- Fase 6 ----
  const f6 = filaObjeto(f.fase6) ?? {};
  const exportaciones = (Array.isArray(f6.exportaciones) ? f6.exportaciones : [])
    .map(validarExport)
    .filter((e): e is ExportInfo => e !== null)
    .slice(0, 12);
  const status6: FaseSimpleStatus =
    f6.status === "approved"
      ? "approved"
      : f6.status === "error"
        ? "error"
        : f6.status === "review"
          ? "review"
          : "idle";
  const informePdf = filaObjeto(f6.informePdf);
  const fase6: Fase6Estado = {
    status: status6,
    params: normalizarParamsFase6(f6.params),
    configDefaults: filaObjeto(f6.configDefaults)
      ? normalizarParamsFase6(f6.configDefaults)
      : null,
    paramsTouched: boolO(f6.paramsTouched),
    exportaciones,
    informePdf: informePdf
      ? {
          bytes: Math.trunc(numO(informePdf.bytes, 0, 0, 2 ** 30)),
          creadoEn: numO(informePdf.creadoEn, 0, 0, 4102444800000),
        }
      : null,
    error: typeof f6.error === "string" ? f6.error.slice(0, 400) : null,
    aprobadaEn:
      status6 === "approved" ? numO(f6.aprobadaEn, 0, 0, 4102444800000) : null,
  };

  // ---- Fase 2.5 (SFX) ----
  const fsx = filaObjeto(f.faseSfx) ?? {};
  const eventosSfx = (Array.isArray(fsx.eventos) ? fsx.eventos : [])
    .map(validarSfxEvento)
    .filter((e): e is SfxEvento => e !== null)
    .slice(0, 400);
  const bibliotecaSfx = (Array.isArray(fsx.biblioteca) ? fsx.biblioteca : [])
    .map(validarSfxDef)
    .filter((b): b is SfxDef => b !== null)
    .slice(0, 200);
  const rsfx = filaObjeto(fsx.resumen);
  const statusSfx: FaseSimpleStatus =
    fsx.status === "approved"
      ? "approved"
      : fsx.status === "error"
        ? "error"
        : fsx.status === "review"
          ? "review"
          : "idle";
  const faseSfx: FaseSfxEstado = {
    status: statusSfx,
    eventos: eventosSfx,
    resumen: rsfx
      ? {
          detectados: Math.trunc(numO(rsfx.detectados, eventosSfx.length, 0, 1000)),
          activos: Math.trunc(numO(rsfx.activos, eventosSfx.filter((e) => e.activo).length, 0, 1000)),
          categorias: Math.trunc(numO(rsfx.categorias, new Set(eventosSfx.map((e) => e.categoria)).size, 0, 200)),
          palabraTop: strO(rsfx.palabraTop, "—", 40),
        }
      : null,
    config: normalizarConfigSfx(fsx.config),
    biblioteca: bibliotecaSfx,
    configTouched: boolO(fsx.configTouched),
    error: typeof fsx.error === "string" ? fsx.error.slice(0, 400) : null,
    aprobadaEn:
      statusSfx === "approved" ? numO(fsx.aprobadaEn, 0, 0, 4102444800000) : null,
  };

  return {
    proyecto: null,
    fileMeta,
    sourceKind: sourceKind ?? "user",
    status,
    silences,
    silenceStats,
    thresholds,
    thresholdsTouched: boolO(f.thresholdsTouched),
    configDefaults,
    gridInfo,
    analysisOpts,
    savedResult,
    analyzedAt: numO(f.analyzedAt, 0, 0, 4102444800000) || null,
    approvedAt:
      status === "approved" ? numO(f.approvedAt, 0, 0, 4102444800000) : null,
    fase2,
    faseSfx,
    fase3,
    fase4,
    fase5,
    fase6,
    configFase3: filaObjeto(f.configFase3)
      ? normalizarConfigFase3(f.configFase3)
      : null,
  };
}

/** Snapshot persistido del proyecto actual (para guardar/exportar .bsproj). */
export function snapshotProyecto(): ReturnType<typeof estadoPersistido> {
  return estadoPersistido(useProjectStore.getState());
}
function estadoPersistido(s: ProjectState): EstadoValidado & { proyecto: ProjectState["proyecto"] } {
  return {
    proyecto: s.proyecto,
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
    faseSfx: s.faseSfx,
    fase3: { ...s.fase3, catalogo: null },
    fase4: { ...s.fase4, mezcla: null },
    fase5: s.fase5,
    fase6: s.fase6,
    configFase3: s.configFase3,
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

      // ---------- proyecto guardado (estilo Camtasia) ----------

      aplicarProyecto: (p) => {
        const validado = validarEstadoProyecto(p.estado);
        if (!validado) return false;
        set({
          ...validado,
          proyecto: {
            id: p.meta.id,
            nombre: p.meta.nombre,
            creadoEn: p.meta.creadoEn,
            guardadoEn: p.meta.guardadoEn,
          },
          // volátiles a cero: la página restaura análisis y audio fuente
          progress: null,
          analysis: null,
          playheadSec: 0,
          error: null,
          sourceMissing: false,
        });
        return true;
      },

      marcarProyectoGuardado: (meta) => set({ proyecto: meta }),

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
          faseSfx: faseSfxInicial,
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
          faseSfx: faseSfxInicial,
          fase3: fase3Inicial,
          fase4: fase4Inicial,
          fase5: fase5Inicial,
          fase6: fase6Inicial,
        }),

      // ---------- acciones de Fase 2.5 (SFX) ----------

      seedConfigSfx: ({ config, biblioteca }) => {
        const s = get();
        set({
          faseSfx: {
            ...s.faseSfx,
            // no pisar una config editada por el usuario en el panel
            config: s.faseSfx.configTouched ? s.faseSfx.config : config,
            biblioteca,
            error: null,
          },
        });
      },

      aplicarDeteccionSfx: (eventos, resumen) =>
        set({
          faseSfx: {
            ...get().faseSfx,
            status: "review",
            eventos,
            resumen,
            error: null,
          },
        }),

      fallarSfx: (msg) =>
        set({ faseSfx: { ...get().faseSfx, status: "error", error: msg } }),

      reiniciarSfx: () =>
        set({
          faseSfx: {
            ...get().faseSfx,
            status: "idle",
            eventos: [],
            resumen: null,
            error: null,
            aprobadaEn: null,
          },
        }),

      ajustarSfxEvento: (id, patch) =>
        set({
          faseSfx: {
            ...get().faseSfx,
            eventos: get().faseSfx.eventos.map((e) =>
              e.id === id
                ? {
                    ...e,
                    ...patch,
                    volumenDb:
                      patch.volumenDb !== undefined
                        ? Math.min(6, Math.max(-60, patch.volumenDb))
                        : e.volumenDb,
                    inicio:
                      patch.inicio !== undefined
                        ? Math.round(Math.max(0, patch.inicio) * 10) / 10
                        : e.inicio,
                  }
                : e
            ),
          },
        }),

      eliminarSfxEvento: (id) =>
        set({
          faseSfx: {
            ...get().faseSfx,
            eventos: get().faseSfx.eventos.filter((e) => e.id !== id),
          },
        }),

      añadirSfxEvento: (ev) =>
        set({
          faseSfx: {
            ...get().faseSfx,
            eventos: [...get().faseSfx.eventos, ev],
          },
        }),

      activarTodosSfx: (activo) =>
        set({
          faseSfx: {
            ...get().faseSfx,
            eventos: get().faseSfx.eventos.map((e) => ({ ...e, activo })),
          },
        }),

      eliminarTodosSfx: () =>
        set({ faseSfx: { ...get().faseSfx, eventos: [] } }),

      ajustarCategoriaSfx: (categoria, patch) =>
        set({
          faseSfx: {
            ...get().faseSfx,
            configTouched: true,
            config: get().faseSfx.config
              ? {
                  ...get().faseSfx.config!,
                  categorias: get().faseSfx.config!.categorias.map((c) =>
                    c.categoria === categoria ? { ...c, ...patch } : c
                  ),
                }
              : null,
          },
        }),

      añadirCategoriaSfx: (cat) => {
        const s = get();
        if (!s.faseSfx.config) return;
        if (s.faseSfx.config.categorias.some((c) => c.categoria === cat.categoria))
          return;
        set({
          faseSfx: {
            ...s.faseSfx,
            configTouched: true,
            config: {
              ...s.faseSfx.config,
              categorias: [...s.faseSfx.config.categorias, cat],
            },
          },
        });
      },

      eliminarCategoriaSfx: (categoria) =>
        set({
          faseSfx: {
            ...get().faseSfx,
            configTouched: true,
            config: get().faseSfx.config
              ? {
                  ...get().faseSfx.config!,
                  categorias: get().faseSfx.config!.categorias.filter(
                    (c) => c.categoria !== categoria
                  ),
                }
              : null,
          },
        }),

      setDefectosSfx: (patch) => {
        const s = get();
        if (!s.faseSfx.config) return;
        set({
          faseSfx: {
            ...s.faseSfx,
            configTouched: true,
            config: {
              ...s.faseSfx.config,
              defectos: { ...s.faseSfx.config.defectos, ...patch },
            },
          },
        });
      },

      reemplazarConfigSfx: (config) =>
        set({
          faseSfx: { ...get().faseSfx, config, configTouched: true },
        }),

      aprobarFaseSfx: () =>
        set({
          faseSfx: { ...get().faseSfx, status: "approved", aprobadaEn: Date.now() },
        }),

      reabrirFaseSfx: () =>
        set({
          faseSfx: { ...get().faseSfx, status: "review", aprobadaEn: null },
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
            // normaliza el punto de entrada de la pista (recortes de borde)
            bloques: bloques.map((b) => ({
              ...b,
              offsetOrigen: Math.max(0, b.offsetOrigen ?? 0),
            })),
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
      partialize: (s) => estadoPersistido(s),
    }
  )
);
