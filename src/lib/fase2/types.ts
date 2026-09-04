/**
 * Tipos compartidos de la Fase 2 (contrato entre pipeline, API y UI).
 * Fase 2 = transcripción por bloques + análisis de emoción/tensión 0-100
 * con curva corregible (puntos arrastrables).
 */

export type Animo =
  | "calma"
  | "misterio"
  | "tension"
  | "batalla"
  | "victoria"
  | "neutro";

export type FuenteEmocion = "llm" | "heuristico" | "energia";

export type Fase2Etapa = "preparando" | "transcribiendo" | "analizando" | "completado";

export type Fase2AvisoNivel = "info" | "aviso" | "error";

/** Frase transcrita con su ventana temporal estimada. */
export interface Segmento {
  id: string;
  /** índice del bloque lógico (≤ 5 min) al que pertenece (0-based) */
  bloque: number;
  /** segundos desde el inicio de la narración (alineación por energía de voz) */
  inicio: number;
  fin: number;
  texto: string;
}

/** Unidad de análisis dramático (≈ escenaSegundos de narración). */
export interface Escena {
  id: string;
  n: number;
  inicio: number;
  fin: number;
  /** texto agregado de los segmentos que caen en la escena */
  texto: string;
  /** energía de voz 0-100, normalizada frente a la media de la narración */
  energia: number;
  /** valor automático (LLM/heurística + energía); se conserva al corregir */
  tensionAuto: number;
  /** valor efectivo: manual si corregido=true */
  tension: number;
  corregido: boolean;
  animo: Animo;
  fuente: FuenteEmocion;
  /** justificación corta del motor (se mostrará en la UI y en el PDF final) */
  razon?: string;
}

export interface Fase2Progreso {
  etapa: Fase2Etapa;
  /** bloque lógico en curso (1-based) */
  bloque: number;
  totalBloques: number;
  /** rango del sub-bloque ASR en curso (≤ 28 s) */
  subInicio: number;
  subFin: number;
  /** frases acumuladas hasta ahora */
  frases: number;
  mensaje?: string;
}

export interface Fase2Aviso {
  nivel: Fase2AvisoNivel;
  texto: string;
}

export interface Fase2Resumen {
  motorTranscripcion: string;
  motorEmocion: string;
  duracionSec: number;
  bloques: number;
  solicitudesAsr: number;
  segmentos: number;
  escenas: number;
  caracteres: number;
}

/** Sección «fase2» de config/config.json (editable por el usuario). */
export interface Fase2Config {
  transcripcion: {
    idioma: string;
    /** bloque lógico de progreso/persistencia (spec: 5 min) */
    bloqueSegundos: number;
    /** ventana para ajustar cortes a silencios aprobados */
    ajusteSilencioSeg: number;
    /** tope DURO por solicitud ASR (el servicio admite 0-30 s) */
    asrMaxSeg: number;
    reintentos: number;
    pausaEntreSolicitudesMs: number;
  };
  escenaSegundos: number;
  loteEmocion: number;
  emocion: { pesosTexto: number; pesosAudio: number };
}

export const FASE2_CONFIG_DEFECTO: Fase2Config = {
  transcripcion: {
    idioma: "es",
    bloqueSegundos: 300,
    ajusteSilencioSeg: 60,
    asrMaxSeg: 28,
    reintentos: 2,
    pausaEntreSolicitudesMs: 1200,
  },
  escenaSegundos: 20,
  loteEmocion: 12,
  emocion: { pesosTexto: 0.7, pesosAudio: 0.3 },
};

export const ANIMOS_VALIDOS: Animo[] = [
  "calma",
  "misterio",
  "tension",
  "batalla",
  "victoria",
  "neutro",
];

export function esAnimo(v: unknown): v is Animo {
  return typeof v === "string" && (ANIMOS_VALIDOS as string[]).includes(v);
}

/** Etiquetas en español para la UI. */
export const ANIMO_ETIQUETAS: Record<Animo, string> = {
  calma: "Calma",
  misterio: "Misterio",
  tension: "Tensión",
  batalla: "Batalla",
  victoria: "Victoria",
  neutro: "Neutro",
};

/** Colores compartidos por curva (canvas), tabla y leyenda. */
export const ANIMO_COLORES: Record<Animo, string> = {
  calma: "#2dd4bf",
  misterio: "#a78bfa",
  tension: "#fb923c",
  batalla: "#f87171",
  victoria: "#fbbf24",
  neutro: "#a1a1aa",
};
