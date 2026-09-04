/**
 * Bardo Studio — Biblioteca de efectos de sonido (SFX) CC0
 *
 * Genera 37 efectos de sonido sintetizados de forma 100 % determinista
 * (un LCG con semilla fija por efecto, sin Math.random suelto) y escribe:
 *
 *   public/sfx/<id>.wav        · RIFF/WAVE · PCM 16-bit · MONO · 22050 Hz
 *   config/sfx.json            · catálogo (id, nombre, archivo, durSec)
 *   config/sfx_config.json     · palabras clave ES/EN por categoría + defectos
 *                                (editable por el usuario: siembra inicial)
 *
 * Síntesis local estilo "musiquero de estudio": ruido filtrado (paso bajo/
 * alto/banda biquad RBJ), osciladores con integración de fase, envolventes
 * exponenciales, AM/FM, parciales inarmónicos (campanas/metal) y tanh como
 * limitador suave. Cada efecto se normaliza a pico −3.2 dBFS (0.7) y recibe
 * micro-fades anti-clic.
 *
 * Idempotente: re-ejecutar sobrescribe con bytes idénticos.
 * Dependencias: ninguna (node:fs / node:path, estándar en Bun).
 *
 * Run: cd /home/z/my-project && bun scripts/generate-sfx-library.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ===========================================================================
// Constantes de salida
// ===========================================================================
const argv1 = process.argv[1] ?? process.cwd();
const PROJECT_ROOT = resolve(dirname(argv1), "..");
const OUT_DIR = join(PROJECT_ROOT, "public", "sfx");
const CONFIG_SFX = join(PROJECT_ROOT, "config", "sfx.json");
const CONFIG_KEYWORDS = join(PROJECT_ROOT, "config", "sfx_config.json");

const SR = 22050;
const SEED_BASE = 20260907;

// ===========================================================================
// PRNG determinista (LCG por efecto)
// ===========================================================================
type Rng = () => number;
function lcg(seed: number): Rng {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ===========================================================================
// Mini-caja de DSP (Float32Array en todo)
// ===========================================================================
const zeros = (len: number) => new Float32Array(len);

function white(rng: Rng, len: number): Float32Array {
  const x = zeros(len);
  for (let i = 0; i < len; i++) x[i] = rng() * 2 - 1;
  return x;
}

/** ruido browniano (integrador con fuga), normalizado a pico 1 */
function brown(rng: Rng, len: number, leak = 0.997): Float32Array {
  const x = zeros(len);
  let acc = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    acc = acc * leak + (rng() * 2 - 1) * 0.02;
    x[i] = acc;
    const a = Math.abs(acc);
    if (a > peak) peak = a;
  }
  if (peak > 0) for (let i = 0; i < len; i++) x[i] /= peak;
  return x;
}

/** paso bajo de un polo */
function lpf(x: Float32Array, cutHz: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutHz) / SR);
  const y = zeros(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += a * (x[i] - acc);
    y[i] = acc;
  }
  return y;
}

/** paso alto = señal − paso bajo */
function hpf(x: Float32Array, cutHz: number): Float32Array {
  const l = lpf(x, cutHz);
  const y = zeros(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] - l[i];
  return y;
}

/** paso banda biquad (RBJ cookbook) */
function bp(x: Float32Array, f0: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * f0) / SR;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const alpha = s / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * c) / a0;
  const a2 = (1 - alpha) / a0;
  const y = zeros(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const yn = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = yn;
    y[i] = yn;
  }
  return y;
}

/** envolvente ataque/decaimiento con rampas de coseno */
function envAR(len: number, attackS: number, releaseS: number): Float32Array {
  const e = zeros(len);
  const na = Math.max(1, Math.round(attackS * SR));
  const nr = Math.max(1, Math.round(releaseS * SR));
  for (let i = 0; i < len; i++) {
    let v = 1;
    if (i < na) v = 0.5 - 0.5 * Math.cos((Math.PI * i) / na);
    else if (i > len - nr) v = 0.5 - 0.5 * Math.cos((Math.PI * (len - i)) / nr);
    e[i] = v;
  }
  return e;
}

/** envolvente de decaimiento exponencial (τ en s) desde el instante t0 */
function decayEnv(len: number, tauS: number, t0 = 0): Float32Array {
  const e = zeros(len);
  const tau = tauS * SR;
  for (let i = 0; i < len; i++) {
    const n = i - t0 * SR;
    e[i] = n <= 0 ? 0 : Math.exp(-n / tau);
  }
  return e;
}

/** suma capas (padding a la más larga); ignora argumentos no-array */
function mix(...capas: Array<Float32Array | number>): Float32Array {
  const layers = capas.filter((l): l is Float32Array => l instanceof Float32Array);
  const len = layers.reduce((m, l) => Math.max(m, l.length), 0);
  const y = zeros(len);
  for (const l of layers) for (let i = 0; i < l.length; i++) y[i] += l[i];
  return y;
}

/** suma src (con ganancia) sobre dst a partir de offset muestras */
function add(dst: Float32Array, src: Float32Array, gain = 1, offset = 0): void {
  for (let i = 0; i < src.length && offset + i < dst.length; i++)
    dst[offset + i] += src[i] * gain;
}

/** multiplica por envolvente (elemento a elemento) o por ganancia constante */
function mul(x: Float32Array, e: Float32Array | number): Float32Array {
  const esNum = typeof e === "number";
  const len = esNum ? x.length : Math.max(x.length, (e as Float32Array).length);
  const y = zeros(len);
  for (let i = 0; i < len; i++) {
    const ev = esNum ? (e as number) : ((e as Float32Array)[i] ?? (i < x.length ? 1 : 0));
    y[i] = (x[i] ?? 0) * ev;
  }
  return y;
}

function am(x: Float32Array, rateHz: number, depth: number, phase = 0): Float32Array {
  const y = zeros(x.length);
  for (let i = 0; i < x.length; i++)
    y[i] = x[i] * (1 - depth + depth * (0.5 + 0.5 * Math.sin((2 * Math.PI * rateHz * i) / SR + phase)));
  return y;
}

/** oscilador sinusoidal con frecuencia instantánea (integración de fase) */
function sineFm(len: number, f: (t: number) => number, phase = 0): Float32Array {
  const y = zeros(len);
  let ph = phase;
  for (let i = 0; i < len; i++) {
    ph += (2 * Math.PI * f(i / SR)) / SR;
    y[i] = Math.sin(ph);
  }
  return y;
}

/** glissando lineal f0 → f1 */
function chirp(len: number, f0: number, f1: number): Float32Array {
  return sineFm(len, (t) => f0 + (f1 - f0) * (t / (len / SR)));
}

/** limitador suave + normalización a pico */
function normalize(x: Float32Array, peak = 0.7): Float32Array {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.tanh(x[i] * 1.4);
    x[i] = v;
    const a = Math.abs(v);
    if (a > p) p = a;
  }
  if (p > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i] / p) * peak;
  return x;
}

