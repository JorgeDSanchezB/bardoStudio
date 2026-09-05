/**
 * Ediciones de los clips de SFX en la línea de tiempo (Fase 5): el mismo
 * contrato estilo Camtasia que los bloques de música — cuchilla, mover,
 * RECORTAR/ALARGAR POR LOS BORDES (con offsetOrigen y bucle del archivo si
 * el clip lo estira), silenciar, cambiar de archivo y volumen por clip.
 * Operaciones puras (deterministas, deshacibles desde la UI).
 */

import type { SfxClip, SfxDef, SfxDefectos, SfxEvento } from "@/lib/sfx/tipos";
import { clamp } from "@/lib/format";

/** duración mínima de un clip tras recortar por borde (s) */
const MIN_FRAG = 0.3;
/** margen mínimo a cada lado para aceptar un corte de cuchilla (s) */
const MIN_CORTE = 0.3;

export type LadoRecorte = "inicio" | "fin";

/** Redondea al grid de 0.1 s usado por todas las ediciones. */
const decimas = (v: number) => Math.round(v * 10) / 10;

/**
 * Materializa los clips de la línea de tiempo a partir de los eventos
 * APROBADOS en la Fase 2.5. El clip nace con la duración del archivo
 * (limitada al final de la narración) y el crossfade de los defectos.
 */
export function materializarClips(
  eventos: SfxEvento[],
  defectos: SfxDefectos,
  duracionSec: number,
  biblioteca: SfxDef[]
): SfxClip[] {
  const durPorSfx = new Map(biblioteca.map((b) => [b.id, b.durSec]));
  const fade = clamp(defectos.crossfadeSeg, 0.05, 2);
  return eventos
    .filter((e) => e.activo)
    .map((e) => {
      const durArchivo = clamp(durPorSfx.get(e.sfxId) ?? e.durSec, 0.3, 3600);
      const inicio = clamp(decimas(e.inicio), 0, Math.max(0, duracionSec - 0.3));
      const fin = Math.min(inicio + durArchivo, duracionSec);
      const dur = Math.max(MIN_FRAG, fin - inicio);
      return {
        id: e.id,
        eventoId: e.id,
        palabra: e.palabra,
        categoria: e.categoria,
        sfxId: e.sfxId,
        inicio,
        fin: inicio + dur,
        fadeInSeg: Math.min(fade, dur / 2),
        fadeOutSeg: Math.min(fade, dur / 2),
        muted: false,
        offsetOrigen: 0,
        volumenDb: e.volumenDb,
        origen: e.origen === "manual" ? "manual" : "auto",
      } satisfies SfxClip;
    })
    .sort((a, b) => a.inicio - b.inicio);
}

/** Límites de arrastre de cada borde de un clip. */
export interface LimitesBordeClip {
  /** tope izquierdo: no revelar contenido previo del archivo (offset llega a 0) */
  inicioMin: number;
  inicioMax: number;
  finMin: number;
  /** tope derecho: final de la narración (el archivo sigue en bucle) */
  finMax: number;
}

export function limitesBordeClip(
  c: SfxClip,
  duracionSec: number
): LimitesBordeClip {
  const offset = Math.max(0, c.offsetOrigen);
  return {
    inicioMin: Math.max(0, c.inicio - offset),
    inicioMax: Math.max(c.fin - MIN_FRAG, c.inicio),
    finMin: Math.min(c.inicio + MIN_FRAG, c.fin),
    finMax: duracionSec,
  };
}

/**
 * Recorta o alarga el clip `id` moviendo uno de sus bordes (arrastre estilo
 * Camtasia). El borde izquierdo desplaza también el punto de entrada dentro
 * del archivo SFX (offsetOrigen); el derecho estira el clip (el archivo
 * continúa en bucle si el clip lo supera).
 */
export function recortarClip(
  clips: SfxClip[],
  id: string,
  lado: LadoRecorte,
  valor: number,
  duracionSec: number
): SfxClip[] | null {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const c = clips[i];
  const lim = limitesBordeClip(c, duracionSec);
  const v = decimas(
    clamp(
      valor,
      lado === "inicio" ? lim.inicioMin : lim.finMin,
      lado === "inicio" ? lim.inicioMax : lim.finMax
    )
  );
  const offset = Math.max(0, c.offsetOrigen);

  let nuevo: SfxClip;
  if (lado === "inicio") {
    if (Math.abs(v - c.inicio) < 0.05) return null;
    const dur = c.fin - v;
    nuevo = {
      ...c,
      inicio: v,
      offsetOrigen: Math.max(0, decimas(offset + (v - c.inicio))),
      fadeInSeg: Math.min(c.fadeInSeg, dur / 2),
      fadeOutSeg: Math.min(c.fadeOutSeg, dur / 2),
      origen: "edicion",
    };
  } else {
    if (Math.abs(v - c.fin) < 0.05) return null;
    const dur = v - c.inicio;
    nuevo = {
      ...c,
      fin: v,
      fadeInSeg: Math.min(c.fadeInSeg, dur / 2),
      fadeOutSeg: Math.min(c.fadeOutSeg, dur / 2),
      origen: "edicion",
    };
  }
  const copia = [...clips];
  copia[i] = nuevo;
  return copia;
}

