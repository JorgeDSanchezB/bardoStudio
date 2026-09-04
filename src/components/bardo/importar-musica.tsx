"use client";

/**
 * Fase 3 · Importar música propia del usuario.
 *
 * Diálogo con dos modos:
 *  - importar: elegir varios archivos de audio, completar metadatos por pista
 *    (con sugerencia de banda de tensión calculada de la energía real del
 *    archivo) y subirlos a /api/user-music.
 *  - editar: corregir los metadatos de una pista propia ya importada
 *    (PATCH /api/user-music/track/<id>).
 */

import { useEffect, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Music2,
  Loader2,
  X,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Save,
} from "lucide-react";
import { ANIMO_ETIQUETAS, type Animo } from "@/lib/fase2/types";
import type { Pista } from "@/lib/fase3/tipos";
import { formatBytes, formatDurSmart } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** avisa al padre para refrescar el catálogo (importar/editar/borrar) */
  onCambio: () => void;
  /** pista a editar; null/undefined = modo importación */
  pistaEditar?: Pista | null;
}

interface Pendiente {
  uid: string;
  file: File;
  titulo: string;
  animo: Animo;
  tensionMin: number;
  tensionMax: number;
  bpm: number;
  tonalidad: string;
  durSec: number;
  decodificando: boolean;
  error: string | null;
  estado: "pendiente" | "subiendo" | "listo" | "error";
  errorSubida?: string;
}

const ANIMOS: Animo[] = [
  "calma",
  "misterio",
  "tension",
  "batalla",
  "victoria",
  "neutro",
];

const ACCEPT = ".wav,.mp3,.m4a,.ogg,.oga,.flac,.opus,.aac,.webm,audio/*";
const MAX_BYTES = 100 * 1024 * 1024;

let uidSeq = 0;

/** Decodifica el audio para medir duración y RMS (sugerencia de tensión). */
async function medirAudio(
  file: File
): Promise<{ durSec: number; rmsDb: number } | null> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctor();
  try {
    const ab = await file.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab);
    const ch = buf.getChannelData(0);
    const paso = Math.max(1, Math.floor(ch.length / 250_000));
    let suma = 0;
    let n = 0;
    for (let i = 0; i < ch.length; i += paso) {
      suma += ch[i] * ch[i];
      n++;
    }
    const rms = n > 0 ? Math.sqrt(suma / n) : 0;
    const rmsDb = rms > 1e-6 ? 20 * Math.log10(rms) : -60;
    return { durSec: buf.duration, rmsDb };
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/** Banda de tensión sugerida a partir del RMS (−26…−8 dBFS → 10…90). */
function sugerirTension(rmsDb: number): { min: number; max: number } {
  const t = Math.min(1, Math.max(0, (rmsDb + 26) / 18));
  const centro = Math.round((t * 80 + 10) / 5) * 5;
  return {
    min: Math.max(0, centro - 15),
    max: Math.min(100, centro + 15),
  };
}

