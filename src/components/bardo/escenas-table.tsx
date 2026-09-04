"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import {
  ANIMO_COLORES,
  ANIMO_ETIQUETAS,
  type Animo,
  type Escena,
} from "@/lib/fase2/types";
import { clamp, formatTimecode } from "@/lib/format";

export interface EscenasTableProps {
  escenas: Escena[];
  selectedId: string | null;
  fileName: string | null;
  onSeleccionar: (id: string) => void;
  onSeek: (t: number) => void;
  /** edición numérica de la tensión (commit en blur/Enter) */
  onCorregir?: (id: string, tension: number) => void;
}

const MAX_ROWS = 600;

/** Clases de badge por ánimo (misma paleta que la curva, sin azules). */
const ANIMO_BADGE: Record<Animo, string> = {
  calma: "border-teal-800/50 bg-teal-500/15 text-teal-300",
  misterio: "border-violet-800/50 bg-violet-500/15 text-violet-300",
  tension: "border-orange-800/50 bg-orange-500/15 text-orange-300",
  batalla: "border-red-800/50 bg-red-500/15 text-red-300",
  victoria: "border-amber-800/50 bg-amber-500/15 text-amber-300",
  neutro: "border-zinc-700/50 bg-zinc-500/15 text-zinc-300",
};

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Editor numérico de tensión: commit en blur/Enter, clamp 0-100, ignora vacío.
 *  El borrador solo vive mientras el campo está enfocado: en reposo el valor
 *  mostrado se deriva de la prop (los arrastres en la curva se ven en vivo). */
function TensionInput({
  escena,
  onCorregir,
}: {
  escena: Escena;
  onCorregir: (id: string, tension: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(escena.tension);

  const commit = () => {
    const raw = (draft ?? "").trim();
    if (raw === "") {
      return; // ignora vacío: conserva el valor vigente
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n === escena.tension) {
      return;
    }
    onCorregir(escena.id, clamp(Math.round(n), 0, 100));
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      value={value}
      aria-label={`Tensión de la escena ${escena.n}`}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(String(escena.tension))}
      onBlur={() => {
        commit();
        setDraft(null);
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-8 w-14 rounded border border-zinc-800 bg-transparent px-1.5 text-center font-mono text-xs text-zinc-200 tabular-nums focus:border-amber-600/60 focus:outline-none"
    />
  );
}

export function EscenasTable(props: EscenasTableProps) {
  const { escenas, selectedId, fileName, onSeleccionar, onSeek, onCorregir } =
    props;
  const [exported, setExported] = useState(false);
  const shown = escenas.slice(0, MAX_ROWS);

  const exportCsv = () => {
    const rows = [
      [
        "n",
        "inicio_tc",
        "fin_tc",
        "tension_auto",
        "tension",
        "corregido",
        "animo",
        "razon",
        "texto",
      ],
      ...escenas.map((e) => [
        String(e.n),
        formatTimecode(e.inicio),
        formatTimecode(e.fin),
        String(e.tensionAuto),
        String(e.tension),
        e.corregido ? "si" : "no",
        e.animo,
        csvCell(e.razon ?? ""),
        csvCell(e.texto),
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `escenas-${(fileName ?? "narracion").replace(/\.[^.]+$/, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            Escenas y tensión{" "}
            <Badge variant="secondary" className="ms-1 font-mono">
              {escenas.length}
            </Badge>
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto h-8 gap-1 text-[11px]"
            onClick={exportCsv}
            disabled={escenas.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {exported ? "Exportado" : "CSV"}
          </Button>
        </div>
        <CardDescription>
          Clic en una fila para seleccionarla y escuchar la escena; edita la
          tensión con el número o arrastrando el punto en la curva.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        {escenas.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
            Aún no hay escenas: lanza el análisis de la Fase 2 y aquí aparecerá
            el mapa dramático con su tensión y ánimo.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-auto scroll-thin rounded-md border border-zinc-800/80">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-zinc-900">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 w-10 text-center">Nº</TableHead>
                  <TableHead className="h-9">Inicio</TableHead>
                  <TableHead className="h-9">Fin</TableHead>
                  <TableHead className="h-9">Tensión</TableHead>
                  <TableHead className="h-9">Ánimo</TableHead>
                  <TableHead className="h-9">Texto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((e) => {
                  const selected = e.id === selectedId;
                  return (
                    <TableRow
                      key={e.id}
                      className={`cursor-pointer font-mono text-xs ${
                        selected
                          ? "bg-amber-500/10 hover:bg-amber-500/15"
                          : ""
                      }`}
                      onClick={() => {
                        onSeleccionar(e.id);
                        onSeek(e.inicio);
                      }}
                      tabIndex={0}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          onSeleccionar(e.id);
                          onSeek(e.inicio);
                        }
                      }}
                    >
                      <TableCell className="py-2 text-center text-zinc-500">
                        {e.n}
                      </TableCell>
                      <TableCell className="py-2 whitespace-nowrap text-amber-200/90">
                        {formatTimecode(e.inicio)}
                      </TableCell>
                      <TableCell className="py-2 whitespace-nowrap text-zinc-300">
                        {formatTimecode(e.fin)}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="block h-1.5 w-16 overflow-hidden rounded bg-zinc-800"
                            aria-hidden
                          >
                            <span
                              className="block h-full rounded"
                              style={{
                                width: `${e.tension}%`,
                                backgroundColor: e.corregido
                                  ? "#fbbf24"
                                  : ANIMO_COLORES[e.animo],
                              }}
                            />
                          </span>
                          {onCorregir ? (
                            <TensionInput escena={e} onCorregir={onCorregir} />
                          ) : (
                            <span className="w-14 text-center tabular-nums text-zinc-200">
                              {e.tension}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={`px-1.5 text-[10px] ${ANIMO_BADGE[e.animo]}`}
                        >
                          {ANIMO_ETIQUETAS[e.animo]}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 font-sans">
                        <span
                          className="block max-w-[280px] truncate text-zinc-400"
                          title={e.texto}
                        >
                          {e.texto}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {escenas.length > MAX_ROWS && (
          <p className="pt-2 text-[11px] text-zinc-500">
            Mostrando las primeras {MAX_ROWS} de {escenas.length} (la lista
            completa está en el CSV).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
