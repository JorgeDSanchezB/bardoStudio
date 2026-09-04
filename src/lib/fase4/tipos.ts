/**
 * Tipos de la Fase 4 (mezcla automática): parámetros editables, bloques de
 * música (EDL) y envolventes resultantes a 10 Hz.
 */

/** Parámetros editables de la mezcla (valores por defecto = config.json). */
export interface Fase4Params {
  /** nivel base de la música bajo la voz (dB) */
  nivelMusicaDb: number;
  /** cuánto sube la música con la tensión de la escena (dB, 0-100) */
  rangoDinamicoDb: number;
  /** cuánto baja la música mientras hay voz (ducking, dB) */
  profundidadDuckingDb: number;
  /** tiempo de reacción al iniciar el ducking (ms) */
  ataqueMs: number;
  /** tiempo de recuperación al cesar la voz (ms) */
  liberacionMs: number;
  /** duración de los crossfades entre pistas (s) */
  crossfadeSeg: number;
  /** hinchado de la música en los silencios largos aprobados (dB) */
  hincharSilenciosDb: number;
}

export const FASE4_PARAMS_DEFECTO: Fase4Params = {
  nivelMusicaDb: -18,
  rangoDinamicoDb: 6,
  profundidadDuckingDb: 10,
  ataqueMs: 120,
  liberacionMs: 700,
  crossfadeSeg: 3,
  hincharSilenciosDb: 6,
};

/** Límites de cada slider (para clamp de config + UI). */
export const FASE4_LIMITES: Record<keyof Fase4Params, [number, number]> = {
  nivelMusicaDb: [-30, -8],
  rangoDinamicoDb: [0, 12],
  profundidadDuckingDb: [2, 18],
  ataqueMs: [20, 600],
  liberacionMs: [100, 2000],
  crossfadeSeg: [0.5, 8],
  hincharSilenciosDb: [0, 12],
};

export const FASE4_ETIQUETAS: Record<keyof Fase4Params, string> = {
  nivelMusicaDb: "Nivel base de música",
  rangoDinamicoDb: "Rango dinámico (tensión)",
  profundidadDuckingDb: "Profundidad de ducking",
  ataqueMs: "Ataque del ducking",
  liberacionMs: "Liberación del ducking",
  crossfadeSeg: "Crossfade entre pistas",
  hincharSilenciosDb: "Hinchar en silencios",
};

export const FASE4_UNIDADES: Record<keyof Fase4Params, string> = {
  nivelMusicaDb: "dB",
  rangoDinamicoDb: "dB",
  profundidadDuckingDb: "dB",
  ataqueMs: "ms",
  liberacionMs: "ms",
  crossfadeSeg: "s",
  hincharSilenciosDb: "dB",
};

/**
 * Un bloque de música sobre la línea de tiempo (EDL).
 * Territorio = [inicio, fin]; el bloque suena además durante su fadeOut
 * (solapándose crossfadeSeg con el bloque siguiente).
 */
export interface BloqueMusica {
  id: string;
  pistaId: string;
  inicio: number;
  fin: number;
  fadeInSeg: number;
  fadeOutSeg: number;
  muted: boolean;
  origen: "auto" | "edicion";
}

export interface MezclaStats {
  bloques: number;
  crossfades: number;
  tiempoConMusicaSec: number;
  nivelMedioDb: number;
  duckMedioDb: number;
  hinchados: number;
}

/** Resultado de calcularMezcla: bloques + envolventes a 10 Hz. */
export interface Mezcla {
  bloques: BloqueMusica[];
  /** nivel de música (sin ducking) en dB por muestra de 100 ms */
  nivelDb: Float32Array;
  /** ducking a aplicar (≤ 0 dB) por muestra de 100 ms */
  duckDb: Float32Array;
  hopSec: number;
  stats: MezclaStats;
}