/** micro-fades anti-clic */
function fades(x: Float32Array, ms = 6): Float32Array {
  const n = Math.max(1, Math.round((ms / 1000) * SR));
  for (let i = 0; i < n && i < x.length; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

/** duración→muestras */
const sec = (s: number) => Math.round(s * SR);

// ===========================================================================
// Especificación de los 37 efectos
// ===========================================================================
interface SfxSpec {
  id: string;
  nombre: string;
  etiquetas: string[];
  dur: number;
  gen: (rng: Rng) => Float32Array;
}

const SPECS: SfxSpec[] = [
  // ---------- clima ----------
  {
    id: "thunder-01",
    nombre: "Trueno cercano",
    etiquetas: ["clima"],
    dur: 5.0,
    gen: (rng) => {
      const n = sec(5.0);
      const y = zeros(n);
      const crack = mul(hpf(white(rng, sec(0.09)), 300), envAR(sec(0.09), 0.002, 0.07));
      add(y, crack, 0.9);
      const cuerpo = mul(lpf(brown(rng, n, 0.999), 150), decayEnv(n, 1.2, 0.05));
      add(y, cuerpo, 1.0);
      const eco = mul(lpf(brown(rng, n, 0.999), 110), decayEnv(n, 1.5, 2.0));
      add(y, eco, 0.5);
      return y;
    },
  },
  {
    id: "thunder-02",
    nombre: "Trueno lejano",
    etiquetas: ["clima"],
    dur: 6.0,
    gen: (rng) => {
      const n = sec(6.0);
      const rumble = am(lpf(brown(rng, n, 0.9993), 90), 0.7, 0.5);
      const e = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        e[i] = Math.min(1, t / 1.5) * Math.exp(-Math.max(0, t - 1.5) / 2.5);
      }
      return mul(rumble, e);
    },
  },
  {
    id: "rain-01",
    nombre: "Lluvia constante",
    etiquetas: ["clima"],
    dur: 6.0,
    gen: (rng) => {
      const n = sec(6.0);
      const capa1 = bp(white(rng, n), 2500, 0.5);
      const capa2 = bp(white(rng, n), 5500, 0.6);
      const y = mix(mul(capa1, envAR(n, 0.4, 0.6)), mul(capa2, 0.45, ), );
      // gotas dispersas
      for (let k = 0; k < 30; k++) {
        const t = Math.floor(rng() * (n - sec(0.01)));
        const g = 0.25 + rng() * 0.3;
        for (let i = 0; i < sec(0.004); i++) y[t + i] += (rng() * 2 - 1) * g;
      }
      return y;
    },
  },
  {
    id: "wind-01",
    nombre: "Viento con rachas",
    etiquetas: ["clima"],
    dur: 6.0,
    gen: (rng) => {
      const n = sec(6.0);
      const base = lpf(white(rng, n), 400);
      const lento = am(base, 0.35, 0.65);
      // rachas: segunda capa con envolvente irregular
      const gust = bp(white(rng, n), 700, 1.2);
      const e = zeros(n);
      let nivel = 0.3;
      for (let i = 0; i < n; i++) {
        if (rng() < 0.0004) nivel = 0.15 + rng() * 0.75;
        e[i] = nivel;
      }
      return mix(lento, mul(mul(gust, e), 0.6));
    },
  },
  // ---------- pasos / puertas ----------
  {
    id: "footsteps-01",
    nombre: "Pasos sobre grava",
    etiquetas: ["acción"],
    dur: 5.0,
    gen: (rng) => {
      const n = sec(5.0);
      const y = zeros(n);
      let t = 0.1;
      let paso = 0;
      while (t < 4.6) {
        const dur = 0.09 + rng() * 0.03;
        const golpe = mul(
          lpf(white(rng, sec(dur)), 300),
          envAR(sec(dur), 0.004, dur * 0.8)
        );
        add(y, golpe, paso % 2 === 0 ? 0.9 : 0.75, sec(t));
        // gravilla: micro-clics
        for (let k = 0; k < 4; k++) {
          const off = sec(t) + Math.floor(rng() * sec(0.05));
          for (let i = 0; i < 20 && off + i < n; i++)
            y[off + i] += (rng() * 2 - 1) * 0.12;
        }
        t += 0.58 + rng() * 0.12;
        paso++;
      }
      return y;
    },
  },
  {
    id: "door-creak-01",
    nombre: "Puerta rechinando",
    etiquetas: ["interior"],
    dur: 3.5,
    gen: (rng) => {
      const n = sec(3.5);
      // chirrido: sierra con tono ascendente + resonancia
      const f0 = 360 + 160 * (1 / 3.5);
      const chirrido = sineFm(n, (t) => 360 + 170 * (t / 3.5) + Math.sin(2 * Math.PI * 1.7 * t) * 25);
      const sq = zeros(n);
      for (let i = 0; i < n; i++) sq[i] = Math.sign(chirrido[i]) * 0.6 + chirrido[i] * 0.4;
      const resonante = bp(sq, 1150, 9);
      // stick-slip: AM irregular
      const amEnv = zeros(n);
      let depth = 0.7;
      for (let i = 0; i < n; i++) {
        if (rng() < 0.002) depth = 0.45 + rng() * 0.5;
        amEnv[i] = depth;
      }
      const modulado = zeros(n);
      for (let i = 0; i < n; i++)
        modulado[i] = resonante[i] * (1 - amEnv[i] + amEnv[i] * Math.abs(Math.sin((2 * Math.PI * 9 * i) / SR)));
      return mul(modulado, envAR(n, 0.15, 0.4));
    },
  },
  {
    id: "door-slam-01",
    nombre: "Portazo",
    etiquetas: ["interior", "acción"],
    dur: 1.2,
    gen: (rng) => {
      const n = sec(1.2);
      const y = zeros(n);
      const golpe = mul(lpf(white(rng, sec(0.25)), 250), envAR(sec(0.25), 0.003, 0.22));
      add(y, golpe, 1.0);
      const cuerpo = bp(white(rng, n), 400, 1.5);
      add(y, mul(cuerpo, decayEnv(n, 0.35, 0.02)), 0.6);
      // vibración del marco
      add(y, mul(sineFm(sec(1.0), (t) => 65 * Math.exp(-t * 2)), decayEnv(sec(1.0), 0.5)), 0.5, sec(0.15));
      return y;
    },
  },
  // ---------- metal / combate ----------
  {
    id: "sword-clash-01",
    nombre: "Choque de espadas",
    etiquetas: ["combate"],
    dur: 2.0,
    gen: (rng) => {
      const n = sec(2.0);
      const y = zeros(n);
      // chispa inicial
      add(y, mul(hpf(white(rng, sec(0.05)), 2000), envAR(sec(0.05), 0.001, 0.04)), 0.8);
      // parciales inarmónicos metálicos
      const parciales = [520, 811, 1247, 2210, 3190, 4100];
      for (const f of parciales) {
        const tau = 0.25 + (1500 / f) * 0.55;
        const p = mul(sineFm(n, () => f * (1 + (rng() - 0.5) * 0.004)), decayEnv(n, tau, 0.01));
        add(y, p, 0.55 / (1 + f / 900));
      }
      // segundo golpe débil (ripostas)
      add(y, mul(hpf(white(rng, sec(0.06)), 2500), envAR(sec(0.06), 0.001, 0.05)), 0.35, sec(0.62));
      const parciales2 = [610, 990, 1830];
      for (const f of parciales2) {
        const p = mul(sineFm(n, () => f), decayEnv(n, 0.3, 0.63));
        add(y, p, 0.3 / (1 + f / 900));
      }
      return y;
    },
  },
  {
    id: "sword-unsheathe-01",
    nombre: "Desenvainar",
    etiquetas: ["combate"],
    dur: 1.5,
    gen: (rng) => {
      const n = sec(1.5);
      // barrido de ruido filtrado hacia arriba + anillo metálico
      const barrido = white(rng, n);
      const a = bp(barrido, 900, 2.2);
      const b = bp(barrido, 2600, 3.5);
      const e = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        e[i] = Math.exp(-Math.pow((t - 0.35) / 0.22, 2));
      }
      const y = mix(mul(a, e), mul(b, e));
      add(y, mul(sineFm(n, () => 3100), decayEnv(n, 0.8, 0.4)), 0.28);
      add(y, mul(sineFm(n, () => 4700), decayEnv(n, 0.5, 0.4)), 0.18);
      return y;
    },
  },
  // ---------- bestias ----------
  {
    id: "roar-01",
    nombre: "Rugido de bestia",
    etiquetas: ["bestia"],
    dur: 3.0,
    gen: (rng) => {
      const n = sec(3.0);
      // portador grave con growl AM
      const base = sineFm(n, (t) => 82 + 18 * Math.sin(2 * Math.PI * 0.9 * t));
      const arm = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        arm[i] = Math.sign(base[i]) * 0.7 + base[i] * 0.3;
      }
      const growl = am(arm, 26, 0.75);
      const formante = mix(bp(growl, 240, 2), mul(bp(growl, 520, 2.5), 0.7));
      const aliento = mul(hpf(white(rng, n), 500), envAR(n, 0.3, 0.8));
      const y = mix(formante, mul(aliento, 0.35));
      const env = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        env[i] = Math.min(1, t / 0.3) * Math.exp(-Math.max(0, t - 0.8) / 1.3);
      }
      return mul(y, env);
    },
  },
  {
    id: "wolf-howl-01",
    nombre: "Aullido de lobo",
    etiquetas: ["bestia"],
    dur: 4.0,
    gen: () => {
      const n = sec(4.0);
      const freq = (t: number) => {
        const subida = Math.min(1, t / 1.1);
        const plana = Math.max(0, Math.min(1, (t - 1.1) / 1.2));
        const caida = Math.max(0, (t - 2.3) / 1.7);
        let f = 340 + 190 * subida - 30 * plana - 150 * caida;
        f += Math.sin(2 * Math.PI * 5.2 * t) * 9; // vibrato
        return Math.max(120, f);
      };
      const tono = sineFm(n, freq);
      const harmon = sineFm(n, (t) => freq(t) * 2.01);
      const y = mix(tono, mul(harmon, 0.25));
      const env = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        env[i] = Math.min(1, t / 0.5) * Math.max(0, 1 - Math.max(0, t - 2.8) / 1.1);
      }
      return mul(y, env);
    },
  },
  {
    id: "dragon-roar-01",
    nombre: "Rugido de dragón",
    etiquetas: ["bestia"],
    dur: 4.5,
    gen: (rng) => {
      const n = sec(4.5);
      const base = sineFm(n, (t) => 70 + 14 * Math.sin(2 * Math.PI * 0.8 * t));
      const arm = zeros(n);
      for (let i = 0; i < n; i++) arm[i] = Math.sign(base[i]) * 0.8 + base[i] * 0.2;
      const growl = am(arm, 21, 0.8);
      const formantes = mix(bp(growl, 200, 1.8), mul(bp(growl, 480, 2.2), 0.8), mul(lpf(white(rng, n), 3500), 0.0), );
      const fuego = mul(hpf(white(rng, n), 1500), decayEnv(n, 2.2, 0.6));
      const sub = mul(sineFm(n, () => 44), decayEnv(n, 1.6, 0.05));
      const y = mix(formantes, mul(fuego, 0.5), mul(sub, 0.6));
      const env = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        env[i] = Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - 1.2) / 2.0);
      }
      return mul(y, env);
    },
  },
  {
    id: "monster-growl-01",
    nombre: "Gruñido de monstruo",
    etiquetas: ["bestia"],
    dur: 3.5,
    gen: () => {
      const n = sec(3.5);
      const base = sineFm(n, (t) => 75 + 10 * Math.sin(2 * Math.PI * 0.6 * t) + Math.sin(2 * Math.PI * 1.9 * t) * 6);
      const arm = zeros(n);
      for (let i = 0; i < n; i++) {
        const v = Math.tanh(base[i] * 3);
        arm[i] = v;
      }
      const growl = am(arm, 24, 0.85);
      const y = mix(bp(growl, 210, 2), mul(bp(growl, 460, 2.6), 0.55));
      const env = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        env[i] = Math.min(1, t / 0.4) * Math.exp(-Math.max(0, t - 1.0) / 1.5);
      }
      return mul(y, env);
    },
  },
  // ---------- naturaleza ----------
  {
    id: "bird-chirp-01",
    nombre: "Pájaros",
    etiquetas: ["naturaleza"],
    dur: 4.0,
    gen: (rng) => {
      const n = sec(4.0);
      const y = zeros(n);
      let t = 0.15;
      while (t < 3.7) {
        const dur = 0.06 + rng() * 0.08;
        const f0 = 2400 + rng() * 900;
        const pio = sineFm(sec(dur), (tt) =>
          f0 + Math.sin(2 * Math.PI * (22 + rng() * 10) * tt) * (600 + rng() * 400)
        );
        const g = 0.5 + rng() * 0.5;
        add(y, mul(pio, envAR(sec(dur), 0.008, dur * 0.7)), g, sec(t));
        t += dur + 0.12 + rng() * 0.5;
      }
      // un pájaro lejano
      add(y, mul(sineFm(sec(0.1), () => 1800), envAR(sec(0.1), 0.01, 0.09)), 0.25, sec(2.6));
      return y;
    },
  },
  {
    id: "crickets-01",
    nombre: "Grillos",
    etiquetas: ["naturaleza"],
    dur: 5.0,
    gen: (rng) => {
      const n = sec(5.0);
      const y = zeros(n);
      const canto = (f: number, periodo: number, ganancia: number, offset: number) => {
        let t = offset;
        while (t < 4.9) {
          for (let k = 0; k < 3; k++) {
            const dur = 0.022;
            const p = sineFm(sec(dur), () => f);
            add(y, mul(p, envAR(sec(dur), 0.002, 0.018)), ganancia, sec(t + k * 0.03));
          }
          t += periodo * (0.92 + rng() * 0.16);
        }
      };
      canto(4300, 0.62, 0.5, 0.05);
      canto(3700, 0.55, 0.32, 0.3);
      canto(4700, 0.71, 0.22, 0.55);
      return mul(y, envAR(n, 0.3, 0.5));
    },
  },
  {
    id: "water-flow-01",
    nombre: "Arroyo",
    etiquetas: ["agua"],
    dur: 6.0,
    gen: (rng) => {
      const n = sec(6.0);
      const lecho = mix(lpf(white(rng, n), 900), mul(bp(white(rng, n), 1800, 1.0), 0.6));
      const y = mul(lecho, envAR(n, 0.5, 0.7));
      // burbujas
      for (let k = 0; k < 25; k++) {
        const t = rng() * 5.6;
        const f0 = 500 + rng() * 700;
        const burbuja = chirp(sec(0.05), f0, f0 * 1.9);
        add(y, mul(burbuja, decayEnv(sec(0.05), 0.02)), 0.16, sec(t));
      }
      return y;
    },
  },
  {
    id: "waves-01",
    nombre: "Olas del mar",
    etiquetas: ["agua"],
    dur: 7.0,
    gen: (rng) => {
      const n = sec(7.0);
      const profundo = lpf(white(rng, n), 480);
      const espuma = hpf(white(rng, n), 1200);
      const y = zeros(n);
      for (const t0 of [0.2, 3.7]) {
        const e = zeros(n);
        for (let i = 0; i < n; i++) {
          const t = i / SR - t0;
          if (t < 0) continue;
          e[i] = Math.min(1, t / 1.8) * Math.exp(-Math.max(0, t - 1.8) / 1.3);
        }
        add(y, mul(mul(profundo, e), 0.9));
        // espuma en la cresta
        const ef = zeros(n);
        for (let i = 0; i < n; i++) {
          const t = i / SR - t0 - 1.6;
          if (t < 0) continue;
          ef[i] = Math.exp(-t / 0.9);
        }
        add(y, mul(mul(espuma, ef), 0.35));
      }
      return y;
    },
  },
  {
    id: "drip-01",
    nombre: "Goteo en caverna",
    etiquetas: ["agua", "interior"],
    dur: 3.0,
    gen: (rng) => {
      const n = sec(3.0);
      const y = zeros(n);
      const gota = (t: number, g: number) => {
        const plink = chirp(sec(0.09), 1350, 750);
        add(y, mul(plink, decayEnv(sec(0.09), 0.018)), g, sec(t));
        // eco
        add(y, mul(plink, decayEnv(sec(0.09), 0.02)), g * 0.35, sec(t + 0.28));
        add(y, mul(lpf(plink, 900), decayEnv(sec(0.09), 0.025)), g * 0.18, sec(t + 0.56));
      };
      for (const [t, g] of [
        [0.1, 0.9],
        [0.95, 0.7],
        [1.8, 0.8],
        [2.45, 0.5],
      ] as const) {
        gota(t, g * (0.9 + rng() * 0.2));
      }
      return y;
    },
  },
  {
    id: "fire-01",
    nombre: "Fuego crepitante",
    etiquetas: ["fuego"],
    dur: 6.0,
    gen: (rng) => {
      const n = sec(6.0);
      const lecho = mul(lpf(brown(rng, n, 0.999), 600), 0.35);
      const y = mix(mul(lecho, envAR(n, 0.4, 0.6)));
      // chasquidos
      for (let k = 0; k < 42; k++) {
        const t = rng() * 5.8;
        const dur = 0.003 + rng() * 0.006;
        const g = 0.35 + rng() * 0.6;
        const crack = mul(hpf(white(rng, sec(dur) + 1), 1800), decayEnv(sec(dur) + 1, 0.012));
        add(y, crack, g, sec(t));
      }
      // siseos ocasionales
      for (let k = 0; k < 5; k++) {
        const t = rng() * 5.2;
        const dur = 0.12 + rng() * 0.1;
        const siseo = bp(white(rng, sec(dur) + 1), 3200, 1.5);
        add(y, siseo, 0.16, sec(t));
      }
      return y;
    },
  },
  // ---------- impactos ----------
  {
    id: "explosion-01",
    nombre: "Explosión",
    etiquetas: ["impacto"],
    dur: 4.0,
    gen: (rng) => {
      const n = sec(4.0);
      const y = zeros(n);
      const estallido = mul(hpf(white(rng, sec(0.3)), 120), envAR(sec(0.3), 0.004, 0.28));
      add(y, estallido, 1.0);
      const cola = mul(lpf(brown(rng, n, 0.9994), 130), decayEnv(n, 1.8, 0.12));
      add(y, cola, 1.1);
      const sub = mul(sineFm(sec(2.0), (t) => 52 - 22 * Math.min(1, t)), decayEnv(sec(2.0), 1.1, 0.02));
      add(y, sub, 0.7);
      // escombros
      for (let k = 0; k < 12; k++) {
        const t = 0.4 + rng() * 2.5;
        const dur = 0.01;
        add(y, mul(hpf(white(rng, sec(dur) + 1), 900), decayEnv(sec(dur) + 1, 0.02)), 0.2 + rng() * 0.25, sec(t));
      }
      return y;
    },
  },
  {
    id: "glass-break-01",
    nombre: "Cristal rompiéndose",
    etiquetas: ["impacto"],
    dur: 2.0,
    gen: (rng) => {
      const n = sec(2.0);
      const y = zeros(n);
      add(y, mul(hpf(white(rng, sec(0.06)), 2200), envAR(sec(0.06), 0.002, 0.055)), 0.9);
      for (let k = 0; k < 14; k++) {
        const t = 0.05 + rng() * 0.85;
        const f = 2400 + rng() * 3200;
        const tau = 0.12 + rng() * 0.3;
        const tink = mul(sineFm(sec(0.5), () => f * (1 + (rng() - 0.5) * 0.01)), decayEnv(sec(0.5), tau));
        add(y, tink, 0.3 * (1 - t / 1.1) + 0.1, sec(t));
      }
      return y;
    },
  },
  {
    id: "snap-01",
    nombre: "Crujido seco",
    etiquetas: ["impacto"],
    dur: 0.8,
    gen: (rng) => {
      const n = sec(0.8);
      const y = zeros(n);
      add(y, mul(hpf(white(rng, sec(0.02)), 1500), envAR(sec(0.02), 0.001, 0.018)), 0.9);
      add(y, mul(bp(white(rng, sec(0.1)), 1800, 2), decayEnv(sec(0.1), 0.03)), 0.8, sec(0.008));
      add(y, mul(sineFm(sec(0.3), () => 880), decayEnv(sec(0.3), 0.06)), 0.3, sec(0.01));
      return mul(y, envAR(n, 0.004, 0.15));
    },
  },
  // ---------- cuerpo ----------
  {
    id: "heartbeat-01",
    nombre: "Latido del corazón",
    etiquetas: ["cuerpo"],
    dur: 4.2,
    gen: (rng) => {
      const n = sec(4.2);
      const y = zeros(n);
      let t = 0.15;
      while (t < 3.8) {
        // lub
        const lub = mix(
          mul(sineFm(sec(0.16), (tt) => 62 - 10 * tt), decayEnv(sec(0.16), 0.045)),
          mul(lpf(white(rng, sec(0.1)), 200), decayEnv(sec(0.1), 0.03))
        );
        add(y, lub, 0.9, sec(t));
        // dub
        const dub = mix(
          mul(sineFm(sec(0.18), (tt) => 55 - 8 * tt), decayEnv(sec(0.18), 0.05)),
          mul(lpf(white(rng, sec(0.1)), 170), decayEnv(sec(0.1), 0.035))
        );
        add(y, dub, 0.7, sec(t + 0.33));
        t += 1.35;
      }
      return y;
    },
  },
  {
    id: "gasp-01",
    nombre: "Jadeo",
    etiquetas: ["cuerpo"],
    dur: 1.4,
    gen: (rng) => {
      const n = sec(1.4);
      const y = zeros(n);
      const jadeo = (t: number, g: number, f: number) => {
        const b = bp(white(rng, sec(0.45)), f, 1.4);
        add(y, mul(b, envAR(sec(0.45), 0.045, 0.4)), g, sec(t));
      };
      jadeo(0.02, 0.9, 1300);
      jadeo(0.5, 0.55, 900);
      jadeo(0.9, 0.35, 1100);
      return y;
    },
  },
  // ---------- voces ----------
  {
    id: "laugh-01",
    nombre: "Risa",
    etiquetas: ["voz"],
    dur: 3.0,
    gen: (rng) => {
      const n = sec(3.0);
      const y = zeros(n);
      let t = 0.05;
      let i = 0;
      while (t < 2.7) {
        const dur = 0.16 + rng() * 0.04;
        const f0 = 235 - i * 8;
        // "ja": formantes de vocal a + ataque consonántico
        const carrier = sineFm(sec(dur), (tt) => f0 * (1 - 0.12 * (tt / dur)));
        const arm = zeros(sec(dur));
        for (let k = 0; k < arm.length; k++) arm[k] = Math.tanh(carrier[k] * 2.2);
        const formante = mix(bp(arm, 800, 2), mul(bp(arm, 1150, 2.4), 0.8));
        const env = envAR(sec(dur), 0.012, dur * 0.75);
        add(y, mul(formante, env), 0.8, sec(t));
        // consonante
        add(y, mul(hpf(white(rng, sec(0.02)), 2000), envAR(sec(0.02), 0.002, 0.017)), 0.3, sec(t));
        t += dur + 0.14 + rng() * 0.06;
        i++;
      }
      return y;
    },
  },
  {
    id: "scream-01",
    nombre: "Grito",
    etiquetas: ["voz"],
    dur: 2.5,
    gen: (rng) => {
      const n = sec(2.5);
      const f0 = 640;
      const carrier = sineFm(n, (t) => f0 + 260 * Math.min(1, t / 0.35) + Math.sin(2 * Math.PI * 6.5 * t) * 30);
      const arm = zeros(n);
      for (let i = 0; i < n; i++) arm[i] = Math.tanh(carrier[i] * 2.5);
      const formantes = mix(
        bp(arm, 850, 2.5),
        mul(bp(arm, 1600, 3), 0.9),
        mul(bp(arm, 2800, 4), 0.5)
      );
      const raspa = mul(hpf(white(rng, n), 2500), 0.35);
      const y = mix(formantes, raspa);
      const env = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        env[i] = Math.min(1, t / 0.08) * Math.exp(-Math.max(0, t - 0.6) / 1.2);
      }
      return mul(y, env);
    },
  },
  // ---------- animales ----------
  {
    id: "horse-gallop-01",
    nombre: "Galope de caballo",
    etiquetas: ["acción"],
    dur: 4.5,
    gen: (rng) => {
      const n = sec(4.5);
      const y = zeros(n);
      const golpe = (t: number, g: number) => {
        const thump = mix(
          mul(sineFm(sec(0.12), (tt) => 78 - 18 * tt), decayEnv(sec(0.12), 0.04)),
          mul(lpf(white(rng, sec(0.09)), 260), decayEnv(sec(0.09), 0.03))
        );
        add(y, thump, g, sec(t));
      };
      let t = 0.1;
      let stride = 0;
      while (t < 4.2) {
        const g = Math.min(1, 0.55 + stride * 0.12);
        golpe(t, g * 1.0);
        golpe(t + 0.16, g * 0.8);
        golpe(t + 0.3, g * 0.9);
        golpe(t + 0.55, g * 0.7);
        t += 0.68;
        stride++;
      }
      return y;
    },
  },
  // ---------- espacios ----------
  {
    id: "echo-ping-01",
    nombre: "Eco de caverna",
    etiquetas: ["espacio"],
    dur: 3.0,
    gen: () => {
      const n = sec(3.0);
      const y = zeros(n);
      const pings: Array<[number, number, number]> = [
        [0.02, 1.0, 1.0],
        [0.42, 0.55, 0.85],
        [0.84, 0.32, 0.7],
        [1.3, 0.18, 0.55],
        [1.78, 0.1, 0.4],
      ];
      for (const [t, g, brillo] of pings) {
        const ping = mix(
          mul(sineFm(sec(0.09), () => 1080), decayEnv(sec(0.09), 0.016)),
          mul(hpf(white(lcg(7), sec(0.03)), 900), envAR(sec(0.03), 0.001, 0.028))
        );
        const filtrado = lpf(ping, 1100 * brillo);
        add(y, filtrado, g, sec(t));
      }
      return y;
    },
  },
  {
    id: "stone-grind-01",
    nombre: "Piedra moliendo",
    etiquetas: ["espacio", "impacto"],
    dur: 3.5,
    gen: (rng) => {
      const n = sec(3.5);
      const base = bp(mix(brown(rng, n, 0.9985), mul(white(rng, n), 0.4)), 260, 1.4);
      const amEnv = zeros(n);
      let depth = 0.6;
      for (let i = 0; i < n; i++) {
        if (rng() < 0.003) depth = 0.4 + rng() * 0.6;
        amEnv[i] = depth;
      }
      const modulado = zeros(n);
      for (let i = 0; i < n; i++)
        modulado[i] = base[i] * (1 - amEnv[i] + amEnv[i] * Math.abs(Math.sin((2 * Math.PI * 3.2 * i) / SR)));
      const granalla = mul(hpf(white(rng, n), 2200), 0.22);
      const rumble = mul(lpf(brown(rng, n, 0.9993), 90), 0.5);
      return mix(modulado, granalla, rumble, mul(zeros(n), 0));
    },
  },
  // ---------- mágico / señal ----------
  {
    id: "magic-sparkle-01",
    nombre: "Destello mágico",
    etiquetas: ["magia"],
    dur: 2.5,
    gen: (rng) => {
      const n = sec(2.5);
      const y = zeros(n);
      const escala = [880, 988, 1175, 1319, 1568, 1760, 2093, 2349];
      escala.forEach((f, i) => {
        const t = 0.02 + i * 0.09;
        const nota = mix(
          sineFm(sec(0.5), () => f * (1 + (rng() - 0.5) * 0.002)),
          mul(sineFm(sec(0.5), () => f * 2.003), 0.3)
        );
        add(y, mul(nota, decayEnv(sec(0.5), 0.16)), 0.5 - i * 0.03, sec(t));
      });
      // polvo brillante
      const polvo = bp(white(rng, n), 5200, 0.8);
      const e = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        e[i] = Math.min(1, t / 0.3) * Math.exp(-t / 0.9);
      }
      add(y, mul(polvo, e), 0.1);
      return y;
    },
  },
  {
    id: "bell-01",
    nombre: "Campana",
    etiquetas: ["señal"],
    dur: 5.0,
    gen: (rng) => {
      const n = sec(5.0);
      const y = zeros(n);
      const f0 = 587;
      const parciales: Array<[number, number, number]> = [
        [0.56, 1.0, 2.1],
        [0.92, 0.7, 1.6],
        [1.19, 0.55, 1.1],
        [1.71, 0.4, 0.8],
        [2.0, 0.3, 0.6],
        [2.74, 0.2, 0.45],
        [3.0, 0.15, 0.35],
      ];
      for (const [ratio, g, tau] of parciales) {
        const f = f0 * ratio * (1 + (rng() - 0.5) * 0.002);
        const p = sineFm(n, () => f);
        add(y, mul(p, decayEnv(n, tau)), g * 0.6);
      }
      // martillo
      add(y, mul(hpf(white(rng, sec(0.03)), 1500), envAR(sec(0.03), 0.001, 0.028)), 0.4);
      return y;
    },
  },
  {
    id: "bell-toll-01",
    nombre: "Campanada grave",
    etiquetas: ["señal"],
    dur: 6.0,
    gen: (rng) => {
      const n = sec(6.0);
      const y = zeros(n);
      const f0 = 196;
      const parciales: Array<[number, number, number]> = [
        [0.5, 1.0, 3.4],
        [1.0, 0.6, 2.6],
        [1.18, 0.5, 2.0],
        [1.5, 0.35, 1.4],
        [2.0, 0.25, 1.0],
        [2.67, 0.15, 0.7],
      ];
      for (const [ratio, g, tau] of parciales) {
        const f = f0 * ratio * (1 + (rng() - 0.5) * 0.0015);
        add(y, mul(sineFm(n, () => f), decayEnv(n, tau)), g * 0.6);
      }
      add(y, mul(hpf(white(rng, sec(0.05)), 800), envAR(sec(0.05), 0.002, 0.045)), 0.35);
      return y;
    },
  },
  {
    id: "horn-01",
    nombre: "Cuerno",
    etiquetas: ["señal"],
    dur: 3.0,
    gen: () => {
      const n = sec(3.0);
      const f0 = 233;
      const osc = sineFm(n, (t) => f0 * (1 + Math.sin(2 * Math.PI * 5.5 * t) * 0.006));
      const arm = zeros(n);
      for (let i = 0; i < n; i++) {
        const v = Math.tanh(osc[i] * 2.4);
        arm[i] = v;
      }
      const brillo = mix(
        bp(arm, 470, 1.6),
        mul(bp(arm, 940, 2.2), 0.6),
        mul(bp(arm, 1400, 3), 0.3)
      );
      const env = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        env[i] = Math.min(1, t / 0.12) * (t > 2.3 ? Math.max(0, 1 - (t - 2.3) / 0.6) : 1);
      }
      return mul(brillo, env);
    },
  },
  {
    id: "war-drums-01",
    nombre: "Tambores de guerra",
    etiquetas: ["combate"],
    dur: 5.0,
    gen: (rng) => {
      const n = sec(5.0);
      const y = zeros(n);
      const tambor = (t: number, g: number) => {
        const golpe = mix(
          mul(sineFm(sec(0.3), (tt) => 88 - 33 * Math.min(1, tt * 8)), decayEnv(sec(0.3), 0.08)),
          mul(lpf(white(rng, sec(0.12)), 420), decayEnv(sec(0.12), 0.045))
        );
        add(y, golpe, g, sec(t));
      };
      const patrón = [
        [0.0, 1.0],
        [0.5, 0.85],
        [1.0, 1.0],
        [1.25, 0.7],
        [2.0, 1.0],
        [2.5, 0.85],
        [3.0, 1.0],
        [3.25, 0.7],
        [4.0, 0.9],
        [4.25, 0.65],
      ] as const;
      for (const [t, g] of patrón) tambor(t, g);
      return mul(y, envAR(n, 0.05, 0.3));
    },
  },
  // ---------- movimiento ----------
  {
    id: "whoosh-01",
    nombre: "Whoosh",
    etiquetas: ["movimiento"],
    dur: 1.5,
    gen: (rng) => {
      const n = sec(1.5);
      // barrido de banda: 300 → 2400 → 500
      const ruido = white(rng, n);
      const y = zeros(n);
      const paso = Math.max(1, Math.floor(n / 24));
      for (let i = 0; i < n; i += paso) {
        const t = i / SR;
        const f = 300 + 2100 * Math.sin(Math.PI * Math.min(1, t / 1.5));
        const trozo = ruido.subarray(i, Math.min(n, i + paso));
        const b = bp(trozo, f, 2.5);
        for (let k = 0; k < b.length; k++) y[i + k] += b[k];
      }
      const env = zeros(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        env[i] = Math.sin(Math.PI * Math.min(1, t / 1.5)) ** 1.5;
      }
      return mul(y, env);
    },
  },
  {
    id: "whoosh-02",
    nombre: "Doble whoosh",
    etiquetas: ["movimiento"],
    dur: 2.2,
    gen: (rng) => {
      const n = sec(2.2);
      const y = zeros(n);
      const whoosh = (t: number, g: number, fMax: number, dur: number) => {
        const len = sec(dur);
        const ruido = white(rng, len);
        const w = zeros(len);
        const paso = Math.max(1, Math.floor(len / 16));
        for (let i = 0; i < len; i += paso) {
          const tt = i / len;
          const f = 250 + (fMax - 250) * Math.sin(Math.PI * Math.min(1, tt));
          const trozo = ruido.subarray(i, Math.min(len, i + paso));
          const b = bp(trozo, f, 2.5);
          for (let k = 0; k < b.length; k++) w[i + k] += b[k];
        }
        const env = zeros(len);
        for (let i = 0; i < len; i++) env[i] = Math.sin((Math.PI * i) / len) ** 1.4;
        add(y, mul(w, env), g, sec(t));
      };
      whoosh(0.02, 0.9, 1800, 0.8);
      whoosh(1.3, 1.0, 2600, 0.85);
      return y;
    },
  },
  {
    id: "leaves-01",
    nombre: "Hojas secas",
    etiquetas: ["naturaleza"],
    dur: 4.0,
    gen: (rng) => {
      const n = sec(4.0);
      const lecho = mul(hpf(white(rng, n), 3400), 0.18);
      const y = mix(lecho);
      // ráfagas de hojas
      for (let k = 0; k < 6; k++) {
        const t = rng() * 3.2;
        const dur = 0.25 + rng() * 0.35;
        const g = 0.4 + rng() * 0.6;
        const rafaga = am(hpf(white(rng, sec(dur)), 2800), 9 + rng() * 8, 0.6);
        add(y, mul(rafaga, envAR(sec(dur), 0.05, dur * 0.6)), g, sec(t));
      }
      return mul(y, envAR(n, 0.2, 0.4));
    },
  },
];

