/**
 * Ediciones del editor de mezcla (Fase 5): cortes tipo cuchilla, mover,
 * RECORTAR/ALARGAR POR LOS BORDES (estilo Camtasia), eliminar, silenciar y
 * cambiar de pista. Operaciones puras sobre el array de bloques
 * (deterministas y deshacibles desde la UI).
 */

import type { BloqueMusica } from "@/lib/fase4/tipos";
import { clamp } from "@/lib/format";

const MIN_DUR = 2; // s: fragmento mínimo tras un corte
const MIN_FRAG = 1; // s: duración mínima de un bloque recortado por borde

export type LadoRecorte = "inicio" | "fin";

/** Límites de arrastre de cada borde (compartidos con la vista previa). */
export interface LimitesBorde {
  /** tope izquierdo: no se puede revelar contenido previo de la pista */
  inicioMin: number;
  inicioMax: number;
  finMin: number;
  /** tope derecho: final de la narración (la pista sigue en bucle) */
  finMax: number;
}

export function limitesBorde(
  b: BloqueMusica,
  duracionSec: number
): LimitesBorde {
  const offset = Math.max(0, b.offsetOrigen ?? 0);
  return {
    // estirar a la izquierda solo hasta agotar el contenido de la pista
    // (como Camtasia: el medio original empieza en su segundo 0)
    inicioMin: Math.max(0, b.inicio - offset),
    inicioMax: Math.max(b.fin - MIN_FRAG, b.inicio),
    finMin: Math.min(b.inicio + MIN_FRAG, b.fin),
    finMax: duracionSec,
  };
}

/** Redondea al grid de 0.1 s usado por todas las ediciones. */
const decimas = (v: number) => Math.round(v * 10) / 10;

/**
 * Recorta o alarga el bloque `id` moviendo uno de sus bordes (arrastre
 * estilo Camtasia). El borde izquierdo desplaza también el punto de
 * entrada en la pista original (offsetOrigen); el derecho estira el
 * bloque (la pista continúa en bucle si hace falta).
 */
export function recortarBloque(
  bloques: BloqueMusica[],
  id: string,
  lado: LadoRecorte,
  valor: number,
  duracionSec: number
): BloqueMusica[] | null {
  const i = bloques.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const b = bloques[i];
  const lim = limitesBorde(b, duracionSec);
  const v = decimas(clamp(valor, lado === "inicio" ? lim.inicioMin : lim.finMin, lado === "inicio" ? lim.inicioMax : lim.finMax));
  const offset = Math.max(0, b.offsetOrigen ?? 0);

  let nuevo: BloqueMusica;
  if (lado === "inicio") {
    if (Math.abs(v - b.inicio) < 0.05) return null;
    const dur = b.fin - v;
    nuevo = {
      ...b,
      inicio: v,
      offsetOrigen: Math.max(0, decimas(offset + (v - b.inicio))),
      fadeInSeg: Math.min(b.fadeInSeg, dur / 2),
      fadeOutSeg: Math.min(b.fadeOutSeg, dur / 2),
      origen: "edicion",
    };
  } else {
    if (Math.abs(v - b.fin) < 0.05) return null;
    const dur = v - b.inicio;
    nuevo = {
      ...b,
      fin: v,
      fadeInSeg: Math.min(b.fadeInSeg, dur / 2),
      fadeOutSeg: Math.min(b.fadeOutSeg, dur / 2),
      origen: "edicion",
    };
  }
  const copia = [...bloques];
  copia[i] = nuevo;
  return copia;
}

let contadorEdicion = 0;
const nuevoId = () => `ed-${++contadorEdicion}-${Math.round(Date.now() / 1000) % 100000}`;

/** Divide el bloque `id` en el instante `t` (cuchilla). */
export function dividirBloque(
  bloques: BloqueMusica[],
  id: string,
  t: number
): BloqueMusica[] | null {
  const i = bloques.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const b = bloques[i];
  const dentro = t > b.inicio + MIN_DUR / 2 && t < b.fin - MIN_DUR / 2;
  if (!dentro) return null;
  const izq: BloqueMusica = {
    ...b,
    id: nuevoId(),
    fin: t,
    fadeInSeg: b.fadeInSeg,
    fadeOutSeg: Math.min(b.fadeOutSeg, (t - b.inicio) / 2),
    origen: "edicion",
    offsetOrigen: b.offsetOrigen ?? 0,
  };
  // la mitad derecha CONTINÚA el contenido de la pista donde la dejó la
  // izquierda (mismo punto de entrada + lo que dura la mitad izquierda)
  const der: BloqueMusica = {
    ...b,
    id: nuevoId(),
    inicio: t,
    fadeInSeg: Math.min(b.fadeInSeg, (b.fin - t) / 2),
    fadeOutSeg: b.fadeOutSeg,
    origen: "edicion",
    offsetOrigen: Math.max(0, (b.offsetOrigen ?? 0) + (t - b.inicio)),
  };
  const copia = [...bloques];
  copia.splice(i, 1, izq, der);
  return copia;
}

/**
 * Mueve el bloque `id` para que empiece en `nuevoInicio` (arrastre) dentro
 * de [0, duración]. Se permiten solapes con vecinos (como en Camtasia:
 * dos bloques sonando a la vez se suman).
 */
export function moverBloque(
  bloques: BloqueMusica[],
  id: string,
  nuevoInicio: number,
  duracionSec: number
): BloqueMusica[] | null {
  const i = bloques.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const b = bloques[i];
  const dur = b.fin - b.inicio;
  const inicio = clamp(
    Math.round(nuevoInicio * 10) / 10,
    0,
    Math.max(0, duracionSec - dur)
  );
  if (Math.abs(inicio - b.inicio) < 0.05) return null;

  const copia = [...bloques];
  copia[i] = { ...b, inicio, fin: inicio + dur, origen: "edicion" };
  return copia;
}

/** Elimina el bloque `id`. */
export function eliminarBloque(
  bloques: BloqueMusica[],
  id: string
): BloqueMusica[] | null {
  if (!bloques.some((b) => b.id === id)) return null;
  return bloques.filter((b) => b.id !== id);
}

/** Silencia/activa el bloque `id`. */
export function silenciarBloque(
  bloques: BloqueMusica[],
  id: string
): BloqueMusica[] | null {
  const i = bloques.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const copia = [...bloques];
  copia[i] = { ...copia[i], muted: !copia[i].muted };
  return copia;
}

/** Cambia la pista del bloque `id` (la nueva pista arranca desde su principio). */
export function cambiarPistaBloque(
  bloques: BloqueMusica[],
  id: string,
  pistaId: string
): BloqueMusica[] | null {
  const i = bloques.findIndex((b) => b.id === id);
  if (i < 0 || bloques[i].pistaId === pistaId) return null;
  const copia = [...bloques];
  copia[i] = { ...copia[i], pistaId, offsetOrigen: 0, origen: "edicion" };
  return copia;
}

/** Número de bucles completos que suena la pista dentro del bloque. */
export function buclesDe(b: BloqueMusica, durPistaSec: number): number {
  if (!Number.isFinite(durPistaSec) || durPistaSec <= 0.5) return 1;
  const offset = Math.max(0, b.offsetOrigen ?? 0);
  return Math.max(1, Math.ceil((offset + (b.fin - b.inicio)) / durPistaSec));
}

/** Estadísticas de edición para la puerta de auditoría. */
export function resumenEdiciones(bloques: BloqueMusica[]) {
  const cortes = bloques.filter((b) => b.origen === "edicion").length;
  const silenciados = bloques.filter((b) => b.muted).length;
  return { cortes, silenciados };
}
