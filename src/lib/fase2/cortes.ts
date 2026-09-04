import type { SilenceRegion } from "@/lib/audio/silence";

/**
 * Calcula puntos de corte para trocear la narración en bloques.
 *
 * Estrategia (spec Fase 2): bloques lógicos de `bloqueSeg` (5 min) cuyo corte
 * se AJUSTA al punto medio del silencio aprobado más cercano al objetivo
 * (± `ajusteSeg`), prefiriendo cortes que no alarguen el bloque más allá de
 * `objetivo + margenExtra`. Sin silencios cercanos → corte exacto.
 *
 * La misma función sirve para los sub-bloques ASR (≤ asrMaxSeg): basta pasar
 * `duracion` = duración del bloque y silencios relativos a él. `topeDuro`
 * garantiza que ningún tramo supere ese máximo absoluto (el ASR admite ≤ 30 s).
 */
export function calcularCortes(
  duracion: number,
  silencios: Array<{ start: number; end: number }>,
  bloqueSeg: number,
  ajusteSeg: number,
  margenExtra = 15,
  topeDuro: number | null = null
): number[] {
  const puntos: number[] = [0];
  if (!(duracion > 0)) return puntos;

  while (true) {
    const base = puntos[puntos.length - 1];
    const objetivo = base + bloqueSeg;

    // lo que queda ya es un bloque corto final → cerrar
    if (duracion - base <= bloqueSeg * 0.8) break;

    // preferencia 1: silencio cercano que no alargue el bloque
    let mejor: number | null = null;
    let mejorD = Infinity;
    for (const s of silencios) {
      const mid = (s.start + s.end) / 2;
      if (mid <= base) continue;
      const d = Math.abs(mid - objetivo);
      if (
        d <= ajusteSeg &&
        mid <= objetivo + margenExtra &&
        mid < duracion &&
        d < mejorD
      ) {
        mejor = mid;
        mejorD = d;
      }
    }
    // preferencia 2: cualquier silencio en ±ajuste (aunque alargue algo)
    if (mejor === null) {
      for (const s of silencios) {
        const mid = (s.start + s.end) / 2;
        if (mid <= base) continue;
        const d = Math.abs(mid - objetivo);
        if (d <= ajusteSeg && mid < duracion && d < mejorD) {
          mejor = mid;
          mejorD = d;
        }
      }
    }

    let corte = mejor ?? objetivo;
    // evita bloques ridículamente cortos por agrupación de silencios
    if (corte - base < bloqueSeg * 0.35) corte = objetivo;
    // tope duro (p. ej. asrMaxSeg del servicio)
    if (topeDuro !== null && corte - base > topeDuro) corte = base + topeDuro;
    if (corte <= base) corte = base + bloqueSeg; // salvaguarda

    puntos.push(Math.min(corte, duracion));
    if (puntos.length > 9999) break; // salvaguarda
  }

  puntos.push(duracion);
  return puntos.map((p) => Math.round(p * 1000) / 1000);
}

/**
 * Sub-bloques ASR dentro de [t0, t1]: cortes en silencios con tope duro de
 * `asrMaxSeg` (el servicio de transcripción admite 0–30 s por archivo).
 */
export function calcularSubBloques(
  t0: number,
  t1: number,
  silencios: SilenceRegion[],
  asrMaxSeg: number
): Array<{ inicio: number; fin: number }> {
  const dur = t1 - t0;
  if (dur <= 0) return [];
  const relativos = silencios
    .filter((s) => s.end > t0 && s.start < t1)
    .map((s) => ({ start: Math.max(0, s.start - t0), end: Math.min(dur, s.end - t0) }));
  const ajuste = Math.max(6, Math.min(20, asrMaxSeg * 0.7));
  const cortes = calcularCortes(
    dur,
    relativos,
    asrMaxSeg,
    ajuste,
    Math.max(3, Math.round(asrMaxSeg * 0.15)),
    asrMaxSeg
  );
  const out: Array<{ inicio: number; fin: number }> = [];
  for (let i = 0; i < cortes.length - 1; i++) {
    const inicio = t0 + cortes[i];
    const fin = t0 + cortes[i + 1];
    if (fin - inicio >= 0.5) out.push({ inicio, fin });
  }
  return out;
}
