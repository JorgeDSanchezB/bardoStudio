"use client";

import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  Square,
  Rewind,
  FastForward,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { formatTimecode } from "@/lib/format";
import type { SilenceRegion } from "@/lib/audio/silence";

interface TransportBarProps {
  playing: boolean;
  playheadSec: number;
  durationSec: number;
  sourceReady: boolean;
  silences: SilenceRegion[];
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (t: number) => void;
}

export function TransportBar(props: TransportBarProps) {
  const {
    playing,
    playheadSec,
    durationSec,
    sourceReady,
    silences,
    onTogglePlay,
    onStop,
    onSeek,
  } = props;

  const jump = (t: number) => {
    const tt = Math.max(0, Math.min(durationSec, t));
    onSeek(tt);
  };

  const jumpSilence = (dir: "next" | "prev") => {
    if (silences.length === 0) return;
    if (dir === "next") {
      const next = silences.find((s) => s.start > playheadSec + 0.25);
      jump(next ? next.start : playheadSec);
    } else {
      const prev = [...silences]
        .reverse()
        .find((s) => s.start < playheadSec - 0.25);
      jump(prev ? prev.start : 0);
    }
  };

  const btn =
    "h-11 w-11 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        onClick={onTogglePlay}
        disabled={!sourceReady}
        className="h-12 w-12 rounded-full bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
        aria-label={playing ? "Pausar (espacio)" : "Reproducir (espacio)"}
      >
        {playing ? (
          <Pause className="h-5 w-5" />
        ) : (
          <Play className="ms-0.5 h-5 w-5" />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={btn}
        onClick={onStop}
        disabled={!sourceReady}
        aria-label="Detener"
      >
        <Square className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={btn}
        onClick={() => jump(playheadSec - 5)}
        aria-label="Retroceder 5 segundos"
      >
        <Rewind className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={btn}
        onClick={() => jump(playheadSec + 5)}
        aria-label="Avanzar 5 segundos"
      >
        <FastForward className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={btn}
        onClick={() => jumpSilence("prev")}
        aria-label="Silencio anterior"
        title="Saltar al silencio anterior"
      >
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className={btn}
        onClick={() => jumpSilence("next")}
        aria-label="Silencio siguiente"
        title="Saltar al siguiente silencio"
      >
        <SkipForward className="h-4 w-4" />
      </Button>

      <div className="ms-auto flex flex-col items-end">
        <span className="font-mono text-base font-semibold tabular-nums text-amber-300 sm:text-lg">
          {formatTimecode(playheadSec)}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-zinc-500">
          / {formatTimecode(durationSec)}
        </span>
      </div>
    </div>
  );
}
