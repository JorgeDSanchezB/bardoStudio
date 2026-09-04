/**
 * Bardo Studio — Task 3-gen (agent: music-library-generator)
 *
 * FASE 3 — Biblioteca musical CC0: 9 pistas WAV sintetizadas 100 % de forma
 * determinista + manifiesto config/musica.json (lo escribe este propio script).
 *
 *   public/demo/musica/<id>.wav   → 9 archivos · RIFF/WAVE PCM 16-bit · MONO · 32000 Hz
 *   config/musica.json            → manifiesto (duraciones reales de los samples)
 *
 * El pipeline posterior (matching por ánimo/tensión, mezcla con ducking/crossfade
 * y export) consume estos archivos tal cual: rutas /demo/musica/<id>.wav.
 *
 * ── Determinismo ──────────────────────────────────────────────────────────────
 * Un LCG por pista (misma receta que scripts/generate-demo-audio.ts:
 * state = imul(state, 1664525) + 1013904223), seed fija y DISTINTA por pista:
 *   calma-aposento     0x0BA2D0A1    calma-posada       0x0BA2D0A2
 *   misterio-runas     0x0BA2D0A3    misterio-pergamino 0x0BA2D0A4
 *   tension-pasos      0x0BA2D0A5    tension-emboscada  0x0BA2D0A6
 *   batalla-acero      0x0BA2D0A7    victoria-amanecer  0x0BA2D0A8
 *   neutro-sendero     0x0BA2D0A9
 * Cero Math.random · cero dependencias externas (solo node:fs · node:path ·
 * node:crypto). Re-ejecutar produce bytes idénticos (sha256 impreso por pista
 * para verificar la idempotencia entre ejecuciones).
 *
 * ── Caja de herramientas de síntesis ──────────────────────────────────────────
 * · Osciladores aditivos por tabla (sierra con 10/12 armónicos 1/n) con lookup
 *   interpolado; detune ±0.3 % entre voces para efecto coro.
 * · Filtros de un polo (LPF/HPF) con coeficiente por bloque de control
 *   (16/32/64 muestras) y LFO lentos (0.05–0.4 Hz) sobre corte y ganancia.
 * · Karplus-Strong con retardo fraccionario (delay exacto = sr/f → afinación
 *   correcta), amortiguación por lazo y excitación suavida ajustable.
 * · Campanas FM (índice 2–4, ratios inarmónicos 1.41 / 2.71) con decaimiento
 *   exponencial doble (brillo + cuerpo) y guarda anti-aliasing del índice.
 * · Percusión: kick con barrido de tono 115→44 Hz, toms y timbales con barrido,
 *   caja / tick / pandereta / redoble con ruido banda-estrecha (LPF² → HPF,
 *   normalizado por pico), redobles crecientes.
 * · Reverb Schroeder global por pista: 4 combs en paralelo (29.7 / 37.1 / 41.1 /
 *   43.7 ms, feedback derivado del T60) → 2 allpass en serie (5 y 1.7 ms, g=0.7)
 *   + HPF de salida a 60 Hz; la mezcla húmeda se calibra por RMS (ratio por
 *   pista, 12–35 %).
 *
 * ── Mezcla y loop ─────────────────────────────────────────────────────────────
 * · Cada voz con su ganancia; el RMS global se calibra por pista (−22…−18 dBFS).
 * · Soft-limit tanh con techo 0.7 antes de cuantizar → pico true ≤ −3.1 dBFS.
 * · Loop reproducible: TODO el contenido (la entrada de la reverb incluida)
 *   vive en [1.2 s, dur − 1.6 s]; fundido de entrada/salida de 1.2 s a silencio
 *   en los extremos del archivo. Los primeros 1.2 s son silencio digital exacto
 *   y los últimos 1.2 s solo contienen cola de reverb atenuada por el fundido →
 *   sin transientes ni clicks al repetir el buffer en bucle.
 * · Progresiones: 2–4 acordes (tríadas con 7ª/9ª) coherentes con la tonalidad,
 *   cambio cada 4–8 compases según BPM; 2.ªs menores y tritonos solo en
 *   tensión/batalla (Si♭ frigio, G7♭9).
 *
 * Run: cd /home/z/my-project && bun scripts/generate-music-library.ts
 * (idempotente; ~35 s para las 9 pistas). Termina con "VERIFICATION OK" y exit 0.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ===========================================================================
// Rutas / constantes de formato
// ===========================================================================
const argv1 = process.argv[1] ?? process.cwd();
const PROJECT_ROOT = resolve(dirname(argv1), "..");
const MUSICA_DIR = join(PROJECT_ROOT, "public", "demo", "musica");
const MANIFEST_PATH = join(PROJECT_ROOT, "config", "musica.json");

const SR = 32000; // sample rate (Hz)
const CHANNELS = 1;
const BITS = 16;
const BYTES_PER_SAMPLE = 2;
const HEADER_BYTES = 44;

const FADE_S = 1.2; // fundido de entrada/salida a silencio (especificación)
const CONTENT_START = 1.2; // primer sample musical (38400 exacto) → loop limpio
const CONTENT_END_MARGIN = 1.6; // último sample de contenido/reverb-in ≤ dur − 1.6
const SOFT_CEIL = 0.7; // techo del tanh ≈ −3.1 dBFS

// ===========================================================================
// PRNG — LCG determinista (sin Math.random en TODO el archivo)
// ===========================================================================
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296; // uniforme [0, 1)
  };
}

// ===========================================================================
// Wavetables (sierra aditiva con armónicos decrecientes 1/n)
// ===========================================================================
const TABLE_BITS = 11;
const TABLE_N = 1 << TABLE_BITS; // 2048
const TABLE_MASK = TABLE_N - 1;

function buildSawTable(k: number): Float64Array {
  const t = new Float64Array(TABLE_N);
  for (let i = 0; i < TABLE_N; i++) {
    let s = 0;
    for (let n = 1; n <= k; n++) s += Math.sin((2 * Math.PI * n * i) / TABLE_N) / n;
    t[i] = (s * 2) / Math.PI; // pico ≈ ±1 (salto de la sierra recortada)
  }
  return t;
}

const SAW10 = buildSawTable(10); // pads / bajos (cálido)
const SAW12 = buildSawTable(12); // metales / cuerdas staccato

// ===========================================================================
// Utilidades musicales
// ===========================================================================
function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

interface GridItem<T> {
  t0: number;
  t1: number;
  item: T;
}

/** Divide [t0, t1] en n tramos iguales ciclando items (acordes por pista). */
function gridExact<T>(t0: number, t1: number, n: number, items: T[]): GridItem<T>[] {
  const step = (t1 - t0) / n;
  const out: GridItem<T>[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t0: t0 + i * step, t1: t0 + (i + 1) * step, item: items[i % items.length] });
  }
  return out;
}

/** Cicla items con paso fijo (en compases) hasta llenar [t0, t1] (último recortado). */
function gridCycle<T>(t0: number, t1: number, step: number, items: T[]): GridItem<T>[] {
  const out: GridItem<T>[] = [];
  let t = t0;
  let i = 0;
  while (t < t1 - 1e-6) {
    const end = Math.min(t + step, t1);
    out.push({ t0: t, t1: end, item: items[i % items.length] });
    t = end;
    i++;
  }
  return out;
}

function itemAt<T>(grid: GridItem<T>[], t: number): T {
  for (let i = grid.length - 1; i >= 0; i--) {
    if (t >= grid[i].t0) return grid[i].item;
  }
  return grid[0].item;
}

// ===========================================================================
// Instrumentos
// ===========================================================================

/** Pad de sierras desafinadas + LPF de un polo con LFO lento sobre el corte. */
interface PadOpts {
  voices: number; // sierras por nota
  detune: number; // ±fracción (0.003 = ±0.3 %)
  cutoffHz: number;
  lfoRate: number; // Hz
  lfoDepth: number; // ±fracción del corte
  attackS: number;
  releaseS: number;
  gain: number;
  ampLfoRate?: number;
  ampLfoDepth?: number;
}

