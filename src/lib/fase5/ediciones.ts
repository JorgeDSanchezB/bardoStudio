/**
 * Ediciones del editor de mezcla (Fase 5): cortes tipo cuchilla, mover,
 * eliminar, silenciar y cambiar de pista. Operaciones puras sobre el array
 * de bloques (deterministas y deshacibles desde la UI).
 */

import type { BloqueMusica } from "@/lib/fase4/tipos";
import { clamp } from "@/lib/format";

const MIN_DUR = 2; // s: fragmento mínimo tras un corte

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
  };
  const der: BloqueMusica = {
    ...b,
    id: nuevoId(),
    inicio: t,
    fadeInSeg: Math.min(b.fadeInSeg, (b.fin - t) / 2),
    fadeOutSeg: b.fadeOutSeg,
    origen: "edicion",
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

/** Cambia la pista del bloque `id` (con crossfade intacto). */
export function cambiarPistaBloque(
  bloques: BloqueMusica[],
  id: string,
  pistaId: string
): BloqueMusica[] | null {
  const i = bloques.findIndex((b) => b.id === id);
  if (i < 0 || bloques[i].pistaId === pistaId) return null;
  const copia = [...bloques];
  copia[i] = { ...copia[i], pistaId, origen: "edicion" };
  return copia;
}

/** Estadísticas de edición para la puerta de auditoría. */
export function resumenEdiciones(bloques: BloqueMusica[]) {
  const cortes = bloques.filter((b) => b.origen === "edicion").length;
  const silenciados = bloques.filter((b) => b.muted).length;
  return { cortes, silenciados };
}
