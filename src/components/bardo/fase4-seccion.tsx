"use client";

import { useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  SlidersHorizontal,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useProjectStore } from "@/store/project";
import { calcularMezcla } from "@/lib/fase4/mezcla";
import {
  FASE4_ETIQUETAS,
  FASE4_LIMITES,
  FASE4_UNIDADES,
  type Fase4Params,
} from "@/lib/fase4/tipos";
import { materializarClips } from "@/lib/sfx/clips";
import { SFX_DEFECTOS } from "@/lib/sfx/tipos";
import { formatDurSmart } from "@/lib/format";
import { GateFase } from "./gate-fase";
import { MixTimeline } from "./mix-timeline";

const CLAVES: Array<keyof Fase4Params> = [
  "nivelMusicaDb",
  "rangoDinamicoDb",
  "profundidadDuckingDb",
  "ataqueMs",
  "liberacionMs",
  "crossfadeSeg",
  "hincharSilenciosDb",
];

const PASOS: Partial<Record<keyof Fase4Params, number>> = {
  nivelMusicaDb: 0.5,
  rangoDinamicoDb: 0.5,
  profundidadDuckingDb: 0.5,
  ataqueMs: 10,
  liberacionMs: 50,
  crossfadeSeg: 0.5,
  hincharSilenciosDb: 0.5,
};

function formatear(clave: keyof Fase4Params, v: number): string {
  const u = FASE4_UNIDADES[clave];
  if (u === "dB") return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
  if (u === "ms") return `${Math.round(v)} ms`;
  if (u === "s") return `${v.toFixed(1)} s`;
  return String(v);
}

