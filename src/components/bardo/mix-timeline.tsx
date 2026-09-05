"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import type { AnalysisData } from "@/store/project";
import type { SilenceRegion } from "@/lib/audio/silence";
import type { BloqueMusica } from "@/lib/fase4/tipos";
import type { Pista } from "@/lib/fase3/tipos";
import type { SfxClip, SfxDef } from "@/lib/sfx/tipos";
import { colorCategoria } from "@/lib/sfx/tipos";
import {
  buclesDe,
  limitesBorde,
  type LadoRecorte,
} from "@/lib/fase5/ediciones";
import {
  buclesDeClip,
  limitesBordeClip,
} from "@/lib/sfx/clips";
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
  /** Recorte/alargado por los bordes (estilo Camtasia). */
  onRecortar?: (id: string, lado: LadoRecorte, valor: number) => void;
  /** pista de efectos (Fase 5 / previsualización Fase 4) */
  clipsSfx?: SfxClip[];
  bibliotecaSfx?: SfxDef[];
  onMoverSfx?: (id: string, nuevoInicio: number) => void;
  onRecortarSfx?: (id: string, lado: LadoRecorte, valor: number) => void;
  onSeek: (t: number) => void;
}

const RULER_H = 26;
const NARR_H = 64;
const MUS_H = 132;
const SFX_H = 56;
const MAX_PPS = 2000;
/** ancho en px de la zona de agarre de cada borde de bloque/clip */
const EDGE_PX = 9;
/** rango vertical del carril de música: dB → y */
const DB_MIN = -48;
const DB_MAX = 6;

type View = { start: number; pps: number };

/** Colección a la que pertenece el id arrastrado. */
type TipoArrastre = "musica" | "sfx";

/** Arrastre de cuerpo: desplaza el bloque/clip completo. */
interface ArrastreMover {
  modo: "mover";
  tipo: TipoArrastre;
  id: string;
  inicioOriginal: number;
  deltaSec: number;
}

/** Arrastre de borde: recorta (hacia dentro) o alarga (hacia fuera). */
interface ArrastreRecorte {
  modo: "recorte";
  tipo: TipoArrastre;
  id: string;
  lado: LadoRecorte;
  valorOriginal: number;
  valor: number;
}