let contadorClip = 0;
const nuevoId = () =>
  `sfx-clip-${++contadorClip}-${Math.round(Date.now() / 1000) % 100000}`;

/** Divide el clip `id` en el instante `t` (cuchilla). */
export function dividirClip(
  clips: SfxClip[],
  id: string,
  t: number
): SfxClip[] | null {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const c = clips[i];
  const dentro = t > c.inicio + MIN_CORTE && t < c.fin - MIN_CORTE;
  if (!dentro) return null;
  const offset = Math.max(0, c.offsetOrigen);
  const izq: SfxClip = {
    ...c,
    fin: t,
    fadeOutSeg: Math.min(c.fadeOutSeg, (t - c.inicio) / 2),
    origen: "edicion",
  };
  // la mitad derecha CONTINÚA el archivo donde lo dejó la izquierda
  const der: SfxClip = {
    ...c,
    id: nuevoId(),
    eventoId: c.eventoId,
    inicio: t,
    fadeInSeg: Math.min(c.fadeInSeg, (c.fin - t) / 2),
    offsetOrigen: offset + (t - c.inicio),
    origen: "edicion",
  };
  const copia = [...clips];
  copia.splice(i, 1, izq, der);
  return copia;
}

/**
 * Mueve el clip `id` para que empiece en `nuevoInicio` (arrastre). Se
 * permiten solapes con otros clips (y con la música), como en Camtasia.
 */
export function moverClip(
  clips: SfxClip[],
  id: string,
  nuevoInicio: number,
  duracionSec: number
): SfxClip[] | null {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const c = clips[i];
  const dur = c.fin - c.inicio;
  const inicio = clamp(decimas(nuevoInicio), 0, Math.max(0, duracionSec - dur));
  if (Math.abs(inicio - c.inicio) < 0.05) return null;
  const copia = [...clips];
  copia[i] = { ...c, inicio, fin: inicio + dur, origen: "edicion" };
  return copia;
}

/** Elimina el clip `id`. */
export function eliminarClip(clips: SfxClip[], id: string): SfxClip[] | null {
  if (!clips.some((c) => c.id === id)) return null;
  return clips.filter((c) => c.id !== id);
}

/** Silencia/activa el clip `id`. */
export function silenciarClip(
  clips: SfxClip[],
  id: string
): SfxClip[] | null {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const copia = [...clips];
  copia[i] = { ...copia[i], muted: !copia[i].muted };
  return copia;
}

/**
 * Cambia el archivo del clip `id` (elige otro de la biblioteca). El archivo
 * arranca desde su principio (offset 0) y conserva el territorio del clip.
 */
export function cambiarSfxClip(
  clips: SfxClip[],
  id: string,
  sfxId: string
): SfxClip[] | null {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0 || clips[i].sfxId === sfxId) return null;
  const copia = [...clips];
  copia[i] = { ...copia[i], sfxId, offsetOrigen: 0, origen: "edicion" };
  return copia;
}

/** Ajusta el volumen (dB) del clip `id`. */
export function ajustarVolumenClip(
  clips: SfxClip[],
  id: string,
  volumenDb: number
): SfxClip[] | null {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const v = clamp(Math.round(volumenDb * 2) / 2, -60, 6);
  if (Math.abs(v - clips[i].volumenDb) < 0.01) return null;
  const copia = [...clips];
  copia[i] = { ...copia[i], volumenDb: v };
  return copia;
}

/** Crea un clip suelto (añadido a mano desde la biblioteca en el editor). */
export function crearClipSuelto(
  def: SfxDef,
  inicio: number,
  volumenDb: number,
  duracionSec: number,
  fadeSeg: number
): SfxClip {
  const ini = clamp(decimas(inicio), 0, Math.max(0, duracionSec - 0.3));
  const dur = Math.max(MIN_FRAG, Math.min(def.durSec, duracionSec - ini));
  const fade = clamp(fadeSeg, 0.05, 2);
  return {
    id: nuevoId(),
    eventoId: "",
    palabra: "(manual)",
    categoria: "manual",
    sfxId: def.id,
    inicio: ini,
    fin: ini + dur,
    fadeInSeg: Math.min(fade, dur / 2),
    fadeOutSeg: Math.min(fade, dur / 2),
    muted: false,
    offsetOrigen: 0,
    volumenDb,
    origen: "manual",
  };
}

/** Número de bucles del archivo que suenan dentro del clip. */
export function buclesDeClip(c: SfxClip, durArchivoSec: number): number {
  if (!Number.isFinite(durArchivoSec) || durArchivoSec <= 0.3) return 1;
  const offset = Math.max(0, c.offsetOrigen);
  return Math.max(1, Math.ceil((offset + (c.fin - c.inicio)) / durArchivoSec));
}

/** Estadísticas de los clips para la puerta de auditoría. */
export function resumenClips(clips: SfxClip[]) {
  return {
    total: clips.length,
    silenciados: clips.filter((c) => c.muted).length,
    editados: clips.filter((c) => c.origen === "edicion").length,
    mano: clips.filter((c) => c.origen === "manual").length,
  };
}
