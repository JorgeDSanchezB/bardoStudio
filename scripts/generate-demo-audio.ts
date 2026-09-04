/**
 * Bardo Studio — Task 2 (agent: demo-audio-generator)
 *
 * Generates a fully deterministic, speech-like narration WAV used to demo and
 * test the Phase-1 silence-detection pipeline:
 *
 *   public/demo/narration-demo.wav
 *     RIFF/WAVE · PCM 16-bit · MONO · 22050 Hz · 366.0 s (~16.1 MB)
 *
 * Timeline: 9 synthetic speech ("narración sintética") paragraphs separated by
 * room-tone pauses, designed so the default detector (threshold ≤ −38 dBFS
 * RMS, min duration ≥ 2.0 s) finds exactly the 5 long pauses
 * (3.0 / 5.0 / 8.0 / 3.2 / 3.9 s). The 3 short pauses (1.8 / 1.5 / 1.4 s) and
 * the intra-paragraph sentence pauses (0.3–0.5 s) only show up when the user
 * lowers the min-duration slider — that is the point of the demo.
 *
 * Speech model (deterministic, single seeded LCG — no Math.random):
 *   - per paragraph: base f0 115–175 Hz with ±4 Hz linear drift
 *   - carrier: harmonics 1..5 (gains 1 / 0.55 / 0.32 / 0.18 / 0.10) + random phases
 *   - breath: white noise → one-pole LPF @ ~1.2 kHz at ~−14 dB vs carrier
 *   - syllabic envelope 3.5–5.5 Hz (30 ms attack, decay to 0.15 floor,
 *     peaks 0.7–1.0)
 *   - sentence pauses inside paragraphs every 6–12 s (0.3–0.5 s, envelope →
 *     noise floor)
 *   - paragraph RMS calibrated to ≈ −20 dBFS (0.1)
 *   - whole-file noise floor at −46 dBFS RMS
 *   - final tanh soft-limit at 0.95 (no int16 clipping)
 *
 * Idempotent: re-running overwrites the file with byte-identical output.
 * Dependencies: none (node:fs / node:path only, standard in Bun).
 *
 * Run: cd /home/z/my-project && bun scripts/generate-demo-audio.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ===========================================================================
// Output & format constants
// ===========================================================================
const argv1 = process.argv[1] ?? process.cwd();
const PROJECT_ROOT = resolve(dirname(argv1), "..");
const OUT_PATH = join(PROJECT_ROOT, "public", "demo", "narration-demo.wav");

const SAMPLE_RATE = 22050;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const DURATION_S = 366.0;
const N_SAMPLES = Math.round(DURATION_S * SAMPLE_RATE); // 8,070,300 samples
const DATA_BYTES = N_SAMPLES * BYTES_PER_SAMPLE * CHANNELS; // 16,140,600
const HEADER_BYTES = 44;

/** Spec reference size (~16.1 MB). Exact structural size is 44 + 2·N. */
const SPEC_SIZE_REF = 16_138_924;
const SPEC_SIZE_TOL = 8_192; // ±8 KB "small tolerance" (≈0.05 %)

// ===========================================================================
// Deterministic PRNG — LCG (seed 20260903). NO Math.random in this file.
// ===========================================================================
const LCG_SEED = 20260903;
let lcgState = LCG_SEED >>> 0;
function rng(): number {
  lcgState = (Math.imul(lcgState, 1664525) + 1013904223) >>> 0;
  return lcgState / 4294967296; // uniform [0, 1)
}

// ===========================================================================
// Voice-model / level constants
// ===========================================================================
const NOISE_FLOOR_DB = -46; // dBFS RMS, present across the WHOLE file
const SPEECH_RMS_TARGET = 0.1; // ≈ −20 dBFS per paragraph
const BREATH_REL_DB = -14; // formant noise relative to carrier RMS
const HARMONIC_GAINS = [1, 0.55, 0.32, 0.18, 0.1]; // harmonics 1..5 of f0
const ENV_FLOOR = 0.15; // syllabic envelope floor (no false silences in speech)
const ATTACK_S = 0.03; // 30 ms syllable attack
const PEAK_MIN = 0.7;
const PEAK_MAX = 1.0;
const EDGE_FADE_S = 0.02; // anti-click fade at paragraph edges
const PAUSE_RAMP_S = 0.02; // anti-click ramp at sentence-pause edges
const DECAY_TAU_DIV = 3.2; // decay τ = (period − attack)/3.2 → reaches floor
const SOFT_LIMIT = 0.95; // tanh soft-limiter ceiling
const LPF_CUTOFF_HZ = 1200; // one-pole cutoff for the breath noise

