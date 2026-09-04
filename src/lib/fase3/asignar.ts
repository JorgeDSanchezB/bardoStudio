/**
 * Matching determinista y auditable de la Fase 3:
 * asigna una pista de la biblioteca a cada escena aprobada de la Fase 2.
 *
 * Reglas (todas locales, sin IA — revisables en el PDF final):
 *  1. Compatibilidad de ánimo: solo pistas del ánimo de la escena (o el
 *     comodín «neutro» si el ánimo no tiene pistas).
 *  2. Banda de tensión: penaliza la distancia de la tensión de la escena al
 *     rango [tensionMin, tensionMax] de la pista.
 *  3. Continuidad: mientras la pista actual lleve menos de
 *     duracionMinBloqueSeg sigue siendo la candidata preferente (+bonus).
 *  4. Anti-fatiga: penaliza las pistas más usadas en la ventana reciente de
 *     penalizacionFatigaMin minutos.
 */

import type { Escena } from "@/lib/fase2/types";
import type { Asignacion, Fase3Config, Pista } from "./tipos";
import { pistasParaAnimo } from "./tipos";

interface Score {
  pista: Pista;
  puntos: number;
}

function puntuar(
  escena: Escena,
  pista: Pista,
  contexto: {
    actualId: string | null;
    minutosConActual: number;
    usoReciente: Map<string, number>; // pistaId → minutos en la ventana
  },
  minBloqueSeg: number
): Score {
  // 1) base por compatibilidad de ánimo (la preselección ya lo garantiza)
  let puntos = 100;

  // 2) banda de tensión
  const t = escena.tension;
  let dist = 0;
  if (t < pista.tensionMin) dist = pista.tensionMin - t;
  else if (t > pista.tensionMax) dist = t - pista.tensionMax;
  puntos -= dist * 1.6;

  // 3) continuidad: la pista actual es preferente mientras no cumpla minBloque
  if (contexto.actualId === pista.id && contexto.minutosConActual * 60 < minBloqueSeg) {
    puntos += 45;
  }

  // 4) anti-fatiga: minutos usados en la ventana reciente
  const uso = contexto.usoReciente.get(pista.id) ?? 0;
  puntos -= uso * 3;

  return { pista, puntos };
}

/**
 * Asigna una pista por escena de forma determinista.
 * Devuelve las asignaciones en el mismo orden que las escenas.
 */
export function asignarPistas(
  escenas: Escena[],
  pistas: Pista[],
  cfg: Fase3Config
): Asignacion[] {
  if (escenas.length === 0 || pistas.length === 0) return [];

  const minBloqueSeg = Math.max(5, cfg.duracionMinBloqueSeg);
  const fatigaMinSeg = Math.max(30, cfg.penalizacionFatigaMin) * 60;

  const asignaciones: Asignacion[] = [];
  let actualId: string | null = null;
  let tInicioActual = 0;

  for (const escena of escenas) {
    const contexto = {
      actualId,
      minutosConActual:
        actualId !== null ? Math.max(0, escena.inicio - tInicioActual) / 60 : 0,
      usoReciente: new Map<string, number>(),
    };
    // ventana de fatiga: uso reciente dentro del rango temporal
    const ventanaIni = Math.max(0, escena.inicio - fatigaMinSeg);
    for (const a of asignaciones) {
      const e = escenas.find((x) => x.id === a.escenaId);
      if (!e || e.fin <= ventanaIni) continue;
      const solape = Math.min(e.fin, escena.inicio) - Math.max(e.inicio, ventanaIni);
      if (solape <= 0) continue;
      contexto.usoReciente.set(
        a.pistaId,
        (contexto.usoReciente.get(a.pistaId) ?? 0) + solape / 60
      );
    }

    const candidatas = pistasParaAnimo(escena.animo, pistas);
    if (candidatas.length === 0) continue;

    let mejor: Score | null = null;
    for (const pista of candidatas) {
      const s = puntuar(escena, pista, contexto, minBloqueSeg);
      if (!mejor || s.puntos > mejor.puntos) mejor = s;
    }
    if (!mejor) continue;

    if (mejor.pista.id !== actualId) {
      actualId = mejor.pista.id;
      tInicioActual = escena.inicio;
    }

    asignaciones.push({
      escenaId: escena.id,
      pistaId: mejor.pista.id,
      match: Math.round(Math.min(100, Math.max(0, mejor.puntos))),
      origen: "auto",
    });
  }

  return asignaciones;
}

/** Recalcula el «match» de una asignación manual (para mostrar en la tabla). */
export function matchDePista(escena: Escena, pista: Pista): number {
  const t = escena.tension;
  let dist = 0;
  if (t < pista.tensionMin) dist = pista.tensionMin - t;
  else if (t > pista.tensionMax) dist = t - pista.tensionMax;
  if (pista.animo !== escena.animo && pista.animo !== "neutro") dist += 60;
  return Math.round(Math.min(100, Math.max(0, 100 - dist * 1.6)));
}

/** Estadísticas del conjunto de asignaciones (resumen de la Fase 3). */
export function resumirAsignaciones(
  escenas: Escena[],
  asignaciones: Asignacion[]
) {
  const usadas = new Set(asignaciones.map((a) => a.pistaId));
  let cambios = 0;
  let prev: string | null = null;
  let tiempo = 0;
  for (const a of asignaciones) {
    if (prev !== null && a.pistaId !== prev) cambios++;
    prev = a.pistaId;
    const e = escenas.find((x) => x.id === a.escenaId);
    if (e) tiempo += Math.max(0, e.fin - e.inicio);
  }
  const manual = asignaciones.filter((a) => a.origen === "manual").length;
  return {
    pistasUsadas: usadas.size,
    cambios,
    auto: asignaciones.length - manual,
    manual,
    tiempoMusicaSec: Math.round(tiempo),
  };
}
