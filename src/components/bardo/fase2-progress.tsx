"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, X } from "lucide-react";
import type { Fase2Etapa, Fase2Progreso } from "@/lib/fase2/types";
import { clamp, formatDurSmart, formatTimecode } from "@/lib/format";

export interface Fase2ProgressProps {
  progreso: Fase2Progreso;
  /** frases ya hechas al reanudar la ejecución */
  reanudadas: number;
  duracionTotalSec: number;
  onCancel: () => void;
}

const ETAPA_ETIQUETAS: Record<Fase2Etapa, string> = {
  preparando: "Preparando",
  transcribiendo: "Transcribiendo",
  analizando: "Analizando tensión",
  completado: "Completando",
};

export function Fase2Progress(props: Fase2ProgressProps) {
  const { progreso, reanudadas, duracionTotalSec, onCancel } = props;

  const total = Math.max(1, progreso.totalBloques);
  let pct: number;
  switch (progreso.etapa) {
    case "preparando":
      pct = 2;
      break;
    case "transcribiendo":
      pct = clamp(Math.round(((progreso.bloque - 1) / total) * 100), 0, 88);
      break;
    case "analizando":
      pct = 90;
      break;
    case "completado":
    default:
      pct = 96;
      break;
  }

  return (
    <Card className="border-zinc-800 bg-zinc-950/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          Fase 2 en curso
          <Badge
            variant="secondary"
            className="font-mono text-[11px] text-amber-200"
          >
            {ETAPA_ETIQUETAS[progreso.etapa]}
          </Badge>
          {reanudadas > 0 && (
            <Badge
              variant="outline"
              className="border-amber-700/50 text-[11px] text-amber-300"
            >
              reanudado · {reanudadas} frases ya listas
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        <Progress
          value={pct}
          className="h-2 bg-zinc-800 [&>div]:bg-amber-400"
          aria-label="Progreso de la Fase 2"
        />
        <p className="font-mono text-xs text-zinc-300">
          Bloque {progreso.bloque} de {progreso.totalBloques} ·{" "}
          {formatTimecode(progreso.subInicio)} → {formatTimecode(progreso.subFin)}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              Frases acumuladas
            </p>
            <p className="font-mono text-sm text-zinc-200">{progreso.frases}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              Duración total
            </p>
            <p className="font-mono text-sm text-zinc-200">
              {formatDurSmart(duracionTotalSec)}
            </p>
          </div>
        </div>
        {progreso.mensaje && (
          <p className="text-[11px] text-zinc-500">{progreso.mensaje}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-500">
            Cada bloque queda guardado: si cancelas o recargas, la transcripción
            se reanuda sin repetir llamadas.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1 border-red-900/60 text-red-300 hover:bg-red-950/40 hover:text-red-200"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
            Cancelar (se guarda el progreso)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
