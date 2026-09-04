"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { AnalysisData } from "@/store/project";
import type { SilenceRegion } from "@/lib/audio/silence";
import type { BloqueMusica } from "@/lib/fase4/tipos";
import type { Pista } from "@/lib/fase3/tipos";
import { ANIMO_COLORES } from "@/lib/fase2/types";
import {
  clamp,
  formatRulerTick,
  formatTimecode,
  pickRulerStep,
} from "@/lib/format";

interface MixTimelineProps {
  analysis: AnalysisData | null;
  durationSec: number;
  bloques: BloqueMusica[];
  pistas: Pista[];
  nivelDb: Float32Array | null;
  hopSec: number;
  duckDb?: Float32Array | null;
  silences: SilenceRegion[];
  playheadSec: number;
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onMover?: (id: string, nuevoInicio: number) => void;
  onSeek: (t: number) => void;
}

const RULER_H = 26;
const NARR_H = 64;
const MUS_H = 132;
const MAX_PPS = 2000;
/** rango vertical del carril de música: dB → y */
const DB_MIN = -48;
const DB_MAX = 6;

type View = { start: number; pps: number };

interface Arrastre {
  id: string;
  inicioOriginal: number;
  deltaSec: number;
}

export function MixTimeline(props: MixTimelineProps) {
  const {
    analysis,
    durationSec,
    bloques,
    pistas,
    nivelDb,
    hopSec,
    duckDb,
    silences,
    playheadSec,
    editable,
    selectedId,
    onSelect,
    onMover,
    onSeek,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(900);
  const [vista, setVista] = useState<View | null>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const pistaMap = useMemo(
    () => new Map(pistas.map((p) => [p.id, p])),
    [pistas]
  );

  // ---------- tamaño ----------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAncho(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setAncho(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // ---------- vista efectiva (derivada en render: fit por defecto) ----------
  const vistaEfectiva = useMemo(
    () => {
      const base =
        vista ?? {
          start: 0,
          pps: clamp(ancho / Math.max(1, durationSec), 0.05, MAX_PPS),
        };
      const pps = clamp(base.pps, 0.05, MAX_PPS);
      const maxStart = Math.max(0, durationSec - ancho / pps);
      return { start: clamp(base.start, 0, maxStart), pps };
    },
    [vista, ancho, durationSec]
  );

  const vistaParaDibujo = arrastre ? { ...vistaEfectiva } : vistaEfectiva;

  // ---------- dibujo ----------
  const dibujar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = ancho;
    const H = RULER_H + NARR_H + MUS_H;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { start: t0, pps } = vistaParaDibujo;
    const t1 = Math.min(durationSec, t0 + W / pps);
    const xDe = (t: number) => (t - t0) * pps;

    // ===== regla =====
    ctx.fillStyle = "#18181b";
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.strokeStyle = "#27272a";
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(W, RULER_H - 0.5);
    ctx.stroke();
    const step = pickRulerStep(pps);
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    const firstTick = Math.floor(t0 / step) * step;
    for (let t = firstTick; t <= t1 + step; t += step) {
      if (t < 0) continue;
      const x = Math.round(xDe(t)) + 0.5;
      if (x < -2 || x > W + 2) continue;
      ctx.strokeStyle = "#3f3f46";
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 10);
      ctx.lineTo(x, RULER_H - 1);
      ctx.stroke();
      ctx.fillStyle = "#a1a1aa";
      ctx.fillText(formatRulerTick(t, step), x + 3, 3);
    }
    const xEnd = xDe(durationSec);
    if (xEnd >= 0 && xEnd <= W) {
      ctx.strokeStyle = "#f43f5e";
      ctx.beginPath();
      ctx.moveTo(xEnd + 0.5, 0);
      ctx.lineTo(xEnd + 0.5, H - 1);
      ctx.stroke();
    }

    // ===== carril narración =====
    const narrTop = RULER_H;
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, narrTop, W, NARR_H);
    // etiqueta
    ctx.fillStyle = "#52525b";
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("VOZ", 6, narrTop + 6);
    if (analysis && analysis.peaksMax.length > 0) {
      const mid = narrTop + NARR_H / 2;
      const amp = (NARR_H / 2 - 6) / Math.max(0.001, analysis.peaksMax.reduce((m, v) => Math.max(m, Math.abs(v)), 0.001));
      const i0 = Math.max(0, Math.floor(t0 * analysis.peaksPerSec));
      const i1 = Math.min(
        analysis.peaksMax.length - 1,
        Math.ceil(t1 * analysis.peaksPerSec)
      );
      ctx.strokeStyle = "rgba(245,158,11,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const pxPerPeak = pps / analysis.peaksPerSec;
      if (pxPerPeak >= 1.5) {
        for (let i = i0; i <= i1; i++) {
          const x = xDe(i / analysis.peaksPerSec);
          const mx = mid - analysis.peaksMax[i] * amp;
          const mn = mid - analysis.peaksMin[i] * amp;
          ctx.moveTo(x, mn);
          ctx.lineTo(x, mx);
        }
        ctx.stroke();
      } else {
        // agrupar por píxel
        for (let x = 0; x < W; x++) {
          const ta = t0 + x / pps;
          const tb = ta + 1 / pps;
          const ja = Math.max(i0, Math.floor(ta * analysis.peaksPerSec));
          const jb = Math.min(i1, Math.ceil(tb * analysis.peaksPerSec));
          if (jb < ja) continue;
          let mx = 0;
          let mn = 0;
          for (let j = ja; j <= jb; j++) {
            if (analysis.peaksMax[j] > mx) mx = analysis.peaksMax[j];
            if (analysis.peaksMin[j] < mn) mn = analysis.peaksMin[j];
          }
          ctx.moveTo(x + 0.5, mid - mn * amp);
          ctx.lineTo(x + 0.5, mid - mx * amp);
        }
        ctx.stroke();
      }
    }
    // silencios
    for (const s of silences) {
      if (s.end < t0 || s.start > t1) continue;
      const x = xDe(s.start);
      const x2 = xDe(s.end);
      ctx.fillStyle = "rgba(244,63,94,0.10)";
      ctx.fillRect(x, narrTop + 2, Math.max(1, x2 - x), NARR_H - 4);
    }

    // ===== carril música =====
    const musTop = RULER_H + NARR_H;
    ctx.fillStyle = "#0d0d10";
    ctx.fillRect(0, musTop, W, MUS_H);
    ctx.strokeStyle = "#27272a";
    ctx.beginPath();
    ctx.moveTo(0, musTop + 0.5);
    ctx.lineTo(W, musTop + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#52525b";
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("MÚSICA", 6, musTop + 6);

    const yDe = (db: number) =>
      musTop + MUS_H - clamp((db - DB_MIN) / (DB_MAX - DB_MIN), 0, 1) * MUS_H;

    // rejilla dB
    ctx.strokeStyle = "rgba(63,63,70,0.5)";
    ctx.lineWidth = 1;
    for (let db = DB_MIN; db <= DB_MAX; db += 12) {
      const y = Math.round(yDe(db)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // bloques
    const bloquesVisibles = bloques.map((b) => {
      if (arrastre && b.id === arrastre.id) {
        return {
          ...b,
          inicio: b.inicio + arrastre.deltaSec,
          fin: b.fin + arrastre.deltaSec,
        };
      }
      return b;
    });
    for (const b of bloquesVisibles) {
      if (b.fin + b.fadeOutSeg < t0 || b.inicio > t1) continue;
      const pista = pistaMap.get(b.pistaId);
      const color = pista
        ? ANIMO_COLORES[pista.animo]
        : "#a1a1aa";
      const x = xDe(b.inicio);
      const x2 = xDe(b.fin);
      const w = Math.max(2, x2 - x);
      const sel = selectedId === b.id;
      ctx.globalAlpha = b.muted ? 0.25 : 0.8;
      ctx.fillStyle = color;
      ctx.fillRect(x, musTop + 14, w, MUS_H - 34);
      ctx.globalAlpha = b.muted ? 0.4 : 1;
      ctx.strokeStyle = sel ? "#ffffff" : color;
      ctx.lineWidth = sel ? 1.8 : 1;
      ctx.strokeRect(x + 0.5, musTop + 14.5, w - 1, MUS_H - 35);
      ctx.globalAlpha = 1;

      // cuñas de fundido
      ctx.fillStyle = "rgba(9,9,11,0.55)";
      if (b.fadeInSeg > 0.05 && b.inicio >= t0) {
        const xf = Math.min(w, b.fadeInSeg * pps);
        ctx.beginPath();
        ctx.moveTo(x, musTop + 14);
        ctx.lineTo(x + xf, musTop + 14);
        ctx.lineTo(x, musTop + MUS_H - 20);
        ctx.closePath();
        ctx.fill();
      }
      if (b.fadeOutSeg > 0.05) {
        const xf = Math.min(w, b.fadeOutSeg * pps);
        ctx.beginPath();
        ctx.moveTo(x2, musTop + 14);
        ctx.lineTo(x2 - xf, musTop + 14);
        ctx.lineTo(x2, musTop + MUS_H - 20);
        ctx.closePath();
        ctx.fill();
      }

      // etiqueta
      if (w > 55 && pista) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 2, musTop + 16, w - 4, 30);
        ctx.clip();
        ctx.fillStyle = "#09090b";
        ctx.font = "bold 10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(pista.titulo, x + 6, musTop + 28);
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillText(
          `${Math.round(b.fin - b.inicio)}s · ${pista.bpm} BPM`,
          x + 6,
          musTop + 40
        );
        ctx.restore();
      }
      if (b.muted && w > 30) {
        ctx.fillStyle = "rgba(228,228,231,0.85)";
        ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText("SILENCIADO", x + 6, musTop + MUS_H - 26);
      }
    }

    // envolvente de nivel (dB → y)
    if (nivelDb && nivelDb.length > 0 && hopSec > 0) {
      // zona de ducking (entre nivel y nivel+duck)
      if (duckDb && duckDb.length === nivelDb.length) {
        ctx.beginPath();
        let empezo = false;
        const n = nivelDb.length;
        for (let i = 0; i < n; i++) {
          const t = i * hopSec;
          if (t < t0 - hopSec || t > t1 + hopSec) continue;
          const x = xDe(t);
          if (!empezo) {
            ctx.moveTo(x, yDe(nivelDb[i]));
            empezo = true;
          } else {
            ctx.lineTo(x, yDe(nivelDb[i]));
          }
        }
        for (let i = n - 1; i >= 0; i--) {
          const t = i * hopSec;
          if (t < t0 - hopSec || t > t1 + hopSec) continue;
          ctx.lineTo(xDe(t), yDe(nivelDb[i] + duckDb[i]));
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(244,63,94,0.14)";
        ctx.fill();
      }

      // línea de nivel
      ctx.beginPath();
      let empezo2 = false;
      for (let i = 0; i < nivelDb.length; i++) {
        const t = i * hopSec;
        if (t < t0 - hopSec || t > t1 + hopSec) continue;
        const x = xDe(t);
        const y = yDe(nivelDb[i]);
        if (!empezo2) {
          ctx.moveTo(x, y);
          empezo2 = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = "rgba(245,158,11,0.95)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // playhead
    const xPh = xDe(playheadSec);
    if (xPh >= -2 && xPh <= W + 2) {
      ctx.strokeStyle = "#fafafa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xPh + 0.5, 0);
      ctx.lineTo(xPh + 0.5, H - 1);
      ctx.stroke();
      ctx.fillStyle = "#fafafa";
      ctx.beginPath();
      ctx.moveTo(xPh - 5, RULER_H - 8);
      ctx.lineTo(xPh + 5, RULER_H - 8);
      ctx.lineTo(xPh, RULER_H - 1);
      ctx.closePath();
      ctx.fill();
    }

    // hover
    if (hover) {
      ctx.strokeStyle = "rgba(250,250,250,0.25)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hover.x + 0.5, RULER_H);
      ctx.lineTo(hover.x + 0.5, H - 1);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(9,9,11,0.92)";
      const texto = formatTimecode(hover.t);
      ctx.font = "10px ui-monospace, monospace";
      const tw = ctx.measureText(texto).width + 10;
      const bx = clamp(hover.x - tw / 2, 2, W - tw - 2);
      ctx.fillRect(bx, 2, tw, 16);
      ctx.fillStyle = "#e4e4e7";
      ctx.fillText(texto, bx + 5, 5);
    }
  }, [
    ancho,
    durationSec,
    vistaParaDibujo,
    analysis,
    silences,
    bloques,
    arrastre,
    pistaMap,
    selectedId,
    nivelDb,
    duckDb,
    hopSec,
    playheadSec,
    hover,
  ]);

  useEffect(() => {
    dibujar();
  }, [dibujar]);

  // ---------- interacción ----------
  const clampVista = useCallback(
    (v: View): View => {
      const pps = clamp(v.pps, 0.05, MAX_PPS);
      const maxStart = Math.max(0, durationSec - ancho / pps);
      return { pps, start: clamp(v.start, 0, maxStart) };
    },
    [ancho, durationSec]
  );

  const zoom = useCallback(
    (factor: number, anclaX: number) => {
      setVista((v) => {
        const base = v ?? { start: 0, pps: ancho / Math.max(1, durationSec) };
        const tAncla = base.start + anclaX / base.pps;
        const nueva = { pps: base.pps * factor, start: 0 };
        nueva.start = tAncla - anclaX / nueva.pps;
        return clampVista(nueva);
      });
    },
    [ancho, durationSec, clampVista]
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoom(e.deltaY > 0 ? 0.82 : 1.22, e.clientX - rect.left);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

  const hitBloque = useCallback(
    (x: number, y: number): BloqueMusica | null => {
      const musTop = RULER_H + NARR_H;
      if (y < musTop + 14 || y > musTop + MUS_H - 20) return null;
      const { start: t0, pps } = vistaEfectiva;
      const t = t0 + x / pps;
      const lista = bloques.map((b) =>
        arrastre && b.id === arrastre.id
          ? { ...b, inicio: b.inicio + arrastre.deltaSec, fin: b.fin + arrastre.deltaSec }
          : b
      );
      return (
        lista.find((b) => t >= b.inicio && t <= b.fin) ??
        lista.find((b) => t >= b.inicio - 0.3 && t <= b.fin + 0.3) ??
        null
      );
    },
    [vistaEfectiva, bloques, arrastre]
  );

  const enArrastre = useRef(false);
  const panRef = useRef<{ x: number; start: number } | null>(null);
  const pressRef = useRef<{ x: number; y: number; t: number; tiempo: number } | null>(
    null
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.setPointerCapture(e.pointerId);
    const { start: t0, pps } = vistaEfectiva;
    const t = t0 + x / pps;

    // arrastre de bloque (solo editable)
    if (editable) {
      const b = hitBloque(x, y);
      if (b) {
        onSelect?.(b.id);
        enArrastre.current = true;
        setArrastre({ id: b.id, inicioOriginal: b.inicio, deltaSec: 0 });
        pressRef.current = { x, y, t, tiempo: performance.now() };
        return;
      }
    }

    // pan desde la regla
    if (y <= RULER_H) {
      panRef.current = { x, start: t0 };
      pressRef.current = null;
      return;
    }

    pressRef.current = { x, y, t, tiempo: performance.now() };
    if (!editable) {
      // clic en el carril de voz = scrub
      onSeek(clamp(t, 0, durationSec));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { start: t0, pps } = vistaEfectiva;
    const t = t0 + x / pps;
    if (y > RULER_H) setHover({ x, t });
    else setHover(null);

    if (panRef.current) {
      const dt = (x - panRef.current.x) / pps;
      setVista(clampVista({ pps, start: panRef.current.start - dt }));
      return;
    }

    if (enArrastre.current && arrastre) {
      const delta = (x - (pressRef.current?.x ?? x)) / pps;
      setArrastre({ ...arrastre, deltaSec: Math.round(delta * 10) / 10 });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = canvasRef.current;
    if (!el) return;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* sin captura */
    }
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (enArrastre.current && arrastre) {
      const dur = arrastre.deltaSec;
      enArrastre.current = false;
      const movio = Math.abs(dur) > 0.05;
      const nuevoInicio = arrastre.inicioOriginal + dur;
      setArrastre(null);
      pressRef.current = null;
      if (movio && onMover && editable) {
        onMover(arrastre.id, Math.round(nuevoInicio * 10) / 10);
      } else if (!movio) {
        // clic simple sobre el bloque → seek al inicio del bloque
        onSeek(clamp(arrastre.inicioOriginal, 0, durationSec));
      }
      return;
    }

    if (panRef.current) {
      const movido = Math.abs(x - panRef.current.x) > 5;
      panRef.current = null;
      if (!movido) {
        // clic simple en la regla → seek
        const { start: t0, pps } = vistaEfectiva;
        const t = t0 + x / pps;
        onSeek(clamp(t, 0, durationSec));
      }
      return;
    }

    if (pressRef.current) {
      const { t: tPress, tiempo } = pressRef.current;
      const rapido = performance.now() - tiempo < 400;
      const { start: t0, pps } = vistaEfectiva;
      const tAhora = t0 + x / pps;
      const movio = Math.abs(tAhora - tPress) * pps > 5;
      if (rapido && !movio && !editable) {
        onSeek(clamp(tPress, 0, durationSec));
      } else if (editable && rapido && !movio) {
        const b = hitBloque(x, e.clientY - rect.top);
        if (!b) {
          onSelect?.(null);
          onSeek(clamp(tPress, 0, durationSec));
        }
      }
      pressRef.current = null;
    }
  };

  const pxEtiqueta = Math.round(vistaEfectiva.pps);

  return (
    <div ref={wrapRef} className="w-full select-none">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
          {pxEtiqueta} px/s
        </span>
        <span className="hidden text-[10px] text-zinc-500 md:inline">
          Rueda = zoom · arrastra la regla = pan ·{" "}
          {editable
            ? "arrastra un bloque para moverlo, clic para seleccionar"
            : "clic en la voz = saltar"}
        </span>
        <span className="md:hidden text-[10px] text-zinc-500">
          Rueda = zoom · arrastra para explorar
        </span>
        <div className="ms-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Alejar"
            onClick={() => zoom(0.5, ancho / 2)}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Acercar"
            onClick={() => zoom(2, ancho / 2)}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Ajustar a lo ancho"
            onClick={() =>
              setVista({ start: 0, pps: clamp(ancho / durationSec, 0.05, MAX_PPS) })
            }
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full cursor-crosshair rounded-lg border border-zinc-800 bg-zinc-950 touch-none"
        style={{ height: RULER_H + NARR_H + MUS_H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        aria-label="Línea de tiempo de la mezcla: narración arriba, bloques de música abajo"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" /> nivel de
          música
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-rose-500/60" />{" "}
          reducción por ducking
        </span>
        <span>cuñas = fundidos de entrada/salida</span>
      </div>
    </div>
  );
}
