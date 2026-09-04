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
  AudioLines,
  Play,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { useProjectStore, type FileMeta } from "@/store/project";
import { analyzeAudio } from "@/lib/audio/analyze";
import type { AnalysisOptions } from "@/lib/audio/types";
import { loadAnalysis, deleteAnalysis } from "@/lib/idb";
import { clamp, formatDurSmart, formatBytes } from "@/lib/format";
import { PhaseStepper, type EstadosFases } from "@/components/bardo/phase-stepper";
import { UploadPanel } from "@/components/bardo/upload-panel";
import { AnalysisProgress } from "@/components/bardo/analysis-progress";
import { WaveformTimeline } from "@/components/bardo/waveform-timeline";
import { TransportBar } from "@/components/bardo/transport-bar";
import { SilenceTable } from "@/components/bardo/silence-table";
import { ThresholdPanel } from "@/components/bardo/threshold-panel";
import { ApprovalGate } from "@/components/bardo/approval-gate";
import { RestoreCard } from "@/components/bardo/phase-teasers";
import { TensionGraph } from "@/components/bardo/tension-graph";
import { EscenasTable } from "@/components/bardo/escenas-table";
import { TranscriptView } from "@/components/bardo/transcript-view";
import { Fase2Progress } from "@/components/bardo/fase2-progress";
import { Fase2Gate } from "@/components/bardo/fase2-gate";
import { Fase3Seccion } from "@/components/bardo/fase3-seccion";
import { Fase4Seccion } from "@/components/bardo/fase4-seccion";
import { Fase5Seccion } from "@/components/bardo/fase5-seccion";
import { Fase6Seccion } from "@/components/bardo/fase6-seccion";
import { obtenerControlMotor } from "@/lib/fase5/registro-motor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ejecutarFase2 } from "@/lib/fase2/pipeline";
import { FASE2_CONFIG_DEFECTO } from "@/lib/fase2/types";

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
  const fase2 = useProjectStore((s) => s.fase2);
  const fase3 = useProjectStore((s) => s.fase3);
  const fase4 = useProjectStore((s) => s.fase4);
  const fase5 = useProjectStore((s) => s.fase5);
  const fase6 = useProjectStore((s) => s.fase6);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cancelRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoVozLoading, setDemoVozLoading] = useState(false);
  const [escenaSel, setEscenaSel] = useState<string | null>(null);
  const cancelFase2Ref = useRef(false);
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
          setSourceUrl(
            st.fileMeta?.name === "narracion-voz-demo.wav"
              ? "/demo/narracion-voz-demo.wav"
              : "/demo/narration-demo.wav"
          );
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
          fase2?: unknown;
          fase3?: unknown;
          fase4?: unknown;
          fase6?: unknown;
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

  // barra espaciadora = play/pausa (motor de mezcla en Fase 5 o audio de Fase 1)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (['BUTTON', "INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.getAttribute("role") === "slider" ||
          target.getAttribute("role") === "checkbox" ||
          target.getAttribute("role") === "switch")
      )
        return;
      e.preventDefault();
      const control = obtenerControlMotor();
      if (control) {
        control.toggle();
        return;
      }
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

  // ---------- Fase 2: transcripción + tensión ----------
  const runFase2 = useCallback(
    async (rehacer: boolean) => {
      const st = useProjectStore.getState();
      const a = st.analysis;
      if (!a || a.envDb.length === 0 || !st.fileMeta) return;
      const url = objectUrlRef.current ?? sourceUrl;
      if (!url) {
        st.fallarFase2(
          "No hay audio fuente disponible: vuelve a cargar el archivo (o la demo) para transcribir."
        );
        return;
      }
      let blob: Blob;
      try {
        blob = await (await fetch(url)).blob();
      } catch {
        st.fallarFase2("No se pudo leer el audio fuente para transcribir.");
        return;
      }
      const config = st.fase2.configFase2 ?? FASE2_CONFIG_DEFECTO;
      cancelFase2Ref.current = false;
      st.iniciarFase2();
      try {
        const salida = await ejecutarFase2(
          {
            blob,
            envDb: a.envDb,
            hopSec: a.envelopeHopSec,
            durationSec: a.durationSec,
            silencios: st.silences,
            umbralDb: st.thresholds.dbThreshold,
            config,
            claveFuente: st.fileMeta.key,
            previos: rehacer
              ? undefined
              : {
                  segmentos: st.fase2.segmentos,
                  bloquesHechos: st.fase2.bloquesHechos,
                },
          },
          {
            onProgreso: (p) => useProjectStore.getState().setProgresoFase2(p),
            onBloque: (b, nuevos, hechos, todos) =>
              useProjectStore
                .getState()
                .bloqueFase2Hecho(b, nuevos, hechos, todos),
            onAviso: () => undefined,
            cancel: () => cancelFase2Ref.current,
          }
        );
        useProjectStore
          .getState()
          .terminarFase2(salida.escenas, salida.resumen, salida.avisos);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("cancelado")) {
          useProjectStore.getState().cancelarFase2();
        } else {
          useProjectStore.getState().fallarFase2(msg);
        }
      }
    },
    [sourceUrl]
  );

  const rehacerFase2Confirm = useCallback(() => {
    if (
      window.confirm(
        "¿Rehacer la Fase 2 desde cero? Se borrarán la transcripción y la curva de tensión actuales."
      )
    ) {
      setEscenaSel(null);
      useProjectStore.getState().rehacerFase2();
      void runFase2(true);
    }
  }, [runFase2]);

  const cargarDemoVoz = useCallback(async () => {
    setDemoVozLoading(true);
    try {
      const res = await fetch("/demo/narracion-voz-demo.wav");
      const blob = await res.blob();
      const file = new File([blob], "narracion-voz-demo.wav", {
        type: "audio/wav",
      });
      attachSource(file, "demo");
      const key = `demo:narracion-voz-demo.wav:${blob.size}:0`;
      void deleteAnalysis(key).catch(() => undefined);
      await runAnalysis(
        file,
        { name: file.name, size: blob.size, type: "audio/wav", lastModified: 0, key },
        "demo"
      );
    } catch {
      useProjectStore
        .getState()
        .failAnalysis("No se pudo descargar la demo con voz.");
    } finally {
      setDemoVozLoading(false);
    }
  }, [runAnalysis]);

  // ---------- render ----------
  const showUpload = !hydrated || status === "empty";

  // estados del stepper (6 fases)
  const stepStatuses: EstadosFases = [
    status === "approved"
      ? "approved"
      : status === "analyzing"
        ? "running"
        : status === "review" || status === "error"
          ? "review"
          : "idle",
    status === "approved"
      ? fase2.status === "error"
        ? "review"
        : fase2.status === "running"
          ? "running"
          : fase2.status === "approved"
            ? "approved"
            : fase2.escenas.length > 0 || fase2.bloquesHechos.length > 0
              ? "review"
              : "idle"
      : "locked",
    fase2.status === "approved"
      ? fase3.status === "error"
        ? "review"
        : fase3.status
      : "locked",
    fase3.status === "approved"
      ? fase4.status === "error"
        ? "review"
        : fase4.status
      : "locked",
    fase4.status === "approved"
      ? fase5.status === "error"
        ? "review"
        : fase5.status
      : "locked",
    fase5.status === "approved"
      ? fase6.status === "error"
        ? "review"
        : fase6.status
      : "locked",
  ];
  const faseActiva = (() => {
    const idx = stepStatuses.findIndex((st) => st !== "approved");
    return idx < 0 ? 6 : idx + 1;
  })();
  const formatLabel =
    savedResult?.format === "wav"
      ? `WAV · ${analysis?.sampleRate.toLocaleString("es") ?? "?"} Hz · ${
          analysis?.channels ?? "?"
        } canal${(analysis?.channels ?? 1) > 1 ? "es" : ""}`
      : savedResult
        ? `Decodificado · ${analysis?.sampleRate.toLocaleString("es") ?? "?"} Hz`
        : "—";

  // derivados de la Fase 2
  const fase2EnCurso = fase2.status === "running";
  const fase2Listo =
    fase2.escenas.length > 0 &&
    (fase2.status === "review" || fase2.status === "approved");
  const fase2Reanudable =
    fase2.bloquesHechos.length > 0 || fase2.segmentos.length > 0;
  const fase2Corregidas = fase2.escenas.filter((e) => e.corregido).length;
  const fase2Media = fase2.escenas.length
    ? Math.round(
        fase2.escenas.reduce((s, e) => s + e.tension, 0) / fase2.escenas.length
      )
    : 0;
  const fase2Pico = fase2.escenas.reduce((m, e) => Math.max(m, e.tension), 0);
  const bloquesEst = Math.max(
    1,
    Math.ceil(
      durationSec /
        (fase2.configFase2?.transcripcion.bloqueSegundos ??
          FASE2_CONFIG_DEFECTO.transcripcion.bloqueSegundos)
    )
  );

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
              <ShieldCheck className="h-3 w-3" /> 6 fases auditables
            </Badge>
            <Badge variant="outline" className="text-[10px] text-zinc-400">
              Fase {faseActiva} / 6
            </Badge>
          </div>
        </div>
      </header>

      {/* ---------------- contenido ---------------- */}
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 pt-5 pb-10 sm:px-6 lg:px-8">
        <PhaseStepper statuses={stepStatuses} />

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
                  — la Fase 1 no sube nada a internet.
                </p>
              </div>
              <UploadPanel
                onFile={handleFile}
                onDemo={loadDemo}
                demoLoading={demoLoading}
                onDemoVoz={cargarDemoVoz}
                demoVozLoading={demoVozLoading}
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

                    {/* ============ FASE 2: transcripción + curva de tensión ============ */}
                    {status === "approved" && (
                      <section
                        className="space-y-4"
                        aria-label="Fase 2: transcripción y curva de tensión"
                      >
                        <div className="space-y-1 pt-1">
                          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
                            <AudioLines className="h-5 w-5 text-amber-400" />
                            Fase 2 · Transcripción y curva de tensión
                          </h2>
                          <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
                            La narración se transcribe{" "}
                            <strong className="text-zinc-200">
                              por bloques ≤ 5 min
                            </strong>{" "}
                            cortados en los silencios que aprobaste; cada frase se
                            alinea con la energía de voz y el motor de IA puntúa
                            la{" "}
                            <strong className="text-zinc-200">
                              tensión 0–100 y el ánimo
                            </strong>{" "}
                            de cada escena. Corrige cualquier punto{" "}
                            <strong className="text-zinc-200">
                              arrastrándolo
                            </strong>{" "}
                            y aprueba para desbloquear la Fase 3.
                          </p>
                        </div>

                        {fase2.status === "error" && fase2.error && (
                          <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Error durante la Fase 2</AlertTitle>
                            <AlertDescription>
                              {fase2.error} — el progreso por bloques ya guardado
                              se conserva: pulsa el botón para continuar donde se
                              quedó.
                            </AlertDescription>
                          </Alert>
                        )}

                        {/* arranque / reanudación */}
                        {!fase2Listo && !fase2EnCurso && (
                          <Card className="border-amber-800/40 bg-amber-950/10">
                            <CardContent className="space-y-3 p-4">
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                                <span>
                                  Duración:{" "}
                                  <span className="text-zinc-300">
                                    {formatDurSmart(durationSec)}
                                  </span>
                                </span>
                                <span>
                                  Bloques ≈{" "}
                                  <span className="text-zinc-300">{bloquesEst}</span>{" "}
                                  · escenas de{" "}
                                  <span className="text-zinc-300">
                                    {fase2.configFase2?.escenaSegundos ??
                                      FASE2_CONFIG_DEFECTO.escenaSegundos}{" "}
                                    s
                                  </span>
                                </span>
                                <span>
                                  Silencios de referencia:{" "}
                                  <span className="text-zinc-300">
                                    {silences.length}
                                  </span>
                                </span>
                              </div>

                              {analysis?.format === "decoded" &&
                                durationSec > 3600 && (
                                  <p className="flex items-center gap-2 text-[11px] text-amber-300/90">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    Formato comprimido de más de 1 h: para
                                    transcribir se decodifica el archivo
                                    completo en memoria. Para narraciones de 3+
                                    horas usa WAV.
                                  </p>
                                )}

                              {!sourceUrl && (
                                <p className="flex items-center gap-2 text-[11px] text-amber-300/90">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  Tras recargar la página el archivo fuente no
                                  está disponible: usa «Volver a analizar» y
                                  re-selecciona el audio para poder transcribir.
                                </p>
                              )}

                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400"
                                  disabled={!sourceUrl}
                                  onClick={() => void runFase2(false)}
                                >
                                  <Play className="me-1 h-4 w-4" />
                                  {fase2Reanudable
                                    ? `Reanudar transcripción (${fase2.bloquesHechos.length} bloques ya listos)`
                                    : "Iniciar transcripción y análisis"}
                                </Button>
                                {fase2Reanudable && (
                                  <Button
                                    variant="ghost"
                                    className="text-zinc-400"
                                    onClick={rehacerFase2Confirm}
                                  >
                                    <RotateCcw className="me-1 h-4 w-4" />
                                    Rehacer desde cero
                                  </Button>
                                )}
                              </div>

                              <p className="text-[11px] leading-relaxed text-zinc-500">
                                Cada bloque se guarda al completarse: puedes
                                cancelar o recargar y reanudar sin repetir
                                llamadas. La transcripción viaja por sub-bloques
                                ≤ 28 s al motor ASR del servicio; el análisis
                                dramático combina el texto con la energía de voz
                                (pesos editables en config.json).
                              </p>
                            </CardContent>
                          </Card>
                        )}

                        {/* en curso */}
                        {fase2EnCurso && (
                          <>
                            {fase2.progreso ? (
                              <Fase2Progress
                                progreso={fase2.progreso}
                                reanudadas={fase2.segmentos.length}
                                duracionTotalSec={durationSec}
                                onCancel={() => {
                                  cancelFase2Ref.current = true;
                                }}
                              />
                            ) : (
                              <Card className="border-zinc-800 bg-zinc-950/60">
                                <CardContent className="flex items-center gap-3 p-4 text-sm text-zinc-400">
                                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                                  Preparando la Fase 2…
                                </CardContent>
                              </Card>
                            )}
                            {fase2.escenas.length > 0 && (
                              <Card className="border-zinc-800 bg-zinc-950/60">
                                <CardContent className="p-4">
                                  <TensionGraph
                                    escenas={fase2.escenas}
                                    durationSec={durationSec}
                                    playheadSec={playheadSec}
                                    selectedId={escenaSel}
                                    soloLectura
                                    onCorregir={() => undefined}
                                    onSeleccionar={setEscenaSel}
                                    onSeek={seek}
                                  />
                                </CardContent>
                              </Card>
                            )}
                          </>
                        )}

                        {/* resultados */}
                        {fase2Listo && (
                          <>
                            <Card className="border-zinc-800 bg-zinc-950/60">
                              <CardContent className="p-4">
                                <TensionGraph
                                  escenas={fase2.escenas}
                                  durationSec={durationSec}
                                  playheadSec={playheadSec}
                                  selectedId={escenaSel}
                                  soloLectura={fase2.status === "approved"}
                                  onCorregir={(id, v) =>
                                    useProjectStore
                                      .getState()
                                      .corregirTension(id, v)
                                  }
                                  onSeleccionar={setEscenaSel}
                                  onSeek={seek}
                                  onRestaurar={() =>
                                    useProjectStore
                                      .getState()
                                      .restaurarTensiones()
                                  }
                                />
                              </CardContent>
                            </Card>

                            <Tabs defaultValue="escenas">
                              <TabsList>
                                <TabsTrigger value="escenas">
                                  Escenas y tensión
                                </TabsTrigger>
                                <TabsTrigger value="transcripcion">
                                  Transcripción
                                </TabsTrigger>
                              </TabsList>
                              <TabsContent value="escenas">
                                <EscenasTable
                                  escenas={fase2.escenas}
                                  selectedId={escenaSel}
                                  fileName={fileMeta?.name ?? null}
                                  onSeleccionar={setEscenaSel}
                                  onSeek={seek}
                                  onCorregir={(id, v) =>
                                    useProjectStore
                                      .getState()
                                      .corregirTension(id, v)
                                  }
                                />
                              </TabsContent>
                              <TabsContent value="transcripcion">
                                <TranscriptView
                                  segmentos={fase2.segmentos}
                                  fileName={fileMeta?.name ?? null}
                                  onSeek={seek}
                                />
                              </TabsContent>
                            </Tabs>

                            {fase2.resumen && (
                              <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-500">
                                <span>
                                  Emoción:{" "}
                                  <span className="text-zinc-300">
                                    {fase2.resumen.motorEmocion}
                                  </span>
                                </span>
                                <span>
                                  Bloques: {fase2.resumen.bloques} · llamadas
                                  ASR: {fase2.resumen.solicitudesAsr}
                                </span>
                                <span>
                                  Frases: {fase2.resumen.segmentos} · escenas:{" "}
                                  {fase2.resumen.escenas} ·{" "}
                                  {fase2.resumen.caracteres.toLocaleString(
                                    "es"
                                  )}{" "}
                                  caracteres
                                </span>
                              </div>
                            )}

                            {fase2.avisos.length > 0 && (
                              <Alert className="border-amber-800/50 bg-amber-950/20 text-amber-200">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertTitle>Avisos del análisis</AlertTitle>
                                <AlertDescription>
                                  <ul className="list-disc space-y-0.5 ps-4">
                                    {fase2.avisos.map((av, i) => (
                                      <li key={i}>{av.texto}</li>
                                    ))}
                                  </ul>
                                </AlertDescription>
                              </Alert>
                            )}

                            <Fase2Gate
                              approved={fase2.status === "approved"}
                              escenas={fase2.escenas.length}
                              corregidas={fase2Corregidas}
                              tensionMedia={fase2Media}
                              picoTension={fase2Pico}
                              onApprove={() =>
                                useProjectStore.getState().aprobarFase2()
                              }
                              onReopen={() => {
                                if (
                                  window.confirm(
                                    "Al reabrir la Fase 2 se reinician las fases 3-6 (asignaciones, mezcla, editor y exportación). ¿Continuar?"
                                  )
                                ) {
                                  useProjectStore.getState().reabrirFase2();
                                }
                              }}
                              onRehacer={rehacerFase2Confirm}
                            />
                          </>
                        )}
                      </section>
                    )}

                    {/* ============ FASES 3-6: música, mezcla, editor, exportación ============ */}
                    {status === "approved" && fase2.status === "approved" && (
                      <>
                        <Fase3Seccion />
                        <Fase4Seccion />
                        <Fase5Seccion sourceUrl={sourceUrl} />
                        <Fase6Seccion sourceUrl={sourceUrl} />
                      </>
                    )}
                  </>
                )}

                <div className="flex flex-col gap-3 sm:flex-row">
                  {status === "approved" && (
                    <Card className="h-fit border-zinc-800/80 bg-zinc-900/30 sm:max-w-xs">
                      <CardHeader className="pb-1">
                        <CardTitle className="text-xs text-zinc-400">
                          Estado del pipeline
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pb-4">
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          Fase 1 aprobada y bloqueada. El pipeline continúa más
                          abajo: música CC0 (3), mezcla automática (4), editor
                          en vivo (5) y exportación + informe PDF (6). Cada fase
                          requiere su aprobación explícita.
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
      <audio ref={audioRef} id="audio-principal" preload="metadata" className="hidden">
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
              Bloques ≤ 5 min · RAM acotada · Fase 1-2 locales/IA · Fases 3-6:
              música CC0 propia, mezcla y export en el navegador
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