function addPadChord(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number[],
  o: PadOpts,
): void {
  const n0 = Math.round(t0 * SR);
  const n = Math.max(4, Math.round(durS * SR));
  const total = midi.length * o.voices;
  const incs = new Float64Array(total);
  const phases = new Float64Array(total);
  let w = 0;
  for (let v = 0; v < midi.length; v++) {
    const base = midiHz(midi[v]);
    for (let d = 0; d < o.voices; d++) {
      const det = d === 0 ? 0 : (rng() * 2 - 1) * o.detune;
      incs[w] = (base * (1 + det)) / SR;
      phases[w] = rng();
      w++;
    }
  }
  const atkN = Math.max(1, Math.min(Math.round(o.attackS * SR), (n >> 1) - 1));
  const relN = Math.max(1, Math.min(Math.round(o.releaseS * SR), (n >> 1) - 1));
  const lfoPh = rng() * 2 * Math.PI;
  const ampR = o.ampLfoRate ?? 0;
  const ampD = o.ampLfoDepth ?? 0;
  const ampPh = ampR > 0 ? rng() * 2 * Math.PI : 0;
  const inv = 1 / total;
  const tab = SAW10;
  const t0s = n0 / SR;
  let lp = 0;
  let alpha = 0.5;
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) {
      const t = t0s + i / SR;
      const cut = o.cutoffHz * (1 + o.lfoDepth * Math.sin(2 * Math.PI * o.lfoRate * t + lfoPh));
      const c = Math.max(60, Math.min(cut, 12000));
      alpha = 1 - Math.exp((-2 * Math.PI * c) / SR);
    }
    let s = 0;
    for (let k = 0; k < total; k++) {
      let p = phases[k] + incs[k];
      if (p >= 1) p -= 1;
      phases[k] = p;
      const pos = p * TABLE_N;
      const ii = pos | 0;
      s += tab[ii] + (tab[(ii + 1) & TABLE_MASK] - tab[ii]) * (pos - ii);
    }
    lp += alpha * (s - lp);
    let env = 1;
    if (i < atkN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / atkN);
    else if (i > n - relN) env = 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / relN);
    if (ampD > 0) env *= 1 + ampD * Math.sin(2 * Math.PI * ampR * (i / SR) + ampPh);
    buf[n0 + i] += lp * inv * env * o.gain;
  }
}

/** Cuerda pulsada Karplus-Strong con retardo fraccionario (afinación exacta). */
function addPluck(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number,
  gain: number,
  damp: number,
  bright: number, // 0 = excitación suave (laúd), 1 = ruido crudo (brillante)
): void {
  const f = midiHz(midi) * (1 + (rng() * 2 - 1) * 0.0012); // humanización ±0.12 %
  const D = SR / f; // retardo exacto (fraccionario) → tono correcto
  const N = Math.max(8, Math.ceil(D) + 2);
  const d = new Float64Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const w = rng() * 2 - 1;
    const sm = prev + 0.42 * (w - prev); // suavizado de la excitación
    d[i] = sm * (1 - bright) + w * bright;
    prev = sm;
  }
  // quitar DC y escalar a pico 0.75
  let mean = 0;
  for (let i = 0; i < N; i++) mean += d[i];
  mean /= N;
  let mx = 0;
  for (let i = 0; i < N; i++) {
    d[i] -= mean;
    const a = d[i] < 0 ? -d[i] : d[i];
    if (a > mx) mx = a;
  }
  const sc = mx > 1e-9 ? 0.75 / mx : 0;
  for (let i = 0; i < N; i++) d[i] *= sc;

  const n0 = Math.round(t0 * SR);
  const n = Math.max(8, Math.round(durS * SR));
  let wpos = 0;
  for (let i = 0; i < n; i++) {
    let rpos = wpos - D;
    while (rpos < 0) rpos += N;
    const i0 = rpos | 0;
    const fr = rpos - i0;
    const i1 = i0 + 1 >= N ? 0 : i0 + 1;
    const y0 = d[i0];
    const y1 = d[i1];
    const y = y0 + (y1 - y0) * fr;
    d[wpos] = damp * 0.5 * (y + y1); // filtro promediador + amortiguación
    let v = y;
    const rem = n - i;
    if (rem <= 48) v *= rem / 48; // rampa anti-click al final
    if (n0 + i < buf.length) buf[n0 + i] += v * gain;
    wpos = wpos + 1 >= N ? 0 : wpos + 1;
  }
}

/** Flauta tenue: seno + 2º armónico leve, vibrato retardado y soplo tenue. */
function addFluteNote(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number,
  gain: number,
): void {
  const f0 = midiHz(midi);
  const n0 = Math.round(t0 * SR);
  const n = Math.max(16, Math.round(durS * SR));
  const atkN = Math.max(1, Math.min(Math.round(0.16 * SR), n >> 1));
  const relN = Math.max(1, Math.min(Math.round(0.28 * SR), n >> 1));
  const vibPh = rng() * 2 * Math.PI;
  let phase = rng();
  let lp = 0;
  const brA = 1 - Math.exp((-2 * Math.PI * 2400) / SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vibOn = Math.min(1, Math.max(0, (t - 0.25) / 0.9));
    const f = f0 * (1 + 0.0038 * vibOn * Math.sin(2 * Math.PI * 5.3 * t + vibPh));
    phase += f / SR;
    while (phase >= 1) phase -= 1;
    const w = rng() * 2 - 1;
    lp += brA * (w - lp);
    const s = Math.sin(2 * Math.PI * phase) + 0.15 * Math.sin(4 * Math.PI * phase + 0.6);
    let env = 1;
    if (i < atkN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / atkN);
    if (i > n - relN) env *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / relN);
    env *= 1 + 0.06 * Math.sin(2 * Math.PI * 0.9 * t); // leve tremolo
    const rem = n - i;
    if (rem <= 64) env *= rem / 64;
    if (n0 + i < buf.length) buf[n0 + i] += (s * 0.87 + lp * 0.1) * env * gain;
  }
}

/** Campana FM: y = sin(2πfc·t + I·e^(−t/τi)·sin(2πfc·ratio·t)). */
function addBell(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number,
  gain: number,
  ratio: number, // 1.41 / 2.71 (inarmónico)
  index: number, // 2–4
  tauA: number, // τ del cuerpo
): void {
  const f = midiHz(midi) * (1 + (rng() * 2 - 1) * 0.0025);
  const n0 = Math.round(t0 * SR);
  const n = Math.max(16, Math.round(durS * SR));
  // guarda anti-aliasing: limita el índice para no abrir bandas > 13.5 kHz
  const maxIdx = Math.max(1.2, (13500 / f - 1) / ratio);
  const idx = Math.min(index, maxIdx);
  let pc = rng();
  let pm = rng();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const envI = Math.exp(-t / (tauA * 0.55)); // el brillo decae antes que el cuerpo
    const envA = Math.exp(-t / tauA);
    pm += (f * ratio) / SR;
    if (pm >= 1) pm -= 1;
    pc += f / SR;
    if (pc >= 1) pc -= 1;
    const y = Math.sin(2 * Math.PI * pc + idx * envI * Math.sin(2 * Math.PI * pm));
    let v = y * envA;
    const rem = n - i;
    if (rem <= 96) v *= rem / 96;
    if (n0 + i < buf.length) buf[n0 + i] += v * gain;
  }
  // transitorio de golpe (ping corto y agudo)
  addNoiseHit(buf, rng, t0, gain * 0.35, 0.009, 0.03, 9000, 2800);
}

/** Nota de latón sintético: sierras ×3 desafinadas + LPF con envolvente de corte. */
function addBrassNote(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number,
  gain: number,
): void {
  const f0 = midiHz(midi);
  const n0 = Math.round(t0 * SR);
  const n = Math.max(32, Math.round(durS * SR));
  const incs = [f0 / SR, (f0 * (1 + (rng() * 2 - 1) * 0.0016)) / SR, (f0 * (1 + (rng() * 2 - 1) * 0.003)) / SR];
  const phases = [rng(), rng(), rng()];
  const relN = Math.max(8, Math.min(Math.round(0.09 * SR), n >> 1));
  const atkN = Math.max(4, Math.min(Math.round(0.035 * SR), n - relN - 1));
  const tab = SAW12;
  let lp = 0;
  let alpha = 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 15) === 0) {
      const c = 2350 - 1650 * Math.exp(-t / 0.075); // corte 700 → 2350 Hz
      alpha = 1 - Math.exp((-2 * Math.PI * Math.min(c, 12000)) / SR);
    }
    let s = 0;
    for (let k = 0; k < 3; k++) {
      let p = phases[k] + incs[k];
      if (p >= 1) p -= 1;
      phases[k] = p;
      const pos = p * TABLE_N;
      const ii = pos | 0;
      s += tab[ii] + (tab[(ii + 1) & TABLE_MASK] - tab[ii]) * (pos - ii);
    }
    lp += alpha * (s / 3 - lp);
    let env: number;
    if (i < atkN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / atkN);
    else env = 0.82 + 0.22 * Math.exp(-(t - atkN / SR) / 0.11); // overshoot → sustain
    if (i > n - relN) env *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / relN);
    const rem = n - i;
    if (rem <= 48) env *= rem / 48;
    if (n0 + i < buf.length) buf[n0 + i] += lp * env * gain;
  }
}

/** Cuerda staccato: sierras ×2 desafinadas, LPF fijo y envolvente corta. */
function addStaccatoNote(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number,
  gain: number,
): void {
  const f0 = midiHz(midi);
  const n0 = Math.round(t0 * SR);
  const n = Math.max(24, Math.round(durS * SR));
  const incs = [f0 / SR, (f0 * (1 + (rng() * 2 - 1) * 0.0025)) / SR];
  const phases = [rng(), rng()];
  const relN = Math.max(6, Math.round(n * 0.55));
  const atkN = Math.max(2, Math.min(Math.round(0.005 * SR), relN - 1));
  const alpha = 1 - Math.exp((-2 * Math.PI * 1900) / SR);
  const tab = SAW12;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 2; k++) {
      let p = phases[k] + incs[k];
      if (p >= 1) p -= 1;
      phases[k] = p;
      const pos = p * TABLE_N;
      const ii = pos | 0;
      s += tab[ii] + (tab[(ii + 1) & TABLE_MASK] - tab[ii]) * (pos - ii);
    }
    lp += alpha * (s / 2 - lp);
    let env = 1;
    if (i < atkN) env = i / atkN;
    if (i > n - relN) env *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / relN);
    if (n0 + i < buf.length) buf[n0 + i] += lp * env * gain;
  }
}

