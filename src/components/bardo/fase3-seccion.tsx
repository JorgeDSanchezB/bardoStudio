"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Music2,
  Play,
  Square,
  Loader2,
  AlertTriangle,
  RotateCcw,
  BadgeCheck,
  Hand,
} from "lucide-react";
import { useProjectStore } from "@/store/project";
import { normalizarPista, bandaTension, type Pista } from "@/lib/fase3/tipos";
import { ANIMO_ETIQUETAS, ANIMO_COLORES } from "@/lib/fase2/types";
import { formatDurSmart } from "@/lib/format";
import { GateFase } from "./gate-fase";

/** Fase 3 · Gestión de música: biblioteca CC0 + asignación por ánimo/tensión. */
export function Fase3Seccion() {
  const fase2 = useProjectStore((s) => s.fase2);
  const fase3 = useProjectStore((s) => s.fase3);
  const catalogo = fase3.catalogo;
  const escenas = fase2.escenas;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [sonando, setSonando] = useState<string | null>(null);
  const [progresoAud, setProgresoAud] = useState(0);

  // ---- cargar catálogo al entrar ----
  useEffect(() => {
    if (fase2.status !== "approved" || catalogo) return;
    let vivo = true;
    (async () => {
      const st = useProjectStore.getState();
      try {
        const res = await fetch("/api/music-library");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          pistas?: Array<Record<string, unknown>>;
        };
        const pistas = (data.pistas ?? [])
          .map((r) => normalizarPista(r))
          .filter((p): p is Pista => p !== null);
        if (!vivo) return;
        st.setCatalogoFase3(pistas);
        // la auto-asignación la dispara el efecto dedicado SOLO si no hay
        // asignaciones persistidas (conserva los ajustes manuales tras recargar)
      } catch {
        if (vivo)
          st.fallarFase3(
            "No se pudo cargar la biblioteca musical local (/api/music-library)."
          );
      }
    })();
    return () => {
      vivo = false;
    };
  }, [fase2.status, catalogo]);

  // ---- asignar automáticamente si hay catálogo y falta ----
  useEffect(() => {
    if (
      catalogo &&
      catalogo.length > 0 &&
      escenas.length > 0 &&
      !fase3.asignaciones
    ) {
      useProjectStore.getState().autoAsignarFase3();
    }
  }, [catalogo, escenas, fase3.asignaciones]);

  // ---- audición ----
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgresoAud(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => {
      setSonando(null);
      setProgresoAud(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const alternarAudicion = (p: Pista) => {
    const a = audioRef.current;
    if (!a) return;
    if (sonando === p.id) {
      a.pause();
      setSonando(null);
      return;
    }
    a.src = p.archivo;
    void a.play().then(() => setSonando(p.id)).catch(() => setSonando(null));
  };

  // ---- derivados ----
  const usosPorPista = useMemo(() => {
    const m = new Map<string, number>();
    if (!fase3.asignaciones) return m;
    for (const a of fase3.asignaciones)
      m.set(a.pistaId, (m.get(a.pistaId) ?? 0) + 1);
    return m;
  }, [fase3.asignaciones]);

  const pistasPorEscena = useMemo(() => {
    if (!fase3.asignaciones) return new Map<string, string>();
    return new Map(fase3.asignaciones.map((a) => [a.escenaId, a.pistaId]));
  }, [fase3.asignaciones]);

  if (fase2.status !== "approved") return null;

  const aprobada = fase3.status === "approved";
  const resumen = fase3.resumen;

  return (
    <section
      className="space-y-4 pt-2"
      aria-label="Fase 3: gestión de música y asignación por escena"
    >
      <div className="space-y-1">
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold sm:text-xl">
          <Music2 className="h-5 w-5 text-amber-400" />
          Fase 3 · Gestión de música
          <Badge variant="outline" className="border-teal-800/60 text-[10px] text-teal-300">
            CC0 · síntesis propia
          </Badge>
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
          La biblioteca local de <strong className="text-zinc-200">9 pistas CC0</strong>{" "}
          (sintetizadas de forma determinista, sin terceros) se empareja con cada
          escena por <strong className="text-zinc-200">ánimo y banda de tensión</strong>.
          Escucha cualquier pista, cambia la asignación de una escena y aprueba
          para desbloquear la mezcla automática.
        </p>
      </div>

      {fase3.status === "error" && fase3.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error de la Fase 3</AlertTitle>
          <AlertDescription>{fase3.error}</AlertDescription>
        </Alert>
      )}

      {!catalogo && fase3.status !== "error" && (
        <Card className="border-zinc-800 bg-zinc-950/60">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            Cargando la biblioteca musical local…
          </CardContent>
        </Card>
      )}

      {catalogo && (
        <>
          {/* biblioteca */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {catalogo.map((p) => {
              const color = ANIMO_COLORES[p.animo];
              const usos = usosPorPista.get(p.id) ?? 0;
              const activa = sonando === p.id;
              return (
                <Card
                  key={p.id}
                  className="relative overflow-hidden border-zinc-800 bg-zinc-950/60"
                  style={{ borderColor: activa ? color : undefined }}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-0.5"
                    style={{ background: color }}
                  />
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-100">
                          {p.titulo}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          <span style={{ color }}>{ANIMO_ETIQUETAS[p.animo]}</span>{" "}
                          · tensión {bandaTension(p)} · {p.bpm} BPM ·{" "}
                          {p.tonalidad}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        className="h-9 w-9 shrink-0 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                        aria-label={activa ? `Detener ${p.titulo}` : `Escuchar ${p.titulo}`}
                        onClick={() => alternarAudicion(p)}
                      >
                        {activa ? (
                          <Square className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {/* banda de tensión */}
                    <div
                      className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
                      aria-hidden
                    >
                      <div
                        className="absolute h-full rounded-full"
                        style={{
                          left: `${p.tensionMin}%`,
                          width: `${Math.max(4, p.tensionMax - p.tensionMin)}%`,
                          background: color,
                        }}
                      />
                    </div>

                    <p className="text-[11px] text-zinc-400">{p.instrumentacion}</p>
                    <p className="line-clamp-2 text-[11px] leading-snug text-zinc-500">
                      {p.descripcion}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span>{formatDurSmart(p.durSec)} · loop limpio</span>
                      {usos > 0 && (
                        <Badge
                          variant="outline"
                          className="h-5 px-1.5 text-[9px]"
                          style={{ borderColor: `${color}66`, color }}
                        >
                          {usos} escena{usos > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    {activa && (
                      <Progress
                        value={progresoAud * 100}
                        className="h-1"
                        aria-label="Progreso de la audición"
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* tabla de asignaciones */}
          {fase3.asignaciones && (
            <Card className="border-zinc-800 bg-zinc-950/60">
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/80 p-4">
                  <p className="text-sm font-semibold text-zinc-200">
                    Asignación por escena
                  </p>
                  <Badge variant="secondary" className="text-[10px]">
                    {escenas.length} escenas
                  </Badge>
                  <div className="ms-auto flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                    {resumen && (
                      <>
                        <span>
                          pistas usadas:{" "}
                          <span className="text-zinc-300">{resumen.pistasUsadas}</span>
                        </span>
                        <span>
                          cambios de pista:{" "}
                          <span className="text-zinc-300">{resumen.cambios}</span>
                        </span>
                        <span>
                          manuales:{" "}
                          <span className="text-zinc-300">{resumen.manual}</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="max-h-[420px] overflow-auto scroll-thin">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Nº</th>
                        <th className="px-3 py-2 font-medium">Rango</th>
                        <th className="px-3 py-2 font-medium">Ánimo</th>
                        <th className="px-3 py-2 font-medium">Tensión</th>
                        <th className="px-3 py-2 font-medium">Pista asignada</th>
                        <th className="px-3 py-2 font-medium">Origen</th>
                        <th className="px-3 py-2 font-medium">Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {escenas.map((e) => {
                        const pid = pistasPorEscena.get(e.id);
                        const pista = catalogo.find((p) => p.id === pid);
                        const asig = fase3.asignaciones!.find(
                          (a) => a.escenaId === e.id
                        );
                        return (
                          <tr
                            key={e.id}
                            className="border-t border-zinc-800/60 hover:bg-zinc-900/40"
                          >
                            <td className="px-3 py-2 font-mono text-zinc-400">
                              {e.n}
                            </td>
                            <td className="px-3 py-2 font-mono text-zinc-400">
                              {Math.floor(e.inicio / 60)}:
                              {String(Math.floor(e.inicio % 60)).padStart(2, "0")}–
                              {Math.floor(e.fin / 60)}:
                              {String(Math.floor(e.fin % 60)).padStart(2, "0")}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                                style={{
                                  borderColor: `${ANIMO_COLORES[e.animo]}66`,
                                  color: ANIMO_COLORES[e.animo],
                                }}
                              >
                                {ANIMO_ETIQUETAS[e.animo]}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-zinc-200">{e.tension}</span>
                            </td>
                            <td className="px-3 py-2">
                              <Select
                                value={pid ?? ""}
                                disabled={aprobada}
                                onValueChange={(v) =>
                                  useProjectStore
                                    .getState()
                                    .setPistaManualFase3(e.id, v)
                                }
                              >
                                <SelectTrigger
                                  className="h-8 w-full min-w-[170px] text-xs"
                                  aria-label={`Pista de la escena ${e.n}`}
                                >
                                  <SelectValue>
                                    <span className="flex items-center gap-1.5 truncate">
                                      {pista && (
                                        <span
                                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                                          style={{
                                            background:
                                              ANIMO_COLORES[pista.animo],
                                          }}
                                        />
                                      )}
                                      <span className="truncate">
                                        {pista?.titulo ?? "—"}
                                      </span>
                                    </span>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {catalogo.map((p) => (
                                    <SelectItem
                                      key={p.id}
                                      value={p.id}
                                      className="text-xs"
                                    >
                                      <span className="flex items-center gap-1.5">
                                        <span
                                          className="inline-block h-2 w-2 rounded-full"
                                          style={{
                                            background: ANIMO_COLORES[p.animo],
                                          }}
                                        />
                                        {p.titulo}
                                        <span className="text-zinc-500">
                                          ({bandaTension(p)})
                                        </span>
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-3 py-2">
                              {asig?.origen === "manual" ? (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-amber-700/50 text-[10px] text-amber-300"
                                >
                                  <Hand className="h-2.5 w-2.5" /> manual
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="gap-1 border-teal-700/50 text-[10px] text-teal-300"
                                >
                                  <BadgeCheck className="h-2.5 w-2.5" /> auto
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-zinc-400">
                              {asig ? `${asig.match}%` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* puerta de auditoría */}
          {fase3.asignaciones && resumen && (
            <GateFase
              fase={3}
              titulo="Gestión de música"
              desbloqueaTexto="bloquea la Fase 4"
              descripcionPendiente="¿La asignación de pistas respeta el ánimo y la tensión de cada escena? Cambia lo que no te convenza y aprueba para calcular la mezcla automática."
              descripcionAprobada="La banda sonora queda fijada por escena: la Fase 4 calculará bloques, crossfades y ducking sobre esta asignación."
              resumen={[
                { etiqueta: "Pistas usadas", valor: String(resumen.pistasUsadas) },
                { etiqueta: "Cambios de pista", valor: String(resumen.cambios) },
                { etiqueta: "Ajustes manuales", valor: String(resumen.manual) },
                { etiqueta: "Tiempo musicalizado", valor: formatDurSmart(resumen.tiempoMusicaSec) },
              ]}
              confirmacion={`He escuchado/repasado la biblioteca y las ${escenas.length} asignaciones (${resumen.manual} ajustadas a mano) y doy fe de que la banda sonora encaja con el mapa dramático.`}
              textoAprobar="Aprobar la banda sonora y desbloquear la Fase 4"
              approved={aprobada}
              onApprove={() => useProjectStore.getState().aprobarFase3()}
              onReopen={() => useProjectStore.getState().reabrirFase3()}
              onRehacer={() => {
                if (
                  window.confirm(
                    "¿Rehacer la asignación automática? Se perderán los ajustes manuales (la Fase 4 se reinicia)."
                  )
                )
                  useProjectStore.getState().rehacerFase3();
              }}
              rehacerLabel="Reasignar automáticamente"
              notaReabrir="Al volver a editar se reinician las fases 4-6 (mezcla, editor y exportación)."
            />
          )}
        </>
      )}

      {/* elemento de audición (siempre montado) */}
      <audio ref={audioRef} preload="none" className="hidden">
        <track kind="captions" />
      </audio>
    </section>
  );
}
