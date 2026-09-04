"use client";

/**
 * Guardar proyecto (estilo Camtasia): nombre + guardar en el servidor local
 * (db/proyectos, junto al audio y al análisis) o descargar el archivo
 * portable .bsproj.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Save,
  Download,
  Loader2,
  CopyPlus,
  HardDrive,
} from "lucide-react";
import { formatHace } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  nombreInicial: string;
  proyecto: { id: string; nombre: string; guardadoEn: number } | null;
  guardando: boolean;
  descargando: boolean;
  error: string | null;
  /** false mientras corre un análisis (no se puede serializar a medias) */
  puedeGuardar: boolean;
  onGuardar: (nombre: string, comoCopia: boolean) => void;
  onDescargar: (nombre: string) => void;
}

export function GuardarDialog({
  open,
  onOpenChange,
  nombreInicial,
  proyecto,
  guardando,
  descargando,
  error,
  puedeGuardar,
  onGuardar,
  onDescargar,
}: Props) {
  // el padre remonta el diálogo con `key` al abrirlo: el nombre se
  // pre-rellena como estado inicial (sin efectos)
  const [nombre, setNombre] = useState(
    () => proyecto?.nombre ?? nombreInicial
  );

  const valido = nombre.trim().length > 0 && !guardando && !descargando;

  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Save className="h-4 w-4 text-amber-400" />
            Guardar proyecto
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Como en Camtasia: guarda el proyecto con su audio, su análisis y
            las seis fases para volver más adelante y seguir modificándolo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proyecto-nombre" className="text-xs text-zinc-400">
              Nombre del proyecto
            </Label>
            <Input
              id="proyecto-nombre"
              className="h-9 text-sm"
              value={nombre}
              maxLength={80}
              placeholder="p. ej. La taberna del dragón — sesión 12"
              disabled={guardando || descargando}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          {!puedeGuardar && (
            <Alert className="border-amber-800/50 bg-amber-950/20 text-amber-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>Un momento…</AlertTitle>
              <AlertDescription>
                El análisis está en marcha: espera a que termine el bloque
                antes de guardar (así el proyecto queda completo).
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>No se pudo guardar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {proyecto && (
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <HardDrive className="h-3 w-3" aria-hidden />
              Guardado por última vez {formatHace(proyecto.guardadoEn)} ·{" "}
              <span className="truncate font-mono text-zinc-600">
                {proyecto.id}
              </span>
            </p>
          )}

          <div className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 text-[11px] leading-relaxed text-zinc-500">
            <p className="font-semibold text-zinc-400">Se guarda:</p>
            <p>
              El audio original, el análisis de la Fase 1 (sin re-analizar al
              reabrir), silencios y umbral, transcripción y curva de tensión
              con tus correcciones, pistas asignadas (incluida tu música
              propia), parámetros de mezcla, ediciones del timeline y las
              aprobaciones con sus fechas.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            className="w-full bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
            disabled={!valido || !puedeGuardar}
            onClick={() => onGuardar(nombre.trim(), false)}
          >
            {guardando ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="me-1 h-4 w-4" />
            )}
            {guardando
              ? "Guardando…"
              : proyecto
                ? "Guardar cambios"
                : "Guardar en este equipo"}
          </Button>
          {proyecto && (
            <Button
              variant="outline"
              className="w-full border-zinc-700 text-zinc-300"
              disabled={!valido || !puedeGuardar}
              onClick={() => onGuardar(nombre.trim(), true)}
            >
              <CopyPlus className="me-1 h-4 w-4" />
              Guardar como copia nueva
            </Button>
          )}
          <Button
            variant="secondary"
            className="w-full"
            disabled={!valido || descargando}
            onClick={() => onDescargar(nombre.trim())}
          >
            {descargando ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="me-1 h-4 w-4" />
            )}
            Descargar archivo .bsproj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
