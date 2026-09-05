/**
 * Cálculo determinista de la mezcla automática (Fase 4) a partir de las
 * escenas aprobadas (Fase 2), las asignaciones (Fase 3), la envolvente de
 * voz (Fase 1) y los parámetros editables.
 *
 * Produce:
 *  - BloquesMusica: una pista por grupo de escenas contiguas, con crossfades.
 *  - nivelDb (10 Hz): nivel musical por escena (tensión) + hincha en silencios
 *    + máscara de huecos tras ediciones.
 *  - duckDb (10 Hz): envolvente de ducking con ataque/liberación suavizados.
 */

import type { Escena } from "@/lib/fase2/types";
import type { SilenceRegion } from "@/lib/audio/silence";
import type { Asignacion } from "@/lib/fase3/tipos";
import type { BloqueMusica, Fase4Params, Mezcla } from "./tipos";

const HOP = 0.1; // 10 Hz
const NIVEL_SILENCIO = -60; // dB para huecos sin bloque
const MARGEN_VOZ_DB = 6; // la voz «activa» supera el umbral + margen
const SILENCIO_MIN_HINCHAR = 3; // s

export interface EntradaMezcla {
  escenas: Escena[];
  asignaciones: Asignacion[];
  duracionSec: number;
  envDb: Float32Array;
  envHopSec: number;
  umbralVozDb: number;
  silencios: SilenceRegion[];
  params: Fase4Params;
  /** Fase 5: recalcular con bloques editados (cortes/movidas/borrados) */
  bloquesOverride?: BloqueMusica[];
  /** SFX: ¿el bus de efectos respeta el ducking de la voz? (defecto: no) */
  sfxRespetarDucking?: boolean;
}

/** Agrupa escenas contiguas con la misma pista en bloques con crossfades. */
export function construirBloques(
  escenas: Escena[],
  asignaciones: Asignacion[],
  crossfadeSeg: number
): BloqueMusica[] {
  const porEscena = new Map(asignaciones.map((a) => [a.escenaId, a.pistaId]));
  const bloques: BloqueMusica[] = [];
  let actual: { pistaId: string; inicio: number; fin: number } | null = null;

  for (const e of escenas) {
    const pistaId = porEscena.get(e.id);
    if (!pistaId) {
      if (actual) {
        bloques.push(crearBloque(actual, crossfadeSeg, bloques.length));
        actual = null;
      }
      continue;
    }
    if (actual && actual.pistaId === pistaId) {
      actual.fin = e.fin;
    } else {
      if (actual) bloques.push(crearBloque(actual, crossfadeSeg, bloques.length));
      actual = { pistaId, inicio: e.inicio, fin: e.fin };
    }
  }
  if (actual) bloques.push(crearBloque(actual, crossfadeSeg, bloques.length));
  return bloques;
}

function crearBloque(
  b: { pistaId: string; inicio: number; fin: number },
  crossfadeSeg: number,
  idx: number
): BloqueMusica {
  const dur = Math.max(0.5, b.fin - b.inicio);
  const fade = Math.min(crossfadeSeg, dur / 2);
  return {
    id: `bm-${idx}-${Math.round(b.inicio * 10)}`,
    pistaId: b.pistaId,
    inicio: b.inicio,
    fin: b.fin,
    fadeInSeg: fade,
    fadeOutSeg: fade,
    muted: false,
    origen: "auto",
    offsetOrigen: 0,
  };
}

