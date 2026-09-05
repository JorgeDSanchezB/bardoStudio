/**
 * Fase 6 — render offline de la mezcla (OfflineAudioContext a 6 canales):
 *   canales 0/1 = narración (L/R) · 2/3 = música (L/R) · 4/5 = efectos (L/R)
 * de ahí se derivan en JS: mezcla (voz+música+efectos), y los stems de voz,
 * música y efectos. WAV 16-bit PCM estéreo 44.1 kHz + normalización opcional.
 */

import type { BloqueMusica } from "@/lib/fase4/tipos";
import type { SfxClip } from "@/lib/sfx/tipos";
import { clamp } from "@/lib/format";

const HOP = 0.1;
const SR = 44100;

const db2gain = (db: number) => Math.pow(10, db / 20);

function valorEn(env: Float32Array, hop: number, t: number): number {
  const i = clamp(Math.round(t / hop), 0, env.length - 1);
  return env[i];
}

export interface OpcionesRender {
  arrayVoz: ArrayBuffer;
  arraysPistas: Map<string, ArrayBuffer>;
  bloques: BloqueMusica[];
  nivelDb: Float32Array;
  duckDb: Float32Array;
  hopSec: number;
  duracionSec: number;
  colaFinalSeg: number;
  normalizar: boolean;
  destinoDb: number;
  /** pista de efectos: archivos + clips editados + envolvente de ducking */
  arraysSfx: Map<string, ArrayBuffer>;
  clipsSfx: SfxClip[];
  duckSfxDb: Float32Array | null;
  onProgreso?: (fraccion: number) => void;
}

export interface CanalEstereo {
  L: Float32Array;
  R: Float32Array;
}

export interface ResultadoRender {
  mezcla: CanalEstereo;
  voz: CanalEstereo;
  musica: CanalEstereo;
  sfx: CanalEstereo;
  meta: {
    sampleRate: number;
    durSec: number;
    picoDb: number;
    rmsDb: number;
    gananciaNormalizacionDb: number;
  };
}

function programarCurvasOffline(
  param: AudioParam,
  env: Float32Array,
  hop: number,
  t0: number,
  desde: number,
  hasta: number
) {
  let t = desde;
  while (t < hasta - 0.05) {
    const durTramo = Math.min(60, hasta - t);
    const n = Math.max(2, Math.round(durTramo / hop));
    const curva = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      curva[i] = db2gain(valorEn(env, hop, t + (i * durTramo) / n));
    }
    try {
      param.setValueCurveAtTime(curva, t0 + (t - desde), durTramo);
    } catch {
      param.linearRampToValueAtTime(
        db2gain(valorEn(env, hop, hasta - 0.1)),
        t0 + (hasta - desde)
      );
      return;
    }
    t += durTramo;
  }
}

function gananciaFade(
  b: { inicio: number; fin: number; fadeInSeg: number; fadeOutSeg: number },
  t: number
): number {
  if (t < b.inicio || t > b.fin + b.fadeOutSeg) return 0;
  if (t < b.inicio + b.fadeInSeg) {
    const d = b.fadeInSeg > 0.001 ? (t - b.inicio) / b.fadeInSeg : 1;
    return clamp(d, 0, 1);
  }
  if (t > b.fin) {
    const d = b.fadeOutSeg > 0.001 ? (t - b.fin) / b.fadeOutSeg : 1;
    return clamp(1 - d, 0, 1);
  }
  return 1;
}

/**
 * Monta una fuente de buffer en bucle sobre `destino` con la automatización
 * de fundidos del bloque/clip, escalada por `volumen` (música: 1; SFX: la
 * ganancia lineal del volumen del clip). Igual que el motor en vivo.
 */
