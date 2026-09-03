"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2, Eye, EyeOff } from "lucide-react";
import type { AnalysisData } from "@/store/project";
import type { SilenceRegion } from "@/lib/audio/silence";
import {
  clamp,
  formatTimecode,
  formatRulerTick,
  pickRulerStep,
} from "@/lib/format";

interface WaveformTimelineProps {
  analysis: AnalysisData | null;
  silences: SilenceRegion[];
  durationSec: number;
  playheadSec: number;
  playing: boolean;
  thresholdDb: number;
  onSeek: (t: number) => void;
  compact?: boolean;
}

const RULER_H = 28;
const WAVE_H = 200;
const ENV_H = 52;
const MAX_PPS = 2000;

type View = { start: number; pps: number };

function drawRuler(
  ctx: CanvasRenderingContext2D,
  W: number,
  t0: number,
  pps: number,
  duration: number
) {
  ctx.fillStyle = "#18181b";
  ctx.fillRect(0, 0, W, RULER_H);
  ctx.strokeStyle = "#27272a";
  ctx.beginPath();
  ctx.moveTo(0, RULER_H - 0.5);
  ctx.lineTo(W, RULER_H - 0.5);
  ctx.stroke();

  const step = pickRulerStep(pps);
  const minor = step / 5;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";

  const first = Math.floor(t0 / step) * step;
  const tEnd = t0 + W / pps;
  for (let t = first; t <= tEnd; t += step) {
    if (t < 0) continue;
    const x = Math.round((t - t0) * pps) + 0.5;
    if (x < -2 || x > W + 2) continue;
    ctx.strokeStyle = "#3f3f46";
    ctx.beginPath();
    ctx.moveTo(x, RULER_H - 10);
    ctx.lineTo(x, RULER_H - 1);
    ctx.stroke();
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(formatRulerTick(t, step), x + 3, 3);
  }
  if (minor * pps >= 14) {
    const firstM = Math.floor(t0 / minor) * minor;
    ctx.strokeStyle = "#27272a";
    for (let t = firstM; t <= tEnd; t += minor) {
      const x = Math.round((t - t0) * pps) + 0.5;
      if (x < 0 || x > W) continue;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 5);
      ctx.lineTo(x, RULER_H - 1);
      ctx.stroke();
    }
  }
  // límite final del clip
  const xEnd = (duration - t0) * pps;
  if (xEnd >= 0 && xEnd <= W) {
    ctx.strokeStyle = "#f43f5e";
    ctx.beginPath();
    ctx.moveTo(xEnd + 0.5, 0);
    ctx.lineTo(xEnd + 0.5, RULER_H - 1);
    ctx.stroke();
  }
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  W: number,
  t0: number,
  pps: number,
  analysis: AnalysisData | null,
  duration: number,
  silences: SilenceRegion[],
  playheadSec: number
) {
  ctx.clearRect(0, RULER_H, W, WAVE_H);
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, RULER_H, W, WAVE_H);

  const t1 = Math.min(duration, t0 + W / pps);

  // Bloques de silencio (requisito Fase 1: pausas marcadas en color)
  for (const s of silences) {
    if (s.end < t0 || s.start > t1) continue;
    const x = (s.start - t0) * pps;
    const x2 = (s.end - t0) * pps;
    const w = Math.max(2, x2 - x);
    ctx.fillStyle = "rgba(244,63,94,0.12)";
    ctx.fillRect(x, RULER_H + 4, w, WAVE_H - 8);
    ctx.strokeStyle = "rgba(244,63,94,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, RULER_H + 4.5, w - 1, WAVE_H - 9);
    if (w > 64) {
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(253,164,175,0.95)";
      ctx.fillText(
        `silencio ${(s.end - s.start).toFixed(1)}s`,
        x + 6,
        RULER_H + 12
      );
    }
  }

  // línea central + forma de onda (agregada por columna de píxel: virtualizada)
  const mid = RULER_H + WAVE_H / 2;
  const half = WAVE_H / 2 - 8;
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid + 0.5);
  ctx.lineTo(W, mid + 0.5);
  ctx.stroke();

  if (analysis && analysis.peaksMax.length > 0) {
    const perSec = analysis.peaksPerSec;
    const peaksMax = analysis.peaksMax;
    const peaksMin = analysis.peaksMin;
    const iStart = Math.max(0, Math.floor(t0 * perSec));
    const iEnd = Math.min(peaksMax.length, Math.ceil(t1 * perSec));
    ctx.strokeStyle = "rgba(251,191,36,0.85)";
    ctx.beginPath();
    const peaksPerPx = perSec / pps;
    if (peaksPerPx <= 1) {
      for (let i = iStart; i < iEnd; i++) {
        const x = Math.round((i / perSec - t0) * pps) + 0.5;
        ctx.moveTo(x, mid - peaksMax[i] * half);
        ctx.lineTo(x, mid - peaksMin[i] * half);
      }
    } else {
      for (let px = 0; px < W; px++) {
        const a = Math.floor((t0 + px / pps) * perSec);
        const b = Math.floor((t0 + (px + 1) / pps) * perSec);
        if (b <= iStart || a >= iEnd) continue;
        let mn = 1;
        let mx = -1;
        for (let i = Math.max(a, iStart); i < Math.min(b, iEnd); i++) {
          if (peaksMin[i] < mn) mn = peaksMin[i];
          if (peaksMax[i] > mx) mx = peaksMax[i];
        }
        if (mx < mn) continue;
        const x = px + 0.5;
        ctx.moveTo(x, mid - mx * half);
        ctx.lineTo(x, mid - mn * half);
      }
    }
    ctx.stroke();
  }

  // playhead (cursor de reproducción)
  const px = (playheadSec - t0) * pps;
  if (px >= -6 && px <= W + 6) {
    const x = Math.round(px) + 0.5;
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(x - 1, RULER_H, 2, WAVE_H);
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 9);
    ctx.closePath();
    ctx.fill();
  }
}

