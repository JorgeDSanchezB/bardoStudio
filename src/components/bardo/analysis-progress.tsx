"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { WaveformTimeline } from "./waveform-timeline";
import { XCircle, Cpu, Blocks } from "lucide-react";
import { formatBytes, formatTimecode, formatDurSmart } from "@/lib/format";
import type { AnalysisData } from "@/store/project";
import type { ProgressInfo } from "@/lib/audio/types";

interface AnalysisProgressProps {
  fileName: string;
  progress: ProgressInfo;
  analysis: AnalysisData | null;
  onCancel: () => void;
}

export function AnalysisProgress({
  fileName,
  progress,
  analysis,
  onCancel,
}: AnalysisProgressProps) {
  const pct =
    progress.totalSec && progress.totalSec > 0
      ? Math.min(99, Math.round((progress.doneSec / progress.totalSec) * 100))
      : 8;
  const dur = analysis?.durationSec ?? 0;

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-950/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            Analizando «{fileName}» por bloques
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-4">
          <Progress
            value={pct}
            className="h-2 bg-zinc-800 [&>div]:bg-amber-400"
            aria-label="Progreso del análisis"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
                <Blocks className="h-3 w-3" /> Bloque
              </p>
              <p className="font-mono text-sm text-zinc-200">
                {progress.chunkIndex}
                {progress.totalChunks ? ` / ${progress.totalChunks}` : " / ?"}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                Procesado
              </p>
              <p className="font-mono text-sm text-zinc-200">
                {formatTimecode(progress.doneSec)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                Total{" "}
                {progress.totalSec ? "" : "(estimado)"}
              </p>
              <p className="font-mono text-sm text-zinc-200">
                {progress.totalSec
                  ? formatDurSmart(progress.totalSec)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-500">
                <Cpu className="h-3 w-3" /> RAM/bloque
              </p>
              <p className="font-mono text-sm text-emerald-300">
                ≈ {formatBytes(progress.ramBytes)}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-zinc-500">
              Bloques de {progress.chunkSeconds.toFixed(0)} s · el archivo se
              lee de forma secuencial, nunca completo en memoria.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 text-[11px] text-zinc-400"
              onClick={onCancel}
            >
              <XCircle className="h-3.5 w-3.5" />
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-400">
            Vista previa en vivo (crece con cada bloque)
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <WaveformTimeline
            analysis={analysis}
            silences={[]}
            durationSec={dur}
            playheadSec={0}
            playing={false}
            thresholdDb={-100}
            onSeek={() => undefined}
            compact
          />
        </CardContent>
      </Card>
    </div>
  );
}
