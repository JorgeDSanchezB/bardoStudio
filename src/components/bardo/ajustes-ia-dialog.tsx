"use client";

/**
 * Ajustes de IA — conexión del servicio de transcripción/análisis.
 *
 * La Fase 2 (transcripción ASR + curva de tensión) necesita un servicio de
 * IA que solo es accesible desde el servidor de la web de Bardo Studio.
 * Este diálogo permite:
 *
 *  · WEB: ver que la IA está conectada vía el servidor y copiar la URL
 *    que la app de escritorio debe usar como relé.
 *  · ESCRITORIO: pegar la URL de su Bardo Studio web y conectarse (con
 *    prueba real); la conexión se guarda en .z-ai-config junto al servidor
 *    interno y se conserva entre versiones.
 *  · Avanzado: quien tenga sus propias credenciales puede escribir su
 *    propio archivo .z-ai-config (ver LEEME).
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Copy, Check, Unplug, Link2 } from "lucide-react";

type ModoIa = "servidor" | "rele" | "ninguno";

interface EstadoIa {
  modo: ModoIa;
  baseUrl?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AjustesIaDialog({ open, onOpenChange }: Props) {
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState<EstadoIa | null>(null);
  const [url, setUrl] = useState("");
  const [probando, setProbando] = useState(false);
  const [resultado, setResultado] = useState<
    { ok: boolean; mensaje: string } | null
  >(null);
  const [copiado, setCopiado] = useState(false);
  const [urlWeb, setUrlWeb] = useState("");

  // al abrir: estado actual + URL de esta web (para copiar al escritorio)
  useEffect(() => {
    if (!open) return;
    setCargando(true);
    setResultado(null);
    setCopiado(false);
    setUrlWeb(window.location.origin);
    fetch("/api/ia-config", { cache: "no-store" })
      .then((r) => r.json() as Promise<EstadoIa>)
      .then((d) => {
        setEstado(d);
        setUrl(
          d.modo === "rele" && d.baseUrl
            ? d.baseUrl.replace(/\/api\/ia\/?$/, "")
            : ""
        );
      })
      .catch(() => setEstado(null))
      .finally(() => setCargando(false));
  }, [open]);

  const conectado = estado?.modo === "servidor" || estado?.modo === "rele";
  const esServidor = estado?.modo === "servidor";
  const esRele = estado?.modo === "rele";

  async function conectar() {
    const candidata = url.trim();
    if (!candidata || probando) return;
    setProbando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/ia-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidata }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        modo?: ModoIa;
        baseUrl?: string;
        error?: string;
      };
      if (res.ok && data.ok) {
        setEstado({ modo: data.modo ?? "rele", baseUrl: data.baseUrl });
        setResultado({
          ok: true,
          mensaje:
            "Conexión establecida y probada. La Fase 2 ya puede transcribir: cierra este panel y reanúdala.",
        });
      } else {
        setResultado({
          ok: false,
          mensaje: data.error ?? "No se pudo conectar con esa URL.",
        });
      }
    } catch {
      setResultado({
        ok: false,
        mensaje: "No se pudo contactar con el servidor de esta app.",
      });
    } finally {
      setProbando(false);
    }
  }

  async function desconectar() {
    if (probando) return;
    setProbando(true);
    setResultado(null);
    try {
      const res = await fetch("/api/ia-config", { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; modo?: ModoIa };
      if (res.ok && data.ok) {
        setEstado({ modo: data.modo ?? "ninguno" });
        setUrl("");
        setResultado({
          ok: true,
          mensaje: "Desconectado. La Fase 2 necesitará reconectar para transcribir.",
        });
      }
    } catch {
      setResultado({ ok: false, mensaje: "No se pudo desconectar." });
    } finally {
      setProbando(false);
    }
  }

  async function copiarUrlWeb() {
    try {
      await navigator.clipboard.writeText(urlWeb);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* portapapeles no disponible: la URL es seleccionable a mano */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-zinc-100">
            <Sparkles className="h-4 w-4 text-amber-400" aria-hidden />
            Ajustes de IA
            {cargando ? (
              <Badge
                variant="outline"
                className="border-zinc-700 text-[10px] text-zinc-400"
              >
                comprobando…
              </Badge>
            ) : conectado ? (
              <Badge
                variant="outline"
                className="gap-1 border-emerald-800/60 text-[10px] text-emerald-300"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                conectada
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-amber-800/60 text-[10px] text-amber-300"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
                sin conectar
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            El servicio de transcripción (Fase 2) y el análisis de tensión usan
            una IA externa que solo el servidor de la web de Bardo Studio puede
            alcanzar. El resto de la aplicación (mezcla, efectos, editor,
            exportación) funciona siempre en local.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {cargando && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Comprobando el estado de la conexión…
            </div>
          )}

          {!cargando && estado?.modo === "servidor" && (
            <div className="space-y-2">
              <p className="text-sm text-zinc-300">
                IA conectada a través del servidor de esta web: no necesitas
                configurar nada aquí.
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">
                  URL para la app de escritorio (cópiala allí, en estos mismos
                  ajustes)
                </Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={urlWeb}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-9 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-300"
                    aria-readonly
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 gap-1.5 border-zinc-700 text-xs text-zinc-300"
                    onClick={() => void copiarUrlWeb()}
                  >
                    {copiado ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {copiado ? "Copiada" : "Copiar"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!cargando && !esServidor && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="ia-url" className="text-xs text-zinc-500">
                  URL de tu Bardo Studio web (la dirección donde abres esta
                  aplicación en el navegador)
                </Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="ia-url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                    disabled={probando}
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 min-w-[180px] flex-1 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans placeholder:text-zinc-600"
                  />
                  <Button
                    size="sm"
                    className="h-9 shrink-0 gap-1.5 bg-amber-500 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                    onClick={() => void conectar()}
                    disabled={probando || url.trim().length < 8}
                    title="Guarda la conexión y prueba el servicio"
                  >
                    {probando ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {esRele ? "Probar" : "Conectar"}
                  </Button>
                  {esRele && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5 border-rose-800/60 text-xs text-rose-300 hover:bg-rose-500/10"
                      onClick={() => void desconectar()}
                      disabled={probando}
                      title="Quitar la conexión guardada"
                    >
                      <Unplug className="h-3.5 w-3.5" aria-hidden />
                      Desconectar
                    </Button>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  Se guardará junto al servidor interno de la app y se conserva
                  al actualizar. Si no la tienes a mano, ábrela en el navegador:
                  en «Ajustes de IA» de la web aparece con botón de copiar.
                </p>
              </div>

              {estado?.modo === "rele" && estado.baseUrl && (
                <p className="text-[11px] text-zinc-500">
                  Conectada a{" "}
                  <span className="font-mono text-zinc-400">
                    {estado.baseUrl.replace(/\/api\/ia\/?$/, "")}
                  </span>
                  . Pulsa «Probar» tras pegar la URL para verificarla de nuevo.
                </p>
              )}
            </div>
          )}

          {!cargando && estado?.modo === "ninguno" && (
            <Alert className="border-amber-800/50 bg-amber-950/10 text-amber-200">
              <AlertTitle className="text-xs font-semibold">
                La Fase 2 no podrá transcribir sin conexión
              </AlertTitle>
              <AlertDescription className="text-[11px] text-amber-200/80">
                Sin la IA, la Fase 1, el editor, la mezcla y la exportación
                siguen funcionando con proyectos ya transcritos, pero la
                transcripción nueva queda bloqueada.
              </AlertDescription>
            </Alert>
          )}

          {resultado && (
            <Alert
              variant={resultado.ok ? "default" : "destructive"}
              className={
                resultado.ok
                  ? "border-emerald-800/50 bg-emerald-950/10 text-emerald-200"
                  : undefined
              }
              role="status"
              aria-live="polite"
            >
              <AlertDescription
                className={resultado.ok ? "text-[12px]" : undefined}
              >
                {resultado.mensaje}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-zinc-400"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