function drawEnvelope(
  ctx: CanvasRenderingContext2D,
  W: number,
  t0: number,
  pps: number,
  analysis: AnalysisData | null,
  duration: number,
  thresholdDb: number,
  playheadSec: number
) {
  ctx.clearRect(0, 0, W, ENV_H);
  ctx.fillStyle = "#0c0c0e";
  ctx.fillRect(0, 0, W, ENV_H);
  const pad = 6;
  const innerH = ENV_H - pad * 2;
  const dbTop = 0;
  const dbBottom = -80;
  const yOf = (db: number) =>
    pad +
    ((dbTop - Math.max(dbBottom, Math.min(dbTop, db))) / (dbTop - dbBottom)) *
      innerH;

  // rejilla de dB
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";
  for (let db = 0; db >= -80; db -= 20) {
    const y = Math.round(yOf(db)) + 0.5;
    ctx.strokeStyle = "rgba(63,63,70,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = "#52525b";
    ctx.fillText(`${db}`, W - 20, y - 5);
  }

  const t1 = Math.min(duration, t0 + W / pps);
  if (analysis && analysis.envDb.length > 0) {
    const hopSec = analysis.envelopeHopSec;
    const env = analysis.envDb;
    ctx.strokeStyle = "rgba(252,211,77,0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let px = 0; px < W; px++) {
      const ta = t0 + px / pps;
      const tb = t0 + (px + 1) / pps;
      if (ta >= t1) break;
      const wa = Math.floor(ta / hopSec);
      const wb = Math.floor(tb / hopSec);
      let db = -100;
      for (let w = wa; w <= Math.min(wb, env.length - 1); w++) {
        if (w >= 0 && env[w] > db) db = env[w];
      }
      if (db === -100) continue;
      const y = yOf(Math.max(db, dbBottom));
      if (!started) {
        ctx.moveTo(px + 0.5, y);
        started = true;
      } else {
        ctx.lineTo(px + 0.5, y);
      }
    }
    ctx.stroke();
  }

  // línea del umbral de silencio
  const yTh = Math.round(yOf(thresholdDb)) + 0.5;
  ctx.strokeStyle = "rgba(244,63,94,0.8)";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, yTh);
  ctx.lineTo(W, yTh);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(253,164,175,0.9)";
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`umbral ${thresholdDb} dB`, 6, yTh - 6);

  const px = (playheadSec - t0) * pps;
  if (px >= 0 && px <= W) {
    ctx.fillStyle = "rgba(250,250,250,0.7)";
    ctx.fillRect(Math.round(px), 0, 1, ENV_H);
  }
}

