"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import type { Segmento } from "@/lib/fase2/types";
import { formatTimecode } from "@/lib/format";

export interface TranscriptViewProps {
  segmentos: Segmento[];
  fileName: string | null;
  onSeek: (t: number) => void;
}

const MAX_ROWS = 800;

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** MM:SS compacto para el chip de cada frase. */
function formatMS(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p2 = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

export function TranscriptView(props: TranscriptViewProps) {
  const { segmentos, fileName, onSeek } = props;
  const [exported, setExported] = useState(false);
  const shown = segmentos.slice(0, MAX_ROWS);

  const exportCsv = () => {
    const rows = [
      ["n", "bloque", "inicio_tc", "fin_tc", "texto"],
      ...segmentos.map((s, i) => [
        String(i + 1),
        String(s.bloque + 1),
        formatTimecode(s.inicio),
        formatTimecode(s.fin),
        csvCell(s.texto),
      ]),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcripcion-${(fileName ?? "narracion").replace(/\.[^.]+$/, "")}.csv`;
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
            Transcripción por bloques{" "}
            <Badge variant="secondary" className="ms-1 font-mono">
              {segmentos.length}
            </Badge>
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto h-8 gap-1 text-[11px]"
            onClick={exportCsv}
            disabled={segmentos.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            {exported ? "Exportado" : "CSV"}
          </Button>
        </div>
        <CardDescription>
          Clic en una frase para saltar a ese instante de la narración.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        {segmentos.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-800 p-6 text-center text-sm leading-relaxed text-zinc-500">
            La transcripción aparecerá aquí cuando inicies el análisis. Cada
            bloque ≤ 5 min se guarda al completarse: si cancelas o recargas, se
            reanuda donde iba.
          </p>
        ) : (
          <div className="max-h-[420px] overflow-y-auto scroll-thin rounded-md border border-zinc-800/80">
            <ul className="m-0 list-none p-0">
              {shown.map((s) => (
                <li key={s.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSeek(s.inicio)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSeek(s.inicio);
                      }
                    }}
                    className="flex min-h-[44px] cursor-pointer items-start gap-3 border-b border-zinc-900 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-zinc-900/60 focus-visible:bg-zinc-900/60 focus-visible:ring-1 focus-visible:ring-amber-600/50 focus-visible:outline-none"
                    title={`Bloque ${s.bloque + 1} · ${formatTimecode(s.inicio)} → ${formatTimecode(s.fin)}`}
                  >
                    <span className="shrink-0 rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-amber-200/90 tabular-nums">
                      {formatMS(s.inicio)}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-xs leading-relaxed text-zinc-300">
                      {s.texto}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {segmentos.length > MAX_ROWS && (
          <p className="pt-2 text-[11px] text-zinc-500">
            Mostrando las primeras {MAX_ROWS} de {segmentos.length} frases (la
            lista completa está en el CSV).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
