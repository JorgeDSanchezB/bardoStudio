import type { Segmento } from "./types";

/**
 * Alineación temporal del texto transcrito usando la energía de voz de la
 * Fase 1 (envolvente RMS). El servicio ASR devuelve texto por sub-bloque; aquí
 * se reparten las frases sobre las regiones con voz en proporción a su
 * duración → cada frase recibe un [inicio, fin] estimado.
 */

/** Regiones con voz dentro de [t0, t1] según la envolvente (umbral de Fase 1). */
export function regionesDeVoz(
  envDb: Float32Array,
  hopSec: number,
  t0: number,
  t1: number,
  umbralDb: number,
  fusionHuecosSeg = 0.35,
  minDurSec = 0.25
): Array<{ start: number; end: number }> {
  const w0 = Math.max(0, Math.floor(t0 / hopSec));
  const w1 = Math.min(envDb.length, Math.ceil(t1 / hopSec));
  const regiones: Array<{ start: number; end: number }> = [];
  const gapWin = Math.max(1, Math.round(fusionHuecosSeg / hopSec));
  let i = w0;
  while (i < w1) {
    if (envDb[i] > umbralDb) {
      let j = i + 1;
      let hueco = 0;
      while (j < w1) {
        if (envDb[j] > umbralDb) {
          j++;
          hueco = 0;
        } else {
          hueco++;
          if (hueco >= gapWin) break;
          j++;
        }
      }
      const finVentana = Math.max(i, j - hueco);
      const start = i * hopSec;
      const end = finVentana * hopSec;
      if (end - start >= minDurSec) regiones.push({ start, end });
      i = j;
    } else {
      i++;
    }
  }
  return regiones;
}

/** Divide el texto en frases (., !, ?, …) con respaldo por longitud. */
export function dividirEnFrases(texto: string, maxLargo = 220): string[] {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (!limpio) return [];
  const brutas = limpio.match(/[^.!?…]+[.!?…]+["»']?/g) ?? [limpio];
  const frases = brutas.map((f) => f.trim()).filter(Boolean);
  const out: string[] = [];
  for (const f of frases) {
    if (f.length <= maxLargo) {
      out.push(f);
      continue;
    }
    const palabras = f.split(" ");
    let acc = "";
    for (const p of palabras) {
      const cand = acc ? `${acc} ${p}` : p;
      if (cand.length > maxLargo && acc) {
        out.push(acc.trim());
        acc = p;
      } else {
        acc = cand;
      }
    }
    if (acc.trim()) out.push(acc.trim());
  }
  return out;
}

const redondeo = (t: number) => Math.round(t * 100) / 100;

/**
 * Reparte las frases del sub-bloque sobre sus regiones de voz, proporcional
 * a la duración de cada región. Devuelve segmentos con tiempos estimados.
 */
export function alinearSubBloque(
  bloqueIdx: number,
  t0: number,
  t1: number,
  texto: string,
  regiones: Array<{ start: number; end: number }>,
  idDesde: number
): Segmento[] {
  const frases = dividirEnFrases(texto);
  if (frases.length === 0) return [];

  const marcas =
    regiones.length > 0 ? regiones : [{ start: t0, end: Math.max(t1, t0 + 1) }];
  const durMarcas = marcas.reduce((s, m) => s + (m.end - m.start), 0) || 1;
  const totalChars = frases.reduce((s, f) => s + f.length, 0) || 1;

  /** fracción de texto (0-1) → tiempo absoluto recorriendo las marcas */
  const tiempoDeFraccion = (frac: number): number => {
    let restante = frac * durMarcas;
    for (let k = 0; k < marcas.length; k++) {
      const d = marcas[k].end - marcas[k].start;
      if (restante <= d || k === marcas.length - 1) {
        return marcas[k].start + Math.min(restante, d);
      }
      restante -= d;
    }
    return t1;
  };

  const segs: Segmento[] = [];
  let acum = 0;
  frases.forEach((f, idx) => {
    const c0 = acum / totalChars;
    acum += f.length;
    const c1 = acum / totalChars;
    const inicio = Math.min(Math.max(t0, tiempoDeFraccion(c0)), t1);
    const fin = Math.min(Math.max(inicio + 0.2, tiempoDeFraccion(c1)), t1);
    segs.push({
      id: `seg-${idDesde + idx + 1}`,
      bloque: bloqueIdx,
      inicio: redondeo(inicio),
      fin: redondeo(fin),
      texto: f,
    });
  });
  return segs;
}