/** Nivel por escena interpolado linealmente entre centros de escena. */
function nivelEscenaDb(
  escenas: Escena[],
  params: Fase4Params,
  nMuestras: number,
  duracionSec: number
): Float32Array {
  const out = new Float32Array(nMuestras);
  if (escenas.length === 0) {
    out.fill(NIVEL_SILENCIO);
    return out;
  }
  const centros = escenas.map((e) => (e.inicio + e.fin) / 2);
  const niveles = escenas.map(
    (e) => params.nivelMusicaDb + params.rangoDinamicoDb * (e.tension / 100)
  );
  for (let i = 0; i < nMuestras; i++) {
    const t = Math.min(duracionSec - 0.001, i * HOP);
    if (t <= centros[0]) {
      out[i] = niveles[0];
      continue;
    }
    if (t >= centros[centros.length - 1]) {
      out[i] = niveles[niveles.length - 1];
      continue;
    }
    // búsqueda binaria del segmento
    let lo = 0;
    let hi = centros.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (centros[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = centros[hi] - centros[lo];
    const frac = span > 0 ? (t - centros[lo]) / span : 0;
    out[i] = niveles[lo] + (niveles[hi] - niveles[lo]) * frac;
  }
  return out;
}

/** Suma el hinchado (+dB) en los silencios largos aprobados. */
function hinchadoSilencios(
  nivel: Float32Array,
  silencios: SilenceRegion[],
  cantidadDb: number,
  duracionSec: number
): number {
  if (cantidadDb <= 0) return 0;
  let hinchados = 0;
  for (const s of silencios) {
    const dur = s.end - s.start;
    if (dur < SILENCIO_MIN_HINCHAR) continue;
    hinchados++;
    const pico = Math.max(s.start + dur * 0.3, s.start + 1);
    const caida = Math.min(s.end - 0.4, pico + dur * 0.35);
    const i0 = Math.max(0, Math.floor(s.start / HOP));
    const i1 = Math.min(nivel.length - 1, Math.floor((duracionSec - 0.05) / HOP));
    for (let i = i0; i <= i1; i++) {
      const t = i * HOP;
      if (t >= s.end) break;
      let g = 0;
      if (t < pico) {
        const subida = pico - s.start;
        g = subida > 0.01 ? Math.min(1, (t - s.start) / subida) : 1;
      } else if (t <= caida) {
        g = 1;
      } else {
        const bajada = s.end - caida;
        g = bajada > 0.01 ? Math.max(0, 1 - (t - caida) / bajada) : 0;
      }
      nivel[i] += cantidadDb * g;
    }
  }
  return hinchados;
}

/**
 * Máscara de bloques: fuera del territorio de todo bloque activo el nivel
 * cae a NIVEL_SILENCIO con rampas de 0.3 s (huecos tras ediciones o pistas
 * silenciadas).
 */
function mascaraBloques(
  nivel: Float32Array,
  bloques: BloqueMusica[],
  duracionSec: number
) {
  const activos = bloques.filter((b) => !b.muted && b.fin > b.inicio);
  if (activos.length === 0) {
    nivel.fill(NIVEL_SILENCIO);
    return;
  }
  const n = nivel.length;
  // cobertura por muestra: 1 dentro, 0 fuera
  const dentro = new Uint8Array(n);
  for (const b of activos) {
    const i0 = Math.max(0, Math.floor(b.inicio / HOP));
    const i1 = Math.min(n - 1, Math.ceil(b.fin / HOP));
    for (let i = i0; i <= i1; i++) dentro[i] = 1;
  }
  // distancia (en muestras) al bloque activo más próximo
  const dist = new Int32Array(n).fill(n + 1);
  let d = n + 1;
  for (let i = 0; i < n; i++) {
    d = dentro[i] ? 0 : d + 1;
    dist[i] = d;
  }
  d = n + 1;
  for (let i = n - 1; i >= 0; i--) {
    d = dentro[i] ? 0 : d + 1;
    if (d < dist[i]) dist[i] = d;
  }
  const rampa = Math.round(0.3 / HOP); // 3 muestras
  for (let i = 0; i < n; i++) {
    if (dentro[i]) continue;
    const fuera = Math.min(dist[i], rampa);
    const caida = 1 - fuera / (rampa + 1);
    nivel[i] = NIVEL_SILENCIO + (nivel[i] - NIVEL_SILENCIO) * caida;
  }
}

/** Envolvente de ducking (≤ 0 dB) con ataque/liberación exponenciales. */
export function calcularDuck(
  envDb: Float32Array,
  envHopSec: number,
  umbralVozDb: number,
  params: Fase4Params,
  nMuestras: number
): Float32Array {
  const out = new Float32Array(nMuestras);
  const umbral = umbralVozDb + MARGEN_VOZ_DB;
  const tauAtaque = Math.max(0.01, params.ataqueMs / 1000);
  const tauLiberacion = Math.max(0.05, params.liberacionMs / 1000);
  const alphaAtaque = 1 - Math.exp(-HOP / tauAtaque);
  const alphaLiberacion = 1 - Math.exp(-HOP / tauLiberacion);
  let actual = 0; // dB (0 = sin duck)
  for (let i = 0; i < nMuestras; i++) {
    // muestra de voz más cercana en la rejilla de la Fase 1
    const j = Math.min(
      envDb.length - 1,
      Math.max(0, Math.round((i * HOP) / envHopSec))
    );
    const vozActiva = j < envDb.length && envDb[j] > umbral;
    const objetivo = vozActiva ? -params.profundidadDuckingDb : 0;
    const alpha = objetivo < actual ? alphaAtaque : alphaLiberacion;
    actual += (objetivo - actual) * alpha;
    out[i] = actual;
  }
  return out;
}

/** Cálculo completo de la mezcla (Fase 4). */
export function calcularMezcla(ent: EntradaMezcla): Mezcla {
  const dur = Math.max(1, ent.duracionSec);
  const n = Math.max(1, Math.ceil(dur / HOP));

  const bloques =
    ent.bloquesOverride ??
    construirBloques(ent.escenas, ent.asignaciones, ent.params.crossfadeSeg);

  const nivel = nivelEscenaDb(ent.escenas, ent.params, n, dur);
  const hinchados = hinchadoSilencios(
    nivel,
    ent.silencios,
    ent.params.hincharSilenciosDb,
    dur
  );
  mascaraBloques(nivel, bloques, dur);
  const duck = calcularDuck(
    ent.envDb,
    ent.envHopSec,
    ent.umbralVozDb,
    ent.params,
    n
  );

  // ducking del bus de SFX: si respeta la voz, baja la MITAD de lo que baja
  // la música («baja ligeramente», según config del módulo); si no, 0 dB.
  const duckSfx = new Float32Array(n);
  if (ent.sfxRespetarDucking) {
    for (let i = 0; i < n; i++) duckSfx[i] = duck[i] * 0.5;
  }

  // estadísticas
  let tiempoMusica = 0;
  for (const b of bloques) {
    if (!b.muted) tiempoMusica += Math.max(0, b.fin - b.inicio);
  }
  let nivelSum = 0;
  let nivelN = 0;
  let duckSum = 0;
  let duckN = 0;
  for (let i = 0; i < n; i++) {
    if (nivel[i] > NIVEL_SILENCIO + 3) {
      nivelSum += nivel[i];
      nivelN++;
    }
    if (duck[i] < -0.5) {
      duckSum += duck[i];
      duckN++;
    }
  }
  const crossfades = bloques
    .slice(0, -1)
    .filter((b, i) => bloques[i + 1].pistaId !== b.pistaId).length;

  return {
    bloques,
    nivelDb: nivel,
    duckDb: duck,
    duckSfxDb: duckSfx,
    hopSec: HOP,
    stats: {
      bloques: bloques.length,
      crossfades,
      tiempoConMusicaSec: Math.round(tiempoMusica),
      nivelMedioDb: nivelN > 0 ? Math.round((nivelSum / nivelN) * 10) / 10 : NIVEL_SILENCIO,
      duckMedioDb: duckN > 0 ? Math.round((duckSum / duckN) * 10) / 10 : 0,
      hinchados,
    },
  };
}
