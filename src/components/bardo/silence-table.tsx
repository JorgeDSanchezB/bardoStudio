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
import { Download, Play } from "lucide-react";
import type { SilenceRegion } from "@/lib/audio/silence";
import { formatTimecode } from "@/lib/format";

interface SilenceTableProps {
  silences: SilenceRegion[];
  onSeek: (t: number) => void;
  fileName: string | null;
}

const MAX_ROWS = 500;

export function SilenceTable({ silences, onSeek, fileName }: SilenceTableProps) {
  const [exported, setExported] = useState(false);
  const shown = silences.slice(0, MAX_ROWS);

  const exportCsv = () => {
    const rows = [
      ["#", "inicio_tc", "fin_tc", "inicio_s", "fin_s", "duracion_s"],
      ...silences.map((s, i) => [
        String(i + 1),
        formatTimecode(s.start),
        formatTimecode(s.end),
        s.start.toFixed(3),
        s.end.toFixed(3),
        (s.end - s.start).toFixed(3),
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `silencios-${(fileName ?? "narracion").replace(/\.[^.]+$/, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  };

  return (
    <Card className="min-w-0 border-zinc-800 bg-zinc-950/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            Silencios detectados{" "}
            <Badge variant="secondary" className="ms-1 font-mono">
              {silences.length}
            </Badge>
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto h-8 gap-1 text-[11px]"
            onClick={exportCsv}
            disabled={silences.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {exported ? "Exportado" : "CSV"}
          </Button>
        </div>
        <CardDescription>
          Clic en una fila para saltar al inicio de cada pausa.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        {silences.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
            No hay silencios con el umbral actual. Prueba a subir el nivel de
            dB o bajar la duración mínima.
          </p>
        ) : (
          <div className="max-h-72 overflow-x-auto overflow-y-auto scroll-thin rounded-md border border-zinc-800/80">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-zinc-900">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-9 w-10 text-center">#</TableHead>
                  <TableHead className="h-9">Inicio</TableHead>
                  <TableHead className="h-9">Fin</TableHead>
                  <TableHead className="h-9 text-right">Duración</TableHead>
                  <TableHead className="h-9 w-12" aria-label="Reproducir" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((s, i) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer font-mono text-xs"
                    onClick={() => onSeek(s.start)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSeek(s.start);
                      }
                    }}
                  >
                    <TableCell className="py-1.5 text-center text-zinc-500">
                      {i + 1}
                    </TableCell>
                    <TableCell className="py-1.5 text-amber-200/90">
                      {formatTimecode(s.start)}
                    </TableCell>
                    <TableCell className="py-1.5 text-zinc-300">
                      {formatTimecode(s.end)}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-rose-300">
                      {(s.end - s.start).toFixed(2)}s
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      <Play className="h-3 w-3 text-zinc-600" aria-hidden />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {silences.length > MAX_ROWS && (
          <p className="pt-2 text-[11px] text-zinc-500">
            Mostrando los primeros {MAX_ROWS} de {silences.length} (la lista
          completa está en el CSV).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
