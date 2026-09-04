"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sparkles,
  Play,
  Square,
  Trash2,
  Loader2,
  RotateCcw,
  AlertTriangle,
  Volume2,
  Plus,
  FileAudio,
} from "lucide-react";
import { useProjectStore } from "@/store/project";
import { detectarSfxFondo } from "@/lib/sfx/detectar-cliente";
import {
  colorCategoria,
  type SfxConfig,
  type SfxDef,
  type SfxEvento,
} from "@/lib/sfx/tipos";
import { formatTimecode } from "@/lib/format";
import { GateFase } from "./gate-fase";
import { SfxPanel } from "./sfx-panel";

/** Fase 2.5 · Detección de efectos de sonido por palabras clave. */
export function SfxSeccion() {
  const fase2 = useProjectStore((s) => s.fase2);
  const faseSfx = useProjectStore((s) => s.faseSfx);
  const analysis = useProjectStore((s) => s.analysis);
  const playheadSec = useProjectStore((s) => s.playheadSec);

  const [analizando, setAnalizando] = useState(false);
  const [preview, setPreview] = useState<{ nombre: string; src: string } | null>(
    null
  );
  const contadorManual = useRef(0);

  const duracion = analysis?.durationSec ?? 0;
  const config = faseSfx.config;
  const biblioteca = faseSfx.biblioteca;

  // ---------- cargar config + biblioteca (GET /api/sfx-config) ----------
  useEffect(() => {
    if (config && biblioteca) return;
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/sfx-config");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SfxConfig & {
          biblioteca: SfxDef[];
        };
        if (!vivo) return;
        if (
          Array.isArray(data.categorias) &&
          data.categorias.length > 0 &&
          Array.isArray(data.biblioteca) &&
          data.biblioteca.length > 0
        ) {
          useProjectStore.getState().seedConfigSfx({
            config: {
              version: data.version ?? 1,
              defectos: data.defectos,
              categorias: data.categorias,
            },
            biblioteca: data.biblioteca,
          });
        }
      } catch (e) {
        if (vivo)
          useProjectStore.getState().fallarSfx(
            `No se pudo cargar el módulo SFX: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
      }
    })();
    return () => {
      vivo = false;
    };
  }, [config, biblioteca]);

  // ---------- detección automática (Web Worker, respaldo inline) ----------
  // Nota: el «en curso» vive en un ref y el resultado se valida contra el
  // store fresco (no contra el closure), de modo que el doble montaje de
  // React StrictMode y los re-renders no invaliden la ejecución en vuelo.
  const enCursoRef = useRef(false);
  useEffect(() => {
    if (!config || !biblioteca) return;
    if (faseSfx.status !== "idle") return;
    if (fase2.segmentos.length === 0) return;
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setAnalizando(true);
    void (async () => {
      try {
        const { eventos, resumen } = await detectarSfxFondo(
          {
            segmentos: fase2.segmentos.map((s) => ({
              inicio: s.inicio,
              fin: s.fin,
              texto: s.texto,
            })),
            duracionSec: duracion,
          },
          config,
          biblioteca
        );
        if (useProjectStore.getState().faseSfx.status === "idle") {
          useProjectStore.getState().aplicarDeteccionSfx(eventos, resumen);
        }
      } catch (e) {
        if (useProjectStore.getState().faseSfx.status === "idle") {
          useProjectStore.getState().fallarSfx(
            e instanceof Error ? e.message : String(e)
          );
        }
      } finally {
        enCursoRef.current = false;
        setAnalizando(false);
      }
    })();
  }, [config, biblioteca, faseSfx.status, fase2.segmentos, duracion]);

  const sfxPorId = useMemo(
    () => new Map((biblioteca ?? []).map((b) => [b.id, b])),
    [biblioteca]
  );
  const catPorNombre = useMemo(
    () => new Map((config?.categorias ?? []).map((c) => [c.categoria, c])),
    [config]
  );

  if (fase2.status !== "approved") return null;

  const aprobada = faseSfx.status === "approved";
  const eventos = faseSfx.eventos;
  const activos = eventos.filter((e) => e.activo).length;
  const categoriasDistintas = new Set(
    eventos.filter((e) => e.activo).map((e) => e.categoria)
  ).size;

  const reproducir = (def: SfxDef | undefined) => {
    if (!def) return;
    setPreview({ nombre: def.nombre, src: def.archivo });
  };

  const añadirManual = (def: SfxDef) => {
    contadorManual.current++;
    const ev: SfxEvento = {
      id: `sfx-man-${Date.now() % 100000}-${contadorManual.current}`,
      palabra: "(manual)",
      categoria: "manual",
      sfxId: def.id,
      inicio: Math.round(Math.max(0, Math.min(duracion, playheadSec)) * 10) / 10,
      durSec: def.durSec,
      volumenDb: config?.defectos.nivelDb ?? -12,
      confidencia: 1,
      origen: "manual",
      activo: true,
    };
    useProjectStore.getState().añadirSfxEvento(ev);
  };

  return (
    <section
      className="space-y-4 pt-2"
      aria-label="Fase 2.5: efectos de sonido"
    >
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
          <Sparkles className="h-5 w-5 text-amber-400" />
          Fase 2.5 · Efectos de sonido (SFX)
          <Badge variant="outline" className="text-[10px] text-zinc-400">
            Detección por palabras clave
          </Badge>
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          La transcripción se analiza en busca de{" "}
          <strong className="text-zinc-200">palabras clave</strong> (trueno,
          pasos, puerta, espada…) y cada coincidencia coloca un{" "}
          <strong className="text-zinc-200">efecto de sonido</strong>{" "}
          sincronizado en el segundo exacto en que se menciona. Revisa la lista:
          activa, cambia el archivo, ajusta volumen o posición, elimina o añade
          a mano desde la biblioteca.
        </p>
      </div>

      {faseSfx.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error del módulo SFX</AlertTitle>
          <AlertDescription>{faseSfx.error}</AlertDescription>
        </Alert>
      )}

      {/* reproducción de previsualización (se remonta por key y arranca solo) */}
      <audio
        key={preview?.src ?? "sfx-preview"}
        src={preview?.src}
        autoPlay={!!preview}
        preload="auto"
        onEnded={() => setPreview(null)}
        aria-label="Previsualización de efecto de sonido"
      />
      {preview && (
        <div className="flex items-center gap-2 rounded-md border border-amber-800/50 bg-amber-950/20 px-3 py-1.5 text-[11px] text-amber-200">
          <Volume2 className="h-3.5 w-3.5 animate-pulse" />
          Escuchando: <strong>{preview.nombre}</strong>
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto h-7 gap-1 px-2 text-[10px] text-amber-200/80"
            onClick={() => setPreview(null)}
          >
            <Square className="h-3 w-3" />
            Detener
          </Button>
        </div>
      )}

      {/* ---------- tabla de eventos detectados ---------- */}
      <Card className="border-zinc-800 bg-zinc-950/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <FileAudio className="h-3.5 w-3.5 text-amber-400" />
            Efectos detectados
            <Badge variant="outline" className="text-[10px] text-zinc-500">
              {eventos.length} eventos · {activos} activos
            </Badge>
            {faseSfx.resumen && eventos.length > 0 && (
              <Badge variant="outline" className="text-[10px] text-zinc-500">
                {categoriasDistintas} categorías · palabra más repetida: «
                {faseSfx.resumen.palabraTop}»
              </Badge>
            )}
            <span className="ms-auto flex flex-wrap gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-zinc-400"
                disabled={eventos.length === 0}
                onClick={() =>
                  useProjectStore.getState().activarTodosSfx(true)
                }
              >
                Activar todos
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-zinc-400"
                disabled={activos === 0}
                onClick={() =>
                  useProjectStore.getState().activarTodosSfx(false)
                }
              >
                Silenciar todos
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-rose-300/80 hover:text-rose-300"
                disabled={eventos.length === 0}
                onClick={() => {
                  if (
                    window.confirm(
                      "¿Eliminar TODOS los efectos detectados? Podrás re-detectar después."
                    )
                  )
                    useProjectStore.getState().eliminarTodosSfx();
                }}
              >
                Eliminar todos
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          {analizando && (
            <p className="flex items-center gap-2 text-[11px] text-amber-300/90">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analizando la transcripción en un Web Worker…
            </p>
          )}

          {!config || !biblioteca ? (
            !faseSfx.error && (
              <p className="flex items-center gap-2 text-[11px] text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando el módulo SFX (palabras clave + biblioteca)…
              </p>
            )
          ) : eventos.length === 0 && !analizando ? (
            <p className="rounded-md border border-zinc-800/80 bg-zinc-900/40 p-3 text-[11px] leading-relaxed text-zinc-500">
              No se detectaron efectos con las palabras clave actuales. Añade
              efectos a mano desde la biblioteca de abajo o amplía el
              diccionario en{" "}
              <strong className="text-zinc-300">
                «Palabras clave y ajustes»
              </strong>
              .
            </p>
          ) : (
            eventos.length > 0 && (
              <div className="max-h-96 overflow-y-auto scroll-thin rounded-md border border-zinc-800/80">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-zinc-900">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 w-10 text-[10px]">✓</TableHead>
                      <TableHead className="h-9 text-[10px]">Inicio</TableHead>
                      <TableHead className="h-9 text-[10px]">Palabra</TableHead>
                      <TableHead className="h-9 text-[10px]">Categoría</TableHead>
                      <TableHead className="h-9 text-[10px]">Efecto</TableHead>
                      <TableHead className="h-9 w-[72px] text-[10px]">
                        Vol (dB)
                      </TableHead>
                      <TableHead className="h-9 w-[64px] text-[10px]">
                        Dur
                      </TableHead>
                      <TableHead className="h-9 w-10 text-[10px]">Oír</TableHead>
                      <TableHead className="h-9 w-10 text-[10px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eventos.map((e) => {
                      const def = sfxPorId.get(e.sfxId);
                      const cat = catPorNombre.get(e.categoria);
                      const color = colorCategoria(e.categoria);
                      return (
                        <TableRow
                          key={e.id}
                          className={
                            e.activo
                              ? "hover:bg-zinc-900/50"
                              : "opacity-45 hover:bg-zinc-900/50"
                          }
                        >
                          <TableCell className="py-1.5">
                            <Checkbox
                              checked={e.activo}
                              disabled={aprobada}
                              onCheckedChange={(v) =>
                                useProjectStore
                                  .getState()
                                  .ajustarSfxEvento(e.id, { activo: v === true })
                              }
                              aria-label={`Incluir el efecto ${def?.nombre ?? e.sfxId} en ${formatTimecode(e.inicio)}`}
                              className="data-[state=checked]:border-amber-400 data-[state=checked]:bg-amber-400 data-[state=checked]:text-zinc-900"
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            <EditorSegundos
                              valor={e.inicio}
                              max={duracion}
                              disabled={aprobada}
                              onCommit={(v) =>
                                useProjectStore
                                  .getState()
                                  .ajustarSfxEvento(e.id, { inicio: v })
                              }
                              ariaLabel={`Posición del efecto ${def?.nombre ?? e.sfxId}`}
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            {e.origen === "manual" ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] text-zinc-500"
                              >
                                a mano
                              </Badge>
                            ) : (
                              <span
                                className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200"
                                title={`Coincidencia${
                                  e.confidencia < 1 ? " (plural/flexión)" : ""
                                }: «${e.palabra}»`}
                              >
                                {e.palabra}
                                {e.confidencia < 1 && " *"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px]"
                              style={{
                                backgroundColor: `${color}22`,
                                color,
                              }}
                              title={cat?.etiqueta ?? e.categoria}
                            >
                              {cat?.etiqueta ?? e.categoria}
                            </span>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Select
                              value={e.sfxId}
                              disabled={aprobada}
                              onValueChange={(v) =>
                                useProjectStore
                                  .getState()
                                  .ajustarSfxEvento(e.id, { sfxId: v })
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-[170px] border-zinc-800 bg-zinc-900/60 text-xs"
                                aria-label={`Efecto asignado a «${e.palabra}»`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-72">
                                {(biblioteca ?? []).map((b) => (
                                  <SelectItem
                                    key={b.id}
                                    value={b.id}
                                    className="text-xs"
                                  >
                                    {b.nombre}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <EditorDb
                              valor={e.volumenDb}
                              disabled={aprobada}
                              onCommit={(v) =>
                                useProjectStore
                                  .getState()
                                  .ajustarSfxEvento(e.id, { volumenDb: v })
                              }
                              ariaLabel={`Volumen del efecto ${def?.nombre ?? e.sfxId}`}
                            />
                          </TableCell>
                          <TableCell className="py-1.5 font-mono text-[10px] text-zinc-500">
                            {(def?.durSec ?? e.durSec).toFixed(1)} s
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-amber-300/80 hover:text-amber-300"
                              aria-label={`Escuchar ${def?.nombre ?? e.sfxId}`}
                              onClick={() => reproducir(def)}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-300/70 hover:text-rose-300"
                              disabled={aprobada}
                              aria-label={`Eliminar el efecto en ${formatTimecode(e.inicio)}`}
                              onClick={() =>
                                useProjectStore.getState().eliminarSfxEvento(e.id)
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="border-t border-zinc-800/60 px-3 py-1.5 text-[10px] text-zinc-600">
                  * = coincidencia por plural/flexión · clic en «Inicio» para
                  editar el segundo · los inactivos no pasan a la mezcla
                </p>
              </div>
            )
          )}
        </CardContent>
      </Card>

      {/* ---------- biblioteca ---------- */}
      {config && biblioteca && (
        <>
          <Card className="border-zinc-800 bg-zinc-950/60">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Biblioteca de efectos · CC0
                <Badge variant="outline" className="text-[10px] text-zinc-500">
                  {biblioteca.length} sintetizados localmente
                </Badge>
                <span className="text-[10px] text-zinc-600">
                  añade en la posición del cursor de reproducción
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="max-h-72 overflow-y-auto scroll-thin rounded-md border border-zinc-800/80">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-zinc-900">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 text-[10px]">Nombre</TableHead>
                      <TableHead className="h-9 text-[10px]">Etiquetas</TableHead>
                      <TableHead className="h-9 w-[64px] text-[10px]">Dur</TableHead>
                      <TableHead className="h-9 w-10 text-[10px]">Oír</TableHead>
                      <TableHead className="h-9 w-[130px] text-[10px]">
                        Añadir
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {biblioteca.map((b) => (
                      <TableRow key={b.id} className="hover:bg-zinc-900/50">
                        <TableCell className="py-1.5 text-xs text-zinc-300">
                          {b.nombre}
                          <span className="block font-mono text-[9px] text-zinc-600">
                            {b.id}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5">
                          <span className="flex flex-wrap gap-1">
                            {(b.etiquetas ?? []).map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className="text-[9px] text-zinc-500"
                              >
                                {t}
                              </Badge>
                            ))}
                          </span>
                        </TableCell>
                        <TableCell className="py-1.5 font-mono text-[10px] text-zinc-500">
                          {b.durSec.toFixed(1)} s
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-300/80 hover:text-amber-300"
                            aria-label={`Escuchar ${b.nombre}`}
                            onClick={() => reproducir(b)}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-[10px]"
                            disabled={aprobada}
                            onClick={() => añadirManual(b)}
                          >
                            <Plus className="h-3 w-3" />
                            en {formatTimecode(playheadSec).slice(3, 8)}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ---------- panel de palabras clave ---------- */}
          {!aprobada && <SfxPanel config={config} biblioteca={biblioteca} />}
        </>
      )}

      {/* ---------- puerta de auditoría ---------- */}
      <GateFase
        fase={2.5}
        titulo="Efectos de sonido"
        desbloqueaTexto="bloquea la Fase 3"
        descripcionPendiente="Revisa cada efecto: su posición (clic en el segundo para ajustarlo), el archivo asignado y el volumen. Los efectos activos sonarán en su propia pista «Efectos» durante la mezcla y la exportación."
        descripcionAprobada="La lista de efectos queda fijada: la mezcla los colocará en la pista «Efectos» del editor."
        resumen={[
          { etiqueta: "Detectados", valor: String(eventos.length) },
          { etiqueta: "Activos", valor: String(activos) },
          { etiqueta: "Categorías", valor: String(categoriasDistintas) },
        ]}
        confirmacion={`He revisado los ${eventos.length} efectos detectados (${activos} activos) y su colocación es correcta.`}
        textoAprobar="Aprobar los efectos y desbloquear la música"
        approved={aprobada}
        onApprove={() => {
          if (preview) setPreview(null);
          useProjectStore.getState().aprobarFaseSfx();
        }}
        onReopen={() => useProjectStore.getState().reabrirFaseSfx()}
        onRehacer={() => {
          if (
            window.confirm(
              "¿Volver a detectar? Se pierden las ediciones manuales de la lista (la config de palabras clave se conserva)."
            )
          ) {
            useProjectStore.getState().reiniciarSfx();
          }
        }}
        rehacerLabel="Volver a detectar"
        notaReabrir="Al volver a editar se reinician las fases 3-6 (asignaciones, mezcla, editor y exportación)."
      />
    </section>
  );
}

/** Editor de segundos (grid 0.1 s) con borrador mientras está enfocado. */
function EditorSegundos({
  valor,
  max,
  disabled,
  onCommit,
  ariaLabel,
}: {
  valor: number;
  max: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <span className="font-mono text-[10px] text-zinc-400" title={formatTimecode(valor)}>
        {formatTimecode(valor).slice(3, 11)}
      </span>
      {!disabled && (
        <Input
          type="number"
          value={draft ?? String(valor)}
          min={0}
          max={max}
          step={0.1}
          aria-label={ariaLabel}
          className="mt-0.5 h-7 w-[84px] border-zinc-800 bg-zinc-900/60 text-[10px]"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setDraft(String(valor))}
          onBlur={() => {
            if (draft !== null && draft.trim() !== "") {
              const n = Number(draft);
              if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(0, n)));
            }
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </span>
  );
}

/** Editor de dB con borrador mientras está enfocado. */
function EditorDb({
  valor,
  disabled,
  onCommit,
  ariaLabel,
}: {
  valor: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (disabled) {
    return <span className="font-mono text-[10px] text-zinc-500">{valor}</span>;
  }
  return (
    <Input
      type="number"
      value={draft ?? String(valor)}
      min={-60}
      max={6}
      step={0.5}
      aria-label={ariaLabel}
      className="h-8 w-[64px] border-zinc-800 bg-zinc-900/60 text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(String(valor))}
      onBlur={() => {
        if (draft !== null && draft.trim() !== "") {
          const n = Number(draft);
          if (Number.isFinite(n)) onCommit(Math.min(6, Math.max(-60, n)));
        }
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