export function ImportarMusica({
  open,
  onOpenChange,
  onCambio,
  pistaEditar,
}: Props) {
  const modoEdicion = !!pistaEditar;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [hayCambios, setHayCambios] = useState(false);

  // ---- edición ----
  const [edTitulo, setEdTitulo] = useState("");
  const [edAnimo, setEdAnimo] = useState<Animo>("neutro");
  const [edMin, setEdMin] = useState(0);
  const [edMax, setEdMax] = useState(100);
  const [edBpm, setEdBpm] = useState(90);
  const [edTonalidad, setEdTonalidad] = useState("");
  const [edError, setEdError] = useState<string | null>(null);
  const [edGuardando, setEdGuardando] = useState(false);

  useEffect(() => {
    if (open && pistaEditar) {
      setEdTitulo(pistaEditar.titulo);
      setEdAnimo(pistaEditar.animo);
      setEdMin(Math.round(pistaEditar.tensionMin));
      setEdMax(Math.round(pistaEditar.tensionMax));
      setEdBpm(Math.round(pistaEditar.bpm));
      setEdTonalidad(pistaEditar.tonalidad === "—" ? "" : pistaEditar.tonalidad);
      setEdError(null);
    }
    if (open && !pistaEditar) {
      setPendientes([]);
      setHayCambios(false);
    }
  }, [open, pistaEditar]);

  // ---- selección de archivos ----
  const agregarArchivos = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const nuevos: Pendiente[] = [];
    for (const file of Array.from(files)) {
      const nombre = file.name.toLowerCase();
      const extOk = /\.(wav|mp3|m4a|ogg|oga|flac|opus|aac|webm)$/.test(nombre);
      if (!extOk && !file.type.startsWith("audio/")) continue;
      if (file.size < 1024) continue;
      if (file.size > MAX_BYTES) continue;
      nuevos.push({
        uid: `imp-${++uidSeq}`,
        file,
        titulo: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
        animo: "neutro",
        tensionMin: 30,
        tensionMax: 70,
        bpm: 90,
        tonalidad: "",
        durSec: 0,
        decodificando: true,
        error: null,
        estado: "pendiente",
      });
    }
    if (nuevos.length === 0) return;
    setPendientes((prev) => [...prev, ...nuevos]);
    setHayCambios(true);
    // medir en serie (RAM acotada)
    void (async () => {
      for (const p of nuevos) {
        const med = await medirAudio(p.file);
        setPendientes((prev) =>
          prev.map((x) => {
            if (x.uid !== p.uid) return x;
            if (!med) {
              return {
                ...x,
                decodificando: false,
                error:
                  "El navegador no pudo decodificar este archivo; comprueba el formato.",
              };
            }
            const s = sugerirTension(med.rmsDb);
            return {
              ...x,
              decodificando: false,
              durSec: Math.round(med.durSec * 10) / 10,
              tensionMin: x.tensionMin === 30 && x.tensionMax === 70 ? s.min : x.tensionMin,
              tensionMax: x.tensionMin === 30 && x.tensionMax === 70 ? s.max : x.tensionMax,
            };
          })
        );
      }
    })();
  };

  const actualizar = (uid: string, cambios: Partial<Pendiente>) =>
    setPendientes((prev) => prev.map((p) => (p.uid === uid ? { ...p, ...cambios } : p)));

  // ---- subir ----
  const importar = async () => {
    const validos = pendientes.filter(
      (p) => p.estado === "pendiente" && !p.decodificando && !p.error
    );
    if (validos.length === 0) return;
    setSubiendo(true);
    let ok = 0;
    for (const p of validos) {
      actualizar(p.uid, { estado: "subiendo" });
      try {
        const fd = new FormData();
        fd.set(
          "meta",
          JSON.stringify({
            titulo: p.titulo,
            animo: p.animo,
            tensionMin: p.tensionMin,
            tensionMax: p.tensionMax,
            bpm: p.bpm,
            tonalidad: p.tonalidad || "—",
            durSec: p.durSec,
            descripcion: `importada: ${p.file.name}`,
          })
        );
        fd.set("archivo", p.file);
        const res = await fetch("/api/user-music", { method: "POST", body: fd });
        if (!res.ok) {
          let detalle = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) detalle = j.error;
          } catch {
            /* sin cuerpo */
          }
          actualizar(p.uid, { estado: "error", errorSubida: detalle });
        } else {
          actualizar(p.uid, { estado: "listo" });
          ok++;
        }
      } catch {
        actualizar(p.uid, {
          estado: "error",
          errorSubida: "fallo de red al subir",
        });
      }
    }
    setSubiendo(false);
    if (ok > 0) {
      setHayCambios(true);
      onCambio();
    }
  };

  // ---- editar ----
  const guardarEdicion = async () => {
    if (!pistaEditar) return;
    const titulo = edTitulo.trim();
    if (!titulo) {
      setEdError("La pista necesita un título.");
      return;
    }
    const min = Math.min(100, Math.max(0, Math.round(edMin)));
    const max = Math.min(100, Math.max(0, Math.round(edMax)));
    if (max <= min) {
      setEdError("La tensión máxima debe ser mayor que la mínima.");
      return;
    }
    setEdGuardando(true);
    setEdError(null);
    try {
      const res = await fetch(`/api/user-music/track/${pistaEditar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          animo: edAnimo,
          tensionMin: min,
          tensionMax: max,
          bpm: Math.min(300, Math.max(20, Math.round(edBpm || 90))),
          tonalidad: edTonalidad.trim() || "—",
          durSec: pistaEditar.durSec,
        }),
      });
      if (!res.ok) {
        let detalle = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) detalle = j.error;
        } catch {
          /* sin cuerpo */
        }
        setEdError(detalle);
      } else {
        onCambio();
        onOpenChange(false);
      }
    } catch {
      setEdError("Fallo de red al guardar los cambios.");
    } finally {
      setEdGuardando(false);
    }
  };

  const todosListos =
    pendientes.length > 0 && pendientes.every((p) => p.estado === "listo" || p.estado === "error");
  const porSubir = pendientes.filter((p) => p.estado === "pendiente").length;

  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-thin border-zinc-800 bg-zinc-950 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100">
            <Music2 className="h-4 w-4 text-amber-400" />
            {modoEdicion
              ? "Editar pista propia"
              : "Importar tu propia música"}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            {modoEdicion ? (
              <>
                Corrige el título, el ánimo o la banda de tensión de{" "}
                <strong className="text-zinc-300">{pistaEditar?.titulo}</strong>
                . El archivo de audio no cambia.
              </>
            ) : (
              <>
                Añade tus propios archivos (WAV, MP3, M4A, OGG, FLAC, Opus,
                AAC o WebM · hasta 100 MB por pista). Quedan guardados en tu
                biblioteca personal del servidor local y podrás asignarlos a
                las escenas igual que las pistas CC0.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!modoEdicion && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-9 gap-2"
                onClick={() => inputRef.current?.click()}
                disabled={subiendo}
              >
                <Plus className="h-4 w-4" />
                Elegir archivos…
              </Button>
              {pendientes.length > 0 && (
                <span className="text-[11px] text-zinc-500">
                  {pendientes.length} pista{pendientes.length > 1 ? "s" : ""} ·{" "}
                  {formatBytes(
                    pendientes.reduce((s, p) => s + p.file.size, 0)
                  )}
                </span>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => {
                  agregarArchivos(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {pendientes.length === 0 && (
              <p className="rounded-lg border border-dashed border-zinc-700/80 bg-zinc-900/30 p-4 text-center text-xs leading-relaxed text-zinc-500">
                Sin archivos aún. La banda de tensión se sugiere
                automáticamente a partir de la energía real de cada archivo
                (puedes ajustarla a mano antes de importar).
              </p>
            )}

            <div className="max-h-[46vh] space-y-3 overflow-y-auto scroll-thin pe-1">
              {pendientes.map((p) => {
                const colorEstado =
                  p.estado === "listo"
                    ? "text-emerald-400"
                    : p.estado === "error"
                      ? "text-rose-400"
                      : "text-zinc-500";
                return (
                  <div
                    key={p.uid}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-zinc-200">
                          {p.file.name}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          {formatBytes(p.file.size)} ·{" "}
                          {p.decodificando
                            ? "midiendo audio…"
                            : p.durSec > 0
                              ? formatDurSmart(p.durSec)
                              : "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.decodificando && (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin text-amber-400"
                            aria-hidden
                          />
                        )}
                        {p.estado === "subiendo" ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin text-amber-400"
                            aria-hidden
                          />
                        ) : p.estado === "listo" ? (
                          <CheckCircle2 className={`h-3.5 w-3.5 ${colorEstado}`} aria-hidden />
                        ) : p.estado === "error" ? (
                          <AlertTriangle className={`h-3.5 w-3.5 ${colorEstado}`} aria-hidden />
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-500"
                          aria-label={`Quitar ${p.file.name}`}
                          disabled={subiendo}
                          onClick={() =>
                            setPendientes((prev) =>
                              prev.filter((x) => x.uid !== p.uid)
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {p.error && (
                      <p className="pt-1 text-[10px] text-rose-400">{p.error}</p>
                    )}
                    {p.errorSubida && (
                      <p className="pt-1 text-[10px] text-rose-400">
                        {p.errorSubida}
                      </p>
                    )}

                    <div className="grid gap-2 pt-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label
                          htmlFor={`${p.uid}-titulo`}
                          className="text-[10px] text-zinc-500"
                        >
                          Título
                        </Label>
                        <Input
                          id={`${p.uid}-titulo`}
                          className="h-8 text-xs"
                          value={p.titulo}
                          maxLength={80}
                          disabled={p.estado === "subiendo" || p.estado === "listo"}
                          onChange={(e) =>
                            actualizar(p.uid, { titulo: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-500">Ánimo</Label>
                        <Select
                          value={p.animo}
                          disabled={p.estado === "subiendo" || p.estado === "listo"}
                          onValueChange={(v) =>
                            actualizar(p.uid, { animo: v as Animo })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ANIMOS.map((a) => (
                              <SelectItem key={a} value={a} className="text-xs">
                                {ANIMO_ETIQUETAS[a]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-2">
                        <div className="w-1/2 space-y-1">
                          <Label
                            htmlFor={`${p.uid}-min`}
                            className="text-[10px] text-zinc-500"
                          >
                            Tensión mín.
                          </Label>
                          <Input
                            id={`${p.uid}-min`}
                            type="number"
                            min={0}
                            max={99}
                            className="h-8 text-xs"
                            value={p.tensionMin}
                            disabled={p.estado === "subiendo" || p.estado === "listo"}
                            onChange={(e) =>
                              actualizar(p.uid, {
                                tensionMin: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </div>
                        <div className="w-1/2 space-y-1">
                          <Label
                            htmlFor={`${p.uid}-max`}
                            className="text-[10px] text-zinc-500"
                          >
                            Tensión máx.
                          </Label>
                          <Input
                            id={`${p.uid}-max`}
                            type="number"
                            min={1}
                            max={100}
                            className="h-8 text-xs"
                            value={p.tensionMax}
                            disabled={p.estado === "subiendo" || p.estado === "listo"}
                            onChange={(e) =>
                              actualizar(p.uid, {
                                tensionMax: Number(e.target.value) || 1,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="w-1/2 space-y-1">
                          <Label
                            htmlFor={`${p.uid}-bpm`}
                            className="text-[10px] text-zinc-500"
                          >
                            BPM
                          </Label>
                          <Input
                            id={`${p.uid}-bpm`}
                            type="number"
                            min={20}
                            max={300}
                            className="h-8 text-xs"
                            value={p.bpm}
                            disabled={p.estado === "subiendo" || p.estado === "listo"}
                            onChange={(e) =>
                              actualizar(p.uid, {
                                bpm: Number(e.target.value) || 90,
                              })
                            }
                          />
                        </div>
                        <div className="w-1/2 space-y-1">
                          <Label
                            htmlFor={`${p.uid}-ton`}
                            className="text-[10px] text-zinc-500"
                          >
                            Tonalidad
                          </Label>
                          <Input
                            id={`${p.uid}-ton`}
                            className="h-8 text-xs"
                            placeholder="p. ej. Am"
                            maxLength={24}
                            value={p.tonalidad}
                            disabled={p.estado === "subiendo" || p.estado === "listo"}
                            onChange={(e) =>
                              actualizar(p.uid, { tonalidad: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {modoEdicion && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ed-titulo" className="text-xs text-zinc-400">
                Título
              </Label>
              <Input
                id="ed-titulo"
                className="h-9 text-sm"
                value={edTitulo}
                maxLength={80}
                disabled={edGuardando}
                onChange={(e) => setEdTitulo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-zinc-400">Ánimo</Label>
              <Select
                value={edAnimo}
                disabled={edGuardando}
                onValueChange={(v) => setEdAnimo(v as Animo)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANIMOS.map((a) => (
                    <SelectItem key={a} value={a} className="text-sm">
                      {ANIMO_ETIQUETAS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <div className="w-1/2 space-y-1">
                <Label htmlFor="ed-min" className="text-xs text-zinc-400">
                  Tensión mín.
                </Label>
                <Input
                  id="ed-min"
                  type="number"
                  min={0}
                  max={99}
                  className="h-9 text-sm"
                  value={edMin}
                  disabled={edGuardando}
                  onChange={(e) => setEdMin(Number(e.target.value) || 0)}
                />
              </div>
              <div className="w-1/2 space-y-1">
                <Label htmlFor="ed-max" className="text-xs text-zinc-400">
                  Tensión máx.
                </Label>
                <Input
                  id="ed-max"
                  type="number"
                  min={1}
                  max={100}
                  className="h-9 text-sm"
                  value={edMax}
                  disabled={edGuardando}
                  onChange={(e) => setEdMax(Number(e.target.value) || 1)}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="w-1/2 space-y-1">
                <Label htmlFor="ed-bpm" className="text-xs text-zinc-400">
                  BPM
                </Label>
                <Input
                  id="ed-bpm"
                  type="number"
                  min={20}
                  max={300}
                  className="h-9 text-sm"
                  value={edBpm}
                  disabled={edGuardando}
                  onChange={(e) => setEdBpm(Number(e.target.value) || 90)}
                />
              </div>
              <div className="w-1/2 space-y-1">
                <Label htmlFor="ed-ton" className="text-xs text-zinc-400">
                  Tonalidad
                </Label>
                <Input
                  id="ed-ton"
                  className="h-9 text-sm"
                  placeholder="p. ej. Am"
                  maxLength={24}
                  value={edTonalidad}
                  disabled={edGuardando}
                  onChange={(e) => setEdTonalidad(e.target.value)}
                />
              </div>
            </div>
            {edError && (
              <p className="sm:col-span-2 text-xs text-rose-400">{edError}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            className="text-zinc-400"
            onClick={() => onOpenChange(false)}
            disabled={subiendo || edGuardando}
          >
            {todosListos ? "Cerrar" : "Cancelar"}
          </Button>
          {modoEdicion ? (
            <Button
              className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
              onClick={() => void guardarEdicion()}
              disabled={edGuardando || !edTitulo.trim()}
            >
              {edGuardando ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="me-1 h-4 w-4" />
              )}
              Guardar cambios
            </Button>
          ) : (
            <Button
              className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
              onClick={() => void importar()}
              disabled={
                subiendo || porSubir === 0 || pendientes.some((p) => p.decodificando)
              }
            >
              {subiendo ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Music2 className="me-1 h-4 w-4" />
              )}
              {subiendo
                ? "Importando…"
                : `Importar ${porSubir} pista${porSubir > 1 ? "s" : ""}`}
            </Button>
          )}
        </DialogFooter>
        {!modoEdicion && hayCambios && (
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Las pistas importadas son archivos tuyos: Bardo Studio no los
            re-codifica ni los sube a internet — se guardan tal cual en el
            servidor local (db/user-music) para poder reabrir tus proyectos
            más adelante.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