// ===========================================================================
// EXACT demo timeline (seconds). Must be contiguous and end at 366.0.
// ===========================================================================
type SegKind = "room" | "speech" | "pause";
interface Segment {
  start: number;
  end: number;
  kind: SegKind;
  label: string;
  note: string;
}

const TIMELINE: Segment[] = [
  { start: 0.0,   end: 3.0,   kind: "room",   label: "ROOM",  note: "room tone, noise floor −46 dBFS" },
  { start: 3.0,   end: 38.5,  kind: "speech", label: "P1",    note: "speech 35.5 s" },
  { start: 38.5,  end: 41.5,  kind: "pause",  label: "L1",    note: "LONG pause 3.0 s → DETECTED (≥2 s)" },
  { start: 41.5,  end: 70.0,  kind: "speech", label: "P2",    note: "speech 28.5 s" },
  { start: 70.0,  end: 71.8,  kind: "pause",  label: "S1",    note: "SHORT pause 1.8 s → NOT detected (<2 s)" },
  { start: 71.8,  end: 112.0, kind: "speech", label: "P3",    note: "speech 40.2 s" },
  { start: 112.0, end: 117.0, kind: "pause",  label: "L2",    note: "LONG pause 5.0 s → DETECTED (≥2 s)" },
  { start: 117.0, end: 149.0, kind: "speech", label: "P4",    note: "speech 32.0 s" },
  { start: 149.0, end: 150.5, kind: "pause",  label: "S2",    note: "SHORT pause 1.5 s → NOT detected (<2 s)" },
  { start: 150.5, end: 208.0, kind: "speech", label: "P5",    note: "speech 57.5 s" },
  { start: 208.0, end: 216.0, kind: "pause",  label: "M1",    note: "MEGA pause 8.0 s → DETECTED (≥2 s)" },
  { start: 216.0, end: 252.0, kind: "speech", label: "P6",    note: "speech 36.0 s" },
  { start: 252.0, end: 255.2, kind: "pause",  label: "L3",    note: "LONG pause 3.2 s → DETECTED (≥2 s)" },
  { start: 255.2, end: 300.0, kind: "speech", label: "P7",    note: "speech 44.8 s" },
  { start: 300.0, end: 301.4, kind: "pause",  label: "S3",    note: "SHORT pause 1.4 s → NOT detected (<2 s)" },
  { start: 301.4, end: 338.0, kind: "speech", label: "P8",    note: "speech 36.6 s" },
  { start: 338.0, end: 341.9, kind: "pause",  label: "L4",    note: "LONG pause 3.9 s → DETECTED (≥2 s)" },
  { start: 341.9, end: 366.0, kind: "speech", label: "P9",    note: "speech 24.1 s" },
];

/** The 5 pauses the default detector (≤ −38 dB, ≥ 2.0 s) must find: [start, end, dur]. */
const EXPECTED_LONG: Array<[number, number, number]> = [
  [38.5, 41.5, 3.0],
  [112.0, 117.0, 5.0],
  [208.0, 216.0, 8.0],
  [252.0, 255.2, 3.2],
  [338.0, 341.9, 3.9],
];

// Pre-flight: the timeline itself must be exact, contiguous and total 366.0 s.
{
  const errors: string[] = [];
  if (TIMELINE[0].start !== 0) errors.push("timeline must start at 0.0 s");
  for (let i = 1; i < TIMELINE.length; i++) {
    if (TIMELINE[i].start !== TIMELINE[i - 1].end) {
      errors.push(`timeline gap/overlap at segment ${i} (${TIMELINE[i - 1].label}→${TIMELINE[i].label})`);
    }
  }
  if (TIMELINE[TIMELINE.length - 1].end !== DURATION_S) errors.push("timeline must end at 366.0 s");
  if (errors.length > 0) {
    for (const e of errors) console.error(`PRECONDITION FAILED: ${e}`);
    process.exit(1);
  }
}

