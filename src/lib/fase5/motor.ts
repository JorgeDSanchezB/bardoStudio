/**
 * Motor de reproducción de la mezcla (Fase 5) sobre Web Audio.
 *
 * Grafo:
 *   voz ─────────────────────────────► gainVoz ─► analizadorVoz ─┐
 *   [bloque: buffer en bucle ─► gainFade] ─► busMusica (nivel)    │
 *        ─► gainDuck (ducking) ─► analizadorMusica ───────────────┤
 *   [clip SFX: buffer en bucle ─► gainFade·vol] ─► busSfx         │
 *        ─► gainDuckSfx ─► analizadorSfx ─────────────────────────┴─► master ─► destino
 *
 * Las envolventes de nivel y ducking (10 Hz, calculadas en Fase 4) se
 * programan con setValueCurveAtTime en tramos de 60 s; los fundidos de
 * entrada/salida de cada bloque y clip con ramps lineales.
 */

import type { BloqueMusica } from "@/lib/fase4/tipos";
import type { SfxClip } from "@/lib/sfx/tipos";
import { clamp } from "@/lib/format";

const HOP = 0.1;
const TRAMO_CURVA = 60; // s por setValueCurveAtTime
const UMBRAL_AUDIBLE = -90; // dB piso

const db2gain = (db: number) => Math.pow(10, db / 20);

export interface MotorConfig {
  bufferVoz: AudioBuffer;
  buffersPistas: Map<string, AudioBuffer>;
  bloques: BloqueMusica[];
  nivelDb: Float32Array;
  duckDb: Float32Array;
  hopSec: number;
  duracionSec: number;
  /** pista de efectos (Fase 5): clips + buffers decodificados + ducking propio */
  clipsSfx: SfxClip[];
  buffersSfx: Map<string, AudioBuffer>;
  duckSfxDb: Float32Array | null;
}

export interface LecturaMetros {
  vozDb: number;
  musicaDb: number;
  sfxDb: number;
}

/** Ganancia del fade de un bloque/clip en el instante t (0..1). */
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

function valorEn(env: Float32Array, hop: number, t: number): number {
  const i = clamp(Math.round(t / hop), 0, env.length - 1);
  return env[i];
}

function programarCurvas(
  param: AudioParam,
  env: Float32Array,
  hop: number,
  t0: number,
  desde: number,
  hasta: number
) {
  let t = desde;
  while (t < hasta - 0.05) {
    const durTramo = Math.min(TRAMO_CURVA, hasta - t);
    const n = Math.max(2, Math.round(durTramo / hop));
    const curva = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      curva[i] = db2gain(valorEn(env, hop, t + (i * durTramo) / n));
    }
    try {
      param.setValueCurveAtTime(curva, t0 + (t - desde), durTramo);
    } catch {
      // navegador sin soporte de curvas encadenadas: rampa global simple
      param.linearRampToValueAtTime(
        db2gain(valorEn(env, hop, hasta - 0.1)),
        t0 + (hasta - desde)
      );
      return;
    }
    t += durTramo;
  }
}

export class MotorMezcla {
  private ctx: AudioContext | null = null;
  private cfg: MotorConfig;
  private fuentes: AudioBufferSourceNode[] = [];
  private gainVoz: GainNode | null = null;
  private busMusica: GainNode | null = null;
  private gainDuck: GainNode | null = null;
  private busSfx: GainNode | null = null;
  private gainDuckSfx: GainNode | null = null;
  private analizadorVoz: AnalyserNode | null = null;
  private analizadorMusica: AnalyserNode | null = null;
  private analizadorSfx: AnalyserNode | null = null;
  private t0 = 0;
  private offset = 0;
  reproduciendo = false;
  private bufMetros = new Float32Array(2048);

  constructor(cfg: MotorConfig) {
    this.cfg = cfg;
  }

