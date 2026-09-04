/** Detección de silencios sobre la envolvente RMS (por ventanas de hopSec). */

export interface SilenceRegion {
  id: string;
  start: number;
  end: number;
}

export interface SilenceStats {
  regions: SilenceRegion[];
  totalSilenceSec: number;
  speechRatio: number;
}

/**
 * Detecta regiones de silencio:
 *  - una ventana está "en silencio" si su RMS ≤ umbralDb.
 *  - huecos entre silencios menores que fusionHuecosSeg se fusionan
 *    (evita parpadeos por pausas respiratorias).
 *  - solo se conservan las regiones con duración ≥ duracionMinimaSeg.
 */
export function detectSilences(
  envDb: Float32Array,
  hopSec: number,
  umbralDb: number,
  duracionMinimaSeg: number,
  fusionHuecosSeg = 0.25
): SilenceStats {
  const n = envDb.length;
  const gapWin = Math.max(0, Math.round(fusionHuecosSeg / hopSec));
  const regions: SilenceRegion[] = [];

  let i = 0;
  while (i < n) {
    if (envDb[i] <= umbralDb) {
      let j = i + 1;
      let gap = 0;
      while (j < n) {
        if (envDb[j] <= umbralDb) {
          j++;
          gap = 0;
        } else {
          gap++;
          if (gap > gapWin) break;
          j++;
        }
      }
      const endWindow = j - gap;
      const start = i * hopSec;
      const end = endWindow * hopSec;
      if (end - start >= duracionMinimaSeg - 1e-9) {
        regions.push({
          id: `sil-${regions.length + 1}`,
          start: Math.round(start * 1000) / 1000,
          end: Math.round(end * 1000) / 1000,
        });
      }
      i = j;
    } else {
      i++;
    }
  }

  const totalSilence = regions.reduce((s, r) => s + (r.end - r.start), 0);
  const total = n * hopSec;
  return {
    regions,
    totalSilenceSec: Math.round(totalSilence * 100) / 100,
    speechRatio: total > 0 ? Math.max(0, Math.min(1, 1 - totalSilence / total)) : 1,
  };
}