// ===========================================================================
// Synthesis
// ===========================================================================
interface ParagraphStats {
  label: string;
  f0Start: number;
  sylRate: number;
  /** Sentence pauses (absolute file seconds) inside the paragraph. */
  sentencePauses: Array<[number, number]>;
  rmsDb: number; // measured later from the written file
}

const paragraphs = TIMELINE.filter((s) => s.kind === "speech");
const paraStatsByLabel = new Map<string, ParagraphStats>();
const t0 = Date.now();

console.log("Bardo Studio · demo narration generator (deterministic)");
console.log(`  output : ${OUT_PATH}`);
console.log(`  format : RIFF/WAVE PCM 16-bit · mono · ${SAMPLE_RATE} Hz · ${DURATION_S.toFixed(1)} s`);
console.log(`  prng   : LCG seed ${LCG_SEED} (byte-identical on every run)`);
console.log("");

// --- 1) Continuous noise floor across the WHOLE file (−46 dBFS RMS) --------
const master = new Float32Array(N_SAMPLES);
const floorRms = Math.pow(10, NOISE_FLOOR_DB / 20); // 0.005012
const unit = Math.sqrt(3); // uniform(−1,1) has std 1/√3 → ×√3 gives std 1
for (let i = 0; i < N_SAMPLES; i++) {
  master[i] = (rng() * 2 - 1) * unit * floorRms;
}

// --- 2) Speech paragraphs --------------------------------------------------
const lpfAlpha = 1 - Math.exp((-2 * Math.PI * LPF_CUTOFF_HZ) / SAMPLE_RATE);
const breathRel = Math.pow(10, BREATH_REL_DB / 20);