  /** Crea (una sola vez) el AudioContext del motor. */
  private async asegurarCtx(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  get duracion(): number {
    return this.cfg.duracionSec;
  }

  get posicion(): number {
    if (!this.reproduciendo || !this.ctx) return this.offset;
    return clamp(
      this.offset + (this.ctx.currentTime - this.t0),
      0,
      this.cfg.duracionSec
    );
  }

  /** Desmonta el grafo actual (fuentes y automatizaciones). */
  private desmontar() {
    for (const f of this.fuentes) {
      try {
        f.stop();
      } catch {
        /* ya detenido */
      }
      f.disconnect();
    }
    this.fuentes = [];
    this.busMusica = null;
    this.gainDuck = null;
    this.gainVoz = null;
    this.busSfx = null;
    this.gainDuckSfx = null;
    this.analizadorVoz = null;
    this.analizadorMusica = null;
    this.analizadorSfx = null;
  }

  /**
   * Monta una fuente de buffer en bucle sobre `destino` con la
   * automatización de fundidos del bloque/clip, escalada por `volumen`
   * (música: 1; SFX: ganancia lineal del volumen del clip).
   */
  private montarFuente(
    ctx: AudioContext,
    destino: GainNode,
    buffer: AudioBuffer,
    b: {
      inicio: number;
      fin: number;
      fadeInSeg: number;
      fadeOutSeg: number;
      offsetOrigen?: number;
    },
    desde: number,
    t0: number,
    volumen: number
  ) {
    const finTotal = b.fin + b.fadeOutSeg;
    if (finTotal <= desde + 0.05) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const g = ctx.createGain();
    src.connect(g);
    g.connect(destino);

    // arranque: en su inicio o ya en marcha desde `desde`; el punto de
    // entrada en el archivo es offsetOrigen (recorte de borde) y el archivo
    // va en bucle, así que se envuelve módulo su duración.
    const arranca = Math.max(b.inicio, desde);
    const cuando = t0 + (arranca - desde);
    const offsetOrigen = Math.max(0, b.offsetOrigen ?? 0);
    const fase =
      b.inicio >= desde - 0.001
        ? offsetOrigen % Math.max(0.1, buffer.duration)
        : (offsetOrigen + (desde - b.inicio)) % Math.max(0.1, buffer.duration);
    src.start(cuando, fase);

    const tParada = t0 + (finTotal - desde);
    if (Number.isFinite(tParada) && tParada > ctx.currentTime) {
      src.stop(Math.max(tParada, ctx.currentTime + 0.01));
    }

    // automatización del fade (escalada por el volumen del clip)
    const v0 = gananciaFade(b, arranca) * volumen;
    g.gain.setValueAtTime(v0, cuando);
    const tFinIn = t0 + (b.inicio + b.fadeInSeg - desde);
    const tFin = t0 + (b.fin - desde);
    const tOut = t0 + (finTotal - desde);
    if (tFinIn > cuando + 0.001)
      g.gain.linearRampToValueAtTime(volumen, tFinIn);
    if (tFin > Math.max(cuando, tFinIn) + 0.001) {
      g.gain.linearRampToValueAtTime(volumen, tFin);
    }
    if (tOut > cuando + 0.001) g.gain.linearRampToValueAtTime(0, tOut);

    src.onended = null;
    this.fuentes.push(src);
  }

  /** Construye el grafo y arranca la reproducción en `desde` segundos. */
  private montar(desde: number): number {
    const ctx = this.ctx!;
    this.desmontar();

    const t0 = ctx.currentTime + 0.08;
    this.t0 = t0;
    this.offset = clamp(desde, 0, this.cfg.duracionSec);

    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);

    // ---- voz ----
    const gainVoz = ctx.createGain();
    gainVoz.gain.value = 1;
    const anVoz = ctx.createAnalyser();
    anVoz.fftSize = 2048;
    gainVoz.connect(anVoz);
    anVoz.connect(master);
    this.gainVoz = gainVoz;
    this.analizadorVoz = anVoz;

    if (desde < this.cfg.bufferVoz.duration - 0.02) {
      const src = ctx.createBufferSource();
      src.buffer = this.cfg.bufferVoz;
      src.connect(gainVoz);
      src.start(t0, desde);
      this.fuentes.push(src);
    }

    // ---- música: bus de nivel + ducking ----
    const busMusica = ctx.createGain();
    busMusica.gain.value = 1;
    const gainDuck = ctx.createGain();
    gainDuck.gain.value = 1;
    const anMus = ctx.createAnalyser();
    anMus.fftSize = 2048;
    busMusica.connect(gainDuck);
    gainDuck.connect(anMus);
    anMus.connect(master);
    this.busMusica = busMusica;
    this.gainDuck = gainDuck;
    this.analizadorMusica = anMus;

    for (const b of this.cfg.bloques) {
      if (b.muted) continue;
      const buffer = this.cfg.buffersPistas.get(b.pistaId);
      if (!buffer) continue;
      this.montarFuente(ctx, busMusica, buffer, b, desde, t0, 1);
    }

    // ---- efectos (SFX): bus propio + ducking propio (configurable) ----
    const busSfx = ctx.createGain();
    busSfx.gain.value = 1;
    const gainDuckSfx = ctx.createGain();
    gainDuckSfx.gain.value = 1;
    const anSfx = ctx.createAnalyser();
    anSfx.fftSize = 2048;
    busSfx.connect(gainDuckSfx);
    gainDuckSfx.connect(anSfx);
    anSfx.connect(master);
    this.busSfx = busSfx;
    this.gainDuckSfx = gainDuckSfx;
    this.analizadorSfx = anSfx;

    for (const c of this.cfg.clipsSfx) {
      if (c.muted) continue;
      const buffer = this.cfg.buffersSfx.get(c.sfxId);
      if (!buffer) continue;
      this.montarFuente(
        ctx,
        busSfx,
        buffer,
        c,
        desde,
        t0,
        db2gain(c.volumenDb)
      );
    }

    // envolventes (nivel, duck y duck SFX) desde `desde` hasta el final
    programarCurvas(
      busMusica.gain,
      this.cfg.nivelDb,
      this.cfg.hopSec,
      t0,
      desde,
      this.cfg.duracionSec
    );
    programarCurvas(
      gainDuck.gain,
      this.cfg.duckDb,
      this.cfg.hopSec,
      t0,
      desde,
      this.cfg.duracionSec
    );
    if (this.cfg.duckSfxDb && this.cfg.duckSfxDb.length > 0) {
      programarCurvas(
        gainDuckSfx.gain,
        this.cfg.duckSfxDb,
        this.cfg.hopSec,
        t0,
        desde,
        this.cfg.duracionSec
      );
    }

    return t0;
  }