// ===========================================================================
// Palabras clave por categoría (ES + EN + variantes)
// ===========================================================================
interface CatSpec {
  categoria: string;
  etiqueta: string;
  sfxId: string;
  palabras: string[];
}

const CATEGORIAS: CatSpec[] = [
  {
    categoria: "trueno",
    etiqueta: "Trueno / tormenta",
    sfxId: "thunder-01",
    palabras: ["trueno", "truenos", "tormenta", "tormentas", "relampago", "relampagos", "rayo", "rayos", "thunder", "storm", "lightning", "bolt"],
  },
  {
    categoria: "lluvia",
    etiqueta: "Lluvia",
    sfxId: "rain-01",
    palabras: ["lluvia", "llovia", "llovizna", "diluvio", "rain", "raining", "drizzle", "downpour"],
  },
  {
    categoria: "viento",
    etiqueta: "Viento / brisa",
    sfxId: "wind-01",
    palabras: ["viento", "vientos", "brisa", "brisas", "ventisca", "rafaga", "rafagas", "wind", "breeze", "gale", "gust"],
  },
  {
    categoria: "pasos",
    etiqueta: "Pasos / pisadas",
    sfxId: "footsteps-01",
    palabras: ["paso", "pasos", "pisada", "pisadas", "pisar", "camina", "caminar", "caminando", "footsteps", "steps", "walking"],
  },
  {
    categoria: "puerta",
    etiqueta: "Puerta rechinando",
    sfxId: "door-creak-01",
    palabras: ["puerta", "puertas", "porton", "portones", "rechino", "rechinando", "chirrio", "chirrido", "door", "doors", "gate", "creak", "creaking"],
  },
  {
    categoria: "portazo",
    etiqueta: "Portazo / golpe",
    sfxId: "door-slam-01",
    palabras: ["portazo", "portazos", "golpe", "golpes", "azoto", "azotar", "slam", "bang"],
  },
  {
    categoria: "espada",
    etiqueta: "Choque de espadas / metal",
    sfxId: "sword-clash-01",
    palabras: ["espada", "espadas", "acero", "choque", "chocar", "choca", "escudo", "escudos", "combate", "sword", "swords", "blade", "clash", "steel", "shield", "metal", "fight"],
  },
  {
    categoria: "desenvainar",
    etiqueta: "Desenvainar",
    sfxId: "sword-unsheathe-01",
    palabras: ["desenvainar", "desenvaina", "desenvaino", "vaina", "saca", "sacar", "unsheathe", "shing"],
  },
  {
    categoria: "rugido",
    etiqueta: "Rugido / gruñido",
    sfxId: "roar-01",
    palabras: ["rugido", "rugidos", "rugir", "ruge", "rugia", "rugiendo", "gruñe", "gruñido", "roar", "roars", "growl", "growling"],
  },
  {
    categoria: "aullido",
    etiqueta: "Aullido de lobo",
    sfxId: "wolf-howl-01",
    palabras: ["aullido", "aullidos", "aulla", "aullar", "lobo", "lobos", "howl", "howls", "wolf", "wolves"],
  },
  {
    categoria: "dragon",
    etiqueta: "Dragón",
    sfxId: "dragon-roar-01",
    palabras: ["dragon", "dragones", "dragon", "dragons", "wyvern"],
  },
  {
    categoria: "pajaro",
    etiqueta: "Pájaros",
    sfxId: "bird-chirp-01",
    palabras: ["pajaro", "pajaros", "ave", "aves", "pio", "trino", "trina", "bird", "birds", "chirp", "chirping", "tweet"],
  },
  {
    categoria: "grillo",
    etiqueta: "Grillos",
    sfxId: "crickets-01",
    palabras: ["grillo", "grillos", "cricket", "crickets", "chirriar"],
  },
  {
    categoria: "agua",
    etiqueta: "Arroyo / agua corriente",
    sfxId: "water-flow-01",
    palabras: ["agua", "rio", "arroyo", "manantial", "riachuelo", "stream", "river", "brook", "water"],
  },
  {
    categoria: "olas",
    etiqueta: "Olas del mar",
    sfxId: "waves-01",
    palabras: ["ola", "olas", "oleaje", "mar", "oceano", "playa", "wave", "waves", "surf", "ocean", "sea"],
  },
  {
    categoria: "goteo",
    etiqueta: "Goteo",
    sfxId: "drip-01",
    palabras: ["gota", "gotas", "goteo", "goteando", "drip", "drips", "dripping", "leak"],
  },
  {
    categoria: "fuego",
    etiqueta: "Fuego / crepitar",
    sfxId: "fire-01",
    palabras: ["fuego", "fuegos", "llama", "llamas", "incendio", "arder", "ardiendo", "quema", "crepita", "crepitar", "acrepitar", "brasas", "fire", "flame", "flames", "burning", "crackle"],
  },
  {
    categoria: "explosion",
    etiqueta: "Explosión / estallido",
    sfxId: "explosion-01",
    palabras: ["explosion", "explosiones", "explota", "explotar", "estallido", "estalla", "boom", "explosion", "explosions", "blast", "detonation"],
  },
  {
    categoria: "latido",
    etiqueta: "Latido del corazón",
    sfxId: "heartbeat-01",
    palabras: ["corazon", "latido", "latidos", "pulso", "pecho", "heartbeat", "heart", "pulse", "pounding"],
  },
  {
    categoria: "campana",
    etiqueta: "Campana",
    sfxId: "bell-01",
    palabras: ["campana", "campanas", "tilin", "tinte", "tañe", "bell", "bells", "chime", "chimes", "ringing"],
  },
  {
    categoria: "campanada",
    etiqueta: "Campanada grave",
    sfxId: "bell-toll-01",
    palabras: ["campanada", "campanadas", "dobla", "doblando", "duelo", "toll", "tolling", "knell"],
  },
  {
    categoria: "cristal",
    etiqueta: "Cristal rompiéndose",
    sfxId: "glass-break-01",
    palabras: ["cristal", "cristales", "vidrio", "vaso", "vasos", "copa", "rompe", "romper", " shattered", "glass", "shatter", "shatters", "breaking"],
  },
  {
    categoria: "whoosh",
    etiqueta: "Whoosh / aire al pasar",
    sfxId: "whoosh-01",
    palabras: ["whoosh", "swoosh", "soplido", "zumbido", "swish", "rush", "whistle"],
  },
  {
    categoria: "risa",
    etiqueta: "Risa",
    sfxId: "laugh-01",
    palabras: ["risa", "risas", "carcajada", "carcajadas", "rie", "reir", "riendo", "sonrie", "laugh", "laughs", "laughter", "giggle", "giggles"],
  },
  {
    categoria: "grito",
    etiqueta: "Grito / chillido",
    sfxId: "scream-01",
    palabras: ["grito", "gritos", "gritar", "chilla", "chillido", "alarido", "scream", "screams", "shout", "shouts", "yell", "yelling", "shriek"],
  },
  {
    categoria: "jadeo",
    etiqueta: "Jadeo / respiración",
    sfxId: "gasp-01",
    palabras: ["jadeo", "jadea", "jadeando", "respiracion", "respira", "respirar", "aliento", "suspiro", "gasp", "gasps", "breath", "breathing", "sigh", "sighs"],
  },
  {
    categoria: "caballo",
    etiqueta: "Galope de caballo",
    sfxId: "horse-gallop-01",
    palabras: ["caballo", "caballos", "galope", "galopa", "galopar", "yegua", "corcel", "horse", "horses", "gallop", "galloping", "hooves"],
  },
  {
    categoria: "monstruo",
    etiqueta: "Monstruo / bestia",
    sfxId: "monster-growl-01",
    palabras: ["monstruo", "monstruos", "bestia", "bestias", "criatura", "golem", "monster", "monsters", "beast", "beasts", "creature"],
  },
  {
    categoria: "eco",
    etiqueta: "Eco de caverna",
    sfxId: "echo-ping-01",
    palabras: ["eco", "ecos", "caverna", "cueva", "gruta", "echo", "echoes", "cave", "cavern", "grotto"],
  },
  {
    categoria: "magia",
    etiqueta: "Magia / chispas",
    sfxId: "magic-sparkle-01",
    palabras: ["magia", "hechizo", "hechizos", "conjuro", "varita", "chispa", "chispas", "destello", "destellos", "brilla", "magic", "spell", "spells", "wand", "sparkle", "spark", "sparks", "shimmer"],
  },
  {
    categoria: "cuerno",
    etiqueta: "Cuerno / trompeta",
    sfxId: "horn-01",
    palabras: ["cuerno", "cuernos", "corneta", "trompeta", "llamado", "clarin", "horn", "horns", "trumpet", "bugle"],
  },
  {
    categoria: "tambores",
    etiqueta: "Tambores de guerra",
    sfxId: "war-drums-01",
    palabras: ["tambor", "tambores", "redoble", "percusion", "batalla", "guerra", "drum", "drums", "battle", "war drums"],
  },
  {
    categoria: "crujido",
    etiqueta: "Crujido seco",
    sfxId: "snap-01",
    palabras: ["cruje", "cruji", "crujio", "crujido", "crujidos", "crujia", "rama", "ramas", "palo", "crack", "snaps", "snap"],
  },
  {
    categoria: "piedra",
    etiqueta: "Piedra moliendo",
    sfxId: "stone-grind-01",
    palabras: ["piedra", "piedras", "roca", "rocas", "muro", "muralla", "grava", "rozar", "stone", "stones", "rock", "rocks", "grind", "rumble"],
  },
  {
    categoria: "hojas",
    etiqueta: "Hojas secas",
    sfxId: "leaves-01",
    palabras: ["hoja", "hojas", "follaje", "arbusto", "maleza", "leaves", "foliage", "rustling", "bush"],
  },
];

