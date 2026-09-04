"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Scissors,
  Trash2,
  VolumeX,
  Volume2,
  Loader2,
  AlertTriangle,
  RotateCcw,
  Disc3,
} from "lucide-react";
import { useProjectStore } from "@/store/project";
import { calcularMezcla } from "@/lib/fase4/mezcla";
import type { Fase4Params } from "@/lib/fase4/tipos";
import {
  MotorMezcla,
  decodificarFuentes,
  type MotorConfig,
} from "@/lib/fase5/motor";
import {
  dividirBloque,
  moverBloque,
  eliminarBloque,
  silenciarBloque,
  cambiarPistaBloque,
} from "@/lib/fase5/ediciones";
import { registrarControlMotor } from "@/lib/fase5/registro-motor";
import { formatTimecode } from "@/lib/format";
import { GateFase } from "./gate-fase";
import { MixTimeline } from "./mix-timeline";
import { TransportMezcla } from "./transport-mezcla";
import { NivelMetros } from "./nivel-metros";

interface Fase5SeccionProps {
  sourceUrl: string | null;
}

/** Fase 5 · Editor de mezcla tipo Camtasia: reproducción + cuchilla + arrastre. */
export function Fase5Seccion(props: Fase5SeccionProps) {
  const { sourceUrl } = props;
  const fase4 = useProjectStore((s) => s.fase4);
  const fase3 = useProjectStore((s) => s.fase3);
  const fase5 = useProjectStore((s) => s.fase5);
  const fase2 = useProjectStore((s) => s.fase2);
  const analysis = useProjectStore((s) => s.analysis);
  const silences = useProjectStore((s) => s.silences);
  const thresholds = useProjectStore((s) => s.thresholds);

  const motorRef = useRef<MotorMezcla | null>(null);
  const buffersRef = useRef<{
    bufferVoz: AudioBuffer;
    buffersPistas: Map<string, AudioBuffer>;
    /** URL con la que se decodificaron (para invalidar al cambiar de fuente) */
    urlVoz: string;
  } | null>(null);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [posicion, setPosicion] = useState(0);
  const [cargandoAudio, setCargandoAudio] = useState(false);
  const [errorMotor, setErrorMotor] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);

  const duracion = analysis?.durationSec ?? 0;
  const bloques = fase5.bloques;
  const paramsEdicion = fase5.params ?? fase4.params;
  const envListo = !!analysis && analysis.envDb.length > 0;
  const listo = bloques !== null && envListo;

  // ---------- materializar bloques desde la mezcla APROBADA ----------
  // (solo al aprobar la Fase 4: si se materializara antes, los ajustes
  // manuales de pistas hechos en la Fase 3 quedarían fuera del editor)
  const mezclaStore = useProjectStore((s) => s.fase4.mezcla);
  useEffect(() => {
    if (bloques || !envListo) return;
    if (fase4.status !== "approved") return;
    if (!mezclaStore || mezclaStore.bloques.length === 0) return;
    useProjectStore
      .getState()
      .materializarFase5(mezclaStore.bloques, fase4.params);
  }, [bloques, envListo, mezclaStore, fase4.params, fase4.status]);

  // ---------- envolventes vigentes (recalculadas tras cada edición) ----------
  const mezclaActual = useMemo(() => {
    if (!bloques || !analysis || analysis.envDb.length === 0) return null;
    try {
      return calcularMezcla({
        escenas: fase2.escenas,
        asignaciones: fase3.asignaciones ?? [],
        duracionSec: analysis.durationSec,
        envDb: analysis.envDb,
        envHopSec: analysis.envelopeHopSec,
        umbralVozDb: thresholds.dbThreshold,
        silencios: silences,
        params: paramsEdicion,
        bloquesOverride: bloques,
      });
    } catch {
      return null;
    }
  }, [
    bloques,
    analysis,
    fase2.escenas,
    fase3.asignaciones,
    silences,
    thresholds.dbThreshold,
    paramsEdicion,
  ]);

  // ---------- construir/actualizar el motor ----------
  useEffect(() => {
    if (!bloques || !mezclaActual || !sourceUrl) return;
    if (motorRef.current) {
      const bufs = buffersRef.current;
      // ¿los buffers actuales cubren todos los bloques vivos y la fuente?
      const cubreTodo =
        !!bufs &&
        bufs.urlVoz === sourceUrl &&
        bloques.every((b) => b.muted || bufs.buffersPistas.get(b.pistaId));
      if (cubreTodo) {
        motorRef.current.reconfigurar({
          bufferVoz: bufs!.bufferVoz,
          buffersPistas: bufs!.buffersPistas,
          bloques,
          nivelDb: mezclaActual.nivelDb,
          duckDb: mezclaActual.duckDb,
          hopSec: mezclaActual.hopSec,
          duracionSec: mezclaActual
            ? analysis?.durationSec ?? duracion
            : duracion,
        });
        return;
      }
      // falta alguna pista (p. ej. tras cambiar de asignación o de proyecto):
      // descartar el motor para que el próximo «reproducir» re-decodifique
      motorRef.current.dispose();
      motorRef.current = null;
      buffersRef.current = null;
      setReproduciendo(false);
      setPosicion(0);
      return;
    }
    // primer arranque diferido: se crea al pulsar reproducir
  }, [bloques, mezclaActual, sourceUrl, analysis, duracion]);

  // ---------- cambio de fuente (proyecto reabierto): invalidar el motor ----------
  const urlVistaRef = useRef<string | null>(null);
  useEffect(() => {
    const vista = urlVistaRef.current;
    if (vista !== null && vista !== sourceUrl) {
      motorRef.current?.dispose();
      motorRef.current = null;
      buffersRef.current = null;
      setReproduciendo(false);
      setPosicion(0);
      useProjectStore.getState().setPlayhead(0);
    }
    if (sourceUrl) urlVistaRef.current = sourceUrl;
  }, [sourceUrl]);

  // ---------- desmonte: cerrar el contexto del motor ----------
  useEffect(
    () => () => {
      motorRef.current?.dispose();
      motorRef.current = null;
      buffersRef.current = null;
    },
    []
  );

  const crearMotor = useCallback(async (): Promise<boolean> => {
    if (motorRef.current) return true;
    if (!sourceUrl || !bloques || !mezclaActual) return false;
    const catalogo = fase3.catalogo ?? [];
    const urls = new Map<string, string>();
    for (const b of bloques) {
      const p = catalogo.find((x) => x.id === b.pistaId);
      if (p) urls.set(p.id, p.archivo);
    }
    setCargandoAudio(true);
    setErrorMotor(null);
    try {
      const { bufferVoz, buffersPistas } = await decodificarFuentes(
        sourceUrl,
        urls
      );
      buffersRef.current = { bufferVoz, buffersPistas, urlVoz: sourceUrl };
      const cfg: MotorConfig = {
        bufferVoz,
        buffersPistas,
        bloques,
        nivelDb: mezclaActual.nivelDb,
        duckDb: mezclaActual.duckDb,
        hopSec: mezclaActual.hopSec,
        duracionSec: duracion,
      };
      motorRef.current = new MotorMezcla(cfg);
      return true;
    } catch (e) {
      setErrorMotor(
        e instanceof Error
          ? e.message
          : "No se pudo decodificar el audio para el editor."
      );
      return false;
    } finally {
      setCargandoAudio(false);
    }
  }, [sourceUrl, bloques, mezclaActual, fase3.catalogo, duracion]);

  // ---------- playhead fluido ----------
  useEffect(() => {
    if (!reproduciendo) return;
    let raf = 0;
    const loop = () => {
      const m = motorRef.current;
      if (m) {
        const p = m.posicion;
        setPosicion(p);
        useProjectStore.getState().setPlayhead(p);
        if (p >= m.duracion - 0.05) {
          m.detener();
          setReproduciendo(false);
          setPosicion(0);
          useProjectStore.getState().setPlayhead(0);
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reproduciendo]);

  // ---------- registro global (barra espaciadora) ----------
  const alternarRef = useRef<(() => void) | null>(null);

  const alternar = useCallback(async () => {
    const ok = await crearMotor();
    const m = motorRef.current;
    if (!ok || !m) return;
    // pausar el <audio> de la Fase 1 si estaba sonando
    const audioPrincipal = document.getElementById(
      "audio-principal"
    ) as HTMLAudioElement | null;
    if (audioPrincipal && !audioPrincipal.paused) audioPrincipal.pause();
    if (m.reproduciendo) {
      m.pausar();
      setReproduciendo(false);
      setPosicion(m.posicion);
    } else {
      if (m.posicion >= m.duracion - 0.05) await m.buscar(0);
      await m.reproducir();
      setReproduciendo(true);
    }
  }, [crearMotor]);

  alternarRef.current = () => void alternar();

  useEffect(() => {
    registrarControlMotor({
      toggle: () => alternarRef.current?.(),
      disponible: true,
    });
    return () => registrarControlMotor(null);
  }, []);

  const buscarA = useCallback(
    async (t: number) => {
      const destino = Math.max(0, Math.min(duracion, t));
      const m = motorRef.current;
      if (m) {
        await m.buscar(destino);
        setPosicion(m.posicion);
      } else {
        setPosicion(destino);
      }
      useProjectStore.getState().setPlayhead(destino);
    },
    [duracion]
  );

  const detener = useCallback(async () => {
    const m = motorRef.current;
    if (m) {
      m.detener();
      await m.buscar(0);
    }
    setReproduciendo(false);
    setPosicion(0);
    useProjectStore.getState().setPlayhead(0);
  }, []);

  // ---------- límites para prev/next ----------
  const limites = useMemo(() => {
    if (!bloques) return [0, duracion];
    const s = new Set<number>([0, duracion]);
    for (const b of bloques) {
      s.add(b.inicio);
      s.add(b.fin);
    }
    return [...s].sort((a, b) => a - b);
  }, [bloques, duracion]);

  const salto = useCallback(
    (dir: -1 | 1) => {
      const ref = posicion + dir * 0.5;
      const destino =
        dir < 0
          ? limites.filter((t) => t < ref).pop() ?? 0
          : limites.find((t) => t > ref) ?? duracion;
      void buscarA(destino);
    },
    [posicion, limites, duracion, buscarA]
  );

  // ---------- ediciones ----------
  const aplicar = useCallback(
    (nuevos: ReturnType<typeof dividirBloque>, detalle: string) => {
      if (!nuevos) return;
      useProjectStore.getState().aplicarEdicionFase5(nuevos, detalle);
    },
    []
  );

  const seleccionado = useMemo(
    () => bloques?.find((b) => b.id === selId) ?? null,
    [bloques, selId]
  );
  const pistaSel = useMemo(
    () => fase3.catalogo?.find((p) => p.id === seleccionado?.pistaId) ?? null,
    [fase3.catalogo, seleccionado]
  );

  const medirMotor = useCallback(() => {
    const m = motorRef.current;
    return m ? m.medir() : { vozDb: -90, musicaDb: -90 };
  }, []);

  if (fase4.status !== "approved" || !bloques) {
    return null;
  }

  const aprobada = fase5.status === "approved";

  return (
    <section
      className="space-y-4 pt-2"
      aria-label="Fase 5: editor de mezcla"
    >
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
          <Scissors className="h-5 w-5 text-amber-400" />
          Fase 5 · Editor de mezcla
          <Badge variant="outline" className="text-[10px] text-zinc-400">
            Web Audio · en vivo
          </Badge>
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          Escucha la <strong className="text-zinc-200">mezcla completa</strong>{" "}
          (voz + música con ducking y crossfades) y afínala como en Camtasia:{" "}
          <strong className="text-zinc-200">corta</strong> bloques con la cuchilla,{" "}
          <strong className="text-zinc-200">arrastra</strong> para moverlos,
          silencia o cambia la pista. Cada edición se recalcula al instante.
        </p>
      </div>

      {errorMotor && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error del motor de audio</AlertTitle>
          <AlertDescription>{errorMotor}</AlertDescription>
        </Alert>
      )}

      {!sourceUrl && (
        <Alert className="border-amber-800/50 bg-amber-950/20 text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Audio fuente no disponible</AlertTitle>
          <AlertDescription>
            Tras recargar la página el archivo original no está en memoria:
            pulsa «Volver a analizar» en la Fase 1 y re-selecciona el audio para
            escuchar la mezcla (la edición sigue disponible).
          </AlertDescription>
        </Alert>
      )}

      {/* transporte + medidores */}
      <Card className="border-zinc-800 bg-zinc-950/60">
        <CardContent className="space-y-3 p-4">
          <TransportMezcla
            reproduciendo={reproduciendo}
            listo={listo && !!sourceUrl}
            cargando={cargandoAudio}
            posicionSec={posicion}
            duracionSec={duracion}
            onToggle={() => void alternar()}
            onStop={() => void detener()}
            onSeekRel={(d) => void buscarA(posicion + d)}
            onPrev={() => salto(-1)}
            onNext={() => salto(1)}
          />
          {cargandoAudio && (
            <p className="flex items-center gap-2 text-[11px] text-amber-300/90">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Decodificando la narración y las pistas en memoria…
            </p>
          )}
          <NivelMetros leer={medirMotor} activo={reproduciendo} />
        </CardContent>
      </Card>

      {/* timeline editable */}
      <Card className="border-zinc-800 bg-zinc-950/60">
        <CardContent className="p-4">
          <MixTimeline
            analysis={analysis}
            durationSec={duracion}
            bloques={bloques}
            pistas={fase3.catalogo ?? []}
            nivelDb={mezclaActual?.nivelDb ?? null}
            hopSec={mezclaActual?.hopSec ?? 0.1}
            duckDb={mezclaActual?.duckDb ?? null}
            silences={silences}
            playheadSec={posicion}
            editable={!aprobada}
            selectedId={selId}
            onSelect={setSelId}
            onMover={(id, nuevoInicio) => {
              const nuevos = moverBloque(bloques, id, nuevoInicio, duracion);
              if (nuevos)
                aplicar(
                  nuevos,
                  `Bloque movido a ${formatTimecode(nuevoInicio)}`
                );
            }}
            onSeek={(t) => void buscarA(t)}
          />
        </CardContent>
      </Card>

      {/* inspector del bloque seleccionado */}
      {seleccionado && !aprobada && (
        <Card className="border-zinc-800 bg-zinc-950/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <Disc3 className="h-3.5 w-3.5 text-amber-400" />
              Bloque seleccionado
              {seleccionado.origen === "edicion" && (
                <Badge variant="outline" className="text-[9px] text-amber-300">
                  editado
                </Badge>
              )}
              <span className="ms-auto font-mono text-[10px] text-zinc-500">
                {formatTimecode(seleccionado.inicio)} →{" "}
                {formatTimecode(seleccionado.fin)} ·{" "}
                {Math.round(seleccionado.fin - seleccionado.inicio)} s
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 pb-4">
            <Select
              value={seleccionado.pistaId}
              onValueChange={(v) => {
                const nuevos = cambiarPistaBloque(bloques, seleccionado.id, v);
                if (nuevos) {
                  const p = fase3.catalogo?.find((x) => x.id === v);
                  aplicar(nuevos, `Pista cambiada a «${p?.titulo ?? v}»`);
                }
              }}
            >
              <SelectTrigger
                className="h-9 w-[240px] text-xs"
                aria-label="Cambiar la pista del bloque"
              >
                <SelectValue placeholder="Pista" />
              </SelectTrigger>
              <SelectContent>
                {(fase3.catalogo ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5"
              disabled={
                posicion <= seleccionado.inicio + 1 ||
                posicion >= seleccionado.fin - 1
              }
              onClick={() => {
                const nuevos = dividirBloque(
                  bloques,
                  seleccionado.id,
                  posicion
                );
                if (nuevos)
                  aplicar(nuevos, `Corte en ${formatTimecode(posicion)}`);
                else
                  setErrorMotor(
                    "El corte debe caer dentro del bloque (mínimo 2 s por lado)."
                  );
              }}
            >
              <Scissors className="h-3.5 w-3.5" />
              Cortar en {formatTimecode(posicion).slice(3, 11)}
            </Button>

            <div className="flex items-center gap-2">
              <Switch
                id="mute-bloque"
                checked={seleccionado.muted}
                onCheckedChange={() => {
                  const nuevos = silenciarBloque(bloques, seleccionado.id);
                  if (nuevos)
                    aplicar(
                      nuevos,
                      seleccionado.muted
                        ? "Bloque reactivado"
                        : "Bloque silenciado"
                    );
                }}
                aria-label="Silenciar el bloque"
              />
              <label
                htmlFor="mute-bloque"
                className="flex items-center gap-1 text-[11px] text-zinc-400"
              >
                {seleccionado.muted ? (
                  <>
                    <VolumeX className="h-3.5 w-3.5" /> silenciado
                  </>
                ) : (
                  <>
                    <Volume2 className="h-3.5 w-3.5" /> con sonido
                  </>
                )}
              </label>
            </div>

            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 border-rose-800/60 text-rose-300 hover:bg-rose-950/30"
              onClick={() => {
                if (
                  window.confirm(
                    `¿Eliminar el bloque «${pistaSel?.titulo ?? ""}» (${formatTimecode(
                      seleccionado.inicio
                    )} → ${formatTimecode(seleccionado.fin)})?`
                  )
                ) {
                  const nuevos = eliminarBloque(bloques, seleccionado.id);
                  if (nuevos) {
                    aplicar(nuevos, "Bloque eliminado");
                    setSelId(null);
                  }
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* puerta de auditoría */}
      <GateFase
        fase={5}
        titulo="Editor de mezcla"
        desbloqueaTexto="bloquea la Fase 6"
        descripcionPendiente="¿La mezcla suena como debe? Escúchala completa (o por tramos con los saltos de bloque) y aprueba para exportar los archivos finales."
        descripcionAprobada="La edición queda congelada: la Fase 6 renderizará exactamente esta mezcla."
        resumen={[
          { etiqueta: "Bloques", valor: String(bloques.length) },
          {
            etiqueta: "Ediciones",
            valor: String(fase5.ediciones),
          },
          {
            etiqueta: "Silenciados",
            valor: String(bloques.filter((b) => b.muted).length),
          },
        ]}
        confirmacion={`He escuchado la mezcla (${bloques.length} bloques, ${fase5.ediciones} ediciones) y el equilibrio voz/música es correcto.`}
        textoAprobar="Aprobar la mezcla final y desbloquear la exportación"
        approved={aprobada}
        onApprove={() => {
          const m = motorRef.current;
          if (m && m.reproduciendo) {
            m.pausar();
            setReproduciendo(false);
          }
          useProjectStore.getState().aprobarFase5();
        }}
        onReopen={() => useProjectStore.getState().reabrirFase5()}
        onRehacer={() => {
          if (
            window.confirm(
              "¿Descartar las ediciones y volver al arreglo automático de la Fase 4?"
            )
          ) {
            if (motorRef.current) {
              motorRef.current.detener();
              setReproduciendo(false);
            }
            const mezcla = useProjectStore.getState().fase4.mezcla;
            if (mezcla)
              useProjectStore
                .getState()
                .materializarFase5(mezcla.bloques, fase4.params);
            setSelId(null);
          }
        }}
        rehacerLabel="Descartar ediciones"
        notaReabrir="Al volver a editar se reinicia la Fase 6 (exportación)."
      />
    </section>
  );
}
