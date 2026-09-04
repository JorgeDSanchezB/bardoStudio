/**
 * Tipos compartidos de la Fase 3 (biblioteca musical + asignación por escena).
 * El catálogo lo sirve /api/music-library leyendo config/musica.json
 * (generado por scripts/generate-music-library.ts — síntesis CC0 propia).
 */

import type { Animo } from "@/lib/fase2/types";
import { esAnimo } from "@/lib/fase2/types";

/** Pista musical de la biblioteca local (WAV mono 32 kHz, loop limpio). */
export interface Pista {
  id: string;
  titulo: string;
  animo: Animo;
  tensionMin: number;
  tensionMax: number;
  bpm: number;
  tonalidad: string;
  durSec: number;
  archivo: string;
  instrumentacion: string;
  descripcion: string;
}

/** Catálogo tal cual se sirve desde /api/music-library. */
export interface CatalogoMusical {
  version: number;
  generadoPor: string;
  licencia: string;
  pistas: Pista[];
}

/** Pista asignada a una escena (auto = matching determinista, manual = usuario). */
export interface Asignacion {
  escenaId: string;
  pistaId: string;
  /** 0-100: compatibilidad con la escena (banda de tensión + continuidad) */
  match: number;
  origen: "auto" | "manual";
}

export interface Fase3Resumen {
  pistasUsadas: number;
  cambios: number;
  auto: number;
  manual: number;
  tiempoMusicaSec: number;
}

/** Sección «fase3» de config/config.json (editable por el usuario). */
export interface Fase3Config {
  /** no cambiar de pista hasta llevar este tiempo con la actual */
  duracionMinBloqueSeg: number;
  /** penalización por minutaje reciente de una misma pista (anti-fatiga) */
  penalizacionFatigaMin: number;
}

export const FASE3_CONFIG_DEFECTO: Fase3Config = {
  duracionMinBloqueSeg: 40,
  penalizacionFatigaMin: 12,
};

/** Normaliza una fila cruda del manifiesto a Pista (defensivo). */
export function normalizarPista(bruto: Record<string, unknown>): Pista | null {
  const id = typeof bruto.id === "string" ? bruto.id : null;
  const titulo = typeof bruto.titulo === "string" ? bruto.titulo : null;
  const archivo = typeof bruto.archivo === "string" ? bruto.archivo : null;
  if (!id || !titulo || !archivo) return null;
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const animoBruto = bruto.animo === "tensión" ? "tension" : bruto.animo;
  return {
    id,
    titulo,
    animo: esAnimo(animoBruto) ? animoBruto : "neutro",
    tensionMin: num(bruto.tensionMin, 0, 0, 100),
    tensionMax: num(bruto.tensionMax, 100, 0, 100),
    bpm: num(bruto.bpm, 90, 20, 300),
    tonalidad: typeof bruto.tonalidad === "string" ? bruto.tonalidad : "—",
    durSec: num(bruto.durSec, 60, 5, 600),
    archivo,
    instrumentacion:
      typeof bruto.instrumentacion === "string" ? bruto.instrumentacion : "—",
    descripcion:
      typeof bruto.descripcion === "string" ? bruto.descripcion : "",
  };
}

/** Animo → pistas compatibles (el neutro es comodín). */
export function pistasParaAnimo(animo: Animo, pistas: Pista[]): Pista[] {
  const propias = pistas.filter((p) => p.animo === animo);
  if (propias.length > 0) return propias;
  const comodines = pistas.filter((p) => p.animo === "neutro");
  return comodines.length > 0 ? comodines : pistas;
}

/** Banda de tensión de una pista como texto corto. */
export function bandaTension(p: Pista): string {
  return `${Math.round(p.tensionMin)}–${Math.round(p.tensionMax)}`;
}