function montarFuenteOffline(
  ctx: OfflineAudioContext,
  destino: GainNode,
  buffer: AudioBuffer,
  b: {
    inicio: number;
    fin: number;
    fadeInSeg: number;
    fadeOutSeg: number;
    offsetOrigen?: number;
  },
  volumen: number
) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const g = ctx.createGain();
  src.connect(g);
  g.connect(destino);
  // punto de entrada = offsetOrigen (recorte de borde, Fase 5), envuelto
  // módulo la duración porque el archivo va en bucle
  const faseOrigen =
    Math.max(0, b.offsetOrigen ?? 0) % Math.max(0.1, buffer.duration);
  src.start(b.inicio, faseOrigen);
  src.stop(b.fin + b.fadeOutSeg + 0.01);
  g.gain.setValueAtTime(gananciaFade(b, b.inicio) * volumen, b.inicio);
  if (b.fadeInSeg > 0.001) {
    g.gain.linearRampToValueAtTime(volumen, b.inicio + b.fadeInSeg);
  }
  if (b.fin - b.inicio > b.fadeInSeg + 0.001) {
    g.gain.linearRampToValueAtTime(volumen, b.fin);
  }
  g.gain.linearRampToValueAtTime(0, b.fin + Math.max(0.001, b.fadeOutSeg));
}

