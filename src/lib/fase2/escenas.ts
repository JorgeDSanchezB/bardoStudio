import type { Escena, Segmento } from "./types";
import { clamp } from "@/lib/format";

/**
 * Construcción de escenas (rejilla temporal) y energía de voz 0-100.
 * La energía se normaliza frente al dBFS medio de la voz de toda la
 * narración: escenas más fuertes que la media suben, más suaves bajan.
 */

/** dBFS medio (energía) de las ventanas con voz de todo el archivo. */
export function dbMedioVoz(
  envDb: Float32Array,
  umbralDb: number,
  pisoDb = -55
): number | null {
  let suma = 0;
  let n = 0;
  for (let i = 0; i < envDb.length; i++) {
    const db = envDb[i];
    if (db > umbralDb + 2 && db > pisoDb) {
      suma += Math.pow(10, db / 10);
      n++;
    }
  }
  return n > 0 ? 10 * Math.log10(suma / n) : null;
}

/** Energía 0-100 de una escena, normalizada frente a la voz media. */
export function energiaDeEscena(
  envDb: Float32Array,
  hopSec: number,
  inicio: number,
  fin: number,
  umbralDb: number,
  dbProm: number | null
): number {
  const w0 = Math.max(0, Math.floor(inicio / hopSec));
  const w1 = Math.min(envDb.length, Math.ceil(fin / hopSec));
  let suma = 0;
  let n = 0;
  for (let i = w0; i < w1; i++) {
    const db = envDb[i];
    if (db > umbralDb + 2) {
      suma += Math.pow(10, db / 10);
      n++;
    }
  }
  if (n === 0 || dbProm === null) return 0;
  const db = 10 * Math.log10(suma / n);
  const ratio = Math.pow(10, (db - dbProm) / 20);
  return Math.round(clamp(50 + 90 * (ratio - 1), 0, 100));
}

const redondeo = (t: number) => Math.round(t * 100) / 100;

/** Escenas por rejilla fija de `escenaSeg` con el texto de los segmentos. */
export function construirEscenas(args: {
  durationSec: number;
  escenaSeg: number;
  segmentos: Segmento[];
  envDb: Float32Array;
  hopSec: number;
  umbralDb: number;
  dbProm: number | null;
}): Escena[] {
  const { durationSec, escenaSeg, segmentos, envDb, hopSec, umbralDb, dbProm } = args;
  const n = Math.max(1, Math.ceil(durationSec / Math.max(1, escenaSeg)));
  const textos: string[][] = Array.from({ length: n }, () => []);
  for (const s of segmentos) {
    const mid = (s.inicio + s.fin) / 2;
    const i = Math.min(n - 1, Math.max(0, Math.floor(mid / escenaSeg)));
    textos[i].push(s.texto);
  }
  const escenas: Escena[] = [];
  for (let i = 0; i < n; i++) {
    const inicio = redondeo(i * escenaSeg);
    const fin = redondeo(Math.min((i + 1) * escenaSeg, durationSec));
    escenas.push({
      id: `esc-${i + 1}`,
      n: i + 1,
      inicio,
      fin,
      texto: textos[i].join(" ").trim(),
      energia: energiaDeEscena(envDb, hopSec, inicio, fin, umbralDb, dbProm),
      // provisional hasta que llegue el análisis de emoción:
      tensionAuto: 0,
      tension: 0,
      corregido: false,
      animo: "neutro",
      fuente: "energia",
    });
  }
  return escenas;
}
