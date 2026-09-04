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
import { CheckCircle2, Lock, RotateCcw } from "lucide-react";

export interface Fase2GateProps {
  approved: boolean;
  escenas: number;
  corregidas: number;
  /** 0-100 redondeado */
  tensionMedia: number;
  /** máximo de tension */
  picoTension: number;
  onApprove: () => void;
  onReopen: () => void;
  onRehacer: () => void;
}

/**
 * Puerta de auditoría obligatoria de la Fase 2: la gestión de música (Fase 3)
 * no se desbloquea sin un clic explícito de aprobación de la curva de tensión.
 */
export function Fase2Gate(props: Fase2GateProps) {
  const {
    approved,
    escenas,
    corregidas,
    tensionMedia,
    picoTension,
    onApprove,
    onReopen,
    onRehacer,
  } = props;
  const [checked, setChecked] = useState(false);

  if (approved) {
    return (
      <Card className="border-emerald-800/60 bg-emerald-950/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            Fase 2 aprobada
          </CardTitle>
          <CardDescription className="text-emerald-200/70">
            La curva de tensión queda como base de la mezcla automática. Di
            «Apruebo la Fase 2, continúa» para que se desarrolle la Fase 3.
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-wrap gap-2 pt-2">
          <Button variant="outline" size="sm" className="h-9" onClick={onReopen}>
            <RotateCcw className="me-1 h-3.5 w-3.5" />
            Volver a editar la curva
          </Button>
          <Button variant="ghost" size="sm" className="h-9" onClick={onRehacer}>
            Rehacer análisis
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
          Puerta de auditoría · Fase 2
          <Badge
            variant="outline"
            className="border-amber-700/50 text-[11px] text-amber-300"
          >
            bloquea la Fase 3
          </Badge>
        </CardTitle>
        <CardDescription className="text-amber-100/70">
          ¿La curva de tensión y la transcripción son correctas? Arrastra los
          puntos o edita la tabla para corregir y aprueba para desbloquear la
          gestión de música.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-800/40 bg-amber-950/30 p-3 text-sm text-amber-100/90">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            className="mt-0.5 data-[state=checked]:border-amber-400 data-[state=checked]:bg-amber-400 data-[state=checked]:text-zinc-900"
            aria-label="Confirmar revisión de la curva de tensión"
          />
          <span className="leading-snug">
            He revisado las <strong>{escenas}</strong> escenas (tensión media{" "}
            <strong>{tensionMedia}</strong>, pico <strong>{picoTension}</strong>
            , <strong>{corregidas}</strong> corregidas a mano) y doy fe de que
            el mapa dramático es correcto.
          </span>
        </label>
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <Button
          className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          disabled={!checked}
          onClick={onApprove}
        >
          <CheckCircle2 className="me-1 h-4 w-4" />
          Aprobar curva de tensión y desbloquear la Fase 3
        </Button>
        <Button
          variant="ghost"
          className="text-zinc-400"
          onClick={onRehacer}
        >
          <RotateCcw className="me-1 h-4 w-4" />
          Volver a transcribir
        </Button>
      </CardFooter>
    </Card>
  );
}
