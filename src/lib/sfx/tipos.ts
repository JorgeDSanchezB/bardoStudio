/**
 * Tipos compartidos del módulo SFX (Fase 2.5 · efectos de sonido).
 * Contrato entre config, detección, store y UI.
 */

/** Defectos de mezcla/integración del módulo (Fase 4/5 en Entrega 2). */
export interface SfxDefectos {
  /** nivel predeterminado de cada evento (dB, negativo) */
  nivelDb: number;
  /** fundido de entrada/salida del SFX al mezclarlo */
  crossfadeSeg: number;
  /** separación mínima entre eventos de la MISMA categoría */
  minSeparacionSeg: number;
  /** si hay voz, ¿el SFX respeta el ducking (baja ligeramente)? */
  respetarDucking: boolean;
  /** tope de eventos detectados (protección de rendimiento) */
  maxEventos: number;
}

export const SFX_DEFECTOS: SfxDefectos = {
  nivelDb: -12,
  crossfadeSeg: 0.5,
  minSeparacionSeg: 1.5,
  respetarDucking: true,
  maxEventos: 400,
};

/** Una categoría de sonido = palabra(s) clave → archivo SFX. */
export interface SfxCategoria {
  /** clave interna (id de la categoría, p. ej. "trueno") */
  categoria: string;
  /** etiqueta legible en español */
  etiqueta: string;
  /** SFX por defecto de la biblioteca */
  sfxId: string;
  /** categoría activada para la detección */
  activo: boolean;
  /** nivel por categoría (dB); ausente → defectos.nivelDb */
  volumenDb?: number | null;
  /** palabras clave y sinónimos (ES + EN; la detección ignora acentos/mayúsculas y maneja plurales) */
  palabras: string[];
}

/** Config editable por el usuario (config/sfx_config.json + panel). */
export interface SfxConfig {
  version?: number;
  defectos: SfxDefectos;
  categorias: SfxCategoria[];
}

/** Entrada de la biblioteca de SFX (config/sfx.json, generado). */
export interface SfxDef {
  id: string;
  nombre: string;
  /** ruta pública del WAV (p. ej. "/sfx/thunder-01.wav") */
  archivo: string;
  durSec: number;
  etiquetas?: string[];
}

/** Evento SFX detectado (o añadido a mano) sobre la línea de tiempo. */
export interface SfxEvento {
  id: string;
  /** palabra tal como apareció en la transcripción (auditoría) */
  palabra: string;
  categoria: string;
  sfxId: string;
  /** segundo de la narración donde se dispara */
  inicio: number;
  /** duración del archivo asignado (segunda edición del clip en Entrega 2) */
  durSec: number;
  volumenDb: number;
  /** 1 = palabra exacta; 0.9 = plural/flexión; 1 = manual */
  confidencia: number;
  origen: "auto" | "manual";
  /** checkbox de auditoría: los inactivos no pasan a la mezcla */
  activo: boolean;
}

/** Resumen de la detección para la puerta de auditoría. */
export interface SfxResumen {
  detectados: number;
  activos: number;
  categorias: number;
  palabraTop: string;
}

/** Paleta estable por categoría (sin azules; hash del nombre). */
const COLORES_CATEGORIA = [
  "#fbbf24",
  "#2dd4bf",
  "#a78bfa",
  "#fb923c",
  "#f87171",
  "#34d399",
  "#e879f9",
  "#a3e635",
  "#fb7185",
  "#facc15",
  "#c084fc",
  "#5eead4",
];

export function colorCategoria(categoria: string): string {
  let h = 0;
  for (let i = 0; i < categoria.length; i++)
    h = (Math.imul(h, 31) + categoria.charCodeAt(i)) >>> 0;
  return COLORES_CATEGORIA[h % COLORES_CATEGORIA.length];
}