/** Fase 4 · Mezcla automática: bloques + envolventes + parámetros editables. */
export function Fase4Seccion() {
  const fase2 = useProjectStore((s) => s.fase2);
  const fase3 = useProjectStore((s) => s.fase3);
  const fase4 = useProjectStore((s) => s.fase4);
  const faseSfx = useProjectStore((s) => s.faseSfx);
  const analysis = useProjectStore((s) => s.analysis);
  const silences = useProjectStore((s) => s.silences);
  const thresholds = useProjectStore((s) => s.thresholds);

  const aprobada = fase4.status === "approved";
  const params = fase4.params;
  const defectosSfx = faseSfx.config?.defectos ?? SFX_DEFECTOS;

  // clips SFX de previsualización (se materializan de verdad en la Fase 5)
  const clipsSfxVista = useMemo(() => {
    if (!analysis || faseSfx.eventos.length === 0) return [];
    return materializarClips(
      faseSfx.eventos,
      defectosSfx,
      analysis.durationSec,
      faseSfx.biblioteca ?? []
    );
  }, [analysis, faseSfx.eventos, faseSfx.biblioteca, defectosSfx]);

  // ---- cálculo determinista de la mezcla (se recalcula al mover sliders) ----
  const mezcla = useMemo(() => {
    const a = analysis;
    if (!a || a.envDb.length === 0 || !fase3.asignaciones) return null;
    try {
      return calcularMezcla({
        escenas: fase2.escenas,
        asignaciones: fase3.asignaciones,
        duracionSec: a.durationSec,
        envDb: a.envDb,
        envHopSec: a.envelopeHopSec,
        umbralVozDb: thresholds.dbThreshold,
        silencios: silences,
        params,
        sfxRespetarDucking: defectosSfx.respetarDucking,
      });
    } catch {
      return null;
    }
  }, [
    analysis,
    fase3.asignaciones,
    fase2.escenas,
    silences,
    thresholds.dbThreshold,
    params,
    defectosSfx.respetarDucking,
  ]);

  // volcar al store (volátil) para que el editor de la Fase 5 la materialice
  useEffect(() => {
    if (mezcla) useProjectStore.getState().setMezclaFase4(mezcla);
  }, [mezcla]);

  if (fase3.status !== "approved") return null;

  const stats = mezcla?.stats;

  return (
    <section
      className="space-y-4 pt-2"
      aria-label="Fase 4: mezcla automática con ducking y crossfades"
    >
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
          <SlidersHorizontal className="h-5 w-5 text-amber-400" />
          Fase 4 · Mezcla automática
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          A partir de la curva de tensión aprobada, se calcula el{" "}
          <strong className="text-zinc-200">arreglo completo</strong>: bloques de
          música por escena, <strong className="text-zinc-200">crossfades</strong>{" "}
          entre pistas, nivel dinámico según la tensión, hinchado en los silencios
          y <strong className="text-zinc-200">ducking</strong> bajo la voz con
          ataque/liberación. Ajusta y aprueba para abrir el editor.
        </p>
      </div>

      {!mezcla && (
        <Card className="border-zinc-800 bg-zinc-950/60">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            Calculando el arreglo musical… (requiere la envolvente de voz de la
            Fase 1 restaurada)
          </CardContent>
        </Card>
      )}

      {mezcla && (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
            {/* panel de parámetros */}
            <Card className="h-fit border-zinc-800 bg-zinc-950/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs text-zinc-400">
                  Parámetros de la mezcla
                  {aprobada && (
                    <Badge variant="outline" className="text-[9px] text-emerald-300">
                      bloqueada
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pb-4">
                {CLAVES.map((clave) => {
                  const [min, max] = FASE4_LIMITES[clave];
                  const paso = PASOS[clave] ?? 1;
                  return (
                    <div key={clave} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className="text-[11px] font-medium text-zinc-300"
                          htmlFor={`p4-${clave}`}
                        >
                          {FASE4_ETIQUETAS[clave]}
                        </label>
                        <span className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                          {formatear(clave, params[clave])}
                        </span>
                      </div>
                      <Slider
                        id={`p4-${clave}`}
                        min={min}
                        max={max}
                        step={paso}
                        value={[params[clave]]}
                        disabled={aprobada}
                        onValueChange={(v) =>
                          useProjectStore
                            .getState()
                            .setParamsFase4({ [clave]: v[0] } as Partial<Fase4Params>)
                        }
                        aria-label={FASE4_ETIQUETAS[clave]}
                      />
                    </div>
                  );
                })}
                {fase4.paramsTouched && !aprobada && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1 text-[11px] text-zinc-400"
                    onClick={() =>
                      useProjectStore.getState().restaurarParamsFase4()
                    }
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restaurar valores de config.json
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* línea de tiempo de la mezcla */}
            <Card className="border-zinc-800 bg-zinc-950/60">
              <CardContent className="p-4">
                <MixTimeline
                  analysis={analysis}
                  durationSec={analysis?.durationSec ?? 0}
                  bloques={mezcla.bloques}
                  pistas={fase3.catalogo ?? []}
                  nivelDb={mezcla.nivelDb}
                  hopSec={mezcla.hopSec}
                  duckDb={mezcla.duckDb}
                  silences={silences}
                  playheadSec={0}
                  clipsSfx={clipsSfxVista}
                  bibliotecaSfx={faseSfx.biblioteca ?? []}
                  onSeek={() => undefined}
                />
              </CardContent>
            </Card>
          </div>

          {/* estadísticas + puerta */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-500">
            <span>
              Bloques: <span className="text-zinc-300">{stats?.bloques}</span> ·
              crossfades: <span className="text-zinc-300">{stats?.crossfades}</span>
            </span>
            <span>
              Tiempo con música:{" "}
              <span className="text-zinc-300">
                {formatDurSmart(stats?.tiempoConMusicaSec ?? 0)}
              </span>
            </span>
            <span>
              Nivel medio:{" "}
              <span className="text-zinc-300">{stats?.nivelMedioDb} dB</span> ·
              ducking medio con voz:{" "}
              <span className="text-zinc-300">{stats?.duckMedioDb} dB</span>
            </span>
            <span>
              Hinchados en silencios:{" "}
              <span className="text-zinc-300">{stats?.hinchados}</span>
            </span>
            <span>
              Efectos: <span className="text-zinc-300">{clipsSfxVista.length}</span>{" "}
              clips · {defectosSfx.nivelDb} dB ·{" "}
              {defectosSfx.respetarDucking
                ? "respeta el ducking de la voz (½ profundidad)"
                : "sin ducking"}{" "}
              · fundidos {defectosSfx.crossfadeSeg} s
            </span>
          </div>

          <GateFase
            fase={4}
            titulo="Mezcla automática"
            desbloqueaTexto="bloquea la Fase 5"
            descripcionPendiente="¿El arreglo respeta la narración? Mueve los sliders, revisa la envolvente, los crossfades y la pista de efectos en la línea de tiempo y aprueba para editar en el estudio."
            descripcionAprobada="El arreglo queda fijado: la Fase 5 lo materializa en un editor reproducible con medidores."
            resumen={[
              { etiqueta: "Bloques", valor: String(stats?.bloques ?? 0) },
              { etiqueta: "Crossfades", valor: String(stats?.crossfades ?? 0) },
              { etiqueta: "Ducking", valor: `−${params.profundidadDuckingDb} dB` },
              { etiqueta: "Crossfade", valor: `${params.crossfadeSeg} s` },
              {
                etiqueta: "Efectos",
                valor: clipsSfxVista.length
                  ? `${clipsSfxVista.length} · ${defectosSfx.nivelDb} dB`
                  : "—",
              },
            ]}
            confirmacion={`He revisado el arreglo (${stats?.bloques ?? 0} bloques, ducking de ${params.profundidadDuckingDb} dB bajo la voz, crossfades de ${params.crossfadeSeg} s${clipsSfxVista.length ? `, ${clipsSfxVista.length} efectos a ${defectosSfx.nivelDb} dB` : ""}) y refleja la intención musical.`}
            textoAprobar="Aprobar el arreglo y abrir el editor (Fase 5)"
            approved={aprobada}
            onApprove={() => useProjectStore.getState().aprobarFase4()}
            onReopen={() => useProjectStore.getState().reabrirFase4()}
            notaReabrir="Al volver a editar se reinician las fases 5-6 (editor y exportación)."
          />
        </>
      )}
    </section>
  );
}