/** Bajo sostenido / ostinato: sierras ×2 + seno de refuerzo tras LPF oscuro. */
function addBassNote(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number,
  gain: number,
  cutoffHz: number,
  attackS: number,
  decayTau: number,
  sustain: number,
): void {
  const f0 = midiHz(midi);
  const n0 = Math.round(t0 * SR);
  const n = Math.max(24, Math.round(durS * SR));
  const inc = f0 / SR;
  const inc2 = (f0 * (1 + (rng() * 2 - 1) * 0.0015)) / SR;
  let p1 = rng();
  let p2 = rng();
  const atkN = Math.max(2, Math.min(Math.round(attackS * SR), n >> 1));
  const relN = Math.max(4, Math.min(Math.round(0.12 * SR), n >> 1));
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / SR);
  const tab = SAW10;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let p = p1 + inc;
    if (p >= 1) p -= 1;
    p1 = p;
    let q = p2 + inc2;
    if (q >= 1) q -= 1;
    p2 = q;
    const pos = p * TABLE_N;
    const ii = pos | 0;
    const saw1 = tab[ii] + (tab[(ii + 1) & TABLE_MASK] - tab[ii]) * (pos - ii);
    const pos2 = q * TABLE_N;
    const jj = pos2 | 0;
    const saw2 = tab[jj] + (tab[(jj + 1) & TABLE_MASK] - tab[jj]) * (pos2 - jj);
    const s = 0.25 * saw1 + 0.25 * saw2 + 0.55 * Math.sin(2 * Math.PI * p);
    lp += alpha * (s - lp);
    let env = sustain + (1 - sustain) * Math.exp(-t / decayTau);
    if (i < atkN) env *= 0.5 - 0.5 * Math.cos((Math.PI * i) / atkN);
    if (i > n - relN) env *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / relN);
    if (n0 + i < buf.length) buf[n0 + i] += lp * env * gain;
  }
}

/** Silbido agudo: seno con vibrato, gliss de caída al soltar y soplo mínimo. */
function addWhistle(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  durS: number,
  midi: number,
  gain: number,
): void {
  const f0 = midiHz(midi);
  const n0 = Math.round(t0 * SR);
  const n = Math.max(32, Math.round(durS * SR));
  const atkN = Math.max(4, Math.min(Math.round(0.14 * SR), n >> 1));
  const relN = Math.max(8, Math.min(Math.round(0.3 * SR), n >> 1));
  const vibPh = rng() * 2 * Math.PI;
  let phase = rng();
  let lp = 0;
  const brA = 1 - Math.exp((-2 * Math.PI * 3000) / SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const gliss = i > n - relN ? 1 - 0.04 * ((i - (n - relN)) / relN) : 1;
    const vib = 1 + 0.005 * Math.sin(2 * Math.PI * 5.8 * t + vibPh) * Math.min(1, t / 0.3);
    phase += (f0 * vib * gliss) / SR;
    while (phase >= 1) phase -= 1;
    const w = rng() * 2 - 1;
    lp += brA * (w - lp);
    let env = 1;
    if (i < atkN) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / atkN);
    if (i > n - relN) env *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / relN);
    if (n0 + i < buf.length) buf[n0 + i] += (Math.sin(2 * Math.PI * phase) + lp * 0.05) * env * gain;
  }
}

/** Viento: ruido blanco → doble LPF con corte modulado por LFO + vaivén de ganancia. */
function addWind(buf: Float64Array, rng: () => number, t0: number, t1: number, gain: number): void {
  const n0 = Math.round(t0 * SR);
  const n1 = Math.round(t1 * SR);
  const n = Math.max(8, n1 - n0);
  const cutPh = rng() * 2 * Math.PI;
  const ampPh = rng() * 2 * Math.PI;
  let lp1 = 0;
  let lp2 = 0;
  let alpha = 0.1;
  let amp = 1;
  for (let i = 0; i < n; i++) {
    if ((i & 63) === 0) {
      const t = (n0 + i) / SR;
      const cut = 500 + 380 * Math.sin(2 * Math.PI * 0.07 * t + cutPh); // LFO 0.07 Hz
      alpha = 1 - Math.exp((-2 * Math.PI * cut) / SR);
      amp = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.12 * t + ampPh); // vaivén 0.12 Hz
    }
    const w = rng() * 2 - 1;
    lp1 += alpha * (w - lp1);
    lp2 += alpha * (lp1 - lp2);
    let env = 1;
    if (i < SR) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / SR);
    const rem = n - i;
    if (rem <= SR) env *= 0.5 - 0.5 * Math.cos((Math.PI * rem) / SR);
    if (n0 + i < buf.length) buf[n0 + i] += lp2 * amp * env * gain * 2.2;
  }
}

// — Percusión ————————————————————————————————————————————————————————————

/** Kick/tambor con seno y barrido de tono (p. ej. 115→44 Hz) + click de ataque. */
function addKick(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  gain: number,
  f0 = 115,
  f1 = 44,
  sweepTau = 0.05,
  tau = 0.24,
): void {
  const n = Math.round(0.55 * SR);
  const n0 = Math.round(t0 * SR);
  let phase = rng();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / sweepTau);
    phase += f / SR;
    while (phase >= 1) phase -= 1;
    let a = Math.exp(-t / tau);
    let v = Math.sin(2 * Math.PI * phase) * a;
    if (t < 0.004) v += (rng() * 2 - 1) * 0.6 * (1 - t / 0.004);
    const rem = n - i;
    if (rem <= 64) v *= rem / 64;
    if (n0 + i < buf.length) buf[n0 + i] += v * gain;
  }
}

/** Tom: seno con barrido descendente + parcial 2× + componente de ruido. */
function addTom(buf: Float64Array, rng: () => number, t0: number, gain: number, fTop: number, fBot: number): void {
  const n = Math.round(0.45 * SR);
  const n0 = Math.round(t0 * SR);
  let phase = rng();
  let lp = 0;
  const aL = 1 - Math.exp((-2 * Math.PI * 500) / SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = fBot + (fTop - fBot) * Math.exp(-t / 0.04);
    phase += f / SR;
    while (phase >= 1) phase -= 1;
    const a = Math.exp(-t / 0.16);
    const w = rng() * 2 - 1;
    lp += aL * (w - lp);
    let v = (Math.sin(2 * Math.PI * phase) + 0.18 * Math.sin(4 * Math.PI * phase)) * a + lp * 0.2 * a;
    const rem = n - i;
    if (rem <= 64) v *= rem / 64;
    if (n0 + i < buf.length) buf[n0 + i] += v * gain;
  }
}

/** Timbal: seno con barrido breve + parcial inarmónico 1.5× + golpe de ruido grave. */
function addTimpani(buf: Float64Array, rng: () => number, t0: number, gain: number, midi: number): void {
  const f0 = midiHz(midi);
  const n = Math.round(1.1 * SR);
  const n0 = Math.round(t0 * SR);
  let phase = rng();
  let lp = 0;
  const aL = 1 - Math.exp((-2 * Math.PI * 280) / SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 * (1 + 0.14 * Math.exp(-t / 0.09));
    phase += f / SR;
    while (phase >= 1) phase -= 1;
    const a = Math.exp(-t / 0.42);
    const w = rng() * 2 - 1;
    lp += aL * (w - lp);
    let v = (Math.sin(2 * Math.PI * phase) + 0.22 * Math.sin(2 * Math.PI * phase * 1.5)) * a + lp * 0.25 * a;
    const rem = n - i;
    if (rem <= 128) v *= rem / 128;
    if (n0 + i < buf.length) buf[n0 + i] += v * gain;
  }
}

/** Golpe de ruido banda-estrecha (LPF² → HPF), normalizado por pico. */
function addNoiseHit(
  buf: Float64Array,
  rng: () => number,
  t0: number,
  gain: number,
  tau: number,
  durS: number,
  lpfHz: number,
  hpfHz: number,
): void {
  const n = Math.max(8, Math.round(durS * SR));
  const n0 = Math.round(t0 * SR);
  const tmp = new Float64Array(n);
  const aL = 1 - Math.exp((-2 * Math.PI * lpfHz) / SR);
  const aH = 1 - Math.exp((-2 * Math.PI * hpfHz) / SR);
  let lp1 = 0;
  let lp2 = 0;
  let lpH = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = rng() * 2 - 1;
    lp1 += aL * (w - lp1);
    lp2 += aL * (lp1 - lp2);
    lpH += aH * (lp2 - lpH);
    let v = (lp2 - lpH) * Math.exp(-t / tau);
    const rem = n - i;
    if (rem <= 48) v *= rem / 48;
    tmp[i] = v;
  }
  let pk = 0;
  for (let i = 0; i < n; i++) {
    const a = tmp[i] < 0 ? -tmp[i] : tmp[i];
    if (a > pk) pk = a;
  }
  const sc = pk > 1e-9 ? 1 / pk : 0;
  for (let i = 0; i < n; i++) {
    if (n0 + i < buf.length) buf[n0 + i] += tmp[i] * sc * gain;
  }
}

