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
  Save,
  FolderOpen,
  FileUp,
} from "lucide-react";
import { useProjectStore, snapshotProyecto, type FileMeta } from "@/store/project";
import { analyzeAudio } from "@/lib/audio/analyze";
import type { AnalysisOptions } from "@/lib/audio/types";
import { loadAnalysis, deleteAnalysis, saveAnalysis, type StoredAnalysis } from "@/lib/idb";
import { clamp, formatDurSmart, formatBytes, formatHace } from "@/lib/format";
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
import { SfxSeccion } from "@/components/bardo/sfx-seccion";
import { Fase4Seccion } from "@/components/bardo/fase4-seccion";
import { Fase5Seccion } from "@/components/bardo/fase5-seccion";
import { Fase6Seccion } from "@/components/bardo/fase6-seccion";
import { obtenerControlMotor } from "@/lib/fase5/registro-motor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ejecutarFase2 } from "@/lib/fase2/pipeline";
import { FASE2_CONFIG_DEFECTO } from "@/lib/fase2/types";
import { GuardarDialog } from "@/components/bardo/guardar-dialog";
import { ProyectosDialog } from "@/components/bardo/proyectos-dialog";
import {
  TIPO_PROYECTO,
  VERSION_PROYECTO,
  parsearProyecto,
  nombreArchivoProyecto,
  type ProyectoGuardado,
} from "@/lib/proyecto/tipos";
import {
  empaquetarAnalysis,
  desempaquetarAnalysis,
  ab2base64,
  base642ab,
} from "@/lib/proyecto/pack";
import { descargarBlob } from "@/lib/fase6/informe";

