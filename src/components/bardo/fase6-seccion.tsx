"use client";

import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  FileDown,
  FileAudio,
  Loader2,
  AlertTriangle,
  Trophy,
  Download,
  FileText,
} from "lucide-react";
import { useProjectStore } from "@/store/project";
import { calcularMezcla } from "@/lib/fase4/mezcla";
import {
  renderizarMezcla,
  codificarWavEstereo,
} from "@/lib/fase6/render";
import {
  generarInformePDF,
  descargarBlob,
  type InformePDF,
  type ExportInfo,
} from "@/lib/fase6/informe";
import { SFX_DEFECTOS } from "@/lib/sfx/tipos";
import { formatBytes, formatDurSmart } from "@/lib/format";
import { GateFase } from "./gate-fase";

interface Fase6SeccionProps {
  sourceUrl: string | null;
}

interface ArchivoLocal extends ExportInfo {
  blob: Blob;
}

/** Fase 6 · Exportación: render offline + WAV + informe PDF auditable. */
export function Fase6Seccion(props: Fase6SeccionProps) {
  const { sourceUrl } = props;
  const fase2 = useProjectStore((s) => s.fase2);
  const fase3 = useProjectStore((s) => s.fase3);
  const fase4 = useProjectStore((s) => s.fase4);
  const fase5 = useProjectStore((s) => s.fase5);
  const fase6 = useProjectStore((s) => s.fase6);
  const faseSfx = useProjectStore((s) => s.faseSfx);
  const fileMeta = useProjectStore((s) => s.fileMeta);
  const analysis = useProjectStore((s) => s.analysis);
  const silences = useProjectStore((s) => s.silences);
  const thresholds = useProjectStore((s) => s.thresholds);
  const phase1 = useProjectStore((s) => s.status);
  const approvedAt = useProjectStore((s) => s.approvedAt);

  const [renderizando, setRenderizando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [archivos, setArchivos] = useState<ArchivoLocal[]>([]);
  const [errorRender, setErrorRender] = useState<string | null>(null);
  const [informando, setInformando] = useState(false);
  const blobRef = useRef<Map<string, Blob>>(new Map());

  const params = fase6.params;
  const aprobada = fase6.status === "approved";
  const clipsSfx = faseSfx.clips ?? [];
  const defectosSfx = faseSfx.config?.defectos ?? SFX_DEFECTOS;

  // envolventes definitivas (con los bloques y clips editados de la Fase 5)
  const mezclaFinal = useMemo(() => {
    if (!fase5.bloques || !analysis || analysis.envDb.length === 0) return null;
    try {
      return calcularMezcla({
        escenas: fase2.escenas,
        asignaciones: fase3.asignaciones ?? [],
        duracionSec: analysis.durationSec,
        envDb: analysis.envDb,
        envHopSec: analysis.envelopeHopSec,
        umbralVozDb: thresholds.dbThreshold,
        silencios: silences,
        params: fase5.params ?? fase4.params,
        bloquesOverride: fase5.bloques,
        sfxRespetarDucking: defectosSfx.respetarDucking,
      });
    } catch {
      return null;
    }
  }, [
    fase5.bloques,
    fase5.params,
    fase4.params,
    analysis,
    fase2.escenas,
    fase3.asignaciones,
    silences,
    thresholds.dbThreshold,
    defectosSfx.respetarDucking,
  ]);

  if (fase5.status !== "approved") return null;

  const baseNombre = (fileMeta?.name ?? "narracion").replace(/\.[^.]+$/, "");

  const renderizar = async () => {
    if (!sourceUrl || !fase5.bloques || !mezclaFinal) return;
    setRenderizando(true);
    setProgreso(0);
    setErrorRender(null);
    setArchivos([]);
    try {
      const arrayVoz = await fetch(sourceUrl).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} al leer la narración`);
        return r.arrayBuffer();
      });
      const catalogo = fase3.catalogo ?? [];
      const arraysPistas = new Map<string, ArrayBuffer>();
      for (const b of fase5.bloques) {
        if (arraysPistas.has(b.pistaId)) continue;
        const p = catalogo.find((x) => x.id === b.pistaId);
        if (!p) continue;
        const ab = await fetch(p.archivo)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null);
        if (ab) arraysPistas.set(b.pistaId, ab);
      }
      // archivos SFX usados por los clips (biblioteca CC0 + propios)
      const arraysSfx = new Map<string, ArrayBuffer>();
      for (const c of clipsSfx) {
        if (arraysSfx.has(c.sfxId)) continue;
        const d = (faseSfx.biblioteca ?? []).find((x) => x.id === c.sfxId);
        if (!d) continue;
        const ab = await fetch(d.archivo)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null);
        if (ab) arraysSfx.set(c.sfxId, ab);
      }

      const res = await renderizarMezcla({
        arrayVoz,
        arraysPistas,
        bloques: fase5.bloques,
        nivelDb: mezclaFinal.nivelDb,
        duckDb: mezclaFinal.duckDb,
        hopSec: mezclaFinal.hopSec,
        duracionSec: analysis?.durationSec ?? 0,
        colaFinalSeg: params.colaFinalSeg,
        normalizar: params.normalizar,
        destinoDb: -1,
        arraysSfx,
        clipsSfx,
        duckSfxDb: mezclaFinal.duckSfxDb,
        onProgreso: setProgreso,
      });

      const nuevos: ArchivoLocal[] = [];
      const stamp = new Date().toISOString().slice(0, 10);
      const nombreMezcla = `${baseNombre}-mezcla-${stamp}.wav`;
      const blobMezcla = codificarWavEstereo(res.mezcla, res.meta.sampleRate);
      blobRef.current.set("mezcla", blobMezcla);
      nuevos.push({
        tipo: "mezcla",
        nombre: nombreMezcla,
        bytes: blobMezcla.size,
        durSec: res.meta.durSec,
        rmsDb: res.meta.rmsDb,
        picoDb: res.meta.picoDb,
        creadoEn: Date.now(),
        blob: blobMezcla,
      });
      if (params.incluirStems) {
        const blobVoz = codificarWavEstereo(res.voz, res.meta.sampleRate);
        const blobMus = codificarWavEstereo(res.musica, res.meta.sampleRate);
        const blobSfx = codificarWavEstereo(res.sfx, res.meta.sampleRate);
        blobRef.current.set("voz", blobVoz);
        blobRef.current.set("musica", blobMus);
        blobRef.current.set("efectos", blobSfx);
        nuevos.push(
          {
            tipo: "voz",
            nombre: `${baseNombre}-voz-${stamp}.wav`,
            bytes: blobVoz.size,
            durSec: res.meta.durSec,
            rmsDb: res.meta.rmsDb,
            picoDb: res.meta.picoDb,
            creadoEn: Date.now(),
            blob: blobVoz,
          },
          {
            tipo: "musica",
            nombre: `${baseNombre}-musica-${stamp}.wav`,
            bytes: blobMus.size,
            durSec: res.meta.durSec,
            rmsDb: res.meta.rmsDb,
            picoDb: res.meta.picoDb,
            creadoEn: Date.now(),
            blob: blobMus,
          },
          {
            tipo: "efectos",
            nombre: `${baseNombre}-efectos-${stamp}.wav`,
            bytes: blobSfx.size,
            durSec: res.meta.durSec,
            rmsDb: res.meta.rmsDb,
            picoDb: res.meta.picoDb,
            creadoEn: Date.now(),
            blob: blobSfx,
          }
        );
      }
      setArchivos(nuevos);
      for (const a of nuevos) {
        const { blob, ...info } = a;
        void blob;
        useProjectStore.getState().addExportFase6(info);
      }
    } catch (e) {
      setErrorRender(
        e instanceof Error ? e.message : "El render offline falló."
      );
      useProjectStore
        .getState()
        .fallarFase6(e instanceof Error ? e.message : "render fallido");
    } finally {
      setRenderizando(false);
    }
  };

  const generarInforme = async () => {
    setInformando(true);
    setErrorRender(null);
    try {
      const st = useProjectStore.getState();
      const escenas = fase2.escenas;
      const catalogo = fase3.catalogo ?? [];
      const asigMap = new Map(
        (fase3.asignaciones ?? []).map((a) => [a.escenaId, a])
      );
      const ultima = archivos.find((a) => a.tipo === "mezcla") ??
        fase6.exportaciones.find((e) => e.tipo === "mezcla") ?? null;

      const informe: InformePDF = {
        proyecto: {
          nombre: fileMeta?.name ?? "—",
          archivo: fileMeta?.name ?? "—",
          duracionSec: Math.round(
            (analysis?.durationSec ?? 0) * 10
          ) / 10,
          formato:
            st.savedResult?.format === "wav"
              ? `WAV · ${analysis?.sampleRate ?? 0} Hz · ${analysis?.channels ?? 1} canal(es)`
              : "Audio decodificado en el navegador",
          fecha: new Date().toISOString(),
        },
        resumen: {
          generadoEn: new Date().toISOString(),
          herramienta: "Bardo Studio",
        },
        dramaturgia: {
          escenas: escenas.length,
          mediaTension: escenas.length
            ? Math.round(
                escenas.reduce((s, e) => s + e.tension, 0) / escenas.length
              )
            : 0,
          picoTension: escenas.reduce((m, e) => Math.max(m, e.tension), 0),
          corregidas: escenas.filter((e) => e.corregido).length,
          motorEmocion: fase2.resumen?.motorEmocion ?? "—",
          bloques: fase2.resumen?.bloques ?? 0,
          frases: fase2.resumen?.segmentos ?? 0,
          caracteres: fase2.resumen?.caracteres ?? 0,
        },
        curva: escenas.map((e) => ({
          n: e.n,
          inicio: Math.round(e.inicio * 10) / 10,
          fin: Math.round(e.fin * 10) / 10,
          tension: e.tension,
          animo: e.animo,
          corregido: e.corregido,
        })),
        musica: {
          nCambiosPista: fase3.resumen?.cambios ?? 0,
          pistasUsadas: [
            ...new Set((fase3.asignaciones ?? []).map((a) => a.pistaId)),
          ].map((id) => catalogo.find((p) => p.id === id)?.titulo ?? id),
          asignaciones: escenas.map((e) => {
            const a = asigMap.get(e.id);
            const p = catalogo.find((x) => x.id === a?.pistaId);
            return {
              escenaN: e.n,
              inicio: Math.round(e.inicio * 10) / 10,
              fin: Math.round(e.fin * 10) / 10,
              animo: e.animo,
              tension: e.tension,
              pistaId: a?.pistaId ?? "—",
              titulo: p?.titulo ?? "—",
              origen: a?.origen ?? "auto",
            };
          }),
        },
        sfx: {
          detectados: faseSfx.eventos.length,
          activos: faseSfx.eventos.filter((e) => e.activo).length,
          categorias:
            faseSfx.resumen?.categorias ??
            new Set(faseSfx.eventos.map((e) => e.categoria)).size,
          palabraTop: faseSfx.resumen?.palabraTop ?? "—",
          nivelDb: defectosSfx.nivelDb,
          crossfadeSeg: defectosSfx.crossfadeSeg,
          respetarDucking: defectosSfx.respetarDucking,
          clipsEnMezcla: clipsSfx.length,
          clipsSilenciados: clipsSfx.filter((c) => c.muted).length,
          ediciones: faseSfx.edicionesSfx,
          clips: clipsSfx
            .slice()
            .sort((a, b) => a.inicio - b.inicio)
            .slice(0, 40)
            .map((c) => {
              const d = (faseSfx.biblioteca ?? []).find(
                (x) => x.id === c.sfxId
              );
              return {
                palabra: c.palabra,
                categoria: c.categoria,
                sfx: d?.nombre ?? c.sfxId,
                inicio: Math.round(c.inicio * 10) / 10,
                durSeg: Math.round((c.fin - c.inicio) * 10) / 10,
                volumenDb: c.volumenDb,
                origen: c.origen,
              };
            }),
        },
        mezcla: {
          ...(fase5.params ?? fase4.params),
          bloques: fase5.bloques?.length ?? 0,
          tiempoConMusicaSeg: mezclaFinal?.stats.tiempoConMusicaSec ?? 0,
        },
        edicion: {
          ediciones: fase5.ediciones,
          detalle:
            fase5.detalleEdiciones.length > 0
              ? fase5.detalleEdiciones.join("; ")
              : "sin ediciones manuales",
        },
        exportacion: {
          formato: `WAV 16-bit · 44.1 kHz · estéreo${
            params.incluirStems ? " (+stems voz/música/efectos)" : ""
          }`,
          normalizado: params.normalizar,
          bytes: ultima?.bytes ?? 0,
          rmsDb: ultima?.rmsDb ?? 0,
          picoDb: ultima?.picoDb ?? 0,
          stems: params.incluirStems,
          colaFinalSeg: params.colaFinalSeg,
        },
        auditoria: [
          {
            fase: 1,
            titulo: "Ingestión y análisis",
            aprobadaEn:
              phase1 === "approved" && approvedAt
                ? new Date(approvedAt).toISOString()
                : null,
          },
          {
            fase: 2,
            titulo: "Transcripción y tensión",
            aprobadaEn:
              fase2.aprobadaEn && fase2.status === "approved"
                ? new Date(fase2.aprobadaEn).toISOString()
                : null,
          },
          {
            fase: 2.5,
            titulo: "Efectos de sonido",
            aprobadaEn:
              faseSfx.aprobadaEn && faseSfx.status === "approved"
                ? new Date(faseSfx.aprobadaEn).toISOString()
                : null,
          },
          {
            fase: 3,
            titulo: "Gestión de música",
            aprobadaEn:
              fase3.aprobadaEn && fase3.status === "approved"
                ? new Date(fase3.aprobadaEn).toISOString()
                : null,
          },
          {
            fase: 4,
            titulo: "Mezcla automática",
            aprobadaEn:
              fase4.aprobadaEn && fase4.status === "approved"
                ? new Date(fase4.aprobadaEn).toISOString()
                : null,
          },
          {
            fase: 5,
            titulo: "Editor de mezcla",
            aprobadaEn:
              fase5.aprobadaEn && fase5.status === "approved"
                ? new Date(fase5.aprobadaEn).toISOString()
                : null,
          },
          {
            fase: 6,
            titulo: "Exportación y reporte",
            aprobadaEn:
              fase6.aprobadaEn && fase6.status === "approved"
                ? new Date(fase6.aprobadaEn).toISOString()
                : null,
          },
        ],
      };

      const { blob, bytes } = await generarInformePDF(informe);
      descargarBlob(blob, `${baseNombre}-informe.pdf`);
      useProjectStore.getState().setInformeFase6(bytes);
    } catch (e) {
      setErrorRender(
        e instanceof Error ? e.message : "No se pudo generar el informe."
      );
    } finally {
      setInformando(false);
    }
  };

  return (
    <section
      className="space-y-4 pt-2"
      aria-label="Fase 6: exportación y reporte"
    >
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
          <FileDown className="h-5 w-5 text-amber-400" />
          Fase 6 · Exportación y reporte
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          Render <strong className="text-zinc-200">offline</strong> de la mezcla
          aprobada (voz + música + <strong className="text-zinc-200">efectos</strong>,
          ducking y crossfades horneados),{" "}
          <strong className="text-zinc-200">normalización de pico</strong>{" "}
          opcional, <strong className="text-zinc-200">stems</strong> de voz,
          música y efectos, y el{" "}
          <strong className="text-zinc-200">informe PDF</strong> auditable con
          toda la trazabilidad del proyecto.
        </p>
      </div>

      {(errorRender || fase6.error) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error de exportación</AlertTitle>
          <AlertDescription>{errorRender ?? fase6.error}</AlertDescription>
        </Alert>
      )}

      {!sourceUrl && (
        <Alert className="border-amber-800/50 bg-amber-950/20 text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Audio fuente no disponible</AlertTitle>
          <AlertDescription>
            Para renderizar se necesita el archivo original: pulsa «Volver a
            analizar» en la Fase 1 y re-selecciona el audio (el informe PDF sí
            puede generarse sin él).
          </AlertDescription>
        </Alert>
      )}

      {/* opciones */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-800 bg-zinc-950/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-zinc-400">
              Opciones de render
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-zinc-300">
                  Normalizar a −1 dBFS
                </p>
                <p className="text-[10px] text-zinc-500">
                  La misma ganancia se aplica a los tres archivos.
                </p>
              </div>
              <Switch
                id="norm"
                checked={params.normalizar}
                disabled={aprobada}
                onCheckedChange={(v) =>
                  useProjectStore.getState().setParamsFase6({ normalizar: v })
                }
                aria-label="Normalizar la mezcla a −1 dBFS"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-zinc-300">
                  Incluir stems (voz, música y efectos)
                </p>
                <p className="text-[10px] text-zinc-500">
                  Archivos separados listos para re-mezclar.
                </p>
              </div>
              <Switch
                id="stems"
                checked={params.incluirStems}
                disabled={aprobada}
                onCheckedChange={(v) =>
                  useProjectStore.getState().setParamsFase6({ incluirStems: v })
                }
                aria-label="Incluir stems de voz, música y efectos"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="cola"
                  className="text-[11px] font-medium text-zinc-300"
                >
                  Cola final (fundido de salida)
                </label>
                <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                  {params.colaFinalSeg.toFixed(0)} s
                </span>
              </div>
              <Slider
                id="cola"
                min={1}
                max={8}
                step={1}
                value={[params.colaFinalSeg]}
                disabled={aprobada}
                onValueChange={(v) =>
                  useProjectStore
                    .getState()
                    .setParamsFase6({ colaFinalSeg: v[0] })
                }
                aria-label="Cola final en segundos"
              />
            </div>
            <Button
              className="w-full gap-2 bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
              disabled={!sourceUrl || renderizando || aprobada}
              onClick={() => void renderizar()}
            >
              {renderizando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileAudio className="h-4 w-4" />
              )}
              {renderizando
                ? `Renderizando… ${Math.round(progreso * 100)}%`
                : "Renderizar la mezcla final"}
            </Button>
            {renderizando && (
              <Progress
                value={progreso * 100}
                aria-label="Progreso del render offline"
              />
            )}
            <p className="text-[10px] leading-relaxed text-zinc-500">
              El render es más rápido que el tiempo real. Para narraciones de 3+
              horas puede tardar unos minutos y usar RAM proporcional a la
              duración.
            </p>
          </CardContent>
        </Card>

        {/* resultados */}
        <Card className="border-zinc-800 bg-zinc-950/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-zinc-400">
              Archivos exportados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            {archivos.length === 0 && fase6.exportaciones.length === 0 && (
              <p className="text-[11px] text-zinc-500">
                Aún no hay archivos: renderiza la mezcla para generar el WAV
                final (y stems si están activados).
              </p>
            )}
            {archivos.map((a) => (
              <div
                key={a.tipo}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-400">
                  <FileAudio className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-200">
                    {a.nombre}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    {formatBytes(a.bytes)} · {formatDurSmart(a.durSec)} · pico{" "}
                    {a.picoDb} dB · RMS {a.rmsDb} dB
                    {a.tipo !== "mezcla" && " · stem"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => descargarBlob(a.blob, a.nombre)}
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar
                </Button>
              </div>
            ))}
            {archivos.length === 0 &&
              fase6.exportaciones.length > 0 &&
              fase6.exportaciones.slice(-3).map((e, i) => (
                <div
                  key={`${e.tipo}-${e.creadoEn}-${i}`}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/20 p-3 opacity-70"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
                    <FileAudio className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-zinc-300">{e.nombre}</p>
                    <p className="text-[10px] text-zinc-500">
                      {formatBytes(e.bytes)} · {formatDurSmart(e.durSec)} ·
                      generado en sesión anterior (re-renderiza para descargar)
                    </p>
                  </div>
                </div>
              ))}

            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={informando}
              onClick={() => void generarInforme()}
            >
              {informando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Generar y descargar el informe PDF
            </Button>
            {fase6.informePdf && (
              <p className="text-[10px] text-emerald-300/80">
                Informe generado ({formatBytes(fase6.informePdf.bytes)}) ·
                descargado en esta sesión
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* puerta final */}
      <GateFase
        fase={6}
        titulo="Exportación y reporte"
        desbloqueaTexto="cierra el proyecto"
        descripcionPendiente="¿Los archivos suenan bien y el informe refleja el trabajo? Aprueba para dar el proyecto por cerrado."
        descripcionAprobada="El proyecto está completo: los siete hitos auditados, del análisis a los archivos finales."
        resumen={[
          {
            etiqueta: "Archivos",
            valor: String(archivos.length || fase6.exportaciones.length),
          },
          {
            etiqueta: "Normalización",
            valor: params.normalizar ? "−1 dBFS" : "off",
          },
          { etiqueta: "Stems", valor: params.incluirStems ? "sí" : "no" },
          {
            etiqueta: "Informe",
            valor: fase6.informePdf ? "generado" : "pendiente",
          },
        ]}
        confirmacion="He escuchado el archivo final, verifiqué el informe y la exportación es correcta."
        textoAprobar="Cerrar el proyecto (Fase 6 de 6)"
        approved={aprobada}
        onApprove={() => useProjectStore.getState().aprobarFase6()}
        onReopen={() => useProjectStore.getState().reabrirFase6()}
      />

      {aprobada && (
        <Card className="border-emerald-700/60 bg-emerald-950/25">
          <CardContent className="flex items-start gap-4 p-6">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
              <Trophy className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <p className="text-base font-bold text-emerald-200">
                Narración musicalizada de principio a fin
              </p>
              <p className="text-sm text-emerald-100/70">
                {formatDurSmart(analysis?.durationSec ?? 0)} de narración ·{" "}
                {fase2.escenas.length} escenas analizadas ·{" "}
                {fase5.bloques?.length ?? 0} bloques musicales ·{" "}
                {clipsSfx.filter((c) => !c.muted).length} efectos ·{" "}
                {archivos.length || fase6.exportaciones.length} archivos
                exportados. Todo el proceso quedó registrado en el informe PDF.
              </p>
              <Badge
                variant="outline"
                className="mt-1 border-emerald-700/50 text-[10px] text-emerald-300"
              >
                7/7 fases aprobadas
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
