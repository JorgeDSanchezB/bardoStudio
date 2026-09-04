"use client";

/**
 * Proyectos guardados (estilo Camtasia): lista los proyectos del servidor
 * local (db/proyectos) para reabrirlos, permite importar un .bsproj
 * descargado antes y empezar un proyecto nuevo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FolderOpen,
  Trash2,
  Loader2,
  FilePlus2,
  Upload,
  Music2,
  AlertTriangle,
} from "lucide-react";
import type { ProyectoResumen } from "@/lib/proyecto/tipos";
import { formatBytes, formatDurSmart, formatHace } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** abre un proyecto del servidor local */
  onAbrir: (id: string) => void;
  /** importa un archivo .bsproj descargado antes */
  onImportar: (file: File) => void;
  /** proyecto nuevo (descarta el trabajo en curso tras confirmar) */
  onNuevo: () => void;
}

export function ProyectosDialog({
  open,
  onOpenChange,
  onAbrir,
  onImportar,
  onNuevo,
}: Props) {
  const [cargando, setCargando] = useState(false);
  const [proyectos, setProyectos] = useState<ProyectoResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abriendoId, setAbriendoId] = useState<string | null>(null);
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/proyectos");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { proyectos?: ProyectoResumen[] };
      setProyectos(Array.isArray(data.proyectos) ? data.proyectos : []);
    } catch {
      setError(
        "No se pudo leer la lista de proyectos del servidor local (/api/proyectos)."
      );
      setProyectos([]);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (open) void cargar();
  }, [open, cargar]);

  const borrar = async (p: ProyectoResumen) => {
    if (
      !window.confirm(
        `¿Eliminar el proyecto «${p.nombre}»? Se borran su estado, su audio y su análisis del servidor local. Esta acción no se puede deshacer.`
      )
    )
      return;
    setBorrandoId(p.id);
    try {
      const res = await fetch(`/api/proyectos/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProyectos((prev) => prev?.filter((x) => x.id !== p.id) ?? null);
    } catch {
      setError("No se pudo eliminar el proyecto.");
    } finally {
      setBorrandoId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-thin border-zinc-800 bg-zinc-950 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <FolderOpen className="h-4 w-4 text-amber-400" />
            Proyectos
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Abre un proyecto guardado para seguir donde lo dejaste — con su
            audio, su análisis, tus correcciones y las fases aprobadas.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {cargando && (
          <div className="flex items-center gap-3 p-3 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            Leyendo los proyectos del servidor local…
          </div>
        )}

        {proyectos && proyectos.length === 0 && !cargando && (
          <div className="rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 p-5 text-center">
            <p className="text-sm font-semibold text-zinc-300">
              Todavía no hay proyectos guardados
            </p>
            <p className="pt-1 text-xs leading-relaxed text-zinc-500">
              Cuando estés trabajando, pulsa «Guardar» en la cabecera: el
              proyecto quedará en este equipo con su audio y todo el pipeline.
            </p>
          </div>
        )}

        {proyectos && proyectos.length > 0 && (
          <ul className="max-h-[52vh] space-y-2 overflow-y-auto scroll-thin pe-1">
            {proyectos.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {p.nombre}
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        p.fases >= 6
                          ? "border-emerald-800/60 text-[9px] text-emerald-300"
                          : "border-amber-800/60 text-[9px] text-amber-300"
                      }
                    >
                      {p.fases}/6 fases
                    </Badge>
                    {!p.tieneAudio && (
                      <Badge
                        variant="outline"
                        className="border-rose-800/60 text-[9px] text-rose-300"
                        title="El audio original no está guardado con este proyecto"
                      >
                        sin audio
                      </Badge>
                    )}
                  </div>
                  <p className="truncate pt-0.5 text-[11px] text-zinc-500">
                    {p.archivo} · {formatDurSmart(p.duracionSec)} ·{" "}
                    {p.escenas} escenas · guardado {formatHace(p.guardadoEn)}
                    {p.tieneAnalisis ? " · análisis incluido" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    className="h-8 bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
                    disabled={abriendoId !== null || borrandoId !== null}
                    onClick={() => {
                      setAbriendoId(p.id);
                      onAbrir(p.id);
                    }}
                  >
                    {abriendoId === p.id ? (
                      <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FolderOpen className="me-1 h-3.5 w-3.5" />
                    )}
                    Abrir
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-zinc-500 hover:text-rose-300"
                    aria-label={`Eliminar ${p.nombre}`}
                    disabled={abriendoId !== null || borrandoId !== null}
                    onClick={() => void borrar(p)}
                  >
                    {borrandoId === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".bsproj,application/json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onImportar(f);
          }}
        />

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="me-1 h-4 w-4" />
            Importar archivo .bsproj
          </Button>
          <Button
            variant="outline"
            className="w-full border-zinc-700 text-zinc-300"
            onClick={() => {
              onOpenChange(false);
              onNuevo();
            }}
          >
            <FilePlus2 className="me-1 h-4 w-4" />
            Nuevo proyecto
          </Button>
        </DialogFooter>

        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-600">
          <Music2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Los .bsproj portátiles incrustan el análisis y todos los ajustes;
          para reproducir y exportar de nuevo te pedirá re-adjuntar el audio
          original (como Camtasia con sus medios).
        </p>
      </DialogContent>
    </Dialog>
  );
}