/** Redoble de caja: golpes rápidos con ganancia creciente. */
function addRollSnare(buf: Float64Array, rng: () => number, t0: number, durS: number, gFrom: number, gTo: number): void {
  const step = 0.045;
  const hits = Math.max(2, Math.floor(durS / step));
  for (let h = 0; h < hits; h++) {
    const g = gFrom + (gTo - gFrom) * (h / (hits - 1));
    addNoiseHit(buf, rng, t0 + h * step, g, 0.06, 0.09, 2800, 320);
  }
}

/** Redoble de timbal (6 golpes crecientes muy juntos). */
function addRollTimpani(buf: Float64Array, rng: () => number, t0: number, midi: number, gFrom: number, gTo: number): void {
  const step = 0.065;
  for (let h = 0; h < 6; h++) {
    addTimpani(buf, rng, t0 + h * step, gFrom + (gTo - gFrom) * (h / 5), midi);
  }
}

/** Pandereta: 5 micro-ráfagas de sonajas (HPF agudo) + golpe seco de aro. */
function addTambourine(buf: Float64Array, rng: () => number, t0: number, gain: number): void {
  const bursts = [0, 0.009, 0.019, 0.03, 0.042];
  const bg = [1, 0.72, 0.55, 0.4, 0.3];
  for (let b = 0; b < bursts.length; b++) {
    addNoiseHit(buf, rng, t0 + bursts[b], gain * bg[b], 0.012, 0.06, 14000, 5200);
  }
  addNoiseHit(buf, rng, t0, gain * 0.25, 0.02, 0.05, 400, 120);
}

// ===========================================================================
// Reverb Schroeder (4 combs paralelo + 2 allpass serie + HPF salida)
// ===========================================================================
const COMB_DELAYS_MS = [29.7, 37.1, 41.1, 43.7];
const AP_DELAYS_MS = [5.0, 1.7];

function schroederReverb(input: Float64Array, t60: number): Float64Array {
  const n = input.length;
  const combDelays = COMB_DELAYS_MS.map((ms) => Math.max(4, Math.round((ms / 1000) * SR)));
  const combFb = combDelays.map((d) => Math.min(0.94, Math.pow(0.001, d / SR / t60)));
  const combBufs = combDelays.map((d) => new Float64Array(d));
  const combIdx = combDelays.map(() => 0);
  const apDelays = AP_DELAYS_MS.map((ms) => Math.max(2, Math.round((ms / 1000) * SR)));
  const apBufs = apDelays.map((d) => new Float64Array(d));
  const apIdx = apDelays.map(() => 0);
  const AP_G = 0.7;
  const out = new Float64Array(n);
  let lpHp = 0; // estado del HPF de salida (60 Hz): y = x − LPF(x)
  const hpAlpha = 1 - Math.exp((-2 * Math.PI * 60) / SR);
  for (let i = 0; i < n; i++) {
    const x = input[i];
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const buf = combBufs[k];
      const idx = combIdx[k];
      const dv = buf[idx];
      s += dv;
      buf[idx] = x + dv * combFb[k];
      combIdx[k] = idx + 1 === buf.length ? 0 : idx + 1;
    }
    let y = s * 0.25;
    for (let k = 0; k < 2; k++) {
      const buf = apBufs[k];
      const idx = apIdx[k];
      const d = buf[idx];
      const o = d - AP_G * y;
      buf[idx] = y + AP_G * o;
      y = o;
      apIdx[k] = idx + 1 === buf.length ? 0 : idx + 1;
    }
    lpHp += hpAlpha * (y - lpHp);
    out[i] = y - lpHp;
  }
  return out;
}

// ===========================================================================
// Definición de pistas
// ===========================================================================
interface Ctx {
  buf: Float64Array;
  rng: () => number;
  t0: number; // inicio del contenido (1.2 s)
  t1: number; // fin del contenido (dur − 1.6 s)
}

interface TrackSpec {
  id: string;
  titulo: string;
  animo: string;
  tensionMin: number;
  tensionMax: number;
  bpm: number;
  tonalidad: string;
  durSec: number;
  seed: number;
  instrumentacion: string;
  descripcion: string;
  targetRmsDb: number;
  reverbT60: number;
  wetRatio: number;
  render: (ctx: Ctx) => void;
}

// — 1 · calma-aposento —————————————————————————————————————————————————————
function renderCalmaAposento(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const bar = 4 * (60 / 60); // 4 s · 60 BPM
  const chords = [
    [48, 52, 55, 59, 62], // Cmaj9
    [45, 52, 55, 59, 60], // Am9
    [41, 48, 52, 55, 57], // Fmaj9
    [43, 50, 55, 57, 59], // G6/9
  ];
  const spans = gridExact(t0, t1, 4, chords);
  // pad cálido (sierras desafinadas + LPF lento con LFO)
  for (const sp of spans) {
    const dur = Math.min(sp.t1 - sp.t0 + 1.6, t1 - sp.t0);
    addPadChord(buf, rng, sp.t0, dur, sp.item, {
      voices: 3, detune: 0.003, cutoffHz: 860, lfoRate: 0.08, lfoDepth: 0.3,
      attackS: 1.6, releaseS: 1.6, gain: 0.5,
    });
  }
  // laúd suave (Karplus-Strong perezoso)
  const eighth = 0.5;
  const pattern = [0, 2, 1, 3, 2, 4, 3, 2];
  let k = 0;
  for (let t = t0; t + 0.4 <= t1; t += eighth, k++) {
    if (rng() < 0.15) continue; // reposo perezoso
    const set = itemAt(spans, t).map((m) => m + 12);
    const idx = pattern[k % pattern.length];
    const hum = t + (rng() * 2 - 1) * 0.008;
    const g = 0.62 * (0.88 + 0.24 * rng());
    const dur = Math.min(1.1, t1 - t);
    addPluck(buf, rng, hum, dur, set[idx % set.length], g, 0.9955, 0.35);
    if (rng() < 0.1) {
      addPluck(buf, rng, hum + 0.012, dur, set[(idx + 2) % set.length], g * 0.6, 0.9955, 0.35);
    }
  }
  // flauta tenue (seno + vibrato): notas largas sobre tonos del acorde
  let ft = t0 + 0.6;
  let fi = 2;
  while (ft < t1 - 2.6) {
    const dur = 2.2 + 1.6 * rng();
    const set = itemAt(spans, ft).map((m) => m + 24);
    if (rng() < 0.18) fi = Math.floor(rng() * set.length);
    else fi = Math.max(0, Math.min(set.length - 1, fi + (rng() < 0.5 ? -1 : 1)));
    addFluteNote(buf, rng, ft, Math.min(dur, t1 - ft), set[fi], 0.5);
    ft += dur + 0.5 + 1.3 * rng();
  }
}

// — 2 · calma-posada ———————————————————————————————————————————————————————
function renderCalmaPosada(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const beat = 60 / 76;
  const bar = 4 * beat;
  const chords = [
    [43, 50, 55, 59, 62], // G
    [40, 47, 50, 55, 59], // Em7
    [48, 52, 55, 62, 64], // Cadd9
    [50, 54, 57, 60, 64], // D7(9)
  ];
  const spans = gridExact(t0, t1, 4, chords);
  // laúd pizzicato saltarín
  const eighth = beat / 2;
  const pattern = [0, 2, 1, 3, 2, 4, 3, 1];
  const slotGain = [1, 0.6, 0.85, 0.6, 0.95, 0.6, 0.85, 0.6];
  let k = 0;
  for (let t = t0; t + 0.45 <= t1; t += eighth, k++) {
    const slot = k % 8;
    const pair = slot === 7 && rng() < 0.18; // doble 16ª de adorno
    if (!pair && rng() < 0.06) continue;
    const set = itemAt(spans, t).map((m) => m + 12);
    const idx = pattern[slot];
    const hum = t + (rng() * 2 - 1) * 0.008;
    const g = 0.75 * slotGain[slot] * (0.88 + 0.24 * rng());
    const dur = Math.min(0.95, t1 - t);
    addPluck(buf, rng, hum, dur, set[idx], g, 0.996, 0.5);
    if (pair) {
      addPluck(buf, rng, t + eighth / 2, Math.min(0.8, t1 - t - eighth / 2), set[(idx + 2) % set.length], g * 0.6, 0.996, 0.5);
    }
  }
  // bordón de contrabajo en tiempos 1 y 3
  for (let t = t0; t + 0.4 <= t1; t += bar) {
    const root = itemAt(spans, t)[0] - 12;
    addBassNote(buf, rng, t, Math.min(1.3, t1 - t), root, 0.5, 300, 0.03, 0.9, 0.55);
    if (t + 2 * beat + 0.4 <= t1) {
      addBassNote(buf, rng, t + 2 * beat, Math.min(1.3, t1 - t - 2 * beat), root, 0.42, 300, 0.03, 0.9, 0.55);
    }
  }
  // pandereta suave en tiempos 2 y 4
  for (let t = t0 + beat; t + 0.15 <= t1; t += 2 * beat) {
    addTambourine(buf, rng, t, 0.22);
    if (rng() < 0.2 && t + 2 * beat - 0.05 <= t1) {
      addTambourine(buf, rng, t + 2 * beat - 0.197, 0.14);
    }
  }
}