  async reproducir(desde?: number): Promise<void> {
    const ctx = await this.asegurarCtx();
    const inicio =
      desde !== undefined ? clamp(desde, 0, this.cfg.duracionSec) : this.posicion;
    this.montar(inicio);
    this.reproduciendo = true;
    void ctx;
  }

  /** Pausa y devuelve la posición actual exacta. */
  pausar(): number {
    const p = this.posicion;
    this.reproduciendo = false;
    this.offset = p;
    this.desmontar();
    return p;
  }

  detener(): number {
    const p = this.pausar();
    this.offset = 0;
    return 0;
  }

  async buscar(t: number): Promise<void> {
    const destino = clamp(t, 0, this.cfg.duracionSec);
    if (this.reproduciendo) {
      await this.asegurarCtx();
      this.montar(destino);
    } else {
      this.offset = destino;
    }
  }

  /** Sustituye la configuración (ediciones de bloques) reconstruyendo el grafo. */
  reconfigurar(cfg: MotorConfig) {
    this.cfg = cfg;
    if (this.reproduciendo && this.ctx) {
      this.montar(this.posicion);
    }
  }

  /** Lectura de los medidores (dB RMS de cada bus). */
  medir(): LecturaMetros {
    const leer = (an: AnalyserNode | null): number => {
      if (!an || !this.reproduciendo) return UMBRAL_AUDIBLE;
      an.getFloatTimeDomainData(this.bufMetros);
      let suma = 0;
      for (let i = 0; i < this.bufMetros.length; i++) {
        suma += this.bufMetros[i] * this.bufMetros[i];
      }
      const rms = Math.sqrt(suma / this.bufMetros.length);
      return rms > 1e-6 ? Math.max(UMBRAL_AUDIBLE, 20 * Math.log10(rms)) : UMBRAL_AUDIBLE;
    };
    return {
      vozDb: leer(this.analizadorVoz),
      musicaDb: leer(this.analizadorMusica),
      sfxDb: leer(this.analizadorSfx),
    };
  }

  dispose() {
    this.reproduciendo = false;
    this.desmontar();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

/** Decodifica la narración, las pistas y los archivos SFX usados. */
export async function decodificarFuentes(
  urlVoz: string,
  urlsPistas: Map<string, string>,
  urlsSfx?: Map<string, string>
): Promise<{
  bufferVoz: AudioBuffer;
  buffersPistas: Map<string, AudioBuffer>;
  buffersSfx: Map<string, AudioBuffer>;
}> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctor();
  const sfx = urlsSfx ?? new Map<string, string>();
  try {
    const [respVoz, ...respPistas] = await Promise.all([
      fetch(urlVoz).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} al leer la narración`);
        return r.arrayBuffer();
      }),
      ...[...urlsPistas.values()].map((u) =>
        fetch(u)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null)
      ),
      ...[...sfx.values()].map((u) =>
        fetch(u)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null)
      ),
    ]);
    const bufferVoz = await ctx.decodeAudioData(respVoz);
    const buffersPistas = new Map<string, AudioBuffer>();
    let i = 0;
    for (const id of urlsPistas.keys()) {
      const ab = respPistas[i++];
      if (!ab) continue;
      try {
        buffersPistas.set(id, await ctx.decodeAudioData(ab));
      } catch {
        /* pista ilegible: se salta */
      }
    }
    const buffersSfx = new Map<string, AudioBuffer>();
    for (const id of sfx.keys()) {
      const ab = respPistas[i++];
      if (!ab) continue;
      try {
        buffersSfx.set(id, await ctx.decodeAudioData(ab));
      } catch {
        /* SFX ilegible: se salta */
      }
    }
    // los buffers sobreviven al cierre del contexto de decodificación
    return { bufferVoz, buffersPistas, buffersSfx };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