/** Render completo (una sola pasada de 6 canales). */
export async function renderizarMezcla(
  op: OpcionesRender
): Promise<ResultadoRender> {
  const durTotal = op.duracionSec + op.colaFinalSeg;
  const ctx = new OfflineAudioContext(6, Math.ceil(durTotal * SR), SR);
  const t0 = 0;

  const merger = ctx.createChannelMerger(6);

  // ---- decodificar en el contexto offline (remuestrea a 44.1 kHz) ----
  const bufferVoz = await ctx.decodeAudioData(op.arrayVoz.slice(0));
  const buffersPistas = new Map<string, AudioBuffer>();
  for (const [id, ab] of op.arraysPistas) {
    try {
      buffersPistas.set(id, await ctx.decodeAudioData(ab.slice(0)));
    } catch {
      /* pista ilegible */
    }
  }
  const buffersSfx = new Map<string, AudioBuffer>();
  for (const [id, ab] of op.arraysSfx) {
    try {
      buffersSfx.set(id, await ctx.decodeAudioData(ab.slice(0)));
    } catch {
      /* SFX ilegible */
    }
  }

  // ---- voz → canales 0/1 ----
  const gainVoz = ctx.createGain();
  gainVoz.gain.value = 1;
  const srcVoz = ctx.createBufferSource();
  srcVoz.buffer = bufferVoz;
  srcVoz.connect(gainVoz);
  gainVoz.connect(merger, 0, 0);
  gainVoz.connect(merger, 0, 1);
  srcVoz.start(t0);

  // ---- música → canales 2/3 ----
  const busMusica = ctx.createGain();
  busMusica.gain.value = 1;
  const gainDuck = ctx.createGain();
  gainDuck.gain.value = 1;
  busMusica.connect(gainDuck);
  gainDuck.connect(merger, 0, 2);
  gainDuck.connect(merger, 0, 3);

  for (const b of op.bloques) {
    if (b.muted) continue;
    const buffer = buffersPistas.get(b.pistaId);
    if (!buffer) continue;
    montarFuenteOffline(ctx, busMusica, buffer, b, 1);
  }

  // ---- efectos → canales 4/5 ----
  const busSfx = ctx.createGain();
  busSfx.gain.value = 1;
  const gainDuckSfx = ctx.createGain();
  gainDuckSfx.gain.value = 1;
  busSfx.connect(gainDuckSfx);
  gainDuckSfx.connect(merger, 0, 4);
  gainDuckSfx.connect(merger, 0, 5);

  for (const c of op.clipsSfx) {
    if (c.muted) continue;
    const buffer = buffersSfx.get(c.sfxId);
    if (!buffer) continue;
    montarFuenteOffline(ctx, busSfx, buffer, c, db2gain(c.volumenDb));
  }

  programarCurvasOffline(
    busMusica.gain,
    op.nivelDb,
    op.hopSec,
    t0,
    0,
    op.duracionSec
  );
  programarCurvasOffline(
    gainDuck.gain,
    op.duckDb,
    op.hopSec,
    t0,
    0,
    op.duracionSec
  );
  if (op.duckSfxDb && op.duckSfxDb.length > 0) {
    programarCurvasOffline(
      gainDuckSfx.gain,
      op.duckSfxDb,
      op.hopSec,
      t0,
      0,
      op.duracionSec
    );
  }

  merger.connect(ctx.destination);

  // progreso vía suspend/resume (si el navegador lo soporta)
  const progreso = op.onProgreso;
  if (progreso) {
    const paso = Math.max(5, durTotal / 20);
    for (let t = paso; t < durTotal; t += paso) {
      const marca = t;
      try {
        void ctx.suspend(marca).then(() => {
          progreso(clamp(marca / durTotal, 0, 0.99));
          void ctx.resume();
        });
      } catch {
        break;
      }
    }
  }

  const render = await ctx.startRendering();
  progreso?.(1);

  const chVozL = render.getChannelData(0);
  const chVozR = render.getChannelData(1);
  const chMusL = render.getChannelData(2);
  const chMusR = render.getChannelData(3);
  const chSfxL = render.getChannelData(4);
  const chSfxR = render.getChannelData(5);

  // fundido de cola final (coseno) sobre TODO el material
  const n = render.length;
  const nCola = Math.min(n, Math.round(op.colaFinalSeg * SR));
  for (let i = 0; i < nCola; i++) {
    const k = (1 - Math.cos((Math.PI * i) / nCola)) / 2; // 0→1 no: queremos 1→0
    const g = 1 - k;
    const idx = n - nCola + i;
    chVozL[idx] *= g;
    chVozR[idx] *= g;
    chMusL[idx] *= g;
    chMusR[idx] *= g;
    chSfxL[idx] *= g;
    chSfxR[idx] *= g;
  }

  // mezcla = voz + música + efectos
  const mezclaL = new Float32Array(n);
  const mezclaR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mezclaL[i] = chVozL[i] + chMusL[i] + chSfxL[i];
    mezclaR[i] = chVozR[i] + chMusR[i] + chSfxR[i];
  }

  // normalización por pico de la MEZCLA (misma ganancia a los cuatro archivos)
  let pico = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(mezclaL[i]), Math.abs(mezclaR[i]));
    if (p > pico) pico = p;
  }
  let ganancia = 1;
  if (op.normalizar && pico > 1e-6) {
    ganancia = db2gain(op.destinoDb) / pico;
  }
  const aplicar = (arr: Float32Array) => {
    if (ganancia === 1) return;
    for (let i = 0; i < arr.length; i++) arr[i] = clamp(arr[i] * ganancia, -1, 1);
  };
  aplicar(mezclaL);
  aplicar(mezclaR);
  aplicar(chVozL);
  aplicar(chVozR);
  aplicar(chMusL);
  aplicar(chMusR);
  aplicar(chSfxL);
  aplicar(chSfxR);

  // métricas post-normalización
  let picoFinal = 0;
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(mezclaL[i]), Math.abs(mezclaR[i]));
    if (p > picoFinal) picoFinal = p;
    suma += (mezclaL[i] * mezclaL[i] + mezclaR[i] * mezclaR[i]) / 2;
  }
  const rms = Math.sqrt(suma / n);

  return {
    mezcla: { L: mezclaL, R: mezclaR },
    voz: { L: chVozL, R: chVozR },
    musica: { L: chMusL, R: chMusR },
    sfx: { L: chSfxL, R: chSfxR },
    meta: {
      sampleRate: SR,
      durSec: Math.round((n / SR) * 100) / 100,
      picoDb: picoFinal > 1e-6 ? Math.round(20 * Math.log10(picoFinal) * 10) / 10 : -90,
      rmsDb: rms > 1e-6 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -90,
      gananciaNormalizacionDb:
        ganancia !== 1 ? Math.round(20 * Math.log10(ganancia) * 10) / 10 : 0,
    },
  };
}

/** Codifica PCM 16-bit estéreo a un Blob WAV. */
export function codificarWavEstereo(
  can: CanalEstereo,
  sampleRate: number
): Blob {
  const n = can.L.length;
  const bytesDatos = n * 4; // 2 canales × 16 bits
  const buffer = new ArrayBuffer(44 + bytesDatos);
  const v = new DataView(buffer);
  const escribirStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  escribirStr(0, "RIFF");
  v.setUint32(4, 36 + bytesDatos, true);
  escribirStr(8, "WAVE");
  escribirStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // estéreo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  escribirStr(36, "data");
  v.setUint32(40, bytesDatos, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    const l = clamp(can.L[i], -1, 1);
    const r = clamp(can.R[i], -1, 1);
    v.setInt16(off, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    v.setInt16(off + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    off += 4;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export const HOP_RENDER = HOP;
export const SR_RENDER = SR;