// — 3 · misterio-runas —————————————————————————————————————————————————————
function renderMisterioRunas(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const beat = 60 / 54;
  const bar = 4 * beat; // 4.444 s
  const chordDefs = [
    { pad: [52, 55, 59], pool: [64, 67, 71, 74], label: "Em(add9)" },
    { pad: [48, 52, 55], pool: [64, 67, 72, 76], label: "Cmaj7" },
    { pad: [45, 52, 57], pool: [60, 64, 69, 72], label: "Am(add9)" },
    { pad: [47, 51, 54, 57], pool: [59, 63, 66, 71], label: "B7" },
  ];
  // drone grave continuo (E1 + E2) con LPF muy oscuro y vaivén
  addPadChord(buf, rng, t0, t1 - t0 - 0.1, [28, 40], {
    voices: 3, detune: 0.003, cutoffHz: 240, lfoRate: 0.05, lfoDepth: 0.45,
    attackS: 2.5, releaseS: 2.0, gain: 0.55, ampLfoRate: 0.07, ampLfoDepth: 0.12,
  });
  addPadChord(buf, rng, t0, t1 - t0 - 0.1, [47], {
    voices: 2, detune: 0.002, cutoffHz: 300, lfoRate: 0.06, lfoDepth: 0.3,
    attackS: 3.0, releaseS: 2.0, gain: 0.16,
  });
  const spans = gridCycle(t0, t1, bar * 4, chordDefs);
  // color armónico tenue por acorde
  for (const sp of spans) {
    const dur = Math.min(sp.t1 - sp.t0 + 2.2, t1 - sp.t0);
    addPadChord(buf, rng, sp.t0, dur, sp.item.pad, {
      voices: 2, detune: 0.0025, cutoffHz: 620, lfoRate: 0.09, lfoDepth: 0.25,
      attackS: 2.6, releaseS: 2.2, gain: 0.3,
    });
  }
  // campanas FM inarmónicas esporádicas
  let bt = t0 + 1.4;
  while (bt < t1 - 1.0) {
    const pool = itemAt(spans, bt).pool;
    let midi = pool[Math.floor(rng() * pool.length)];
    if (rng() < 0.2) midi += 12;
    const dur = Math.min(2.4 + 2.6 * rng(), t1 - bt);
    const ratio = rng() < 0.5 ? 1.41 : 2.71;
    const index = 2 + 2 * rng();
    const g = 0.3 + 0.26 * rng();
    addBell(buf, rng, bt, dur, midi, g, ratio, index, dur * 0.42);
    bt += 1.6 + 4.4 * rng();
  }
  // viento (ruido filtrado con vaivén)
  addWind(buf, rng, t0, t1 - 0.2, 0.2);
}

// — 4 · misterio-pergamino ———————————————————————————————————————————————————
function renderMisterioPergamino(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const bar = 4 * (60 / 60); // 4 s · 60 BPM
  const chordDefs = [
    { pad: [50, 53, 57, 60, 62], arp: [62, 65, 69, 72, 74], label: "Dm9" },
    { pad: [48, 52, 55, 59, 62], arp: [60, 64, 67, 71, 74], label: "Cmaj9" },
    { pad: [50, 53, 57, 62, 64], arp: [62, 65, 69, 74, 76], label: "Dm11" },
    { pad: [45, 52, 55, 60, 64], arp: [57, 64, 67, 72, 76], label: "Am7" },
  ];
  const spans = gridCycle(t0, t1, bar * 4, chordDefs);
  // hinchazones armónicas (pad de ataque muy lento, una por acorde)
  for (const sp of spans) {
    const dur = Math.min(sp.t1 - sp.t0 + 2.2, t1 - sp.t0);
    addPadChord(buf, rng, sp.t0, dur, sp.item.pad, {
      voices: 3, detune: 0.003, cutoffHz: 700, lfoRate: 0.09, lfoDepth: 0.28,
      attackS: 2.4, releaseS: 2.2, gain: 0.45,
    });
  }
  // arpa lenta (KS con mucho ring + cola de reverb larga)
  const quarter = 1.0;
  const pattern = [0, 1, 2, 3, 4, 3, 2, 1];
  let k = 0;
  for (let t = t0; t + 0.8 <= t1; t += quarter, k++) {
    if (rng() < 0.07) continue;
    const arp = itemAt(spans, t).arp;
    const idx = pattern[k % 8];
    const hum = t + (rng() * 2 - 1) * 0.01;
    const g = 0.6 * (0.9 + 0.2 * rng());
    addPluck(buf, rng, hum, Math.min(1.9, t1 - t), arp[idx], g, 0.997, 0.3);
  }
}

// — 5 · tension-pasos ——————————————————————————————————————————————————————
function renderTensionPasos(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const beat = 60 / 84;
  const bar = 4 * beat;
  const eighth = beat / 2;
  const A1 = 33, Bb1 = 34, D2 = 38, E2 = 40, G2 = 43; // La frigio
  const ostGain = [1, 0.68, 0.85, 0.68, 0.95, 0.68, 0.85, 0.68];
  // ostinato bajo pulsante en corcheas (Si♭ = 2.ª menor frigia como acento)
  let k = 0;
  for (let t = t0; t + 0.25 <= t1; t += eighth, k++) {
    const barIdx = Math.floor(k / 8);
    const slot = k % 8;
    let midi = A1;
    if (barIdx % 4 === 3 && (slot === 2 || slot === 5)) midi = Bb1;
    if (barIdx % 8 === 7) {
      if (slot === 2) midi = D2;
      else if (slot === 4) midi = E2;
      else if (slot === 6) midi = G2;
    }
    const g = 0.7 * ostGain[slot] * (0.9 + 0.2 * rng());
    addBassNote(buf, rng, t, Math.min(0.3, t1 - t), midi, g, 480, 0.008, 0.14, 0.45);
  }
  // percusión que marca (tick en los contratiempos, acento en el 3.er tiempo)
  let tk = 0;
  for (let t = t0 + eighth / 2; t + 0.05 <= t1; t += eighth, tk++) {
    const g = tk % 4 === 2 ? 0.21 : 0.14;
    addNoiseHit(buf, rng, t, g, 0.012, 0.07, 12000, 4800);
  }
  // silbido agudo ocasional (seno con vibrato y caída final)
  let wt = t0 + 4.5;
  const whistleSet = [100, 101, 103]; // E7 · F7 · G7 (notas del frigio)
  while (wt + 2.0 <= t1) {
    const midi = whistleSet[Math.floor(rng() * whistleSet.length)];
    const dur = 0.9 + 0.7 * rng();
    addWhistle(buf, rng, wt, dur, midi, 0.15);
    wt += 7 + 6 * rng();
  }
}

// — 6 · tension-emboscada ———————————————————————————————————————————————————
function renderTensionEmboscada(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const beat = 60 / 112;
  const bar = 4 * beat;
  const sixteenth = beat / 4;
  const chordDefs = [
    { ct: [48, 51, 55, 58], root: 36, label: "Cm7" },
    { ct: [44, 48, 51, 55], root: 32, label: "Abmaj7" },
    { ct: [48, 51, 55, 58], root: 36, label: "Cm7" },
    { ct: [43, 47, 50, 53], root: 31, stab: 56, label: "G7♭9" }, // tritono+♭9
  ];
  const spans = gridCycle(t0, t1, bar * 4, chordDefs);
  // ostinato rápido de cuerdas staccato en 16avos
  const pat = [0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 1, 0, 2, 0, 3, 0];
  let k = 0;
  for (let t = t0; t + 0.1 <= t1; t += sixteenth, k++) {
    const sp = itemAt(spans, t);
    const slot = k % 16;
    const note = sp.stab !== undefined && slot === 14 ? sp.stab : sp.ct[pat[slot]];
    const g = (slot % 4 === 0 ? 0.62 : 0.4) * (0.9 + 0.2 * rng());
    addStaccatoNote(buf, rng, t, Math.min(0.115, t1 - t), note, g);
  }
  // timbales tenues al entrar cada acorde + golpe medio
  for (const sp of spans) {
    if (sp.t0 + 1.2 <= t1) addTimpani(buf, rng, sp.t0, 0.5, sp.item.root);
    if (sp.t0 + 4.3 + 1.2 <= t1) addTimpani(buf, rng, sp.t0 + 4.3, 0.32, sp.item.root);
  }
  // bordón grave por compás
  for (let t = t0; t + 0.5 <= t1; t += bar) {
    addBassNote(buf, rng, t, Math.min(0.55, t1 - t), itemAt(spans, t).root, 0.5, 300, 0.02, 0.5, 0.5);
  }
}