for (const seg of paragraphs) {
  const dur = seg.end - seg.start;
  const n0 = Math.round(seg.start * SAMPLE_RATE);
  const n1 = Math.round(seg.end * SAMPLE_RATE);
  const len = n1 - n0;

  // -- paragraph voice parameters (fixed RNG draw order → deterministic) --
  const f0Start = 115 + 60 * rng(); // 115–175 Hz
  const f0Drift = (rng() * 2 - 1) * 4; // ±4 Hz linear drift
  const sylRate = 3.5 + 2.0 * rng(); // 3.5–5.5 Hz
  const phases: number[] = [];
  for (let h = 0; h < HARMONIC_GAINS.length; h++) {
    phases.push((rng() * 2 - 1) * (Math.PI / 4)); // small random phase per harmonic
  }

  const sylPeriod = 1 / sylRate;
  const nSyl = Math.ceil(dur / sylPeriod);
  const peaks = new Float64Array(nSyl);
  for (let i = 0; i < nSyl; i++) peaks[i] = PEAK_MIN + (PEAK_MAX - PEAK_MIN) * rng();

  // -- sentence pauses inside the paragraph: every 6–12 s, 0.3–0.5 s long.
  //    Kept ≥0.8 s away from the paragraph edges so they never merge with the
  //    inter-paragraph pauses of the master timeline.
  const sentencePauses: Array<[number, number]> = [];
  let cursor = 0;
  for (;;) {
    const gap = 6 + 6 * rng();
    const pd = 0.3 + 0.2 * rng();
    const ps = cursor + gap;
    if (ps + pd > dur - 0.8) break;
    sentencePauses.push([ps, ps + pd]);
    cursor = ps + pd;
  }

  // -- pass 1: harmonic carrier + one-pole LPF'd breath noise ---------------
  const carrier = new Float64Array(len);
  const breath = new Float64Array(len);
  let phase = 0;
  let lp = 0;
  let carSq = 0;
  let brSq = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;
    const f0 = f0Start + f0Drift * (t / dur);
    phase += (2 * Math.PI * f0) / SAMPLE_RATE;
    let c = 0;
    for (let h = 0; h < HARMONIC_GAINS.length; h++) {
      c += HARMONIC_GAINS[h] * Math.sin((h + 1) * phase + phases[h]);
    }
    carrier[i] = c;
    carSq += c * c;
    const w = (rng() * 2 - 1) * unit;
    lp += lpfAlpha * (w - lp); // one-pole low-pass @ ~1.2 kHz
    breath[i] = lp;
    brSq += lp * lp;
  }
  const carRms = Math.sqrt(carSq / len);
  const brRms = Math.sqrt(brSq / len) || 1;
  const breathGain = (carRms * breathRel) / brRms; // breath ≈ −14 dB vs carrier

  // -- pass 2: syllabic envelope × sentence-pause gate × edge fades ---------
  const speech = new Float64Array(len);
  const tau = (sylPeriod - ATTACK_S) / DECAY_TAU_DIV;
  let pauseIdx = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SAMPLE_RATE;

    // syllabic envelope: 30 ms raised-cosine attack, exponential decay to 0.15
    const sylIdx = Math.min(Math.floor(t / sylPeriod), nSyl - 1);
    const pos = t - sylIdx * sylPeriod;
    const peak = peaks[sylIdx];
    let env: number;
    if (pos < ATTACK_S) {
      env = ENV_FLOOR + (peak - ENV_FLOOR) * (0.5 - 0.5 * Math.cos((Math.PI * pos) / ATTACK_S));
    } else {
      env = ENV_FLOOR + (peak - ENV_FLOOR) * Math.exp(-(pos - ATTACK_S) / tau);
    }

    // sentence-pause gate (20 ms anti-click ramps; fully open = 1, inside = 0)
    let pg = 1;
    while (pauseIdx < sentencePauses.length && t >= sentencePauses[pauseIdx][1]) pauseIdx++;
    if (pauseIdx < sentencePauses.length && t >= sentencePauses[pauseIdx][0]) {
      const ps = sentencePauses[pauseIdx][0];
      const pe = sentencePauses[pauseIdx][1];
      if (t < ps + PAUSE_RAMP_S) {
        pg = 0.5 * (1 + Math.cos((Math.PI * (t - ps)) / PAUSE_RAMP_S));
      } else if (t > pe - PAUSE_RAMP_S) {
        pg = 0.5 * (1 - Math.cos((Math.PI * (t - pe + PAUSE_RAMP_S)) / PAUSE_RAMP_S));
      } else {
        pg = 0; // speech off → only the global noise floor remains
      }
    }

    // anti-click fades at the paragraph edges
    let fg = 1;
    if (t < EDGE_FADE_S) fg = 0.5 * (1 - Math.cos((Math.PI * t) / EDGE_FADE_S));
    else if (t > dur - EDGE_FADE_S) fg = 0.5 * (1 - Math.cos((Math.PI * (dur - t)) / EDGE_FADE_S));

    speech[i] = (carrier[i] + breathGain * breath[i]) * env * pg * fg;
  }

  // -- pass 3: calibrate paragraph RMS to ≈ 0.1 (−20 dBFS) and mix ----------
  let sq = 0;
  for (let i = 0; i < len; i++) sq += speech[i] * speech[i];
  const rms = Math.sqrt(sq / len) || 1;
  const scale = SPEECH_RMS_TARGET / rms;
  for (let i = 0; i < len; i++) master[n0 + i] += speech[i] * scale;

  paraStatsByLabel.set(seg.label, {
    label: seg.label,
    f0Start,
    sylRate,
    sentencePauses: sentencePauses.map(([ps, pe]) => [seg.start + ps, seg.start + pe] as [number, number]),
    rmsDb: 20 * Math.log10(rms * scale),
  });
}

// --- 3) Soft-limit (tanh @ 0.95) + int16 quantization ----------------------
const pcm = new Int16Array(N_SAMPLES);
let peakAmp = 0;
for (let i = 0; i < N_SAMPLES; i++) {
  const x = master[i];
  const y = SOFT_LIMIT * Math.tanh(x / SOFT_LIMIT); // |y| < 0.95, no clipping
  const a = y < 0 ? -y : y;
  if (a > peakAmp) peakAmp = a;
  pcm[i] = Math.max(-32768, Math.min(32767, Math.round(y * 32767)));
}

// --- 4) WAV encode (44-byte header, int16 LE) ------------------------------
const buf = Buffer.alloc(HEADER_BYTES + DATA_BYTES);
buf.write("RIFF", 0, "ascii");
buf.writeUInt32LE(HEADER_BYTES + DATA_BYTES - 8, 4); // fileSize − 8
buf.write("WAVE", 8, "ascii");
buf.write("fmt ", 12, "ascii");
buf.writeUInt32LE(16, 16); // fmt chunk size
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(CHANNELS, 22);
buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE, 28); // byte rate
buf.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32); // block align
buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
buf.write("data", 36, "ascii");
buf.writeUInt32LE(DATA_BYTES, 40);

