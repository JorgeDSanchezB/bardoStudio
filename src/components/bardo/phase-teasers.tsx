"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, AudioLines, RefreshCw, FileAudio } from "lucide-react";

export function Phase2Teaser() {
  return (
    <Card className="border-zinc-800/80 bg-zinc-900/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-300">
          <Lock className="h-4 w-4 text-zinc-500" />
          Fase 2 · Transcripción y curva de tensión — en espera
        </CardTitle>
        <CardDescription className="text-zinc-500">
          Se desarrollará cuando apruebes la Fase 1.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pb-4 text-xs leading-relaxed text-zinc-500">
        <p className="flex items-start gap-2">
          <AudioLines className="mt-0.5 h-4 w-4 shrink-0 text-amber-500/70" />
          Whisper local por bloques de 5 min (sin subir nada a la nube) con
          opción configurable de API en la nube, análisis de sentimiento por
          frase y curva de tensión 0–100 con puntos arrastrables.
        </p>
      </CardContent>
    </Card>
  );
}

export function RestoreCard({
  onReanalyze,
}: {
  onReanalyze: () => void;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-950/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-300">
          <RefreshCw className="h-4 w-4 text-amber-400" />
          Análisis no disponible tras recargar
        </CardTitle>
        <CardDescription>
          Los picos de la forma de onda no estaban en el caché local (IndexedDB).
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <Button variant="secondary" size="sm" className="h-9" onClick={onReanalyze}>
          <FileAudio className="me-1 h-4 w-4" />
          Re-seleccionar el archivo y analizar
        </Button>
      </CardContent>
    </Card>
  );
}
