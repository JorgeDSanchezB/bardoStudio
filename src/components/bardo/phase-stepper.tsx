"use client";

import { Badge } from "@/components/ui/badge";
import {
  Upload,
  AudioLines,
  Music2,
  SlidersHorizontal,
  Scissors,
  FileDown,
  Lock,
  CheckCircle2,
} from "lucide-react";
import type { Phase1Status } from "@/store/project";

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
    desc: "Whisper por bloques + curva",
    icon: AudioLines,
  },
  {
    n: 3,
    title: "Gestión de música",
    desc: "CC0 automática por mood",
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
    title: "Editor tipo Camtasia",
    desc: "Cuchilla, arrastre, marcadores",
    icon: Scissors,
  },
  {
    n: 6,
    title: "Exportación y reporte",
    desc: "MP3/WAV + informe PDF",
    icon: FileDown,
  },
] as const;

/** Estado visual de la Fase 2 en el stepper. "locked" por defecto (compat). */
export type Phase2StepperStatus =
  | "locked"
  | "idle"
  | "running"
  | "review"
  | "approved";

interface PhaseStepperProps {
  phase1Status: Phase1Status;
  phase2Status?: Phase2StepperStatus;
}

export function PhaseStepper({
  phase1Status,
  phase2Status = "locked",
}: PhaseStepperProps) {
  const done = phase1Status === "approved";
  return (
    <nav aria-label="Progreso del pipeline" className="w-full">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PHASES.map((p) => {
          const active = p.n === 1 && !done;
          const ok = (p.n === 1 && done) || (p.n === 2 && phase2Status === "approved");
          const f2 =
            p.n === 2 && phase2Status !== "locked"
              ? phase2Status
              : null;
          const f2Running = f2 === "running" || f2 === "review";
          const f2Idle = f2 === "idle";
          const locked = p.n > 1 && (p.n !== 2 || phase2Status === "locked");
          const Icon = p.icon;
          return (
            <li
              key={p.n}
              className={[
                "flex items-center gap-2.5 rounded-lg border p-2.5",
                active
                  ? "border-amber-600/60 bg-amber-950/30"
                  : ok
                    ? "border-emerald-800/50 bg-emerald-950/20"
                    : f2Running
                      ? "border-amber-600/60 bg-amber-950/30"
                      : f2Idle
                        ? "border-amber-700/40 bg-zinc-900/40"
                        : "border-zinc-800/80 bg-zinc-900/40 opacity-70",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                  active
                    ? "bg-amber-500/20 text-amber-300"
                    : ok
                      ? "bg-emerald-500/15 text-emerald-300"
                      : f2Running
                        ? "bg-amber-500/20 text-amber-300"
                        : f2Idle
                          ? "bg-amber-900/30 text-amber-300/70"
                          : "bg-zinc-800 text-zinc-500",
                ].join(" ")}
              >
                {ok ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : locked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Icon
                    className={
                      f2 === "running" ? "h-4 w-4 animate-pulse" : "h-4 w-4"
                    }
                  />
                )}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-zinc-200">
                  Fase {p.n}
                  {(active || f2Running) && (
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
