"use client";

import { Badge } from "@/components/ui/badge";
import {
  Upload,
  AudioLines,
  Sparkles,
  Music2,
  SlidersHorizontal,
  Scissors,
  FileDown,
  Lock,
  CheckCircle2,
} from "lucide-react";

export const PHASES = [
  {
    n: 1,
    title: "Ingestión y análisis",
    desc: "Forma de onda + silencios",
    icon: Upload,
  },
  {
    n: 2,
    title: "Transcripción y tensión",
    desc: "IA por bloques + curva",
    icon: AudioLines,
  },
  {
    n: 2.5,
    title: "Efectos de sonido",
    desc: "Palabras clave → SFX",
    icon: Sparkles,
  },
  {
    n: 3,
    title: "Gestión de música",
    desc: "Biblioteca CC0 por ánimo",
    icon: Music2,
  },
  {
    n: 4,
    title: "Mezcla automática",
    desc: "Ducking + crossfade",
    icon: SlidersHorizontal,
  },
  {
    n: 5,
    title: "Editor de mezcla",
    desc: "Cuchilla, SFX, medidores",
    icon: Scissors,
  },
  {
    n: 6,
    title: "Exportación y reporte",
    desc: "WAV + informe PDF",
    icon: FileDown,
  },
] as const;

/** Estado visual de cada fase en el stepper. */
export type StepStatus =
  | "locked"
  | "idle"
  | "running"
  | "review"
  | "approved";

/** Estados de las 7 fases, en orden (1, 2, 2.5, 3, 4, 5, 6). */
export type EstadosFases = [
  StepStatus,
  StepStatus,
  StepStatus,
  StepStatus,
  StepStatus,
  StepStatus,
  StepStatus,
];

interface PhaseStepperProps {
  statuses: EstadosFases;
}

export function PhaseStepper({ statuses }: PhaseStepperProps) {
  // una fase está bloqueada si la anterior no está aprobada
  const locked: boolean[] = statuses.map(
    (st, i) => i > 0 && statuses[i - 1] !== "approved"
  );
  // activa = primera no aprobada y no bloqueada
  const idxActiva = statuses.findIndex(
    (st, i) => st !== "approved" && !locked[i]
  );
  const todoAprobado = statuses.every((st) => st === "approved");

  return (
    <nav aria-label="Progreso del pipeline" className="w-full">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {PHASES.map((p, i) => {
          const st = statuses[i];
          const ok = st === "approved";
          const active = i === idxActiva && !todoAprobado;
          const running = st === "running" || st === "review";
          const idle = st === "idle" && !locked[i];
          const Icon = p.icon;
          return (
            <li
              key={p.n}
              className={[
                "flex items-center gap-2.5 rounded-lg border p-2.5",
                active || running
                  ? "border-amber-600/60 bg-amber-950/30"
                  : ok
                    ? "border-emerald-800/50 bg-emerald-950/20"
                    : idle
                      ? "border-amber-700/40 bg-zinc-900/40"
                      : "border-zinc-800/80 bg-zinc-900/40 opacity-70",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  active || running
                    ? "bg-amber-500/20 text-amber-300"
                    : ok
                      ? "bg-emerald-500/15 text-emerald-300"
                      : idle
                        ? "bg-amber-900/30 text-amber-300/70"
                        : "bg-zinc-800 text-zinc-500",
                ].join(" ")}
              >
                {ok ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : locked[i] ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Icon
                    className={st === "running" ? "h-4 w-4 animate-pulse" : "h-4 w-4"}
                  />
                )}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-zinc-200">
                  Fase {p.n}
                  {(active || running) && (
                    <Badge className="h-4 bg-amber-500 px-1 text-[9px] font-bold text-zinc-950">
                      ACTIVA
                    </Badge>
                  )}
                </p>
                <p className="truncate text-[10px] text-zinc-500">{p.title}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