const ACCEPT_AUDIO = ".wav,.mp3,.m4a,.ogg,.oga,.flac,.opus,.aac,.webm,audio/*";

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
  const faseSfx = useProjectStore((s) => s.faseSfx);
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

  // ---- proyectos guardados (estilo Camtasia) ----
  const proyecto = useProjectStore((s) => s.proyecto);
  const sourceMissing = useProjectStore((s) => s.sourceMissing);
  const [dialogoGuardar, setDialogoGuardar] = useState(false);
  const [dialogoProyectos, setDialogoProyectos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const readjuntarRef = useRef<HTMLInputElement | null>(null);

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
        let saved = await loadAnalysis(st.fileMeta.key).catch(
          () => undefined
        );
        // proyecto guardado: si el caché local no está, probar el paquete del servidor
        if (
          (!saved || saved.envDb.length === 0) &&
          st.proyecto &&
          st.savedResult
        ) {
          try {
            const res = await fetch(
              `/api/proyectos/${st.proyecto.id}/analysis`
            );
            if (res.ok) {
              const pack = desempaquetarAnalysis(await res.arrayBuffer());
              if (pack) {
                saved = {
                  peaksMin: pack.peaksMin,
                  peaksMax: pack.peaksMax,
                  envDb: pack.envDb,
                  savedAt: Date.now(),
                };
                void saveAnalysis(st.fileMeta.key, saved).catch(
                  () => undefined
                );
              }
            }
          } catch {
            /* sin paquete en el servidor */
          }
        }
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
        } else if (st.proyecto) {
          // proyecto guardado: el audio original vive en el servidor local
          try {
            const res = await fetch(
              `/api/proyectos/${st.proyecto.id}/audio`
            );
            if (!res.ok) throw new Error("sin audio");
            const blob = await res.blob();
            if (blob.size <= 1024) throw new Error("audio vacío");
            if (objectUrlRef.current) {
              URL.revokeObjectURL(objectUrlRef.current);
            }
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            setSourceUrl(url);
          } catch {
            st.setSourceMissing(true);
          }
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
      // conservar el pipeline (y el proyecto guardado si lo hay):
      // re-adjuntar el archivo original y re-analizar solo si hace falta
      readjuntarRef.current?.click();
    }
  }, [sourceKind, loadDemo]);

  // ---------- proyectos guardados (estilo Camtasia) ----------

  /** ¿hay trabajo sin guardar que se perdería al cambiar de proyecto? */
  const confirmarDescartar = useCallback((): boolean => {
    const st = useProjectStore.getState();
    if (!st.fileMeta) return true;
    return window.confirm(
      "Hay un proyecto en marcha en esta pestaña. ¿Descartar los cambios no guardados y continuar?"
    );
  }, []);

  /** aplica un paquete de análisis (del servidor o de un .bsproj) al estado. */
  const aplicarPack = useCallback((pack: {
    peaksMin: Float32Array;
    peaksMax: Float32Array;
    envDb: Float32Array;
  }): boolean => {
    const st = useProjectStore.getState();
    if (!st.savedResult || !st.fileMeta) return false;
    const gi = st.gridInfo;
    st.restoreAnalysis({
      sampleRate: st.savedResult.sampleRate,
      channels: st.savedResult.channels,
      format: st.savedResult.format,
      peaksPerSec: gi?.peaksPerSec ?? st.analysisOpts.peaksPerSec,
      envelopeHopSec: gi?.envelopeHopSec ?? st.analysisOpts.envelopeHopSec,
      peaksMin: pack.peaksMin,
      peaksMax: pack.peaksMax,
      envDb: pack.envDb,
      durationSec: st.savedResult.durationSec,
    });
    st.recomputeSilences();
    // cachear también localmente para las próximas recargas
    void saveAnalysis(st.fileMeta.key, {
      peaksMin: pack.peaksMin,
      peaksMax: pack.peaksMax,
      envDb: pack.envDb,
      savedAt: Date.now(),
    }).catch(() => undefined);
    return true;
  }, []);

  /** restaura desde la caché IndexedDB. */
  const aplicarSaved = useCallback((saved: StoredAnalysis): boolean => {
    const st = useProjectStore.getState();
    if (!st.savedResult) return false;
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
    return true;
  }, []);

  const demoUrlDe = useCallback(
    (nombre?: string | null) =>
      nombre === "narracion-voz-demo.wav"
        ? "/demo/narracion-voz-demo.wav"
        : "/demo/narration-demo.wav",
    []
  );

  /** abre un proyecto guardado en el servidor local. */
  const abrirProyectoServidor = useCallback(
    async (id: string) => {
      if (!confirmarDescartar()) return;
      try {
        const res = await fetch(`/api/proyectos/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          proyecto?: unknown;
          tieneAudio?: boolean;
          tieneAnalisis?: boolean;
        };
        const p = parsearProyecto(data.proyecto);
        if (!p) {
          throw new Error("el archivo del proyecto no es legible (¿versión antigua?)");
        }
        if (!useProjectStore.getState().aplicarProyecto(p)) {
          throw new Error("el estado del proyecto no se pudo interpretar");
        }
        audioRef.current?.pause();

        // ---- análisis: paquete del servidor → caché local → re-analizar ----
        let restaurado = false;
        if (data.tieneAnalisis) {
          try {
            const resAn = await fetch(`/api/proyectos/${id}/analysis`);
            if (resAn.ok) {
              const pack = desempaquetarAnalysis(await resAn.arrayBuffer());
              if (pack) restaurado = aplicarPack(pack);
            }
          } catch {
            /* sin paquete */
          }
        }
        if (!restaurado) {
          const key = useProjectStore.getState().fileMeta?.key;
          if (key) {
            const saved = await loadAnalysis(key).catch(() => undefined);
            if (saved && saved.envDb.length > 0) {
              restaurado = aplicarSaved(saved);
            }
          }
        }

        // ---- audio original ----
        const st = useProjectStore.getState();
        let audioOk = false;
        if (st.sourceKind === "demo") {
          setSourceUrl(demoUrlDe(st.fileMeta?.name));
          audioOk = true;
        } else if (data.tieneAudio) {
          try {
            const resAu = await fetch(`/api/proyectos/${id}/audio`);
            if (resAu.ok) {
              const blob = await resAu.blob();
              if (blob.size > 1024) {
                if (objectUrlRef.current) {
                  URL.revokeObjectURL(objectUrlRef.current);
                }
                const url = URL.createObjectURL(blob);
                objectUrlRef.current = url;
                setSourceUrl(url);
                audioOk = true;
              }
            }
          } catch {
            /* sin audio en el servidor */
          }
        }
        if (audioOk) {
          useProjectStore.getState().setSourceMissing(false);
        } else {
          setSourceUrl(null);
          useProjectStore.getState().setSourceMissing(true);
        }

        // sin análisis disponible pero con audio: re-analizar en segundo plano
        if (
          !restaurado &&
          audioOk &&
          objectUrlRef.current &&
          st.fileMeta &&
          st.status !== "empty"
        ) {
          const blob = await fetch(objectUrlRef.current).then((r) => r.blob());
          void runAnalysis(
            blob,
            st.fileMeta,
            st.sourceKind === "demo" ? "demo" : "user"
          );
        }
        setDialogoProyectos(false);
      } catch (err) {
        window.alert(
          `No se pudo abrir el proyecto: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    },
    [confirmarDescartar, aplicarPack, aplicarSaved, demoUrlDe, runAnalysis]
  );

  /** importa un archivo .bsproj descargado antes. */
  const importarBsproj = useCallback(
    async (file: File) => {
      if (!confirmarDescartar()) return;
      try {
        const p = parsearProyecto(JSON.parse(await file.text()));
        if (!p) {
          throw new Error("no parece un proyecto de Bardo Studio (.bsproj)");
        }
        if (!useProjectStore.getState().aplicarProyecto(p)) {
          throw new Error("el estado del proyecto no es válido");
        }
        audioRef.current?.pause();

        // análisis incrustado (base64) o caché local
        let restaurado = false;
        if (p.analisis) {
          const ab = base642ab(p.analisis);
          const pack = ab ? desempaquetarAnalysis(ab) : null;
          if (pack) restaurado = aplicarPack(pack);
        }
        if (!restaurado) {
          const key = useProjectStore.getState().fileMeta?.key;
          if (key) {
            const saved = await loadAnalysis(key).catch(() => undefined);
            if (saved && saved.envDb.length > 0) {
              restaurado = aplicarSaved(saved);
            }
          }
        }

        const st = useProjectStore.getState();
        if (st.sourceKind === "demo") {
          setSourceUrl(demoUrlDe(st.fileMeta?.name));
          useProjectStore.getState().setSourceMissing(false);
        } else {
          // el .bsproj no lleva el audio: pedir re-adjuntar (como Camtasia)
          setSourceUrl(null);
          useProjectStore.getState().setSourceMissing(true);
        }
        setDialogoProyectos(false);
      } catch (err) {
        window.alert(
          `No se pudo importar el .bsproj: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    },
    [confirmarDescartar, aplicarPack, aplicarSaved, demoUrlDe]
  );

  /** guarda el proyecto en el servidor local (audio + análisis incluidos). */
  const guardarProyecto = useCallback(
    async (nombre: string, comoCopia: boolean) => {
      setGuardando(true);
      setErrorGuardar(null);
      try {
        const st = useProjectStore.getState();
        const estado = snapshotProyecto();
        const musicaPropia = (st.fase3.catalogo ?? []).filter(
          (x) => x.propia
        );
        const fd = new FormData();
        fd.set(
          "proyecto",
          JSON.stringify({
            tipo: TIPO_PROYECTO,
            version: VERSION_PROYECTO,
            meta: {
              id: comoCopia ? undefined : st.proyecto?.id,
              nombre,
            },
            estado,
            musicaPropia,
          })
        );
        // audio en memoria (las demos ya viven en el servidor)
        if (st.sourceKind === "user" && objectUrlRef.current) {
          const blob = await fetch(objectUrlRef.current)
            .then((r) => r.blob())
            .catch(() => null);
          if (blob && blob.size > 1024) {
            fd.set("audio", blob, st.fileMeta?.name ?? "audio.bin");
          }
        }
        // análisis empaquetado (evita re-analizar al reabrir)
        if (st.analysis && st.analysis.envDb.length > 0) {
          fd.set(
            "analisis",
            new Blob([
              empaquetarAnalysis({
                peaksMin: st.analysis.peaksMin,
                peaksMax: st.analysis.peaksMax,
                envDb: st.analysis.envDb,
              }),
            ])
          );
        }
        const res = await fetch("/api/proyectos", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          let detalle = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j?.error) detalle = j.error;
          } catch {
            /* sin cuerpo */
          }
          throw new Error(detalle);
        }
        const data = (await res.json()) as {
          id: string;
          nombre: string;
          guardadoEn: number;
          creadoEn?: number;
        };
        const previo = st.proyecto;
        useProjectStore.getState().marcarProyectoGuardado({
          id: data.id,
          nombre: data.nombre,
          creadoEn:
            data.creadoEn ??
            (previo && !comoCopia ? previo.creadoEn : data.guardadoEn),
          guardadoEn: data.guardadoEn,
        });
        setDialogoGuardar(false);
      } catch (err) {
        setErrorGuardar(
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        setGuardando(false);
      }
    },
    []
  );

  /** descarga el proyecto portable (.bsproj, con el análisis incrustado). */
  const descargarBsproj = useCallback(async (nombre: string) => {
    setDescargando(true);
    try {
      const st = useProjectStore.getState();
      const musicaPropia = (st.fase3.catalogo ?? []).filter(
        (x) => x.propia
      );
      const p: ProyectoGuardado = {
        tipo: TIPO_PROYECTO,
        version: VERSION_PROYECTO,
        meta: {
          id: st.proyecto?.id ?? "",
          nombre,
          creadoEn: st.proyecto?.creadoEn ?? Date.now(),
          guardadoEn: Date.now(),
        },
        estado: snapshotProyecto() as unknown as ProyectoGuardado["estado"],
        musicaPropia,
        analisis:
          st.analysis && st.analysis.envDb.length > 0
            ? ab2base64(
                empaquetarAnalysis({
                  peaksMin: st.analysis.peaksMin,
                  peaksMax: st.analysis.peaksMax,
                  envDb: st.analysis.envDb,
                })
              )
            : undefined,
      };
      descargarBlob(
        new Blob([JSON.stringify(p)], { type: "application/json" }),
        nombreArchivoProyecto(nombre)
      );
    } finally {
      setDescargando(false);
    }
  }, []);

  /** re-adjunta el audio original (tras importar .bsproj o audio ausente). */
  const handleReadjuntar = useCallback(
    (file: File) => {
      const st = useProjectStore.getState();
      const meta = st.fileMeta;
      if (!meta) return;
      const coincide =
        meta.name === file.name && meta.size === file.size;
      if (
        !coincide &&
        !window.confirm(
          `El archivo elegido («${file.name}», ${formatBytes(
            file.size
          )}) no coincide exactamente con el original («${
            meta.name
          }», ${formatBytes(meta.size)}). ¿Usarlo igualmente?`
        )
      ) {
        return;
      }
      attachSource(file, "user");
      useProjectStore.getState().setSourceMissing(false);
      if (!st.analysis || st.analysis.envDb.length === 0) {
        void runAnalysis(file, meta, "user");
      }
    },
    [runAnalysis]
  );

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

  // derivados de proyectos guardados
  const puedeGuardar =
    status !== "analyzing" && fase2.status !== "running";
  const nombreInicialProyecto =
    proyecto?.nombre ??
    fileMeta?.name.replace(/\.[^.]+$/, "") ??
    "Mi proyecto";

  // ---------- render ----------
  const showUpload = !hydrated || status === "empty";

  // estados del stepper (7 fases: 1, 2, 2.5, 3, 4, 5, 6)
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
      ? faseSfx.status === "error"
        ? "review"
        : faseSfx.status
      : "locked",
    faseSfx.status === "approved"
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
    if (idx < 0) return 6;
    return [1, 2, 2.5, 3, 4, 5, 6][idx];
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
          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            {proyecto && (
              <Badge
                variant="outline"
                className="hidden max-w-[170px] items-center gap-1.5 border-amber-800/60 text-[10px] text-amber-300 md:inline-flex"
                title={`${proyecto.nombre} · guardado ${formatHace(proyecto.guardadoEn)}`}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                  aria-hidden
                />
                <span className="truncate">{proyecto.nombre}</span>
              </Badge>
            )}
            <Badge
              variant="outline"
              className="hidden gap-1 border-emerald-800/60 text-[10px] text-emerald-300 sm:inline-flex"
            >
              <ShieldCheck className="h-3 w-3" /> 7 fases
            </Badge>
            <Badge variant="outline" className="text-[10px] text-zinc-400">
              Fase {faseActiva} / 7
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-[11px] text-zinc-300"
              onClick={() => setDialogoProyectos(true)}
            >
              <FolderOpen className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Proyectos</span>
              <span className="sr-only sm:hidden">Abrir proyectos guardados</span>
            </Button>
            {fileMeta && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-amber-500 px-2.5 text-[11px] font-semibold text-zinc-950 hover:bg-amber-400"
                disabled={!puedeGuardar}
                title={
                  puedeGuardar
                    ? "Guardar el proyecto en este equipo"
                    : "Espera a que termine el análisis en curso"
                }
                onClick={() => {
                  setErrorGuardar(null);
                  setDialogoGuardar(true);
                }}
              >
                <Save className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Guardar</span>
                <span className="sr-only sm:hidden">Guardar proyecto</span>
              </Button>
            )}
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
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-2 text-zinc-400"
                  onClick={() => setDialogoProyectos(true)}
                >
                  <FolderOpen className="h-4 w-4 text-amber-400/80" aria-hidden />
                  Abrir un proyecto guardado…
                </Button>
              </div>
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
                        {!sourceReady && !sourceMissing && sourceUrl && (
                          <p className="pt-2 text-[11px] text-zinc-500">
                            Cargando el audio…
                          </p>
                        )}
                        {sourceMissing && sourceKind === "user" && (
                          <div className="mt-2 space-y-2 rounded-lg border border-amber-800/50 bg-amber-950/10 p-3">
                            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
                              <FileUp className="h-3.5 w-3.5" aria-hidden />
                              Falta el audio original en esta sesión
                            </p>
                            <p className="text-[11px] leading-relaxed text-zinc-500">
                              El proyecto y su análisis están restaurados, pero
                              para reproducir, transcribir o exportar hay que
                              re-adjuntar el archivo original — como Camtasia
                              re-engancha sus medios al abrir un proyecto
                              movido de sitio.
                            </p>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 gap-1.5"
                              onClick={() => readjuntarRef.current?.click()}
                            >
                              <FileUp className="h-3.5 w-3.5" aria-hidden />
                              Re-adjuntar el audio
                            </Button>
                          </div>
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
                                    "Al reabrir la Fase 2 se reinician las fases 2.5-6 (efectos, asignaciones, mezcla, editor y exportación). ¿Continuar?"
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

                    {/* ============ FASE 2.5: efectos de sonido ============ */}
                    {status === "approved" && fase2.status === "approved" && (
                      <SfxSeccion />
                    )}

                    {/* ============ FASES 3-6: música, mezcla, editor, exportación ============ */}
                    {status === "approved" &&
                      fase2.status === "approved" &&
                      faseSfx.status === "approved" && (
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
                          abajo: efectos por palabras clave (2.5), música CC0
                          (3), mezcla automática (4), editor en vivo (5) y
                          exportación + informe PDF (6). Cada fase requiere su
                          aprobación explícita.
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

      {/* entrada oculta para re-adjuntar el audio original */}
      <input
        ref={readjuntarRef}
        type="file"
        accept={ACCEPT_AUDIO}
        className="sr-only"
        aria-label="Re-adjuntar el audio original"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleReadjuntar(f);
        }}
      />

      {/* diálogos de proyectos guardados (estilo Camtasia) */}
      <GuardarDialog
        key={`guardar-${dialogoGuardar}`}
        open={dialogoGuardar}
        onOpenChange={(v) => setDialogoGuardar(v)}
        nombreInicial={nombreInicialProyecto}
        proyecto={proyecto}
        guardando={guardando}
        descargando={descargando}
        error={errorGuardar}
        puedeGuardar={puedeGuardar}
        onGuardar={(nombre, comoCopia) =>
          void guardarProyecto(nombre, comoCopia)
        }
        onDescargar={(nombre) => void descargarBsproj(nombre)}
      />

      <ProyectosDialog
        open={dialogoProyectos}
        onOpenChange={setDialogoProyectos}
        onAbrir={(id) => void abrirProyectoServidor(id)}
        onImportar={(f) => void importarBsproj(f)}
        onNuevo={() => {
          if (confirmarDescartar()) resetAll();
        }}
      />

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
              Bloques ≤ 5 min · RAM acotada · Fase 1-2 locales/IA · Efectos SFX
              (2.5) + música CC0 + la tuya, mezcla y export en el navegador ·
              proyectos guardables y reabribles
            </span>
          </span>
        </div>
      </footer>
    </div>
  );
}
