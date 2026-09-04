"use client";

import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Rewind,
  FastForward,
} from "lucide-react";
import { formatTimecode } from "@/lib/format";

interface TransportMezclaProps {
  reproduciendo: boolean;
  listo: boolean;
  cargando: boolean;
  posicionSec: number;
  duracionSec: number;
  onToggle: () => void;
  onStop: () => void;
  onSeekRel: (delta: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

/** Transporte del editor de mezcla (Fase 5), estilo DAW. */
export function TransportMezcla(props: TransportMezclaProps) {
  const {
    reproduciendo,
    listo,
    cargando,
    posicionSec,
    duracionSec,
    onToggle,
    onStop,
    onSeekRel,
    onPrev,
    onNext,
  } = props;

  const btn =
    "h-10 w-10 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-40";

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="toolbar"
      aria-label="Transporte de la mezcla"
    >
      <Button
        size="icon"
        className={btn}
        aria-label="Bloque anterior"
        disabled={!listo}
        onClick={onPrev}
      >
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        className={btn}
        aria-label="Retroceder 5 s"
        disabled={!listo}
        onClick={() => onSeekRel(-5)}
      >
        <Rewind className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        className="h-12 w-12 rounded-full bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
        aria-label={reproduciendo ? "Pausar la mezcla" : "Reproducir la mezcla"}
        disabled={!listo || cargando}
        onClick={onToggle}
      >
        {reproduciendo ? (
          <Pause className="h-5 w-5" />
        ) : cargando ? (
          <Play className="h-5 w-5 animate-pulse" />
        ) : (
          <Play className="h-5 w-5" />
        )}
      </Button>
      <Button
        size="icon"
        className={btn}
        aria-label="Avanzar 5 s"
        disabled={!listo}
        onClick={() => onSeekRel(5)}
      >
        <FastForward className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        className={btn}
        aria-label="Bloque siguiente"
        disabled={!listo}
        onClick={onNext}
      >
        <SkipForward className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        className={btn}
        aria-label="Detener"
        disabled={!listo}
        onClick={onStop}
      >
        <Square className="h-4 w-4" />
      </Button>

      <div className="ms-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5">
        <span className="font-mono text-sm tabular-nums text-amber-200">
          {formatTimecode(posicionSec)}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">
          {" "}
          / {formatTimecode(duracionSec)}
        </span>
      </div>
      <p className="w-full text-[10px] text-zinc-500 sm:w-auto">
        Barra espaciadora = reproducir/pausar · la mezcla se oye en vivo (voz +
        música con ducking)
      </p>
    </div>
  );
}