// — 7 · batalla-acero ——————————————————————————————————————————————————————
function renderBatallaAcero(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const beat = 60 / 140;
  const bar = 4 * beat;
  const eighth = beat / 2;
  const chordDefs = [
    { root: 64, iv: [0, 3, 7, 12], pad: [52, 59], label: "Em" },
    { root: 60, iv: [0, 4, 7, 12], pad: [48, 55], label: "C" },
    { root: 62, iv: [0, 4, 7, 12], pad: [50, 57], label: "D" },
    { root: 64, iv: [0, 3, 7, 12], pad: [52, 59], label: "Em" },
  ];
  const spans = gridCycle(t0, t1, bar * 8, chordDefs);
  // tambores de guerra: kick en 1 y 3, caja en 2 y 4, fantasmas, fills y redoble
  let bi = 0;
  for (let t = t0; t < t1; t += bar, bi++) {
    addKick(buf, rng, t, 1.0);
    if (t + 2 * beat + 0.5 <= t1) addKick(buf, rng, t + 2 * beat, 0.95);
    if (bi % 4 === 3 && t + 3 * beat + 0.5 <= t1) addKick(buf, rng, t + 3 * beat, 0.55);
    if (t + beat + 0.3 <= t1) addNoiseHit(buf, rng, t + beat, 0.55, 0.09, 0.25, 2600, 350);
    if (t + 3 * beat + 0.3 <= t1) addNoiseHit(buf, rng, t + 3 * beat, 0.5, 0.09, 0.25, 2600, 350);
    if (rng() < 0.35 && t + beat + eighth + 0.2 <= t1) {
      addNoiseHit(buf, rng, t + beat + eighth, 0.2, 0.07, 0.18, 2600, 350);
    }
    if (bi % 4 === 3 && t + 3 * beat + 0.6 <= t1) {
      const tomF = [
        [175, 95],
        [145, 80],
        [115, 65],
        [88, 50],
      ];
      for (let f = 0; f < 4; f++) addTom(buf, rng, t + 3 * beat + f * (beat / 4), 0.6, tomF[f][0], tomF[f][1]);
    }
    if (bi % 8 === 7 && t + 2 * beat + 0.9 <= t1) {
      addRollSnare(buf, rng, t + 2 * beat, beat * 2, 0.22, 0.85);
    }
  }
  // riff de metales sintéticos (frase de 2 compases sobre las notas del acorde)
  const riff = [0, -1, 0, -1, 3, -1, 7, -1, 0, -1, 3, -1, 7, -1, 12, -1];
  const twoBars = bar * 2;
  for (let t = t0; t < t1 - 0.3; t += twoBars) {
    const sp = itemAt(spans, t);
    for (let s = 0; s < riff.length; s++) {
      const off = riff[s];
      if (off < 0) continue;
      const nt = t + s * eighth;
      if (nt + 0.15 > t1) break;
      addBrassNote(buf, rng, nt, Math.min(0.2, t1 - nt), sp.root + off, 0.65);
    }
  }
  // colchón oscuro (quinta grave del acorde)
  for (const sp of spans) {
    const dur = Math.min(sp.t1 - sp.t0 + 0.8, t1 - sp.t0);
    addPadChord(buf, rng, sp.t0, dur, sp.item.pad, {
      voices: 2, detune: 0.003, cutoffHz: 700, lfoRate: 0.1, lfoDepth: 0.2,
      attackS: 0.6, releaseS: 0.8, gain: 0.35,
    });
  }
}

// — 8 · victoria-amanecer ———————————————————————————————————————————————————
function renderVictoriaAmanecer(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const beat = 60 / 96;
  const bar = 4 * beat;
  const eighth = beat / 2;
  const chordDefs = [
    { pad: [48, 52, 55, 60], pool: [84, 88, 91], timp: 36, timp5: 43, label: "C" },
    { pad: [41, 48, 53, 57], pool: [81, 84, 89], timp: 29, timp5: 36, label: "F" },
    { pad: [43, 50, 55, 59], pool: [79, 83, 86], timp: 31, timp5: 38, label: "G" },
  ];
  const spans = gridCycle(t0, t1, bar * 4, chordDefs);
  // pad cálido de apoyo
  for (const sp of spans) {
    const dur = Math.min(sp.t1 - sp.t0 + 1.0, t1 - sp.t0);
    addPadChord(buf, rng, sp.t0, dur, sp.item.pad, {
      voices: 3, detune: 0.003, cutoffHz: 900, lfoRate: 0.1, lfoDepth: 0.2,
      attackS: 0.7, releaseS: 0.9, gain: 0.4,
    });
  }
  // fanfarria de vientos (sierra + LPF con envolvente de corte tipo latón)
  const phraseA: Array<number | null> = [72, null, 72, null, 72, 72, 76, null, 79, null, null, null, 76, null, 72, null];
  const phraseB: Array<number | null> = [72, null, 72, null, 72, 72, 76, 79, 84, null, null, null, 79, null, 76, null];
  const phraseFin: Array<number | null> = [84, null, 79, null, 76, null, 72, null, 84, null, null, null, null, null, null, null];
  const phrases = [phraseA, phraseB, phraseA, phraseB, phraseA, phraseB, phraseA, phraseB, phraseA, phraseA, phraseFin];
  const phraseLen = bar * 2;
  for (let p = 0; p < phrases.length; p++) {
    const pt = t0 + p * phraseLen;
    if (pt >= t1 - 0.3) break;
    const ph = phrases[p];
    for (let s = 0; s < 16; s++) {
      const note = ph[s];
      if (note === null) continue;
      let run = 1;
      while (s + run < 16 && ph[s + run] === null) run++;
      const nt = pt + s * eighth;
      const dur = Math.min(run * eighth * 0.92, t1 - nt);
      if (dur < 0.08) continue;
      addBrassNote(buf, rng, nt, dur, note, 0.7);
    }
  }
  // timbal en tiempos 1 y 3 de cada compás + redoble antes de cada cambio
  for (let t = t0; t < t1; t += bar) {
    const it = itemAt(spans, t);
    if (t + 1.2 <= t1) addTimpani(buf, rng, t, 0.5, it.timp);
    if (t + 2 * beat + 1.2 <= t1) addTimpani(buf, rng, t + 2 * beat, 0.33, it.timp5);
  }
  for (const sp of spans) {
    if (sp.t1 < t1 - 0.01 && sp.t1 - 0.5 > sp.t0 + 1) {
      addRollTimpani(buf, rng, sp.t1 - 0.45, sp.item.timp, 0.25, 0.6);
    }
  }
  // campanas festivas cada 2 compases + destello ocasional
  for (let t = t0; t + 1.4 <= t1; t += bar * 2) {
    const pool = itemAt(spans, t).pool;
    addBell(buf, rng, t, Math.min(1.6, t1 - t), pool[Math.floor(rng() * pool.length)], 0.42, 2.71, 2.6, 0.5);
    if (rng() < 0.3) {
      const t2 = t + eighth;
      if (t2 + 1.2 <= t1) {
        addBell(buf, rng, t2, Math.min(1.2, t1 - t2), pool[Math.floor(rng() * pool.length)], 0.28, 1.41, 2.2, 0.38);
      }
    }
  }
}

// — 9 · neutro-sendero —————————————————————————————————————————————————————
function renderNeutroSendero(ctx: Ctx): void {
  const { buf, rng, t0, t1 } = ctx;
  const beat = 60 / 72;
  const bar = 4 * beat;
  const chordDefs = [
    { chord: [45, 52, 55, 60, 64], label: "Am7" }, // A2 E3 G3 C4 E4
    { chord: [41, 48, 52, 57, 60], label: "Fmaj7" }, // F2 C3 E3 A3 C4
    { chord: [48, 52, 55, 59, 64], label: "Cmaj7" }, // C3 E3 G3 B3 E4
    { chord: [43, 50, 55, 59, 64], label: "G6" }, // G2 D3 G3 B3 E4
  ];
  const spans = gridExact(t0, t1, 4, chordDefs);
  // pad tenue
  for (const sp of spans) {
    const dur = Math.min(sp.t1 - sp.t0 + 1.4, t1 - sp.t0);
    addPadChord(buf, rng, sp.t0, dur, sp.item.chord, {
      voices: 2, detune: 0.003, cutoffHz: 750, lfoRate: 0.07, lfoDepth: 0.25,
      attackS: 1.4, releaseS: 1.4, gain: 0.32,
    });
  }
  // arpegio neutro de guitarra (sin percusión)
  const eighth = beat / 2;
  const pattern = [0, 2, 1, 3, 2, 4, 3, 2];
  let k = 0;
  for (let t = t0; t + 0.5 <= t1; t += eighth, k++) {
    if (rng() < 0.06) continue; // respiración
    const arp = itemAt(spans, t).chord;
    const idx = pattern[k % 8];
    const hum = t + (rng() * 2 - 1) * 0.01;
    const g = 0.65 * (0.88 + 0.24 * rng());
    addPluck(buf, rng, hum, Math.min(0.9, t1 - t), arp[idx], g, 0.996, 0.45);
  }
}

