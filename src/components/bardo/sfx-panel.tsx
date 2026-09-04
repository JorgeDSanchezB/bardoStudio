"use client";

import { useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Settings2,
  Download,
  Upload,
  RotateCcw,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useProjectStore, normalizarConfigSfx } from "@/store/project";
import type { SfxConfig, SfxDef, SfxDefectos } from "@/lib/sfx/tipos";

interface SfxPanelProps {
  config: SfxConfig;
  biblioteca: SfxDef[];
}

/** Editor de texto con borrador solo mientras está enfocado (commit al blur). */
function EditorTexto({
  valor,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  valor: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      value={draft ?? valor}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="h-8 border-zinc-800 bg-zinc-900/60 text-xs"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(valor)}
      onBlur={() => {
        if (draft !== null && draft !== valor) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Editor numérico con borrador (mismo patrón que escenas-table). */
function EditorNumero({
  valor,
  onCommit,
  min,
  max,
  paso = 0.1,
  ariaLabel,
  sufijo,
}: {
  valor: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  paso?: number;
  ariaLabel: string;
  sufijo?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const mostrar = draft ?? String(valor);
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        type="number"
        value={mostrar}
        min={min}
        max={max}
        step={paso}
        aria-label={ariaLabel}
        className="h-8 w-[72px] border-zinc-800 bg-zinc-900/60 text-xs"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setDraft(String(valor))}
        onBlur={() => {
          if (draft !== null) {
            const n = Number(draft);
            if (Number.isFinite(n) && draft.trim() !== "") {
              onCommit(Math.min(max, Math.max(min, n)));
            }
          }
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {sufijo && <span className="text-[10px] text-zinc-500">{sufijo}</span>}
    </span>
  );
}

/** Panel de palabras clave y ajustes del módulo SFX (Fase 2.5). */
export function SfxPanel({ config, biblioteca }: SfxPanelProps) {
  const [abierto, setAbierto] = useState(false);
  const [errorImport, setErrorImport] = useState<string | null>(null);
  const [nuevaCat, setNuevaCat] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement | null>(null);

  const defectos = config.defectos;
  const setDefectos = (patch: Partial<SfxDefectos>) =>
    useProjectStore.getState().setDefectosSfx(patch);

  const descargar = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sfx_config.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importar = async (file: File) => {
    setErrorImport(null);
    try {
      const texto = await file.text();
      const normalizada = normalizarConfigSfx(JSON.parse(texto));
      if (!normalizada)
        throw new Error("el JSON no tiene categorías válidas (con palabras)");
      useProjectStore.getState().reemplazarConfigSfx(normalizada);
    } catch (e) {
      setErrorImport(
        e instanceof Error ? e.message : "No se pudo importar el JSON."
      );
    }
  };

  const restaurarServidor = async () => {
    setErrorImport(null);
    try {
      const res = await fetch("/api/sfx-config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const normalizada = normalizarConfigSfx(data);
      if (!normalizada) throw new Error("respuesta del servidor inválida");
      useProjectStore
        .getState()
        .seedConfigSfx({ config: normalizada, biblioteca: data.biblioteca ?? biblioteca });
      useProjectStore.getState().reiniciarSfx();
    } catch (e) {
      setErrorImport(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950/60">
      <Collapsible open={abierto} onOpenChange={setAbierto}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer py-3 hover:bg-zinc-900/40">
            <CardTitle className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <Settings2 className="h-3.5 w-3.5 text-amber-400" />
              Palabras clave y ajustes de detección
              <Badge variant="outline" className="text-[10px] text-zinc-500">
                {config.categorias.length} categorías ·{" "}
                {config.categorias.reduce((n, c) => n + c.palabras.length, 0)}{" "}
                palabras
              </Badge>
              <span className="ms-auto text-[10px] text-zinc-500">
                {abierto ? "ocultar ▲" : "editar ▼"}
              </span>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 pb-4">
            <CardDescription className="text-[11px] leading-relaxed text-zinc-500">
              Cada categoría mapea palabras (ES/EN, sin acentos, con plurales)
              a un efecto. Los cambios afectan a la <strong>próxima</strong>{" "}
              detección: usa «Volver a detectar» para aplicarlos.
            </CardDescription>

            {errorImport && (
              <p
                role="alert"
                className="flex items-center gap-2 rounded-md border border-rose-800/60 bg-rose-950/30 p-2 text-[11px] text-rose-300"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {errorImport}
              </p>
            )}

            {/* ---- defectos globales ---- */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-zinc-800/80 bg-zinc-900/40 p-2.5 text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-300">Defectos:</span>
              <span className="flex items-center gap-1">
                nivel
                <EditorNumero
                  valor={defectos.nivelDb}
                  onCommit={(v) => setDefectos({ nivelDb: v })}
                  min={-60}
                  max={6}
                  ariaLabel="Nivel por defecto de los SFX en dB"
                />
                dB
              </span>
              <span className="flex items-center gap-1">
                crossfade
                <EditorNumero
                  valor={defectos.crossfadeSeg}
                  onCommit={(v) => setDefectos({ crossfadeSeg: v })}
                  min={0}
                  max={3}
                  ariaLabel="Crossfade de los SFX en segundos"
                />
                s
              </span>
              <span className="flex items-center gap-1">
                separación mín.
                <EditorNumero
                  valor={defectos.minSeparacionSeg}
                  onCommit={(v) => setDefectos({ minSeparacionSeg: v })}
                  min={0}
                  max={30}
                  ariaLabel="Separación mínima entre eventos de la misma categoría"
                />
                s
              </span>
              <span className="flex items-center gap-1">
                máx. eventos
                <EditorNumero
                  valor={defectos.maxEventos}
                  onCommit={(v) => setDefectos({ maxEventos: Math.round(v) })}
                  min={1}
                  max={1000}
                  paso={1}
                  ariaLabel="Máximo de eventos detectados"
                />
              </span>
              <label className="flex cursor-pointer items-center gap-1.5">
                <Switch
                  checked={defectos.respetarDucking}
                  onCheckedChange={(v) => setDefectos({ respetarDucking: v })}
                  aria-label="Los SFX respetan el ducking de la voz"
                />
                respeta ducking de voz
              </label>
            </div>

            {/* ---- tabla de categorías ---- */}
            <div className="max-h-96 overflow-y-auto scroll-thin rounded-md border border-zinc-800/80">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-zinc-900">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 w-10 text-[10px]">On</TableHead>
                    <TableHead className="h-9 text-[10px]">Categoría</TableHead>
                    <TableHead className="h-9 text-[10px]">Efecto</TableHead>
                    <TableHead className="h-9 w-[76px] text-[10px]">
                      Vol (dB)
                    </TableHead>
                    <TableHead className="h-9 text-[10px]">
                      Palabras (separadas por comas)
                    </TableHead>
                    <TableHead className="h-9 w-9" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.categorias.map((c) => (
                    <TableRow key={c.categoria} className="hover:bg-zinc-900/50">
                      <TableCell className="py-1.5">
                        <Switch
                          checked={c.activo}
                          onCheckedChange={(v) =>
                            useProjectStore
                              .getState()
                              .ajustarCategoriaSfx(c.categoria, { activo: v })
                          }
                          aria-label={`Activar la categoría ${c.etiqueta}`}
                        />
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-zinc-300">
                        {c.etiqueta}
                        <span className="block font-mono text-[9px] text-zinc-600">
                          {c.categoria}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Select
                          value={c.sfxId}
                          onValueChange={(v) =>
                            useProjectStore
                              .getState()
                              .ajustarCategoriaSfx(c.categoria, { sfxId: v })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-[170px] border-zinc-800 bg-zinc-900/60 text-xs"
                            aria-label={`Efecto de la categoría ${c.etiqueta}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {biblioteca.map((b) => (
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
                        <EditorNumero
                          valor={c.volumenDb ?? defectos.nivelDb}
                          onCommit={(v) =>
                            useProjectStore
                              .getState()
                              .ajustarCategoriaSfx(c.categoria, {
                                volumenDb: v,
                              })
                          }
                          min={-60}
                          max={6}
                          ariaLabel={`Volumen de la categoría ${c.etiqueta}`}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <EditorTexto
                          valor={c.palabras.join(", ")}
                          onCommit={(v) =>
                            useProjectStore
                              .getState()
                              .ajustarCategoriaSfx(c.categoria, {
                                palabras: v
                                  .split(/[,;]+/)
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              })
                          }
                          placeholder="palabras…"
                          ariaLabel={`Palabras de la categoría ${c.etiqueta}`}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-rose-300/70 hover:text-rose-300"
                          aria-label={`Eliminar la categoría ${c.etiqueta}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `¿Eliminar la categoría «${c.etiqueta}» y sus palabras?`
                              )
                            )
                              useProjectStore
                                .getState()
                                .eliminarCategoriaSfx(c.categoria);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* ---- acciones ---- */}
            <div className="flex flex-wrap items-center gap-2">
              {nuevaCat === null ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setNuevaCat("")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Añadir categoría
                </Button>
              ) : (
                <span className="flex flex-wrap items-center gap-2 rounded-md border border-amber-800/50 bg-amber-950/20 p-2">
                  <Input
                    value={nuevaCat}
                    placeholder="categoría (p. ej. tambor)"
                    aria-label="Nombre de la nueva categoría"
                    className="h-8 w-[180px] border-zinc-800 bg-zinc-900/60 text-xs"
                    onChange={(e) => setNuevaCat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && nuevaCat.trim()) {
                        useProjectStore.getState().añadirCategoriaSfx({
                          categoria: nuevaCat.trim().toLowerCase().slice(0, 64),
                          etiqueta: nuevaCat.trim().slice(0, 80),
                          sfxId: biblioteca[0]?.id ?? "",
                          activo: true,
                          palabras: [nuevaCat.trim().toLowerCase()],
                        });
                        setNuevaCat(null);
                      }
                    }}
                  />
                  <span className="text-[10px] text-zinc-500">
                    Enter = crear (luego edita palabras/efecto en la tabla)
                  </span>
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void restaurarServidor()}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurar del servidor
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={descargar}
              >
                <Download className="h-3.5 w-3.5" />
                Descargar JSON
              </Button>
              <input
                ref={archivoRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Importar archivo JSON de config SFX"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importar(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => archivoRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Importar JSON
              </Button>
              <span className="ms-auto text-[10px] text-zinc-600">
                también editable a mano en config/sfx_config.json
              </span>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