// ===========================================================================
// Escritura WAV
// ===========================================================================
function writeWav(path: string, x: Float32Array): number {
  const n = x.length;
  const dataBytes = n * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, x[i]));
    if (!Number.isFinite(v)) v = 0;
    buf.writeInt16LE((v < 0 ? v * 32768 : v * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(path, buf);
  return 44 + dataBytes;
}

// ===========================================================================
// main
// ===========================================================================
mkdirSync(OUT_DIR, { recursive: true });

const biblioteca: Array<{
  id: string;
  nombre: string;
  archivo: string;
  durSec: number;
  etiquetas: string[];
}> = [];

let totalBytes = 0;
for (let i = 0; i < SPECS.length; i++) {
  const spec = SPECS[i];
  const rng = lcg(SEED_BASE + i * 7919);
  const x = normalize(fades(spec.gen(rng)), 0.7);
  const len = x.length;
  const dur = len / SR;
  const bytes = writeWav(join(OUT_DIR, `${spec.id}.wav`), x);
  totalBytes += bytes;
  biblioteca.push({
    id: spec.id,
    nombre: spec.nombre,
    archivo: `/sfx/${spec.id}.wav`,
    durSec: Math.round(dur * 100) / 100,
    etiquetas: spec.etiquetas,
  });
}

// --- config/sfx.json (catálogo) ---
const catalogoJson = {
  version: 1,
  generadoPor: "scripts/generate-sfx-library.ts (síntesis determinista local)",
  licencia: "CC0 · síntesis propia, sin fuentes externas",
  sfx: biblioteca,
};
writeFileSync(CONFIG_SFX, JSON.stringify(catalogoJson, null, 2) + "\n");

// --- config/sfx_config.json (palabras clave: semilla editable por el usuario) ---
const configJson = {
  version: 1,
  generadoPor: "scripts/generate-sfx-library.ts — semilla editable por el usuario",
  licencia: "CC0",
  defectos: {
    nivelDb: -12,
    crossfadeSeg: 0.5,
    minSeparacionSeg: 1.5,
    respetarDucking: true,
    maxEventos: 400,
  },
  categorias: CATEGORIAS.map((c) => ({
    categoria: c.categoria,
    etiqueta: c.etiqueta,
    sfxId: c.sfxId,
    activo: true,
    palabras: c.palabras,
  })),
};
writeFileSync(CONFIG_KEYWORDS, JSON.stringify(configJson, null, 2) + "\n");

// ===========================================================================
// Verificación
// ===========================================================================
const nombresPalabras = CATEGORIAS.reduce((n, c) => n + c.palabras.length, 0);
const idsBib = new Set(biblioteca.map((b) => b.id));
for (const c of CATEGORIAS) {
  if (!idsBib.has(c.sfxId))
    throw new Error(`La categoría «${c.categoria}» apunta a un SFX inexistente: ${c.sfxId}`);
}

let fallos = 0;
for (const b of biblioteca) {
  const raw = readFileSync(join(OUT_DIR, `${b.id}.wav`));
  if (raw.length < 44) throw new Error(`${b.id}: archivo truncado`);
  if (raw.toString("ascii", 0, 4) !== "RIFF" || raw.toString("ascii", 8, 12) !== "WAVE")
    throw new Error(`${b.id}: no es RIFF/WAVE`);
  if (raw.readUInt16LE(20) !== 1 || raw.readUInt16LE(22) !== 1)
    throw new Error(`${b.id}: no es PCM mono`);
  if (raw.readUInt32LE(24) !== SR || raw.readUInt16LE(16) !== 16)
    throw new Error(`${b.id}: sample rate o profundidad incorrectos`);
  const dataBytes = raw.readUInt32LE(40);
  const dur = dataBytes / 2 / SR;
  if (Math.abs(dur - b.durSec) > 0.02) {
    fallos++;
    console.error(`${b.id}: duración ${dur.toFixed(3)} ≠ ${b.durSec}`);
  }
  let peak = 0;
  for (let i = 44; i < raw.length; i += 2) {
    const v = Math.abs(raw.readInt16LE(i)) / 32768;
    if (v > peak) peak = v;
    if (!Number.isFinite(v)) {
      fallos++;
      break;
    }
  }
  if (peak > 0.71 || peak < 0.5) {
    fallos++;
    console.error(`${b.id}: pico anómalo ${peak.toFixed(3)}`);
  }
}

console.log(
  `SFX: ${biblioteca.length} archivos · ${CATEGORIAS.length} categorías · ${nombresPalabras} palabras clave · ${(totalBytes / 1e6).toFixed(2)} MB total`
);
if (fallos > 0) {
  console.error(`VERIFICACIÓN FALLIDA: ${fallos} problemas`);
  process.exit(1);
}
console.log("VERIFICATION OK");