// ===========================================================================
// Catálogo (seeds LCG documentadas en la cabecera)
// ===========================================================================
const TRACKS: TrackSpec[] = [
  {
    id: "calma-aposento",
    titulo: "Aposento del Descanso",
    animo: "calma",
    tensionMin: 0,
    tensionMax: 38,
    bpm: 60,
    tonalidad: "Do mayor",
    durSec: 68.0,
    seed: 0x0ba2d0a1,
    instrumentacion: "pad cálido, laúd, flauta tenue",
    descripcion: "Un lecho tibio junto al fuego: pad sereno y laúd perezoso para reposos y diálogos tranquilos.",
    targetRmsDb: -21,
    reverbT60: 2.2,
    wetRatio: 0.3,
    render: renderCalmaAposento,
  },
  {
    id: "calma-posada",
    titulo: "Fuego de Posada",
    animo: "calma",
    tensionMin: 20,
    tensionMax: 55,
    bpm: 76,
    tonalidad: "Sol mayor",
    durSec: 66.0,
    seed: 0x0ba2d0a2,
    instrumentacion: "laúd pizzicato, contrabajo, pandereta",
    descripcion: "Jaranas de posada: laúd saltarín y contrabajo caminero para cenas y risas.",
    targetRmsDb: -20,
    reverbT60: 1.6,
    wetRatio: 0.22,
    render: renderCalmaPosada,
  },
  {
    id: "misterio-runas",
    titulo: "Runas en la Niebla",
    animo: "misterio",
    tensionMin: 15,
    tensionMax: 50,
    bpm: 54,
    tonalidad: "Mi menor",
    durSec: 70.0,
    seed: 0x0ba2d0a3,
    instrumentacion: "campanas FM, drone grave, viento",
    descripcion: "Campanas antiguas flotando en la bruma: textura espesa para enigmas y presencias.",
    targetRmsDb: -21,
    reverbT60: 2.8,
    wetRatio: 0.35,
    render: renderMisterioRunas,
  },
  {
    id: "misterio-pergamino",
    titulo: "El Pergamino Antiguo",
    animo: "misterio",
    tensionMin: 35,
    tensionMax: 65,
    bpm: 60,
    tonalidad: "Re dórico",
    durSec: 64.0,
    seed: 0x0ba2d0a4,
    instrumentacion: "arpa lenta, hinchazones armónicas",
    descripcion: "Arpa de biblioteca maldita: arpegios lentos que escarban secretos.",
    targetRmsDb: -21,
    reverbT60: 3.0,
    wetRatio: 0.33,
    render: renderMisterioPergamino,
  },
  {
    id: "tension-pasos",
    titulo: "Pasos en la Oscuridad",
    animo: "tensión",
    tensionMin: 40,
    tensionMax: 72,
    bpm: 84,
    tonalidad: "La frigio",
    durSec: 62.0,
    seed: 0x0ba2d0a5,
    instrumentacion: "ostinato bajo, tick, silbido agudo",
    descripcion: "Un pulso que acecha: ostinato opresivo para mazmorras y emboscadas inminentes.",
    targetRmsDb: -20,
    reverbT60: 1.2,
    wetRatio: 0.16,
    render: renderTensionPasos,
  },
  {
    id: "tension-emboscada",
    titulo: "Emboscada",
    animo: "tensión",
    tensionMin: 55,
    tensionMax: 85,
    bpm: 112,
    tonalidad: "Do menor",
    durSec: 58.0,
    seed: 0x0ba2d0a6,
    instrumentacion: "ostinato rápido, timbales, cuerdas staccato",
    descripcion: "Cuerdas tensas y timbales: la trampa se cierra sobre el grupo.",
    targetRmsDb: -19.5,
    reverbT60: 1.0,
    wetRatio: 0.14,
    render: renderTensionEmboscada,
  },
  {
    id: "batalla-acero",
    titulo: "Furia de Acero",
    animo: "batalla",
    tensionMin: 65,
    tensionMax: 100,
    bpm: 140,
    tonalidad: "Mi menor",
    durSec: 56.0,
    seed: 0x0ba2d0a7,
    instrumentacion: "tambores de guerra, riff de metales",
    descripcion: "Tambores y acero: carga épica para combates sin tregua.",
    targetRmsDb: -19,
    reverbT60: 0.9,
    wetRatio: 0.12,
    render: renderBatallaAcero,
  },
  {
    id: "victoria-amanecer",
    titulo: "Amanecer Victorioso",
    animo: "victoria",
    tensionMin: 55,
    tensionMax: 95,
    bpm: 96,
    tonalidad: "Do mayor",
    durSec: 60.0,
    seed: 0x0ba2d0a8,
    instrumentacion: "fanfarria de vientos, timbal, campanas",
    descripcion: "Clarines al alba: fanfarria luminosa para triunfos y recompensas.",
    targetRmsDb: -19.5,
    reverbT60: 1.8,
    wetRatio: 0.24,
    render: renderVictoriaAmanecer,
  },
  {
    id: "neutro-sendero",
    titulo: "Sendero Tranquilo",
    animo: "neutro",
    tensionMin: 0,
    tensionMax: 100,
    bpm: 72,
    tonalidad: "La menor",
    durSec: 72.0,
    seed: 0x0ba2d0a9,
    instrumentacion: "arpegio de guitarra, pad tenue",
    descripcion: "Colchón neutro versátil: viaja bien por cualquier ánimo cuando la narración manda.",
    targetRmsDb: -21,
    reverbT60: 2.3,
    wetRatio: 0.27,
    render: renderNeutroSendero,
  },
];

// ===========================================================================
// Cadena de master: reverb calibrada → normalización RMS → fundido → tanh
// ===========================================================================
function rmsRange(a: Float64Array, i0: number, i1: number): number {
  const n = Math.max(1, i1 - i0);
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / n);
}

function finalizeTrack(spec: TrackSpec, dry: Float64Array): { pcm: Int16Array; prePeak: number } {
  const n = dry.length;
  // reverb Schroeder global con cola natural (procesa TODO el buffer)
  const wet = schroederReverb(dry, spec.reverbT60);
  // calibración del wet por RMS sobre la región con contenido
  const i0 = Math.round(CONTENT_START * SR);
  const i1 = Math.min(n, Math.round((n / SR - CONTENT_END_MARGIN) * SR));
  const dryRms = rmsRange(dry, i0, i1);
  const wetRms = rmsRange(wet, i0, i1);
  const wetGain = wetRms > 1e-9 ? (spec.wetRatio * dryRms) / wetRms : 0;
  const mix = new Float64Array(n);
  let prePeak = 0;
  for (let i = 0; i < n; i++) {
    mix[i] = dry[i] + wet[i] * wetGain;
    const a = mix[i] < 0 ? -mix[i] : mix[i];
    if (a > prePeak) prePeak = a;
  }
  // normalización al RMS objetivo
  const mixRms = rmsRange(mix, i0, i1);
  const target = Math.pow(10, spec.targetRmsDb / 20);
  const scale = mixRms > 1e-9 ? target / mixRms : 1;
  // fundido 1.2 s + soft-limit tanh + cuantización int16
  const fadeN = Math.round(FADE_S * SR);
  const endFadeStart = n - fadeN;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let x = mix[i] * scale;
    if (i < fadeN) x *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeN);
    else if (i >= endFadeStart) x *= 0.5 - 0.5 * Math.cos((Math.PI * (n - i)) / fadeN);
    const y = SOFT_CEIL * Math.tanh(x / SOFT_CEIL);
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(y * 32767)));
  }
  return { pcm, prePeak };
}

function encodeWav(pcm: Int16Array): Buffer {
  const dataBytes = pcm.length * BYTES_PER_SAMPLE;
  const buf = Buffer.alloc(HEADER_BYTES + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(HEADER_BYTES + dataBytes - 8, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * CHANNELS * BYTES_PER_SAMPLE, 28); // 64000
  buf.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32); // 2
  buf.writeUInt16LE(BITS, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  const nativeLE = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
  if (nativeLE) {
    buf.set(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), HEADER_BYTES);
  } else {
    for (let i = 0; i < pcm.length; i++) buf.writeUInt16LE(pcm[i] & 0xffff, HEADER_BYTES + 2 * i);
  }
  return buf;
}

// ===========================================================================
// Manifiesto
// ===========================================================================
interface ManifestPista {
  id: string;
  titulo: string;
  animo: string;
  tensionMin: number;
  tensionMax: number;
  bpm: number;
  tonalidad: string;
  durSec: number;
  archivo: string;
  instrumentacion: string;
  descripcion: string;
}

interface Manifest {
  version: number;
  generadoPor: string;
  licencia: string;
  pistas: ManifestPista[];
}

// ===========================================================================
// Generación
// ===========================================================================
const tAll = Date.now();
console.log("Bardo Studio · generador de biblioteca musical (Fase 3, determinista)");
console.log(`  salida : ${MUSICA_DIR}/<id>.wav (9 pistas) + ${MANIFEST_PATH}`);
console.log(`  formato: RIFF/WAVE PCM 16-bit · mono · ${SR} Hz · PCM por pista ≈ 56–72 s`);
console.log(`  prng   : LCG con seed fija por pista (ver cabecera del script) — sin Math.random`);
console.log("");