const nativeLE = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
if (nativeLE) {
  buf.set(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), HEADER_BYTES);
} else {
  // big-endian host fallback: emit int16 LE explicitly
  for (let i = 0; i < N_SAMPLES; i++) buf.writeUInt16LE(pcm[i] & 0xffff, HEADER_BYTES + 2 * i);
}

// --- 5) Write (idempotent: overwrites) -------------------------------------
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, buf);
const genMs = Date.now() - t0;
console.log(
  `Wrote ${buf.length.toLocaleString("en-US")} bytes in ${(genMs / 1000).toFixed(2)} s ` +
    `(peak ${peakAmp.toFixed(3)} = ${(20 * Math.log10(peakAmp)).toFixed(1)} dBFS, soft-limited @ ${SOFT_LIMIT})`,
);

// ===========================================================================
// Verification — re-read the file from disk
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

const raw = readFileSync(OUT_PATH);
const size = raw.length;

console.log("");
console.log(`Re-read verification of ${OUT_PATH}`);
check(
  "magic bytes: RIFF / WAVE / fmt  / data",
  raw.toString("ascii", 0, 4) === "RIFF" &&
    raw.toString("ascii", 8, 12) === "WAVE" &&
    raw.toString("ascii", 12, 16) === "fmt " &&
    raw.toString("ascii", 36, 40) === "data",
);
const vAudioFormat = raw.readUInt16LE(20);
const vChannels = raw.readUInt16LE(22);
const vSampleRate = raw.readUInt32LE(24);
const vByteRate = raw.readUInt32LE(28);
const vBlockAlign = raw.readUInt16LE(32);
const vBits = raw.readUInt16LE(34);
const vDataSize = raw.readUInt32LE(40);
const vRiffSize = raw.readUInt32LE(4);
const vFmtSize = raw.readUInt32LE(16);
const vDuration = vDataSize / (vSampleRate * vChannels * (vBits / 8));

check(
  `fmt: PCM ${vBits}-bit, ${vChannels} channel (mono), ${vSampleRate} Hz, byteRate ${vByteRate}, blockAlign ${vBlockAlign}`,
  vAudioFormat === 1 &&
    vBits === BITS_PER_SAMPLE &&
    vChannels === CHANNELS &&
    vSampleRate === SAMPLE_RATE &&
    vByteRate === 44100 &&
    vBlockAlign === 2,
);
check(
  `RIFF sizes correct (riffSize ${vRiffSize} = fileSize−8, fmtSize ${vFmtSize}, dataSize ${vDataSize} = fileSize−44)`,
  vRiffSize === size - 8 && vFmtSize === 16 && vDataSize === size - 44 && vDataSize === DATA_BYTES,
);
check(`duration = ${vDuration.toFixed(3)} s (spec 366.0 ± 0.05)`, Math.abs(vDuration - DURATION_S) <= 0.05);
check(
  `file size = ${size.toLocaleString("en-US")} B (15.4 MiB) ≈ spec ref ${SPEC_SIZE_REF.toLocaleString("en-US")} ± ${SPEC_SIZE_TOL} B (Δ ${size - SPEC_SIZE_REF} B)`,
  Math.abs(size - SPEC_SIZE_REF) <= SPEC_SIZE_TOL && size === HEADER_BYTES + DATA_BYTES,
);

// --- decode samples back from disk for content checks ----------------------
const samples = new Float32Array(N_SAMPLES);
let vPeak = 0;
for (let i = 0; i < N_SAMPLES; i++) {
  const v = raw.readInt16LE(HEADER_BYTES + 2 * i) / 32768;
  samples[i] = v;
  const a = v < 0 ? -v : v;
  if (a > vPeak) vPeak = a;
}
check(
  `no clipping: peak amplitude ${vPeak.toFixed(4)} (${(20 * Math.log10(vPeak)).toFixed(1)} dBFS) ≤ ${SOFT_LIMIT + 0.001}`,
  vPeak <= SOFT_LIMIT + 0.001,
);

