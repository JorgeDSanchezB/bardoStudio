/** Timecode exacto HH:MM:SS.mmm (visor de tiempo de la Fase 1/5). */
export function formatTimecode(sec: number): string {
  const t = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const tms = Math.round(t * 1000);
  const h = Math.floor(tms / 3_600_000);
  const m = Math.floor((tms % 3_600_000) / 60_000);
  const s = Math.floor((tms % 60_000) / 1000);
  const ms = tms % 1000;
  const p2 = (x: number) => String(x).padStart(2, "0");
  const p3 = (x: number) => String(x).padStart(3, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}.${p3(ms)}`;
}

/** Duración compacta para chips (ej. "6m 06s", "3h 05m"). */
export function formatDurSmart(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

const RULER_STEPS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

/** Paso "bonito" para la regla de tiempo según px por segundo. */
export function pickRulerStep(pxPerSec: number, minPx = 90): number {
  for (const step of RULER_STEPS) {
    if (step * pxPerSec >= minPx) return step;
  }
  return RULER_STEPS[RULER_STEPS.length - 1];
}

export function formatRulerTick(t: number, stepSec: number): string {
  const p2 = (x: number) => String(x).padStart(2, "0");
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (stepSec < 1) {
    return `${p2(m)}:${s.toFixed(1).padStart(4, "0")}`;
  }
  if (h > 0 || stepSec >= 3600) return `${p2(h)}:${p2(m)}:${p2(Math.floor(s))}`;
  return `${p2(m)}:${p2(Math.floor(s))}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** «hace 5 min», «hace 3 h», «hace 2 días» o fecha corta. */
export function formatHace(ts: number): string {
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff) || diff < 0) return "—";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 31) return `hace ${d} día${d > 1 ? "s" : ""}`;
  return new Date(ts).toLocaleDateString("es");
}
