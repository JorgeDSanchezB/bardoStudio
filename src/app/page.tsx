"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AudioWaveform,
  ShieldCheck,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { useProjectStore, type FileMeta } from "@/store/project";
import { analyzeAudio } from "@/lib/audio/analyze";
import type { AnalysisOptions } from "@/lib/audio/types";
import { loadAnalysis, deleteAnalysis } from "@/lib/idb";
import { clamp, formatDurSmart, formatBytes } from "@/lib/format";
import { PhaseStepper } from "@/components/bardo/phase-stepper";
import { UploadPanel } from "@/components/bardo/upload-panel";
import { AnalysisProgress } from "@/components/bardo/analysis-progress";
import { WaveformTimeline } from "@/components/bardo/waveform-timeline";
import { TransportBar } from "@/components/bardo/transport-bar";
import { SilenceTable } from "@/components/bardo/silence-table";
import { ThresholdPanel } from "@/components/bardo/threshold-panel";
import { ApprovalGate } from "@/components/bardo/approval-gate";
import { Phase2Teaser, RestoreCard } from "@/components/bardo/phase-teasers";

export default function Page() {
  const status = useProjectStore((s) => s.status);
  const fileMeta = useProjectStore((s) => s.fileMeta);
  const sourceKind = useProjectStore((s) => s.sourceKind);
  const analysis = useProjectStore((s) => s.analysis);
  const progress = useProjectStore((s) => s.progress);
  const silences = useProjectStore((s) => s.silences);
  const silenceStats = useProjectStore((s) => s.silenceStats);
  const thresholds = useProjectStore((s) => s.thresholds);
  const analysisOpts = useProjectStore((s) => s.analysisOpts);
  const savedResult = useProjectStore((s) => s.savedResult);
  const error = useProjectStore((s) => s.error);
  const playheadSec = useProjectStore((s) => s.playheadSec);
  const configDefaults = useProjectStore((s) => s.configDefaults);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cancelRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const durationSec = analysis?.durationSec ?? 0;

  // ---------- hidratación del store persistido ----------
  useEffect(() => {
    const api = useProjectStore.persist;
    if (api.hasHydrated()) setHydrated(true);
    const un = api.onFinishHydration(() => setHydrated(true));
    return () => un();
  }, []);

  // ---------- restauración tras recargar ----------
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      const st = useProjectStore.getState();
      if (st.fileMeta && st.status !== "empty" && st.status !== "analyzing") {
        const saved = await loadAnalysis(st.fileMeta.key).catch(
          () => undefined
        );
        if (saved && st.savedResult && saved.envDb.length > 0) {
          const gi = st.gridInfo;
          st.restoreAnalysis({
            sampleRate: st.savedResult.sampleRate,
            channels: st.savedResult.channels,
            format: st.savedResult.format,
            peaksPerSec: gi?.peaksPerSec ?? st.analysisOpts.peaksPerSec,
            envelopeHopSec: gi?.envelopeHopSec ?? st.analysisOpts.envelopeHopSec,
            peaksMin: saved.peaksMin,
            peaksMax: saved.peaksMax,
            envDb: saved.envDb,
            durationSec: st.savedResult.durationSec,
          });
          st.recomputeSilences();
        }
        if (st.sourceKind === "demo") {
          setSourceUrl("/demo/narration-demo.wav");
        } else {
          st.setSourceMissing(true);
        }
      }
    })();
  }, [hydrated]);

  // ---------- configuración desde config.json (vía API) ----------
  useEffect(() => {
    if (!hydrated) return;
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: unknown) => {
        if (!cfg) return;
        const c = cfg as {
          silencio?: {
            umbralDb?: number;
            duracionMinimaSeg?: number;
            fusionHuecosSeg?: number;
          };
          analisis?: Partial<AnalysisOptions>;
        };
        useProjectStore.getState().seedFromConfig(c);
      })
      .catch(() => undefined);
  }, [hydrated]);

  // ---------- eventos del elemento <audio> ----------
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onLoaded = () => setSourceReady(true);
    const onErr = () => setSourceReady(false);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("canplay", onLoaded);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("error", onErr);
    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("canplay", onLoaded);
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("error", onErr);
    };
  }, []);

  // fuente del <audio>
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (sourceUrl) {
      a.src = sourceUrl;
      a.load();
      setSourceReady(false);
    } else {
      a.removeAttribute("src");
      setSourceReady(false);
    }
  }, [sourceUrl]);

  // playhead fluido (60 fps solo mientras suena)
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const a = audioRef.current;
      if (a) useProjectStore.getState().setPlayhead(a.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = useCallback(
    (t: number) => {
      const dur = useProjectStore.getState().analysis?.durationSec ?? 0;
      const tt = clamp(t, 0, Math.max(0, dur));
      const a = audioRef.current;
      if (a && a.src) {
        try {
          a.currentTime = tt;
        } catch {
          /* seek antes de metadata */
        }
      }
      useProjectStore.getState().setPlayhead(tt);
    },
    []
  );

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.src) return;
    if (a.paused) {
      a.play().catch(() => undefined);
    } else {
      a.pause();
    }
  }, []);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      try {
        a.currentTime = 0;
      } catch {
        /* noop */
      }
    }
    useProjectStore.getState().setPlayhead(0);
  }, []);

  // barra espaciadora = play/pausa (como en un DAW)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.getAttribute("role") === "slider" ||
          target.getAttribute("role") === "checkbox")
      )
        return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  // ---------- ejecución del análisis por bloques ----------
  const runAnalysis = useCallback(
    async (blob: Blob, meta: FileMeta, kind: "demo" | "user") => {
      cancelRef.current = false;
      const st = useProjectStore.getState();
      st.beginAnalysis(meta, kind);
      const opts: AnalysisOptions = st.analysisOpts;
      try {
        const result = await analyzeAudio(blob, opts, {
          onMeta: (m) => useProjectStore.getState().setMetaInfo(m),
          onProgress: (p) => useProjectStore.getState().setProgress(p),
          onChunk: (c) => useProjectStore.getState().appendChunk(c),
          cancel: () => cancelRef.current,
        });
        useProjectStore.getState().finishAnalysis(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("cancel")) {
          useProjectStore.getState().cancelAnalysis();
        } else {
          useProjectStore.getState().failAnalysis(msg);
        }
      }
    },
    []
  );

  const attachSource = (file: Blob, kind: "demo" | "user") => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setSourceUrl(url);
    void kind;
  };

  const handleFile = useCallback(
    (file: File) => {
      attachSource(file, "user");
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      void deleteAnalysis(key).catch(() => undefined);
      const meta: FileMeta = {
        name: file.name,
        size: file.size,
        type: file.type || "audio/*",
        lastModified: file.lastModified || Date.now(),
        key,
      };
      void runAnalysis(file, meta, "user");
    },
    [runAnalysis]
  );

  const loadDemo = useCallback(async () => {
    setDemoLoading(true);
    try {
      const res = await fetch("/demo/narration-demo.wav");
      const blob = await res.blob();
      const file = new File([blob], "narracion-demo.wav", {
        type: "audio/wav",
      });
      attachSource(file, "demo");
      const key = "demo:narration-demo.wav:16140644:0";
      void deleteAnalysis(key).catch(() => undefined);
      await runAnalysis(file, { name: file.name, size: file.size, type: "audio/wav", lastModified: 0, key }, "demo");
    } catch {
      useProjectStore.getState().failAnalysis("No se pudo descargar la demo.");
    } finally {
      setDemoLoading(false);
    }
  }, [runAnalysis]);

  const resetAll = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setSourceUrl(null);
    const key = useProjectStore.getState().fileMeta?.key;
    if (key) void deleteAnalysis(key).catch(() => undefined);
    useProjectStore.getState().resetAll();
  }, []);

  const reanalyze = useCallback(() => {
    if (sourceKind === "demo") {
      void loadDemo();
    } else {
      useProjectStore.getState().resetAll();
      setSourceUrl(null);
    }
  }, [sourceKind, loadDemo]);

  // ---------- render ----------
  const showUpload = !hydrated || status === "empty";
  const formatLabel =
    savedResult?.format === "wav"
      ? `WAV · ${analysis?.sampleRate.toLocaleString("es") ?? "?"} Hz · ${
          analysis?.channels ?? "?"
        } canal${(analysis?.channels ?? 1) > 1 ? "es" : ""}`
      : savedResult
        ? `Decodificado · ${analysis?.sampleRate.toLocaleString("es") ?? "?"} Hz`
        : "—";

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* ---------------- cabecera ---------------- */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
            <AudioWaveform className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-wide sm:text-base">
              Bardo Studio
            </h1>
            <p className="hidden text-[11px] text-zinc-500 sm:block">
              Musicalización auditable de narraciones · D&amp;D y audiolibros
            </p>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <Badge
              variant="outline"
              className="gap-1 border-emerald-800/60 text-[10px] text-emerald-300"
            >
              <ShieldCheck className="h-3 w-3" /> 100 % local
            </Badge>
            <Badge variant="outline" className="text-[10px] text-zinc-400">
              Fase 1 / 6
            </Badge>
          </div>
        </div>
      </header>

      {/* ---------------- contenido ---------------- */}
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 pt-5 pb-10 sm:px-6 lg:px-8">
        <PhaseStepper phase1Status={status} />

        <AnimatePresence mode="wait">
          {showUpload && (
            <motion.section
              key="upload"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="space-y-5"
            >
              <div className="space-y-2 pt-2">
                <h2 className="text-xl font-bold sm:text-2xl">
                  Fase 1 · Ingestión y análisis visual
                </h2>
                <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
                  Carga la narración de tu sesión: verás su{" "}
                  <strong className="text-zinc-200">forma de onda</strong>, los{" "}
                  <strong className="text-rose-300">silencios</strong> (pausas
                  ≥ 2 s) marcados en la línea de tiempo, y podrás ajustar el
                  umbral antes de aprobar. El audio se procesa{" "}
                  <strong className="text-zinc-200">
                    por bloques en tu propio navegador
                  </strong>{" "}
                  — nada se sube a internet.
                </p>
              </div>
              <UploadPanel
                onFile={handleFile}
                onDemo={loadDemo}
                demoLoading={demoLoading}
              />
            </motion.section>
          )}

          {status === "analyzing" && progress && fileMeta && (
            <motion.section
              key="analyzing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <AnalysisProgress
                fileName={fileMeta.name}
                progress={progress}
                analysis={analysis}
                onCancel={() => {
                  cancelRef.current = true;
                }}
              />
            </motion.section>
          )}

          {(status === "review" ||
            status === "approved" ||
            status === "error") &&
            fileMeta && (
              <motion.section
                key="workspace"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-5"
              >
                {status === "error" && error && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Error durante el análisis</AlertTitle>
                    <AlertDescription>
                      {error} — Prueba con WAV o recodifica el archivo y vuelve
                      a intentarlo.
                    </AlertDescription>
                  </Alert>
                )}

                {!analysis && <RestoreCard onReanalyze={reanalyze} isDemo={sourceKind === "demo"} />}

                {analysis && (
                  <>
                    {/* tarjeta de transporte */}
                    <Card className="border-zinc-800 bg-zinc-950/60">
                      <CardContent className="p-4">
                        <TransportBar
                          playing={playing}
                          playheadSec={playheadSec}
                          durationSec={durationSec}
                          sourceReady={sourceReady}
                          silences={silences}
                          onTogglePlay={togglePlay}
                          onStop={stop}
                          onSeek={seek}
                        />
                        {!sourceReady && sourceKind === "user" && (
                          <p className="pt-2 text-[11px] text-zinc-500">
                            Recargaste la página: el análisis está restaurado
                            desde el caché local, pero para reproducir audio
                            pulsa «Volver a analizar» y re-selecciona el
                            archivo.
                          </p>
                        )}
                      </CardContent>
                    </Card>

                    {/* línea de tiempo */}
                    <Card className="border-zinc-800 bg-zinc-950/60">
                      <CardContent className="p-4">
                        <WaveformTimeline
                          analysis={analysis}
                          silences={silences}
                          durationSec={durationSec}
                          playheadSec={playheadSec}
                          playing={playing}
                          thresholdDb={thresholds.dbThreshold}
                          onSeek={seek}
                        />
                      </CardContent>
                    </Card>

                    {/* umbrales + tabla */}
                    <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
                      <ThresholdPanel
                        thresholds={thresholds}
                        defaults={
                          configDefaults ?? {
                            dbThreshold: -38,
                            minDurationSec: 2,
                            mergeGapSec: thresholds.mergeGapSec,
                          }
                        }
                        onChange={(t) => {
                          useProjectStore.getState().setThresholds(t);
                          useProjectStore.getState().recomputeSilences();
                        }}
                        silences={silences.length}
                        totalSilenceSec={silenceStats.totalSilenceSec}
                        speechRatio={silenceStats.speechRatio}
                        durationSec={durationSec}
                      />
                      <SilenceTable
                        silences={silences}
                        onSeek={seek}
                        fileName={fileMeta.name}
                      />
                    </div>

                    {/* metadatos del análisis */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-500">
                      <span>
                        Archivo:{" "}
                        <span className="text-zinc-300">{fileMeta.name}</span>
                      </span>
                      <span>Tamaño: {formatBytes(fileMeta.size)}</span>
                      <span>Formato: {formatLabel}</span>
                      {savedResult && (
                        <span>
                          Bloques: {savedResult.totalChunks} ×{" "}
                          {savedResult.chunkSeconds.toFixed(0)} s
                        </span>
                      )}
                      <span>Duración: {formatDurSmart(durationSec)}</span>
                    </div>

                    {/* puerta de auditoría */}
                    <ApprovalGate
                      approved={status === "approved"}
                      silences={silences.length}
                      durationLabel={formatDurSmart(durationSec)}
                      onApprove={() => useProjectStore.getState().approve()}
                      onReopen={() => useProjectStore.getState().reopen()}
                      onReanalyze={reanalyze}
                    />
                  </>
                )}

                <div className="flex flex-col gap-3 sm:flex-row">
                  {status === "approved" && <Phase2Teaser />}
                  {status === "approved" && (
                    <Card className="h-fit border-zinc-800/80 bg-zinc-900/30 sm:max-w-xs">
                      <CardHeader className="pb-1">
                        <CardTitle className="text-xs text-zinc-400">
                          Estado del pipeline
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pb-4">
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          Fase 1 completada y bloqueada. Las fases 2–6 se
                          entregan de forma incremental, cada una con su
                          propia ventana de auditoría.
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-3 h-8 gap-1 text-[11px] text-rose-300/80 hover:text-rose-300"
                          onClick={resetAll}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Descartar proyecto
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </motion.section>
            )}
        </AnimatePresence>
      </main>

      {/* Elemento de audio siempre montado (los efectos conectan src y
          eventos desde el primer render) */}
      <audio ref={audioRef} preload="metadata" className="hidden">
        <track kind="captions" />
      </audio>

      {/* ---------------- pie pegajoso ---------------- */}
      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/95">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[11px] text-zinc-500 sm:px-6 lg:px-8">
          <span>
            Bardo Studio · pipeline auditable de musicalización de narraciones
          </span>
          <span className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            {fileMeta && (
              <span className="max-w-[180px] truncate text-zinc-400">
                {fileMeta.name}
              </span>
            )}
            <span>
              Bloques ≤ 5 min · RAM acotada · procesamiento local
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
