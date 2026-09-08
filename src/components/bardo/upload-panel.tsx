"use client";

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  UploadCloud,
  ShieldCheck,
  MemoryStick,
  ClipboardCheck,
  FileAudio,
} from "lucide-react";

interface UploadPanelProps {
  onFile: (file: File) => void;
}

const ACCEPTED = ".wav,.mp3,.m4a,.ogg,.oga,.flac,.opus,.aac,.webm,audio/*";

export function UploadPanel({ onFile }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = (file: File): boolean => {
    const name = file.name.toLowerCase();
    const extOk = /\.(wav|mp3|m4a|ogg|oga|flac|opus|aac|webm)$/.test(name);
    const typeOk = file.type.startsWith("audio/") || file.type === "";
    if (!extOk && !typeOk) {
      setError(
        `«${file.name}» no parece un archivo de audio. Formatos: WAV, MP3, M4A, OGG, FLAC, Opus, AAC.`
      );
      return false;
    }
    if (file.size < 1024) {
      setError("El archivo está vacío o es demasiado pequeño.");
      return false;
    }
    setError(null);
    return true;
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && validate(file)) onFile(file);
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <FileAudio className="h-4 w-4" />
          <AlertTitle>Archivo rechazado</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="border-zinc-800 bg-zinc-950/60">
        <CardContent className="p-0">
          <div
            role="button"
            tabIndex={0}
            aria-label="Zona de carga de audio"
            className={[
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors sm:p-12",
              dragOver
                ? "border-amber-500/70 bg-amber-950/20"
                : "border-zinc-700/80 bg-zinc-900/30 hover:border-zinc-600",
            ].join(" ")}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
              <UploadCloud className="h-7 w-7" />
            </span>
            <div className="space-y-1">
              <p className="text-base font-semibold text-zinc-100">
                Arrastra tu narración o haz clic para elegir el archivo
              </p>
              <p className="text-xs text-zinc-500">
                WAV (análisis exacto por bloques) · MP3/M4A/OGG (decodificación
                por bloques) · hasta 3+ horas
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: ClipboardCheck,
            title: "Auditoría por fases",
            desc: "El pipeline se detiene en cada fase y espera tu clic de aprobación.",
          },
          {
            icon: MemoryStick,
            title: "3+ horas sin agotar RAM",
            desc: "Análisis por bloques ≤ 5 min con barra de progreso por bloque.",
          },
          {
            icon: ShieldCheck,
            title: "Análisis local",
            desc:
              "La Fase 1 se analiza en tu navegador; la Fase 2 puede usar IA conectada o el motor 100 % local y gratis.",
          },
        ].map((f) => (
          <div
            key={f.title}
            className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3.5"
          >
            <f.icon className="mb-2 h-4 w-4 text-amber-400" />
            <p className="text-xs font-semibold text-zinc-200">{f.title}</p>
            <p className="pt-1 text-[11px] leading-snug text-zinc-500">
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