export function WaveformTimeline(props: WaveformTimelineProps) {
  const {
    analysis,
    silences,
    durationSec,
    playheadSec,
    playing,
    thresholdDb,
    onSeek,
    compact,
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLCanvasElement | null>(null);
  const envRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  // vista "cruda" pedida por el usuario; la efectiva se DERIVA (siempre válida)
  const [view, setView] = useState<View>({ start: 0, pps: 0.01 });
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [follow, setFollow] = useState(true);
  const panRef = useRef<{ x0: number; start0: number; pps0: number } | null>(
    null
  );
  const scrubRef = useRef(false);

  const minPps = width > 0 && durationSec > 0 ? width / durationSec : 0.01;
  const clampView = useCallback(
    (v: View): View => {
      const pps = clamp(v.pps, Math.max(minPps, 0.01), MAX_PPS);
      const span = width > 0 ? width / pps : 0;
      const start = clamp(v.start, 0, Math.max(0, durationSec - span));
      return { start, pps };
    },
    [minPps, width, durationSec]
  );

  /**
   * Vista efectiva (pura, derivada en render):
   *  - siempre acotada al ancho/duración actuales (zoom-out en vivo durante
   *    el análisis por bloques);
   *  - mientras suena y «seguir» está activo, se recentra al salir el
   *    playhead (scroll por páginas, como un DAW).
   */
  const effView = useMemo(() => {
    const bv = clampView(view);
    if (!playing || !follow || width <= 0 || durationSec <= 0) return bv;
    const span = width / bv.pps;
    if (playheadSec > bv.start + span * 0.92 || playheadSec < bv.start) {
      return clampView({ pps: bv.pps, start: playheadSec - span * 0.1 });
    }
    return bv;
  }, [clampView, view, playing, follow, width, durationSec, playheadSec]);

  // Observa el ancho del contenedor (responsive)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zoom con la rueda del ratón, anclado al cursor (requisito Camtasia)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (durationSec <= 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setView((v) => {
        const bv = clampView(v);
        const tAt = bv.start + x / bv.pps;
        const factor = Math.exp(-e.deltaY * 0.0012);
        const pps = clamp(bv.pps * factor, Math.max(minPps, 0.01), MAX_PPS);
        return { pps, start: tAt - x / pps };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [minPps, clampView, durationSec]);

  // Dibujo del lienzo principal
  useEffect(() => {
    const c = mainRef.current;
    if (!c || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const H = RULER_H + WAVE_H;
    c.width = Math.round(width * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    drawRuler(ctx, width, effView.start, effView.pps, durationSec);
    drawWave(
      ctx,
      width,
      effView.start,
      effView.pps,
      analysis,
      durationSec,
      silences,
      playheadSec
    );
  }, [width, effView, analysis, silences, durationSec, playheadSec]);

  // Dibujo del carril de envolvente RMS
  useEffect(() => {
    const c = envRef.current;
    if (!c || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(ENV_H * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${ENV_H}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEnvelope(
      ctx,
      width,
      effView.start,
      effView.pps,
      analysis,
      durationSec,
      thresholdDb,
      playheadSec
    );
  }, [width, effView, analysis, durationSec, thresholdDb, playheadSec]);

  const timeAtX = (x: number) =>
    clamp(effView.start + x / effView.pps, 0, Math.max(0, durationSec));

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (y < RULER_H) {
      panRef.current = {
        x0: x,
        start0: effView.start,
        pps0: effView.pps,
      };
      setFollow(false);
    } else {
      scrubRef.current = true;
      onSeek(timeAtX(x));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (panRef.current) {
      const dx = x - panRef.current.x0;
      setView((v) => ({
        pps: v.pps,
        start: panRef.current!.start0 - dx / panRef.current!.pps0,
      }));
      return;
    }
    if (scrubRef.current) {
      onSeek(timeAtX(x));
    }
    setHover({ x, t: timeAtX(x) });
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    panRef.current = null;
    scrubRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const zoomBy = (factor: number) => {
    setView(() => {
      const anchor = effView.start + width / effView.pps / 2;
      const pps = clamp(effView.pps * factor, Math.max(minPps, 0.01), MAX_PPS);
      return { pps, start: anchor - width / pps / 2 };
    });
  };

  const zoomLabel =
    effView.pps >= 100
      ? `${Math.round(effView.pps)} px/s`
      : `${effView.pps.toFixed(1)} px/s`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Línea de tiempo
        </span>
        <span className="font-mono text-[11px] text-zinc-500">{zoomLabel}</span>
        <span className="hidden text-[11px] text-zinc-500 sm:inline">
          · rueda = zoom · arrastra la regla = desplazar · clic en la onda =
          buscar
        </span>
        <div className="ms-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Alejar"
            onClick={() => zoomBy(1 / 1.6)}
            disabled={effView.pps <= minPps + 0.001}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Acercar"
            onClick={() => zoomBy(1.6)}
            disabled={effView.pps >= MAX_PPS}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Ajustar todo"
            onClick={() => setView({ start: 0, pps: 0.01 })}
            disabled={durationSec <= 0}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant={follow ? "secondary" : "ghost"}
            size="sm"
            className="h-8 gap-1 px-2 text-[11px]"
            aria-pressed={follow}
            onClick={() => setFollow((f) => !f)}
            disabled={durationSec <= 0}
          >
            {follow ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            Seguir
          </Button>
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 select-none"
        onPointerLeave={() => setHover(null)}
      >
        <canvas
          ref={mainRef}
          className="block w-full touch-none"
          style={{ height: RULER_H + WAVE_H, cursor: "crosshair" }}
          role="img"
          aria-label="Forma de onda con silencios marcados y cursor de reproducción"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        />
        <canvas
          ref={envRef}
          className="block w-full border-t border-zinc-900 touch-none"
          style={{ height: ENV_H, cursor: "crosshair" }}
          role="img"
          aria-label="Envolvente RMS con umbral de silencio"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek(timeAtX(e.clientX - rect.left));
          }}
        />
        {hover && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-zinc-400/40"
            style={{ left: hover.x }}
          >
            <span className="absolute top-1 right-1 rounded bg-zinc-800/90 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
              {formatTimecode(hover.t)}
            </span>
          </div>
        )}
      </div>
      {!compact && (
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Bloques rosados = silencios detectados · línea discontinua del carril
          inferior = umbral de dB · la onda se dibuja solo para la ventana
          visible (virtualización para archivos de 3+ horas).
        </p>
      )}
    </div>
  );
}