// --- 100 ms RMS block scan (mirrors the Phase-1 detector) ------------------
const BLOCK = Math.round(0.1 * SAMPLE_RATE); // 2205
const nBlocks = Math.floor(N_SAMPLES / BLOCK);
const blockDb = new Float64Array(nBlocks);
for (let b = 0; b < nBlocks; b++) {
  let acc = 0;
  const off = b * BLOCK;
  for (let i = 0; i < BLOCK; i++) {
    const v = samples[off + i];
    acc += v * v;
  }
  blockDb[b] = 20 * Math.log10(Math.sqrt(acc / BLOCK) + 1e-12);
}

// noise floor (leading room tone 0–3 s)
let flSq = 0;
const floorN = Math.round(3.0 * SAMPLE_RATE);
for (let i = 0; i < floorN; i++) flSq += samples[i] * samples[i];
const floorDb = 20 * Math.log10(Math.sqrt(flSq / floorN) + 1e-12);
check(`room tone 0–3 s at ${floorDb.toFixed(1)} dBFS RMS (spec −46 ± 1.5)`, Math.abs(floorDb - NOISE_FLOOR_DB) <= 1.5);

// per-paragraph RMS ≈ −20 dBFS
console.log("");
console.log("Speech calibration (measured from the written file):");
for (const seg of paragraphs) {
  const st = paraStatsByLabel.get(seg.label)!;
  const n0 = Math.round(seg.start * SAMPLE_RATE);
  const n1 = Math.round(seg.end * SAMPLE_RATE);
  let sq = 0;
  for (let i = n0; i < n1; i++) sq += samples[i] * samples[i];
  st.rmsDb = 20 * Math.log10(Math.sqrt(sq / (n1 - n0)) + 1e-12);
  check(
    `${seg.label}: ${st.rmsDb.toFixed(1)} dBFS RMS (spec −20 ± 2.5) · f0 ${st.f0Start.toFixed(0)} Hz · ${st.sylRate.toFixed(1)} syl/s · ${st.sentencePauses.length} sentence pause(s) inside`,
    Math.abs(st.rmsDb - -20) <= 2.5,
  );
}

// minimum 100 ms-RMS inside speech, excluding intentional sentence pauses
// (±0.12 s): must stay ≥ −30 dBFS → no false silences inside speech.
let minSpeechDb = Infinity;
for (const seg of paragraphs) {
  const st = paraStatsByLabel.get(seg.label)!;
  const b0 = Math.round(seg.start * 10);
  const b1 = Math.round(seg.end * 10);
  for (let bi = b0; bi < b1; bi++) {
    const t0 = bi / 10;
    const t1 = t0 + 0.1;
    let near = false;
    for (const [ps, pe] of st.sentencePauses) {
      if (t0 < pe + 0.12 && t1 > ps - 0.12) {
        near = true;
        break;
      }
    }
    if (!near && blockDb[bi] < minSpeechDb) minSpeechDb = blockDb[bi];
  }
}
check(
  `min 100 ms-RMS inside speech ${minSpeechDb.toFixed(1)} dBFS ≥ −30 (no false silences in syllables)`,
  minSpeechDb >= -30.0,
);

// --- silence runs (threshold −38 dBFS, contiguous silent blocks) -----------
const SILENCE_DB = -38;
const MIN_DUR_S = 2.0;
interface Run {
  b0: number;
  b1: number;
}
const runs: Run[] = [];
{
  let b = 0;
  while (b < nBlocks) {
    if (blockDb[b] <= SILENCE_DB) {
      let b1 = b;
      while (b1 + 1 < nBlocks && blockDb[b1 + 1] <= SILENCE_DB) b1++;
      runs.push({ b0: b, b1 });
      b = b1 + 1;
    } else {
      b++;
    }
  }
}
const runStart = (r: Run) => (r.b0 * BLOCK) / SAMPLE_RATE;
const runDur = (r: Run) => ((r.b1 - r.b0 + 1) * BLOCK) / SAMPLE_RATE;
const leading = runs.filter((r) => r.b0 === 0);
const trailing = runs.filter((r) => r.b1 === nBlocks - 1);
const interior = runs.filter((r) => r.b0 !== 0 && r.b1 !== nBlocks - 1);
const detected = interior.filter((r) => runDur(r) >= MIN_DUR_S);
const shortRuns = interior.filter((r) => runDur(r) < MIN_DUR_S);
const shortParaPauses = shortRuns.filter((r) => runDur(r) >= 1.0);
const sentenceRuns = shortRuns.filter((r) => runDur(r) < 1.0);

