"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from "lucide-react";
import {
  ANIMO_COLORES,
  ANIMO_ETIQUETAS,
  ANIMOS_VALIDOS,
  type Escena,
} from "@/lib/fase2/types";
import {
  clamp,
  formatTimecode,
  formatRulerTick,
  pickRulerStep,
} from "@/lib/format";

export interface TensionGraphProps {
  escenas: Escena[];
  durationSec: number;
  playheadSec: number;
  selectedId: string | null;
  /** true mientras se re-analiza: los puntos solo se seleccionan, no se arrastran */
  soloLectura?: boolean;
  /** al arrastrar un punto (cada cambio de valor) */
  onCorregir: (id: string, tension: number) => void;
  /** clic en punto o en el área vacía */
  onSeleccionar: (id: string) => void;
  /** clic en vacío (salta al inicio de la escena más cercana) o clic en la regla */
  onSeek: (t: number) => void;
  /** botón «Restaurar automáticos» (solo si hay correcciones) */
  onRestaurar?: () => void;
}

const RULER_H = 26;
const PLOT_H = 240;
const MAX_PPS = 2000;
/** radio de hit-test de los puntos (px) */
const HIT_R = 16;

type View = { start: number; pps: number };

/** MM:SS compacto para el chip de escena seleccionada. */
function formatMS(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p2 = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

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
  ctx.font = `10px ${MONO}`;
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
    ctx.fillText(formatRulerTick(t, step), x + 3, 2);
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

function drawPlot(
  ctx: CanvasRenderingContext2D,
  W: number,
  t0: number,
  pps: number,
  escenas: Escena[],
  duration: number,
  playheadSec: number,
  selectedId: string | null
) {
  const plotTop = RULER_H;
  const yOf = (tension: number) => plotTop + (1 - tension / 100) * PLOT_H;

  ctx.clearRect(0, plotTop, W, PLOT_H);
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, plotTop, W, PLOT_H);

  if (escenas.length === 0) {
    ctx.fillStyle = "#52525b";
    ctx.font = `12px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "Aún no hay análisis de tensión.",
      W / 2,
      plotTop + PLOT_H / 2
    );
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    return;
  }

  // rejilla horizontal: línea cada 10, etiqueta cada 25, base 0 sólida
  ctx.font = `9px ${MONO}`;
  ctx.textBaseline = "bottom";
  for (let v = 10; v <= 100; v += 10) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = "#27272a";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    if (v % 25 === 0) {
      ctx.fillStyle = "#52525b";
      ctx.fillText(String(v), 4, y - 2);
    }
  }
  const yBase = Math.round(yOf(0)) + 0.5;
  ctx.strokeStyle = "#3f3f46";
  ctx.beginPath();
  ctx.moveTo(0, yBase);
  ctx.lineTo(W, yBase);
  ctx.stroke();
  ctx.textBaseline = "alphabetic";

  const xOf = (e: Escena) =>
    Math.round(((e.inicio + e.fin) / 2 - t0) * pps) + 0.5;

  // banda de resaltado de la escena seleccionada
  const sel = selectedId ? escenas.find((e) => e.id === selectedId) : null;
  if (sel) {
    const xa = (sel.inicio - t0) * pps;
    const xb = (sel.fin - t0) * pps;
    ctx.fillStyle = "rgba(250,250,250,0.05)";
    ctx.fillRect(xa, plotTop, Math.max(2, xb - xa), PLOT_H);
    ctx.strokeStyle = "rgba(250,250,250,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(xa) + 0.5, plotTop);
    ctx.lineTo(Math.round(xa) + 0.5, plotTop + PLOT_H);
    ctx.moveTo(Math.round(xb) - 0.5, plotTop);
    ctx.lineTo(Math.round(xb) - 0.5, plotTop + PLOT_H);
    ctx.stroke();
  }

  const hayCorregidas = escenas.some((e) => e.corregido);

  // curva automática (punteada, detrás) — solo si hay correcciones manuales
  if (hayCorregidas) {
    ctx.strokeStyle = "rgba(165,163,175,0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    let started = false;
    for (const e of escenas) {
      const x = xOf(e);
      const y = yOf(e.tensionAuto);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // relleno bajo la curva actual
  ctx.beginPath();
  const first = escenas[0];
  const last = escenas[escenas.length - 1];
  ctx.moveTo(xOf(first), yOf(0));
  for (const e of escenas) {
    ctx.lineTo(xOf(e), yOf(e.tension));
  }
  ctx.lineTo(xOf(last), yOf(0));
  ctx.closePath();
  ctx.fillStyle = "rgba(52,211,153,0.10)";
  ctx.fill();

  // curva actual
  ctx.beginPath();
  for (let i = 0; i < escenas.length; i++) {
    const e = escenas[i];
    const x = xOf(e);
    const y = yOf(e.tension);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.lineWidth = 1;

  // puntos (solo los visibles, más un margen)
  for (const e of escenas) {
    const x = xOf(e);
    if (x < -20 || x > W + 20) continue;
    const y = yOf(e.tension);
    // anillo de corregido
    if (e.corregido) {
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    // anillo de selección
    if (e.id === selectedId) {
      ctx.strokeStyle = "#fafafa";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 7.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    // punto
    ctx.fillStyle = ANIMO_COLORES[e.animo];
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#09090b";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // playhead: línea vertical + triángulo en la regla
  const px = (playheadSec - t0) * pps;
  if (px >= -6 && px <= W + 6) {
    const x = Math.round(px) + 0.5;
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(x - 1, plotTop, 2, PLOT_H);
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 9);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Curva de tensión 0–100 de la Fase 2 con puntos corregibles arrastrables.
 * Canvas propio con regla, zoom con rueda anclado al cursor, pan y playhead
 * (mismos patrones que waveform-timeline).
 */
export function TensionGraph(props: TensionGraphProps) {
  const {
    escenas,
    durationSec,
    playheadSec,
    selectedId,
    soloLectura = false,
    onCorregir,
    onSeleccionar,
    onSeek,
    onRestaurar,
  } = props;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  // vista "cruda" pedida por el usuario; la efectiva se DERIVA (siempre válida)
  const [view, setView] = useState<View>({ start: 0, pps: 0.01 });
  const [cursor, setCursor] = useState<"crosshair" | "grab" | "grabbing">(
    "crosshair"
  );
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    t: number;
    escena: Escena | null;
  } | null>(null);

  const panRef = useRef<{ x0: number; start0: number; pps0: number } | null>(
    null
  );
  const dragRef = useRef<{ id: string; tension: number } | null>(null);
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(
    null
  );

  const corregidas = useMemo(
    () => escenas.reduce((n, e) => n + (e.corregido ? 1 : 0), 0),
    [escenas]
  );

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

  const effView = useMemo(() => clampView(view), [clampView, view]);

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

  // Zoom con la rueda, anclado al cursor
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

  // Dibujo del lienzo
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const H = RULER_H + PLOT_H;
    c.width = Math.round(width * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    drawRuler(ctx, width, effView.start, effView.pps, durationSec);
    drawPlot(
      ctx,
      width,
      effView.start,
      effView.pps,
      escenas,
      durationSec,
      playheadSec,
      selectedId
    );
  }, [width, effView, escenas, durationSec, playheadSec, selectedId]);

  const timeAtX = (x: number) =>
    clamp(effView.start + x / effView.pps, 0, Math.max(0, durationSec));

  const pointAt = (x: number, y: number): Escena | null => {
    let best: Escena | null = null;
    let bestD = HIT_R;
    for (const e of escenas) {
      const px = ((e.inicio + e.fin) / 2 - effView.start) * effView.pps;
      const py = RULER_H + (1 - e.tension / 100) * PLOT_H;
      const d = Math.hypot(x - px, y - py);
      if (d <= bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  const nearestEscenaX = (x: number): Escena | null => {
    const t = timeAtX(x);
    let best: Escena | null = null;
    let bestD = Infinity;
    for (const e of escenas) {
      const d = Math.abs((e.inicio + e.fin) / 2 - t);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (y < RULER_H) {
      panRef.current = { x0: x, start0: effView.start, pps0: effView.pps };
      pressRef.current = { x, y, moved: false };
      return;
    }
    const hit = pointAt(x, y);
    if (hit) {
      if (soloLectura) {
        onSeleccionar(hit.id);
        return;
      }
      dragRef.current = { id: hit.id, tension: hit.tension };
      setCursor("grabbing");
      setHover(null);
      return;
    }
    // área vacía: clic (se decide al soltar) o pan si supera 5 px
    pressRef.current = { x, y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // arrastre de un punto → corregir tensión
    if (dragRef.current) {
      const tension = clamp(
        Math.round(100 * (1 - (y - RULER_H) / PLOT_H)),
        0,
        100
      );
      if (tension !== dragRef.current.tension) {
        dragRef.current.tension = tension;
        onCorregir(dragRef.current.id, tension);
      }
      return;
    }

    // pan (regla o área vacía tras superar el umbral)
    if (panRef.current) {
      const dx = x - panRef.current.x0;
      if (pressRef.current && Math.abs(dx) > 2) {
        pressRef.current.moved = true;
      }
      setView((v) => ({
        pps: v.pps,
        start: panRef.current!.start0 - dx / panRef.current!.pps0,
      }));
      return;
    }

    if (pressRef.current) {
      const dx = x - pressRef.current.x;
      const dy = y - pressRef.current.y;
      if (!pressRef.current.moved && Math.hypot(dx, dy) > 5) {
        panRef.current = {
          x0: pressRef.current.x,
          start0: effView.start,
          pps0: effView.pps,
        };
        pressRef.current.moved = true;
      }
      return;
    }

    // hover sin botón pulsado: tooltip dinámico + cursor
    const hit = pointAt(x, y);
    setHover({ x, y, t: timeAtX(x), escena: hit });
    setCursor(hit ? "grab" : "crosshair");
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDrag = dragRef.current !== null;
    dragRef.current = null;
    const hadPan = panRef.current !== null;
    panRef.current = null;
    const press = pressRef.current;
    pressRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setCursor("crosshair");
    if (wasDrag) return;
    if (press && !press.moved) {
      if (hadPan) {
        // clic simple en la regla → buscar
        onSeek(timeAtX(press.x));
        return;
      }
      // clic simple en vacío → escuchar la escena más cercana
      const nearest = nearestEscenaX(press.x);
      if (nearest) {
        onSeleccionar(nearest.id);
        onSeek(nearest.inicio);
      } else {
        onSeek(timeAtX(press.x));
      }
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    panRef.current = null;
    pressRef.current = null;
    setCursor("crosshair");
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

  const H = RULER_H + PLOT_H;
  const sel = selectedId ? escenas.find((e) => e.id === selectedId) : null;

  // posición del tooltip (evita desbordes)
  const tooltipLeft =
    hover ? clamp(hover.x + 12, 8, Math.max(8, width - 260)) : 0;
  const tooltipTop = hover ? clamp(hover.y + 12, 4, H - 84) : 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Curva de tensión (0–100)
        </span>
        <span className="font-mono text-[11px] text-zinc-500">{zoomLabel}</span>
        {soloLectura && (
          <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            solo lectura
          </span>
        )}
        <span className="hidden text-[11px] text-zinc-500 lg:inline">
          · rueda = zoom · arrastra la regla = desplazar · arrastra un punto =
          corregir · clic en vacío = escuchar esa escena
        </span>
        <span className="text-[11px] text-zinc-500 lg:hidden">
          · arrastra un punto = corregir
        </span>
        <div className="ms-auto flex items-center gap-1">
          {onRestaurar && corregidas > 0 && (
            <Button
              variant="ghost"
              className="h-8 gap-1 px-2 text-[11px] text-zinc-400"
              onClick={onRestaurar}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar automáticos
            </Button>
          )}
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
        </div>
      </div>

      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 select-none"
        onPointerLeave={() => setHover(null)}
      >
        <canvas
          ref={canvasRef}
          className="block w-full touch-none"
          style={{ height: H, cursor }}
          role="img"
          aria-label={
            escenas.length > 0
              ? `Curva de tensión de 0 a 100 con ${escenas.length} escenas; arrastra los puntos para corregir`
              : "Curva de tensión de 0 a 100 (aún sin análisis)"
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
        {sel && (
          <div
            className="pointer-events-none absolute top-2 left-2 z-10 max-w-[70%] rounded border border-zinc-700/60 bg-zinc-900/95 px-2 py-1"
            title={sel.razon || undefined}
          >
            <p className="font-mono text-[11px] text-zinc-200">
              {formatMS(sel.inicio)} · tensión {sel.tension} ·{" "}
              {ANIMO_ETIQUETAS[sel.animo]}
              {sel.corregido ? " · corregida" : ""}
            </p>
            {sel.razon && (
              <p className="max-w-[280px] truncate text-[10px] text-zinc-400">
                {sel.razon.slice(0, 60)}
              </p>
            )}
          </div>
        )}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-fit max-w-[260px] rounded border border-zinc-700/60 bg-zinc-900/95 px-2 py-1.5"
            style={{ left: tooltipLeft, top: tooltipTop }}
          >
            {hover.escena ? (
              <>
                <p className="font-mono text-[10px] text-zinc-500">
                  {formatTimecode(hover.t)}
                </p>
                <p className="text-[11px] text-zinc-200">
                  tensión {hover.escena.tension} ·{" "}
                  <span style={{ color: ANIMO_COLORES[hover.escena.animo] }}>
                    {ANIMO_ETIQUETAS[hover.escena.animo]}
                  </span>
                </p>
                <p className="text-[10px] leading-snug break-words text-zinc-400">
                  {hover.escena.texto.slice(0, 80)}
                </p>
              </>
            ) : (
              <p className="font-mono text-[10px] text-zinc-300">
                {formatTimecode(hover.t)}
              </p>
            )}
          </div>
        )}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500"
        aria-label="Leyenda de ánimos"
      >
        {ANIMOS_VALIDOS.map((a) => (
          <span key={a} className="inline-flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-full border border-zinc-900"
              style={{ backgroundColor: ANIMO_COLORES[a] }}
              aria-hidden
            />
            {ANIMO_ETIQUETAS[a]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span
            className="h-3 w-3 rounded-full border-2 border-amber-400"
            aria-hidden
          />
          corregido manualmente
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Las correcciones también pueden hacerse numéricamente en la tabla de
        escenas.
      </p>
    </div>
  );
}
