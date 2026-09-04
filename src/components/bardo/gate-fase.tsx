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

export interface ItemResumen {
  etiqueta: string;
  valor: string;
}

interface GateFaseProps {
  fase: number;
  /** fase que desbloquea al aprobar (fase + 1 o «el informe final») */
  desbloqueaTexto: string;
  titulo: string;
  descripcionPendiente: string;
  descripcionAprobada: string;
  resumen: ItemResumen[];
  confirmacion: string;
  textoAprobar: string;
  approved: boolean;
  onApprove: () => void;
  onReopen: () => void;
  onRehacer?: () => void;
  rehacerLabel?: string;
  notaReabrir?: string;
}

/**
 * Puerta de auditoría genérica de las fases 3-6: la fase siguiente no se
 * desbloquea sin un clic explícito de aprobación (pipeline auditable).
 */
export function GateFase(props: GateFaseProps) {
  const {
    fase,
    desbloqueaTexto,
    titulo,
    descripcionPendiente,
    descripcionAprobada,
    resumen,
    confirmacion,
    textoAprobar,
    approved,
    onApprove,
    onReopen,
    onRehacer,
    rehacerLabel,
    notaReabrir,
  } = props;
  const [checked, setChecked] = useState(false);

  if (approved) {
    return (
      <Card className="border-emerald-800/60 bg-emerald-950/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            Fase {fase} aprobada · {titulo}
          </CardTitle>
          <CardDescription className="text-emerald-200/70">
            {descripcionAprobada}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-wrap gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              if (
                !notaReabrir ||
                window.confirm(
                  `${notaReabrir}\n\n¿Volver a editar la Fase ${fase}?`
                )
              ) {
                onReopen();
              }
            }}
          >
            <RotateCcw className="me-1 h-3.5 w-3.5" />
            Volver a editar
          </Button>
          {onRehacer && (
            <Button variant="ghost" size="sm" className="h-9" onClick={onRehacer}>
              {rehacerLabel ?? "Rehacer"}
            </Button>
          )}
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-amber-800/50 bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base text-amber-200">
          <Lock className="h-4 w-4" />
          Puerta de auditoría · Fase {fase}
          <Badge
            variant="outline"
            className="border-amber-700/50 text-[11px] text-amber-300"
          >
            {desbloqueaTexto}
          </Badge>
        </CardTitle>
        <CardDescription className="text-amber-100/70">
          {descripcionPendiente}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
          {resumen.map((r) => (
            <span key={r.etiqueta}>
              {r.etiqueta}:{" "}
              <strong className="text-zinc-200">{r.valor}</strong>
            </span>
          ))}
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-800/40 bg-amber-950/30 p-3 text-sm text-amber-100/90">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            className="mt-0.5 data-[state=checked]:border-amber-400 data-[state=checked]:bg-amber-400 data-[state=checked]:text-zinc-900"
            aria-label={`Confirmar revisión de la Fase ${fase}`}
          />
          <span className="leading-snug">{confirmacion}</span>
        </label>
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <Button
          className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          disabled={!checked}
          onClick={onApprove}
        >
          <CheckCircle2 className="me-1 h-4 w-4" />
          {textoAprobar}
        </Button>
        {onRehacer && (
          <Button variant="ghost" className="text-zinc-400" onClick={onRehacer}>
            <RotateCcw className="me-1 h-4 w-4" />
            {rehacerLabel ?? "Rehacer"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