type Arrastre = ArrastreMover | ArrastreRecorte;

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
    onRecortar,
    clipsSfx,
    bibliotecaSfx,
    onMoverSfx,
    onRecortarSfx,
    onSeek,
  } = props;

  const conSfx = clipsSfx !== undefined;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(900);
  const [vista, setVista] = useState<View | null>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);

  const altoTotal = RULER_H + NARR_H + MUS_H + (conSfx ? SFX_H : 0);
  const sfxTop = RULER_H + NARR_H + MUS_H;

  const pistaMap = useMemo(
    () => new Map(pistas.map((p) => [p.id, p])),
    [pistas]
  );
  const sfxMap = useMemo(
    () => new Map((bibliotecaSfx ?? []).map((b) => [b.id, b])),
    [bibliotecaSfx]
  );

  /** Aplica el arrastre en curso a un bloque de música (vista previa viva). */
  const conArrastre = useCallback(
    (b: BloqueMusica): BloqueMusica => {
      if (!arrastre || arrastre.id !== b.id || arrastre.tipo !== "musica")
        return b;
      if (arrastre.modo === "mover") {
        return {
          ...b,
          inicio: b.inicio + arrastre.deltaSec,
          fin: b.fin + arrastre.deltaSec,
        };
      }
      const lim = limitesBorde(b, durationSec);
      if (arrastre.lado === "inicio") {
        const v = clamp(
          Math.round(arrastre.valor * 10) / 10,
          lim.inicioMin,
          lim.inicioMax
        );
        const dur = b.fin - v;
        return {
          ...b,
          inicio: v,
          offsetOrigen: Math.max(0, (b.offsetOrigen ?? 0) + (v - b.inicio)),
          fadeInSeg: Math.min(b.fadeInSeg, dur / 2),
          fadeOutSeg: Math.min(b.fadeOutSeg, dur / 2),
        };
      }
      const v = clamp(
        Math.round(arrastre.valor * 10) / 10,
        lim.finMin,
        lim.finMax
      );
      const dur = v - b.inicio;
      return {
        ...b,
        fin: v,
        fadeInSeg: Math.min(b.fadeInSeg, dur / 2),
        fadeOutSeg: Math.min(b.fadeOutSeg, dur / 2),
      };
    },
    [arrastre, durationSec]
  );

  /** Aplica el arrastre en curso a un clip de SFX (vista previa viva). */
  const conArrastreSfx = useCallback(
    (c: SfxClip): SfxClip => {
      if (!arrastre || arrastre.id !== c.id || arrastre.tipo !== "sfx")
        return c;
      if (arrastre.modo === "mover") {
        return {
          ...c,
          inicio: c.inicio + arrastre.deltaSec,
          fin: c.fin + arrastre.deltaSec,
        };
      }
      const lim = limitesBordeClip(c, durationSec);
      if (arrastre.lado === "inicio") {
        const v = clamp(
          Math.round(arrastre.valor * 10) / 10,
          lim.inicioMin,
          lim.inicioMax
        );
        const dur = c.fin - v;
        return {
          ...c,
          inicio: v,
          offsetOrigen: Math.max(0, c.offsetOrigen + (v - c.inicio)),
          fadeInSeg: Math.min(c.fadeInSeg, dur / 2),
          fadeOutSeg: Math.min(c.fadeOutSeg, dur / 2),
        };
      }
      const v = clamp(
        Math.round(arrastre.valor * 10) / 10,
        lim.finMin,
        lim.finMax
      );
      const dur = v - c.inicio;
      return {
        ...c,
        fin: v,
        fadeInSeg: Math.min(c.fadeInSeg, dur / 2),
        fadeOutSeg: Math.min(c.fadeOutSeg, dur / 2),
      };
    },
    [arrastre, durationSec]
  );

  const ponerCursor = (css: string) => {
    const el = canvasRef.current;
    if (el && el.style.cursor !== css) el.style.cursor = css;
  };

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
    const H = altoTotal;
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

    // bloques (con la vista previa del arrastre aplicada)
    const bloquesVisibles = bloques.map(conArrastre);
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

      // costuras de bucle: dónde reinicia la pista dentro del bloque
      const durPista = pista?.durSec ?? 0;
      if (durPista > 1 && w > 24 && durPista * pps > 18) {
        const offset = Math.max(0, b.offsetOrigen ?? 0);
        ctx.strokeStyle = "rgba(9,9,11,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        let ts = b.inicio + (durPista - (offset % durPista));
        while (ts < b.fin - 0.2) {
          const xs = xDe(ts);
          if (xs > x + 12 && xs < x2 - 12) {
            ctx.beginPath();
            ctx.moveTo(xs + 0.5, musTop + 16);
            ctx.lineTo(xs + 0.5, musTop + MUS_H - 22);
            ctx.stroke();
          }
          ts += durPista;
        }
        ctx.setLineDash([]);
      }

      // asas de borde (estilo Camtasia): agarre para recortar/alargar
      if (editable && onRecortar && w >= 8) {
        const gw = Math.min(6, w / 4);
        const activo =
          arrastre?.modo === "recorte" &&
          arrastre.id === b.id &&
          arrastre.tipo === "musica";
        ctx.fillStyle = activo
          ? "#fbbf24"
          : sel
            ? "rgba(251,191,36,0.9)"
            : "rgba(255,255,255,0.55)";
        ctx.fillRect(x, musTop + 14, gw, MUS_H - 34);
        ctx.fillRect(x2 - gw, musTop + 14, gw, MUS_H - 34);
      }

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
          `${Math.round(b.fin - b.inicio)}s${
            pista && buclesDe(b, pista.durSec) > 1
              ? ` · bucle×${buclesDe(b, pista.durSec)}`
              : ""
          } · ${pista.bpm} BPM`,
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

    // ===== carril efectos (SFX) =====
    if (conSfx) {
      ctx.fillStyle = "#0a0a0c";
      ctx.fillRect(0, sfxTop, W, SFX_H);
      ctx.strokeStyle = "#27272a";
      ctx.beginPath();
      ctx.moveTo(0, sfxTop + 0.5);
      ctx.lineTo(W, sfxTop + 0.5);
      ctx.stroke();
      ctx.fillStyle = "#52525b";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText("EFECTOS", 6, sfxTop + 6);

      const clipsVisibles = (clipsSfx ?? []).map(conArrastreSfx);
      const yClip0 = sfxTop + 12;
      const hClip = SFX_H - 20;
      for (const c of clipsVisibles) {
        if (c.fin + c.fadeOutSeg < t0 || c.inicio > t1) continue;
        const def = sfxMap.get(c.sfxId);
        const color = colorCategoria(c.categoria);
        const x = xDe(c.inicio);
        const x2 = xDe(c.fin);
        const w = Math.max(2, x2 - x);
        const sel = selectedId === c.id;
        ctx.globalAlpha = c.muted ? 0.25 : 0.85;
        ctx.fillStyle = color;
        ctx.fillRect(x, yClip0, w, hClip);
        ctx.globalAlpha = c.muted ? 0.4 : 1;
        ctx.strokeStyle = sel ? "#ffffff" : color;
        ctx.lineWidth = sel ? 1.8 : 1;
        ctx.strokeRect(x + 0.5, yClip0 + 0.5, w - 1, hClip - 1);
        ctx.globalAlpha = 1;

        // costuras de bucle del archivo
        const durArch = def?.durSec ?? 0;
        if (durArch > 0.5 && w > 20 && durArch * pps > 14) {
          ctx.strokeStyle = "rgba(9,9,11,0.55)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          let ts = c.inicio + (durArch - (c.offsetOrigen % durArch));
          while (ts < c.fin - 0.1) {
            const xs = xDe(ts);
            if (xs > x + 8 && xs < x2 - 8) {
              ctx.beginPath();
              ctx.moveTo(xs + 0.5, yClip0 + 2);
              ctx.lineTo(xs + 0.5, yClip0 + hClip - 2);
              ctx.stroke();
            }
            ts += durArch;
          }
          ctx.setLineDash([]);
        }

        // asas de borde
        if (editable && onRecortarSfx && w >= 8) {
          const gw = Math.min(6, w / 4);
          const activo =
            arrastre?.modo === "recorte" &&
            arrastre.id === c.id &&
            arrastre.tipo === "sfx";
          ctx.fillStyle = activo
            ? "#fbbf24"
            : sel
              ? "rgba(251,191,36,0.9)"
              : "rgba(255,255,255,0.55)";
          ctx.fillRect(x, yClip0, gw, hClip);
          ctx.fillRect(x2 - gw, yClip0, gw, hClip);
        }

        // cuñas de fundido
        ctx.fillStyle = "rgba(9,9,11,0.55)";
        if (c.fadeInSeg > 0.05 && c.inicio >= t0) {
          const xf = Math.min(w, c.fadeInSeg * pps);
          ctx.beginPath();
          ctx.moveTo(x, yClip0);
          ctx.lineTo(x + xf, yClip0);
          ctx.lineTo(x, yClip0 + hClip - 4);
          ctx.closePath();
          ctx.fill();
        }
        if (c.fadeOutSeg > 0.05) {
          const xf = Math.min(w, c.fadeOutSeg * pps);
          ctx.beginPath();
          ctx.moveTo(x2, yClip0);
          ctx.lineTo(x2 - xf, yClip0);
          ctx.lineTo(x2, yClip0 + hClip - 4);
          ctx.closePath();
          ctx.fill();
        }

        // etiqueta: palabra + volumen (y bucles si alarga el archivo)
        if (w > 42) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 2, yClip0 + 2, w - 4, hClip - 4);
          ctx.clip();
          ctx.fillStyle = "#09090b";
          ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(
            c.palabra !== "(manual)" ? c.palabra : (def?.nombre ?? "efecto"),
            x + 5,
            yClip0 + 12
          );
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          ctx.fillText(
            `${c.volumenDb > 0 ? "+" : ""}${c.volumenDb}dB${
              durArch > 0.5 && buclesDeClip(c, durArch) > 1
                ? ` · bucle×${buclesDeClip(c, durArch)}`
                : ""
            }`,
            x + 5,
            yClip0 + hClip - 6
          );
          ctx.restore();
        }
        if (c.muted && w > 26) {
          ctx.fillStyle = "rgba(228,228,231,0.85)";
          ctx.font = "8px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText("MUTE", x + 5, yClip0 + hClip / 2 + 3);
        }
      }
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
    altoTotal,
    durationSec,
    vistaParaDibujo,
    analysis,
    silences,
    bloques,
    clipsSfx,
    conSfx,
    sfxTop,
    arrastre,
    pistaMap,
    sfxMap,
    selectedId,
    nivelDb,
    duckDb,
    hopSec,
    playheadSec,
    hover,
    conArrastre,
    conArrastreSfx,
    editable,
    onRecortar,
    onRecortarSfx,
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
      const lista = bloques.map(conArrastre);
      return (
        lista.find((b) => t >= b.inicio && t <= b.fin) ??
        lista.find((b) => t >= b.inicio - 0.3 && t <= b.fin + 0.3) ??
        null
      );
    },
    [vistaEfectiva, bloques, conArrastre]
  );

  /** ¿El puntero está sobre el borde (asas) de un bloque de música? */
  const hitBorde = useCallback(
    (x: number, y: number): { id: string; lado: LadoRecorte } | null => {
      if (!editable || !onRecortar) return null;
      const musTop = RULER_H + NARR_H;
      if (y < musTop + 14 || y > musTop + MUS_H - 20) return null;
      const { start: t0, pps } = vistaEfectiva;
      const t = t0 + x / pps;
      const umbral = clamp(EDGE_PX / pps, 0.12, 1.2);
      let mejor: { id: string; lado: LadoRecorte } | null = null;
      let mejorDt = Infinity;
      for (const b of bloques) {
        for (const lado of ["inicio", "fin"] as const) {
          const borde = lado === "inicio" ? b.inicio : b.fin;
          const dt = Math.abs(t - borde);
          if (dt < umbral && dt < mejorDt) {
            mejor = { id: b.id, lado };
            mejorDt = dt;
          }
        }
      }
      return mejor;
    },
    [editable, onRecortar, vistaEfectiva, bloques]
  );

  const hitClipSfx = useCallback(
    (x: number, y: number): SfxClip | null => {
      if (!conSfx) return null;
      const y0 = sfxTop + 12;
      if (y < y0 || y > sfxTop + SFX_H - 8) return null;
      const { start: t0, pps } = vistaEfectiva;
      const t = t0 + x / pps;
      const lista = (clipsSfx ?? []).map(conArrastreSfx);
      return (
        lista.find((c) => t >= c.inicio && t <= c.fin) ??
        lista.find((c) => t >= c.inicio - 0.15 && t <= c.fin + 0.15) ??
        null
      );
    },
    [conSfx, sfxTop, vistaEfectiva, clipsSfx, conArrastreSfx]
  );

  /** ¿El puntero está sobre el borde (asas) de un clip de SFX? */
  const hitBordeSfx = useCallback(
    (x: number, y: number): { id: string; lado: LadoRecorte } | null => {
      if (!editable || !onRecortarSfx || !conSfx) return null;
      const y0 = sfxTop + 12;
      if (y < y0 || y > sfxTop + SFX_H - 8) return null;
      const { start: t0, pps } = vistaEfectiva;
      const t = t0 + x / pps;
      const umbral = clamp(EDGE_PX / pps, 0.1, 1.0);
      let mejor: { id: string; lado: LadoRecorte } | null = null;
      let mejorDt = Infinity;
      for (const c of clipsSfx ?? []) {
        for (const lado of ["inicio", "fin"] as const) {
          const borde = lado === "inicio" ? c.inicio : c.fin;
          const dt = Math.abs(t - borde);
          if (dt < umbral && dt < mejorDt) {
            mejor = { id: c.id, lado };
            mejorDt = dt;
          }
        }
      }
      return mejor;
    },
    [editable, onRecortarSfx, conSfx, sfxTop, vistaEfectiva, clipsSfx]
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

    // arrastre (solo editable): primero los BORDES (recorte estilo Camtasia)
    // y luego el cuerpo (mover), en el carril de música y en el de efectos
    if (editable) {
      const bordeSfx = hitBordeSfx(x, y);
      if (bordeSfx) {
        const c = (clipsSfx ?? []).find((x2) => x2.id === bordeSfx.id);
        if (c) {
          onSelect?.(c.id);
          enArrastre.current = true;
          setArrastre({
            modo: "recorte",
            tipo: "sfx",
            id: c.id,
            lado: bordeSfx.lado,
            valorOriginal:
              bordeSfx.lado === "inicio" ? c.inicio : c.fin,
            valor: bordeSfx.lado === "inicio" ? c.inicio : c.fin,
          });
          pressRef.current = { x, y, t, tiempo: performance.now() };
          ponerCursor("ew-resize");
          return;
        }
      }
      const borde = hitBorde(x, y);
      if (borde) {
        const b = bloques.find((x2) => x2.id === borde.id);
        if (b) {
          onSelect?.(b.id);
          enArrastre.current = true;
          setArrastre({
            modo: "recorte",
            tipo: "musica",
            id: b.id,
            lado: borde.lado,
            valorOriginal: borde.lado === "inicio" ? b.inicio : b.fin,
            valor: borde.lado === "inicio" ? b.inicio : b.fin,
          });
          pressRef.current = { x, y, t, tiempo: performance.now() };
          ponerCursor("ew-resize");
          return;
        }
      }
      const c = hitClipSfx(x, y);
      if (c) {
        onSelect?.(c.id);
        enArrastre.current = true;
        setArrastre({
          modo: "mover",
          tipo: "sfx",
          id: c.id,
          inicioOriginal: c.inicio,
          deltaSec: 0,
        });
        pressRef.current = { x, y, t, tiempo: performance.now() };
        ponerCursor("grabbing");
        return;
      }
      const b = hitBloque(x, y);
      if (b) {
        onSelect?.(b.id);
        enArrastre.current = true;
        setArrastre({
          modo: "mover",
          tipo: "musica",
          id: b.id,
          inicioOriginal: b.inicio,
          deltaSec: 0,
        });
        pressRef.current = { x, y, t, tiempo: performance.now() };
        ponerCursor("grabbing");
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

    // cursor según la zona (borde = recorte, cuerpo = mover)
    if (!enArrastre.current && !panRef.current) {
      if (editable) {
        const borde = hitBordeSfx(x, y) ?? hitBorde(x, y);
        ponerCursor(
          borde
            ? "ew-resize"
            : hitClipSfx(x, y) || hitBloque(x, y)
              ? "grab"
              : "crosshair"
        );
      } else {
        ponerCursor("crosshair");
      }
    }

    if (panRef.current) {
      const dt = (x - panRef.current.x) / pps;
      setVista(clampVista({ pps, start: panRef.current.start - dt }));
      return;
    }

    if (enArrastre.current && arrastre) {
      if (arrastre.modo === "recorte") {
        setArrastre({ ...arrastre, valor: t });
      } else {
        const delta = (x - (pressRef.current?.x ?? x)) / pps;
        setArrastre({ ...arrastre, deltaSec: Math.round(delta * 10) / 10 });
      }
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
      enArrastre.current = false;
      setArrastre(null);
      pressRef.current = null;
      ponerCursor("crosshair");
      if (arrastre.modo === "recorte") {
        const movio =
          Math.abs(arrastre.valor - arrastre.valorOriginal) > 0.05;
        if (movio && editable) {
          if (arrastre.tipo === "sfx") {
            if (onRecortarSfx)
              onRecortarSfx(arrastre.id, arrastre.lado, arrastre.valor);
          } else if (onRecortar) {
            onRecortar(arrastre.id, arrastre.lado, arrastre.valor);
          }
        } else if (!movio) {
          // clic simple sobre el asa → saltar al inicio del bloque/clip
          if (arrastre.tipo === "sfx") {
            const c = (clipsSfx ?? []).find((x2) => x2.id === arrastre.id);
            if (c) onSeek(clamp(c.inicio, 0, durationSec));
          } else {
            const b = bloques.find((x2) => x2.id === arrastre.id);
            if (b) onSeek(clamp(b.inicio, 0, durationSec));
          }
        }
        return;
      }
      const dur = arrastre.deltaSec;
      const movio = Math.abs(dur) > 0.05;
      const nuevoInicio = arrastre.inicioOriginal + dur;
      if (movio && editable) {
        if (arrastre.tipo === "sfx") {
          if (onMoverSfx)
            onMoverSfx(arrastre.id, Math.round(nuevoInicio * 10) / 10);
        } else if (onMover) {
          onMover(arrastre.id, Math.round(nuevoInicio * 10) / 10);
        }
      } else if (!movio) {
        // clic simple sobre el bloque/clip → seek a su inicio
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
        const c = hitClipSfx(x, e.clientY - rect.top);
        if (!b && !c) {
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
            ? "arrastra un bloque o clip para moverlo; sus BORDES, para recortarlo o alargarlo"
            : "clic en la voz = saltar"}
        </span>
        <span className="md:hidden text-[10px] text-zinc-500">
          Rueda = zoom · bordes = recortar/alargar
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
        style={{ height: altoTotal }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHover(null);
          ponerCursor("crosshair");
        }}
        aria-label="Línea de tiempo de la mezcla: narración arriba, bloques de música y clips de efectos abajo"
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
        <span>┊ punteadas = el archivo reinicia (bucle)</span>
        {conSfx && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-orange-400" />{" "}
            pista de efectos
          </span>
        )}
      </div>
    </div>
  );
}
