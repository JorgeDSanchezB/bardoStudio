/**
 * Tipos del archivo de proyecto de Bardo Studio (.bsproj) y de la copia
 * guardada en el servidor (db/proyectos/<id>.json).
 *
 * El «estado» es exactamente el slice persistido del store (lo mismo que
 * vive en localStorage), de modo que guardar/abrir un proyecto es fiel al
 * trabajo en curso. El audio original y el paquete de análisis viajan
 * aparte (archivos binarios en el servidor; el .bsproj incrusta el análisis
 * en base64 y el audio se re-adjunta al abrir, como Camtasia con sus medios).
 */

import type { Pista } from "@/lib/fase3/tipos";

export interface ProyectoMeta {
  id: string;
  nombre: string;
  creadoEn: number;
  guardadoEn: number;
}

/** Fila del listado GET /api/proyectos. */
export interface ProyectoResumen {
  id: string;
  nombre: string;
  creadoEn: number;
  guardadoEn: number;
  fases: number;
  archivo: string;
  duracionSec: number;
  escenas: number;
  tieneAudio: boolean;
  tieneAnalisis: boolean;
}

/** Estado serializable del pipeline (ver store/project.ts · partialize). */
export interface EstadoProyecto {
  fileMeta: {
    name: string;
    size: number;
    type: string;
    lastModified: number;
    key: string;
  } | null;
  sourceKind: "demo" | "user" | null;
  status: string;
  silences: unknown[];
  silenceStats: { totalSilenceSec: number; speechRatio: number };
  thresholds: {
    dbThreshold: number;
    minDurationSec: number;
    mergeGapSec: number;
  };
  thresholdsTouched: boolean;
  configDefaults: {
    dbThreshold: number;
    minDurationSec: number;
    mergeGapSec: number;
  } | null;
  gridInfo: { peaksPerSec: number; envelopeHopSec: number } | null;
  analysisOpts: Record<string, number>;
  savedResult: Record<string, number> | null;
  analyzedAt: number | null;
  approvedAt: number | null;
  fase2: Record<string, unknown>;
  fase3: Record<string, unknown>;
  fase4: Record<string, unknown>;
  fase5: Record<string, unknown>;
  fase6: Record<string, unknown>;
  configFase3: Record<string, number> | null;
}

/** Archivo .bsproj completo (o fila del servidor). */
export interface ProyectoGuardado {
  tipo: "bardo-studio-proyecto";
  version: 1;
  meta: ProyectoMeta;
  estado: EstadoProyecto;
  /** metadatos de las pistas propias usadas (solo referencia/auditoría) */
  musicaPropia: Pista[];
  /** pack de análisis en base64 (solo en .bsproj; el servidor lo guarda aparte) */
  analisis?: string;
}

export const TIPO_PROYECTO = "bardo-studio-proyecto";
export const VERSION_PROYECTO = 1;
/** Extensión de los archivos de proyecto descargables. */
export const EXT_PROYECTO = ".bsproj";

/**
 * Valida y normaliza un JSON crudo como ProyectoGuardado.
 * Defensivo: cualquier campo inválido se descarta, no lanza.
 */
export function parsearProyecto(bruto: unknown): ProyectoGuardado | null {
  if (!bruto || typeof bruto !== "object") return null;
  const p = bruto as Record<string, unknown>;
  if (p.tipo !== TIPO_PROYECTO || p.version !== VERSION_PROYECTO) return null;
  const meta = p.meta;
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const id = typeof m.id === "string" ? m.id : "";
  const nombre = typeof m.nombre === "string" ? m.nombre.trim() : "";
  const creadoEn = Number(m.creadoEn);
  const guardadoEn = Number(m.guardadoEn);
  if (!id || !nombre || !Number.isFinite(creadoEn) || !Number.isFinite(guardadoEn)) {
    return null;
  }
  const estado = p.estado;
  if (!estado || typeof estado !== "object") return null;
  const musicaPropia = Array.isArray(p.musicaPropia)
    ? (p.musicaPropia as unknown[])
        .filter((x) => x && typeof x === "object")
        .map((x) => x as Pista)
    : [];
  const analisis = typeof p.analisis === "string" ? p.analisis : undefined;
  return {
    tipo: TIPO_PROYECTO,
    version: VERSION_PROYECTO,
    meta: {
      id,
      nombre: nombre.slice(0, 80),
      creadoEn: Math.max(0, creadoEn),
      guardadoEn: Math.max(0, guardadoEn),
    },
    estado: estado as EstadoProyecto,
    musicaPropia,
    analisis,
  };
}

/** Nombre de archivo sugerido para descargar el proyecto. */
export function nombreArchivoProyecto(nombre: string): string {
  const base = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
  return `${base || "proyecto"}${EXT_PROYECTO}`;
}