console.log("");
console.log("Silence self-check — 100 ms RMS blocks, threshold ≤ −38.0 dBFS:");
check(
  `leading room tone: ${leading.length} run, ${leading.length ? runDur(leading[0]).toFixed(1) : "0.0"} s @ 0.0–${leading.length ? (runStart(leading[0]) + runDur(leading[0])).toFixed(1) : "0.0"} (below threshold, trimmed as leading silence)`,
  leading.length === 1 && Math.abs(runDur(leading[0]) - 3.0) <= 0.4,
);
check("no trailing silence (file ends with speech P9)", trailing.length === 0);
check(
  `interior silences ≥ 2.0 s: ${detected.length} found — expected exactly 5`,
  detected.length === EXPECTED_LONG.length,
);
detected.forEach((r, i) => {
  const exp = EXPECTED_LONG[i];
  check(
    `  silence ${i + 1}: ${runDur(r).toFixed(1)} s @ ${runStart(r).toFixed(1)}–${(runStart(r) + runDur(r)).toFixed(1)} (expected ${exp[2].toFixed(1)} s @ ${exp[0].toFixed(1)}–${exp[1].toFixed(1)})`,
    Math.abs(runDur(r) - exp[2]) <= 0.35 && Math.abs(runStart(r) - exp[0]) <= 0.25,
  );
});
check(
  `short pauses 1.0–2.0 s NOT detected: ${shortParaPauses.length} found (${shortParaPauses.map((r) => runDur(r).toFixed(1)).join(" / ")} s) — expected exactly 3 (1.8 / 1.5 / 1.4)`,
  shortParaPauses.length === 3,
);
const totalSentencePauses = paragraphs.reduce(
  (n, s) => n + paraStatsByLabel.get(s.label)!.sentencePauses.length,
  0,
);
check(
  `sentence pauses inside paragraphs (0.3–0.5 s, only visible with a lower min-duration slider): ${sentenceRuns.length} found — expected ${totalSentencePauses}`,
  sentenceRuns.length === totalSentencePauses,
);

// ===========================================================================
// Timeline report
// ===========================================================================
console.log("");
console.log("Segment timeline embedded in the file:");
console.log("  #    start      end     dur   content");
TIMELINE.forEach((s, i) => {
  const dur = s.end - s.start;
  let content: string;
  if (s.kind === "speech") {
    const st = paraStatsByLabel.get(s.label)!;
    content = `SPEECH ${s.label}  f0 ${st.f0Start.toFixed(0)} Hz · ${st.sylRate.toFixed(1)} syl/s · ${st.sentencePauses.length} sentence pause(s)`;
  } else if (s.kind === "room") {
    content = `ROOM TONE  ${s.note}`;
  } else {
    content = `PAUSE ${s.label}  ${s.note}`;
  }
  console.log(
    `  ${String(i + 1).padStart(2)}  ${s.start.toFixed(1).padStart(7)}  ${s.end.toFixed(1).padStart(7)}  ${dur.toFixed(1).padStart(6)}   ${content}`,
  );
});

console.log("");
console.log("Expected silence detection (default detector: ≤ −38 dBFS, ≥ 2.0 s):");
console.log(
  `  detected (5): ${EXPECTED_LONG.map((e) => `${e[2].toFixed(1)} s @ ${e[0].toFixed(1)}–${e[1].toFixed(1)}`).join("  ·  ")}`,
);
console.log(
  "  not detected (3 short pauses < 2 s): 1.8 s @ 70.0–71.8  ·  1.5 s @ 149.0–150.5  ·  1.4 s @ 300.0–301.4",
);
console.log(
  `  not detected (sentence pauses 0.3–0.5 s inside paragraphs): ${totalSentencePauses} — appear when the min-duration slider is lowered`,
);
console.log(
  "  leading room tone 0.0–3.0 (−46 dBFS) is also below threshold; detectors that trim leading silence report the 5 above.",
);

// ===========================================================================
// Final verdict
// ===========================================================================
console.log("");
if (failures.length === 0) {
  console.log("VERIFICATION OK");
  process.exit(0);
} else {
  console.error(`${failures.length} verification check(s) failed:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.log(`VERIFICATION FAILED (${failures.length} checks)`);
  process.exit(1);
}
