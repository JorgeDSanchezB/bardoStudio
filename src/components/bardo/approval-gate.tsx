"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Lock, RotateCcw, AlertTriangle } from "lucide-react";

interface ApprovalGateProps {
  approved: boolean;
  silences: number;
  durationLabel: string;
  onApprove: () => void;
  onReopen: () => void;
  onReanalyze: () => void;
}

/**
 * Gate de auditoría obligatorio de la Fase 1: el programa NO avanza a la
 * Fase 2 sin un clic explícito de aprobación.
 */
export function ApprovalGate(props: ApprovalGateProps) {
  const { approved, silences, durationLabel, onApprove, onReopen, onReanalyze } =
    props;
  const [checked, setChecked] = useState(false);

  if (approved) {
    return (
      <Card className="border-emerald-800/60 bg-emerald-950/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            Fase 1 aprobada
          </CardTitle>
          <CardDescription className="text-emerald-200/70">
            El mapa de {silences} silencios queda como base de la transcripción
            (Fase 2). Di «Apruebo la Fase 1, continúa» para que desarrolle la
            siguiente fase.
          </CardDescription>
        </CardHeader>
        <CardFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" className="h-9" onClick={onReopen}>
            <RotateCcw className="me-1 h-3.5 w-3.5" />
            Volver a editar la Fase 1
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-amber-800/50 bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base text-amber-200">
          <Lock className="h-4 w-4" />
          Puerta de auditoría · Fase 1
          <Badge variant="outline" className="border-amber-700/50 text-[11px] text-amber-300">
            bloquea la Fase 2
          </Badge>
        </CardTitle>
        <CardDescription className="text-amber-100/70">
          ¿Los silencios detectados son correctos? Escucha cada pausa con los
          botones de salto, ajusta los umbrales si hace falta y aprueba para
          desbloquear la transcripción.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-800/40 bg-amber-950/30 p-3 text-sm text-amber-100/90">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            className="mt-0.5 data-[state=checked]:border-amber-400 data-[state=checked]:bg-amber-400 data-[state=checked]:text-zinc-900"
            aria-label="Confirmar revisión de silencios"
          />
          <span className="leading-snug">
            He revisado la forma de onda y los <strong>{silences}</strong>{" "}
            silencios sobre <strong>{durationLabel}</strong> de narración y doy
            fe de que el mapa de pausas es correcto.
          </span>
        </label>
        {silences === 0 && (
          <p className="mt-2 flex items-center gap-2 text-[11px] text-amber-300/80">
            <AlertTriangle className="h-3.5 w-3.5" />
            Con 0 silencios la Fase 2 no tendrá pausas de referencia: revisa el
            umbral antes de aprobar.
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          disabled={!checked}
          onClick={onApprove}
        >
          <CheckCircle2 className="me-1 h-4 w-4" />
          Aprobar silencios y desbloquear la Fase 2
        </Button>
        <Button
          variant="ghost"
          className="text-zinc-400"
          onClick={onReanalyze}
        >
          <RotateCcw className="me-1 h-4 w-4" />
          Volver a analizar
        </Button>
      </CardFooter>
    </Card>
  );
}
