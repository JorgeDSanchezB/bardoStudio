"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import type { Thresholds } from "@/store/project";
import { formatDurSmart } from "@/lib/format";

interface ThresholdPanelProps {
  thresholds: Thresholds;
  defaults: Thresholds;
  onChange: (t: Partial<Thresholds>) => void;
  silences: number;
  totalSilenceSec: number;
  speechRatio: number;
  durationSec: number;
}

export function ThresholdPanel(props: ThresholdPanelProps) {
  const {
    thresholds,
    defaults,
    onChange,
    silences,
    totalSilenceSec,
    speechRatio,
    durationSec,
  } = props;

  // Sliders totalmente controlados por el store: la re-detección es O(n)
  // sobre la envolvente ya calculada (<1 ms incluso con 3 h de audio).
  const pctVoice = Math.round(speechRatio * 100);

  return (
    <Card className="border-zinc-800 bg-zinc-950/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Umbral de silencios</CardTitle>
        <CardDescription>
          Ajusta y observa cómo cambian los bloques rosados en la línea de
          tiempo. La re-detección es instantánea.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pb-4">
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <label
              htmlFor="umbral-db"
              className="text-xs font-medium text-zinc-300"
            >
              Nivel de audio (dBFS)
            </label>
            <span className="font-mono text-sm text-amber-300">
              {thresholds.dbThreshold} dB
            </span>
          </div>
          <Slider
            id="umbral-db"
            value={[thresholds.dbThreshold]}
            min={-60}
            max={-15}
            step={1}
            onValueChange={(v) => onChange({ dbThreshold: v[0] })}
            aria-label="Umbral de silencio en decibelios"
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            Ventanas por debajo de este nivel cuentan como pausa. Sube el
            valor si tu narración tiene ruido de fondo (micrófono USB ≈ −30 a
            −34 dB).
          </p>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <label
              htmlFor="dur-min"
              className="text-xs font-medium text-zinc-300"
            >
              Duración mínima de pausa
            </label>
            <span className="font-mono text-sm text-amber-300">
              {thresholds.minDurationSec.toFixed(1)} s
            </span>
          </div>
          <Slider
            id="dur-min"
            value={[thresholds.minDurationSec]}
            min={0.5}
            max={8}
            step={0.5}
            onValueChange={(v) => onChange({ minDurationSec: v[0] })}
            aria-label="Duración mínima del silencio en segundos"
          />
          <p className="text-[11px] leading-snug text-zinc-500">
            El caso D&amp;D/audiolibros usa 2.0 s por defecto (viene de{" "}
            <code className="text-[10px]">config/config.json</code>).
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-zinc-800/70 pt-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              Silencios
            </p>
            <p className="font-mono text-lg text-rose-300">{silences}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              Tiempo mudo
            </p>
            <p className="font-mono text-lg text-zinc-200">
              {formatDurSmart(totalSilenceSec)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              Narración
            </p>
            <p className="font-mono text-lg text-emerald-300">{pctVoice}%</p>
          </div>
        </div>
        <p className="text-[11px] text-zinc-500">
          {silences} pausas sobre {formatDurSmart(durationSec)} de audio.
        </p>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-[11px] text-zinc-400"
          onClick={() =>
            onChange({
              dbThreshold: defaults.dbThreshold,
              minDurationSec: defaults.minDurationSec,
            })
          }
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restablecer umbrales de config.json
        </Button>
      </CardContent>
    </Card>
  );
}