mkdirSync(MUSICA_DIR, { recursive: true });

const pistas: ManifestPista[] = [];
for (const spec of TRACKS) {
  const tTrack = Date.now();
  const n = Math.round(spec.durSec * SR);
  const dry = new Float64Array(n);
  spec.render({ buf: dry, rng: makeRng(spec.seed), t0: CONTENT_START, t1: n / SR - CONTENT_END_MARGIN });
  const { pcm, prePeak } = finalizeTrack(spec, dry);
  const wav = encodeWav(pcm);
  writeFileSync(join(MUSICA_DIR, `${spec.id}.wav`), wav);
  pistas.push({
    id: spec.id,
    titulo: spec.titulo,
    animo: spec.animo,
    tensionMin: spec.tensionMin,
    tensionMax: spec.tensionMax,
    bpm: spec.bpm,
    tonalidad: spec.tonalidad,
    durSec: Math.round((n / SR) * 10) / 10,
    archivo: `/demo/musica/${spec.id}.wav`,
    instrumentacion: spec.instrumentacion,
    descripcion: spec.descripcion,
  });
  const ms = Date.now() - tTrack;
  console.log(
    `  [${TRACKS.indexOf(spec) + 1}/9] ${spec.id.padEnd(19)} ${wav.length.toLocaleString("en-US").padStart(11)} B  ` +
      `${(ms / 1000).toFixed(1)} s  pre-peak ${prePeak.toFixed(2)}`,
  );
}

const manifest: Manifest = {
  version: 1,
  generadoPor: "scripts/generate-music-library.ts (síntesis determinista local)",
  licencia: "CC0 · síntesis propia, sin terceros",
  pistas,
};
mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
console.log("");
console.log(`Manifiesto escrito: ${MANIFEST_PATH} (${pistas.length} pistas)`);
const genMs = Date.now() - tAll;
console.log(`Generación completa en ${(genMs / 1000).toFixed(1)} s`);
console.log("");

// ===========================================================================
// Verificación — relee cada WAV + el manifiesto desde disco
// ===========================================================================
const failures: string[] = [];
function check(desc: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${desc}`);
  } else {
    failures.push(desc);
    console.log(`  ✗ FAIL: ${desc}`);
  }
}

interface Row {
  id: string;
  dur: string;
  bytes: number;
  rmsDb: number;
  peakDb: number;
  headDb: number;
  tailDb: number;
  sha: string;
}

const rows: Row[] = [];
let totalBytes = 0;
let totalSamples = 0;

console.log("Verificación (re-lectura desde disco):");
for (const spec of TRACKS) {
  const path = join(MUSICA_DIR, `${spec.id}.wav`);
  const raw = readFileSync(path);
  const size = raw.length;
  totalBytes += size;

  // — cabecera
  const magicOk =
    raw.toString("ascii", 0, 4) === "RIFF" &&
    raw.toString("ascii", 8, 12) === "WAVE" &&
    raw.toString("ascii", 12, 16) === "fmt " &&
    raw.toString("ascii", 36, 40) === "data";
  const vFmt = raw.readUInt16LE(20);
  const vCh = raw.readUInt16LE(22);
  const vSr = raw.readUInt32LE(24);
  const vBr = raw.readUInt32LE(28);
  const vBa = raw.readUInt16LE(32);
  const vBits = raw.readUInt16LE(34);
  const vData = raw.readUInt32LE(40);
  const vRiff = raw.readUInt32LE(4);
  const nSamples = vData / 2;
  totalSamples += nSamples;
  const dur = nSamples / SR;

  check(
    `${spec.id}: cabecera RIFF/WAVE + fmt PCM ${vBits}-bit · ${vCh} canal · ${vSr} Hz · byteRate ${vBr} · blockAlign ${vBa}`,
    magicOk && vFmt === 1 && vBits === 16 && vCh === 1 && vSr === 32000 && vBr === 64000 && vBa === 2,
  );
  check(
    `${spec.id}: tamaños correctos (riffSize ${vRiff} = fileSize−8 · dataSize ${vData} = fileSize−44)`,
    vRiff === size - 8 && vData === size - 44,
  );
  check(
    `${spec.id}: duración ${dur.toFixed(3)} s = espec. ${spec.durSec.toFixed(1)} ± 0.05`,
    Math.abs(dur - spec.durSec) <= 0.05,
  );

  // — medidas desde los samples cuantizados
  let sq = 0;
  let peak = 0;
  const headN = Math.round(1.2 * SR);
  let headSq = 0;
  let tailSq = 0;
  for (let i = 0; i < nSamples; i++) {
    const v = raw.readInt16LE(HEADER_BYTES + 2 * i) / 32768;
    sq += v * v;
    if (i < headN) headSq += v * v;
    if (i >= nSamples - headN) tailSq += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  const rmsDb = 20 * Math.log10(Math.sqrt(sq / nSamples) + 1e-12);
  const peakDb = 20 * Math.log10(peak + 1e-12);
  const headDb = 20 * Math.log10(Math.sqrt(headSq / headN) + 1e-12);
  const tailDb = 20 * Math.log10(Math.sqrt(tailSq / headN) + 1e-12);
  check(`${spec.id}: RMS global ${rmsDb.toFixed(1)} dBFS ∈ [−23, −17]`, rmsDb >= -23 && rmsDb <= -17);
  check(`${spec.id}: pico ${peakDb.toFixed(1)} dBFS ≤ −3.0`, peakDb <= -3.0 + 0.05);
  check(`${spec.id}: RMS primeros 1.2 s ${headDb.toFixed(1)} dBFS ≤ −40 (loop limpio)`, headDb <= -40);
  check(`${spec.id}: RMS últimos 1.2 s ${tailDb.toFixed(1)} dBFS ≤ −40 (loop limpio)`, tailDb <= -40);

  const sha = createHash("sha256").update(raw).digest("hex");
  rows.push({
    id: spec.id,
    dur: dur.toFixed(1),
    bytes: size,
    rmsDb,
    peakDb,
    headDb,
    tailDb,
    sha,
  });
}

// — manifiesto
const manifestRaw = readFileSync(MANIFEST_PATH, "utf8");
const manifestParsed = JSON.parse(manifestRaw) as Manifest;
check(
  `manifiesto: version 1 · ${manifestParsed.pistas.length} pistas · licencia CC0`,
  manifestParsed.version === 1 && manifestParsed.pistas.length === 9 && manifestParsed.licencia.includes("CC0"),
);
for (let i = 0; i < TRACKS.length; i++) {
  const p = manifestParsed.pistas[i];
  const spec = TRACKS[i];
  const durReal = Math.round((Math.round(spec.durSec * SR) / SR) * 10) / 10;
  check(
    `manifiesto[${i}] ${p.id}: campos · archivo ${p.archivo} · durSec ${p.durSec} · ánimo ${p.animo} · tensión ${p.tensionMin}–${p.tensionMax}`,
    p.id === spec.id &&
      p.archivo === `/demo/musica/${spec.id}.wav` &&
      Math.abs(p.durSec - durReal) <= 0.05 &&
      p.animo === spec.animo &&
      p.tensionMin === spec.tensionMin &&
      p.tensionMax === spec.tensionMax &&
      p.bpm === spec.bpm &&
      p.titulo === spec.titulo &&
      p.tonalidad === spec.tonalidad &&
      typeof p.instrumentacion === "string" &&
      p.instrumentacion.length > 0 &&
      typeof p.descripcion === "string" &&
      p.descripcion.length > 0,
  );
}

check(
  `tamaño total ${totalBytes.toLocaleString("en-US")} B (${(totalBytes / 1e6).toFixed(1)} MB) = 44×9 + 2×${totalSamples.toLocaleString("en-US")} samples`,
  totalBytes === 9 * HEADER_BYTES + 2 * totalSamples && totalBytes > 34e6 && totalBytes < 39e6,
);

// — tabla resumen
console.log("");
console.log("Resumen por pista (medido desde los WAV escritos):");
console.log(
  "  pista                dur(s)     bytes    RMS dB  pico dB  ini dB  fin dB  seed        sha256[:12]",
);
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  console.log(
    `  ${r.id.padEnd(19)} ${r.dur.padStart(6)} ${r.bytes.toLocaleString("en-US").padStart(11)} ` +
      `${r.rmsDb.toFixed(1).padStart(9)} ${r.peakDb.toFixed(1).padStart(9)} ${r.headDb.toFixed(1).padStart(7)} ` +
      `${r.tailDb.toFixed(1).padStart(7)}  0x${TRACKS[i].seed.toString(16).padEnd(10)} ${r.sha.slice(0, 12)}`,
  );
}
console.log(`  ${"TOTAL".padEnd(19)} ${" ".repeat(6)} ${totalBytes.toLocaleString("en-US").padStart(11)}`);

console.log("");
if (failures.length === 0) {
  console.log("VERIFICATION OK");
  process.exit(0);
} else {
  console.error(`${failures.length} verificación(es) fallida(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.log("VERIFICATION FAILED");
  process.exit(1);
}
