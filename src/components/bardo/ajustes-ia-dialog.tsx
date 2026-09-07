"use client";

/**
 * Ajustes de IA — proveedores REEMPLAZABLES para la Fase 2 (ADR-014).
 *
 * La transcripción (ASR) y el análisis de tensión (LLM) pueden usar:
 *
 *  · Z.AI incluida — directa en la web del servidor; en la app de escritorio
 *    vía relé de la web (pegar URL, igual que la 1.0.1).
 *  · API propia compatible OpenAI — OpenAI, Groq, Mistral, servidores
 *    locales (whisper.cpp, LM Studio…): el usuario pone SU clave.
 *  · Deepgram — solo transcripción (la tensión usa la heurística local).
 *
 * Las claves se guardan junto al servidor interno de la app (archivo local
 * .bardo-ia.json, conservado al actualizar) y nunca salen por GET.
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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  Unplug,
  Link2,
  Eye,
  EyeOff,
  KeyRound,
  Trash2,
  PlugZap,
  Cpu,
  Zap,
} from "lucide-react";

type IdProveedor = "zai" | "openai" | "deepgram";

interface EstadoIa {
  activo: IdProveedor | "ninguno";
  zai: { modo: "servidor" | "rele" | "ninguno"; baseUrl?: string };
  openai: {
    baseUrl?: string;
    modeloAsr?: string;
    modeloChat?: string;
    tieneClave?: boolean;
    pistaClave?: string;
  } | null;
  deepgram: { tieneClave?: boolean; pistaClave?: string } | null;
}

const NOMBRE_PROVEEDOR: Record<IdProveedor, string> = {
  zai: "Z.AI incluida",
  openai: "API propia",
  deepgram: "Deepgram",
};

const PREAJUSTES: Array<{
  id: string;
  etiqueta: string;
  baseUrl: string;
  modeloAsr?: string;
  modeloChat?: string;
  nota: string;
}> = [
  {
    id: "openai",
    etiqueta: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modeloAsr: "whisper-1",
    modeloChat: "gpt-4o-mini",
    nota: "Plataforma de OpenAI: Whisper (transcripción) + GPT (tensión).",
  },
  {
    id: "groq",
    etiqueta: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    modeloAsr: "whisper-large-v3",
    modeloChat: "llama-3.1-8b-instant",
    nota: "Muy rápido y con capa gratuita: Whisper large + Llama.",
  },
  {
    id: "mistral",
    etiqueta: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    modeloChat: "mistral-small-latest",
    nota: "Análisis de tensión con Mistral (sin transcripción: usa otro proveedor o el modelo de voz que tengas).",
  },
  {
    id: "local",
    etiqueta: "Servidor local",
    baseUrl: "http://localhost:8080/v1",
    nota: "LM Studio (chat, http://localhost:1234/v1), whisper.cpp (transcripción, :8080), vLLM… en tu equipo: sin coste y sin salir a internet. LM Studio NO transcribe: pon su URL arriba y la de Whisper en «URL de transcripción aparte».",
  },
  {
    id: "personalizada",
    etiqueta: "Personalizada",
    baseUrl: "",
    nota: "Cualquier otra API compatible con el formato de OpenAI.",
  },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function AjustesIaDialog({ open, onOpenChange }: Props) {
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState<EstadoIa | null>(null);

  // pestaña Z.AI (relé de la web, escritorio)
  const [urlRele, setUrlRele] = useState("");

  // pestaña API propia
  const [preset, setPreset] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  /** URL de transcripción aparte (opcional): chat y ASR en servicios distintos */
  const [baseUrlAsr, setBaseUrlAsr] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [modeloAsr, setModeloAsr] = useState("");
  const [modeloChat, setModeloChat] = useState("");

  // pestaña Deepgram
  const [claveDg, setClaveDg] = useState("");
  const [verClaveDg, setVerClaveDg] = useState(false);

  // común
  const [probando, setProbando] = useState<IdProveedor | null>(null);
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
    fetch("/api/ia-proveedores", { cache: "no-store" })
      .then((r) => r.json() as Promise<EstadoIa>)
      .then((d) => {
        setEstado(d);
        setUrlRele(
          d.zai?.modo === "rele" && d.zai.baseUrl
            ? d.zai.baseUrl.replace(/\/api\/ia\/?$/, "")
            : ""
        );
        if (d.openai?.baseUrl) {
          setBaseUrl(d.openai.baseUrl);
          setBaseUrlAsr(d.openai.baseUrlAsr ?? "");
          setModeloAsr(d.openai.modeloAsr ?? "");
          setModeloChat(d.openai.modeloChat ?? "");
          setPreset(
            PREAJUSTES.some((p) => p.baseUrl === d.openai?.baseUrl)
              ? (PREAJUSTES.find((p) => p.baseUrl === d.openai?.baseUrl)!.id)
              : "personalizada"
          );
        } else {
          aplicarPreset("openai");
        }
        setClave("");
        setClaveDg("");
      })
      .catch(() => setEstado(null))
      .finally(() => setCargando(false));
  }, [open]);

  function aplicarPreset(id: string) {
    setPreset(id);
    const p = PREAJUSTES.find((x) => x.id === id);
    if (!p) return; // personalizada: no tocar los campos
    setBaseUrl(p.baseUrl);
    setBaseUrlAsr("");
    setModeloAsr(p.modeloAsr ?? "");
    setModeloChat(p.modeloChat ?? "");
  }

  async function enviar(
    proveedor: IdProveedor,
    cuerpo: Record<string, unknown>,
    mensajeOk: string
  ) {
    if (probando) return;
    setProbando(proveedor);
    setResultado(null);
    try {
      const res = await fetch("/api/ia-proveedores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor, ...cuerpo }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        estado?: EstadoIa;
        error?: string;
      };
      if (res.ok && data.ok) {
        if (data.estado) setEstado(data.estado);
        setClave("");
        setClaveDg("");
        setResultado({ ok: true, mensaje: mensajeOk });
      } else {
        setResultado({
          ok: false,
          mensaje: data.error ?? "No se pudo guardar la configuración.",
        });
      }
    } catch {
      setResultado({
        ok: false,
        mensaje: "No se pudo contactar con el servidor de esta app.",
      });
    } finally {
      setProbando(null);
    }
  }

  async function quitar(proveedor: IdProveedor) {
    if (probando) return;
    setProbando(proveedor);
    setResultado(null);
    try {
      const res = await fetch("/api/ia-proveedores", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        estado?: EstadoIa;
        error?: string;
      };
      if (res.ok && data.ok) {
        if (data.estado) setEstado(data.estado);
        if (proveedor === "openai") aplicarPreset("openai");
        if (proveedor === "zai") setUrlRele("");
        setResultado({ ok: true, mensaje: "Configuración quitada." });
      } else {
        setResultado({ ok: false, mensaje: data.error ?? "No se pudo quitar." });
      }
    } catch {
      setResultado({ ok: false, mensaje: "No se pudo quitar." });
    } finally {
      setProbando(null);
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

  const activo = estado?.activo ?? "ninguno";
  const conectado = activo !== "ninguno";
  const esZaiServidor = estado?.zai?.modo === "servidor";
  const esZaiRele = estado?.zai?.modo === "rele";
  const notaPreset =
    PREAJUSTES.find((p) => p.id === preset)?.nota ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-lg">
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
                <span
                  className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                  aria-hidden
                />
                conectada · {NOMBRE_PROVEEDOR[activo]}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 border-amber-800/60 text-[10px] text-amber-300"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full bg-amber-400"
                  aria-hidden
                />
                sin conectar
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            La Fase 2 (transcripción y análisis de tensión) usa una IA{" "}
            <strong className="font-semibold text-zinc-400">reemplazable</strong>
            : la incluida, tu propia API compatible con OpenAI (OpenAI, Groq,
            Mistral, servidores locales) o Deepgram. El resto de la app
            (mezcla, efectos, editor, exportación) funciona siempre en tu
            equipo.
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Comprobando el estado de la conexión…
          </div>
        ) : (
          <Tabs defaultValue={activo === "openai" ? "openai" : activo === "deepgram" ? "deepgram" : "zai"}>
            <TabsList className="grid w-full grid-cols-3 bg-zinc-900">
              <TabsTrigger value="zai" className="gap-1.5 text-[11px]">
                <Zap className="h-3.5 w-3.5" aria-hidden />
                Incluida
              </TabsTrigger>
              <TabsTrigger value="openai" className="gap-1.5 text-[11px]">
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                API propia
              </TabsTrigger>
              <TabsTrigger value="deepgram" className="gap-1.5 text-[11px]">
                <Cpu className="h-3.5 w-3.5" aria-hidden />
                Deepgram
              </TabsTrigger>
            </TabsList>

            {/* ── Z.AI incluida ─────────────────────────────── */}
            <TabsContent value="zai" className="space-y-3 pt-1">
              {esZaiServidor && (
                <div className="space-y-2">
                  <p className="text-sm text-zinc-300">
                    {activo === "zai" ? (
                      <>
                        IA conectada a través del servidor de esta web:{" "}
                        <span className="text-emerald-300">
                          no necesitas configurar nada aquí
                        </span>
                        .
                      </>
                    ) : (
                      <>
                        Disponible a través del servidor de esta web (ahora hay
                        otro proveedor activo).
                      </>
                    )}
                  </p>
                  {activo !== "zai" && (
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 bg-amber-500 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                      disabled={probando !== null}
                      onClick={() =>
                        void enviar(
                          "zai",
                          {},
                          "Z.AI activada: la Fase 2 vuelve a usar el servicio incluido."
                        )
                      }
                    >
                      {probando === "zai" ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <PlugZap className="h-3.5 w-3.5" aria-hidden />
                      )}
                      Activar esta IA
                    </Button>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-500">
                      URL para la app de escritorio (cópiala allí, en estos
                      mismos ajustes)
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
                          <Check
                            className="h-3.5 w-3.5 text-emerald-400"
                            aria-hidden
                          />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {copiado ? "Copiada" : "Copiar"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {!esZaiServidor && (
                <div className="space-y-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ia-url" className="text-xs text-zinc-500">
                      URL de tu Bardo Studio web (la dirección donde abres esta
                      aplicación en el navegador)
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id="ia-url"
                        value={urlRele}
                        onChange={(e) => setUrlRele(e.target.value)}
                        placeholder="https://…"
                        disabled={probando !== null}
                        inputMode="url"
                        autoComplete="off"
                        spellCheck={false}
                        className="h-9 min-w-[180px] flex-1 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans placeholder:text-zinc-600"
                      />
                      <Button
                        size="sm"
                        className="h-9 shrink-0 gap-1.5 bg-amber-500 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                        onClick={() =>
                          void enviar(
                            "zai",
                            { url: urlRele.trim() },
                            "Conexión establecida y probada. La Fase 2 ya puede transcribir: cierra este panel y reanúdala."
                          )
                        }
                        disabled={probando !== null || urlRele.trim().length < 8}
                        title="Guarda la conexión y prueba el servicio"
                      >
                        {probando === "zai" ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {esZaiRele ? "Probar" : "Conectar"}
                      </Button>
                      {esZaiRele && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0 gap-1.5 border-rose-800/60 text-xs text-rose-300 hover:bg-rose-500/10"
                          onClick={() => void quitar("zai")}
                          disabled={probando !== null}
                          title="Quitar la conexión guardada"
                        >
                          <Unplug className="h-3.5 w-3.5" aria-hidden />
                          Desconectar
                        </Button>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-600">
                      Se guardará junto al servidor interno de la app y se
                      conserva al actualizar. Si no la tienes a mano, ábrela en
                      el navegador: en «Ajustes de IA» de la web aparece con
                      botón de copiar.
                    </p>
                  </div>

                  {esZaiRele && estado?.zai?.baseUrl && (
                    <p className="text-[11px] text-zinc-500">
                      Conectada a{" "}
                      <span className="font-mono text-zinc-400">
                        {estado.zai.baseUrl.replace(/\/api\/ia\/?$/, "")}
                      </span>
                      . Pulsa «Probar» tras pegar la URL para verificarla de
                      nuevo.
                    </p>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── API propia (compatible OpenAI) ─────────────── */}
            <TabsContent value="openai" className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">
                  Servicio (rellena URL y modelos)
                </Label>
                <Select
                  value={preset}
                  onValueChange={(v) => aplicarPreset(v)}
                  disabled={probando !== null}
                >
                  <SelectTrigger
                    id="ia-preset"
                    className="h-9 border-zinc-700 bg-zinc-900 text-xs text-zinc-200"
                    aria-label="Servicio de IA"
                  >
                    <SelectValue placeholder="Elige un servicio" />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-900">
                    {PREAJUSTES.map((p) => (
                      <SelectItem
                        key={p.id}
                        value={p.id}
                        className="text-xs text-zinc-200"
                      >
                        {p.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {notaPreset && (
                  <p className="text-[11px] leading-relaxed text-zinc-600">
                    {notaPreset}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ia-baseurl" className="text-xs text-zinc-500">
                  URL base de la API
                </Label>
                <Input
                  id="ia-baseurl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  disabled={probando !== null}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans"
                />
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  Para chat (análisis de tensión) y, si no pones la de abajo,
                  también para transcribir.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ia-baseurl-asr" className="text-xs text-zinc-500">
                  URL de transcripción aparte{" "}
                  <span className="text-zinc-600">(opcional)</span>
                </Label>
                <Input
                  id="ia-baseurl-asr"
                  value={baseUrlAsr}
                  onChange={(e) => setBaseUrlAsr(e.target.value)}
                  placeholder="http://localhost:8080/v1"
                  disabled={probando !== null}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans"
                />
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  Solo si transcribes con OTRO servicio: p. ej. chat con LM
                  Studio en <span className="font-mono text-zinc-500">:1234</span> y
                  Whisper local en{" "}
                  <span className="font-mono text-zinc-500">:8080</span>. Déjala
                  vacía si todo vive en la misma URL. La clave se usa en ambas.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ia-clave" className="text-xs text-zinc-500">
                  Clave de API {estado?.openai?.tieneClave && (
                    <span className="text-zinc-600">
                      (guardada: {estado.openai.pistaClave})
                    </span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="ia-clave"
                    type={verClave ? "text" : "password"}
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    placeholder={
                      estado?.openai?.tieneClave
                        ? "Deja vacío para conservar la guardada… o pega otra"
                        : "sk-…"
                    }
                    disabled={probando !== null}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 flex-1 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 shrink-0 border-zinc-700 p-0 text-zinc-400"
                    onClick={() => setVerClave((v) => !v)}
                    title={verClave ? "Ocultar la clave" : "Mostrar la clave"}
                    aria-label={verClave ? "Ocultar la clave" : "Mostrar la clave"}
                  >
                    {verClave ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="ia-modelo-asr"
                    className="text-xs text-zinc-500"
                  >
                    Modelo transcripción
                  </Label>
                  <Input
                    id="ia-modelo-asr"
                    value={modeloAsr}
                    onChange={(e) => setModeloAsr(e.target.value)}
                    placeholder="whisper-1 (opcional)"
                    disabled={probando !== null}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="ia-modelo-chat"
                    className="text-xs text-zinc-500"
                  >
                    Modelo chat (tensión)
                  </Label>
                  <Input
                    id="ia-modelo-chat"
                    value={modeloChat}
                    onChange={(e) => setModeloChat(e.target.value)}
                    placeholder="gpt-4o-mini (opcional)"
                    disabled={probando !== null}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans"
                  />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Puedes poner solo transcripción, solo chat o ambos. Sin modelo
                de chat, la curva de tensión usa la heurística local. La clave
                se guarda SOLO en tu equipo (archivo local junto al servidor de
                la app, se conserva al actualizar) y no se envía a ningún otro
                servicio que el que hayas elegido.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-9 gap-1.5 bg-amber-500 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                  disabled={
                    probando !== null ||
                    baseUrl.trim().length < 8 ||
                    (clave.trim().length < 8 &&
                      !estado?.openai?.tieneClave)
                  }
                  onClick={() =>
                    void enviar(
                      "openai",
                      {
                        baseUrl: baseUrl.trim(),
                        baseUrlAsr: baseUrlAsr.trim(),
                        apiKey: clave.trim(),
                        modeloAsr: modeloAsr.trim(),
                        modeloChat: modeloChat.trim(),
                      },
                      "API propia guardada y probada: la Fase 2 ya transcribe con TU servicio. Cierra este panel y reanúdala."
                    )
                  }
                  title="Guarda la configuración y prueba el servicio de verdad"
                >
                  {probando === "openai" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Guardar y probar
                </Button>
                {estado?.openai?.tieneClave && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 border-rose-800/60 text-xs text-rose-300 hover:bg-rose-500/10"
                    onClick={() => void quitar("openai")}
                    disabled={probando !== null}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Quitar
                  </Button>
                )}
              </div>

              {estado?.openai?.tieneClave && activo === "openai" && (
                <p className="text-[11px] text-zinc-500">
                  Activa:{" "}
                  <span className="font-mono text-zinc-400">
                    {estado.openai.baseUrl}
                  </span>
                  {estado.openai.baseUrlAsr ? (
                    <>
                      {" · transcripción en "}
                      <span className="font-mono text-zinc-400">
                        {estado.openai.baseUrlAsr}
                      </span>
                    </>
                  ) : (
                    ""
                  )}
                  {estado.openai.modeloAsr ? ` · ASR ${estado.openai.modeloAsr}` : ""}
                  {estado.openai.modeloChat
                    ? ` · chat ${estado.openai.modeloChat}`
                    : ""}
                </p>
              )}
            </TabsContent>

            {/* ── Deepgram ──────────────────────────────────── */}
            <TabsContent value="deepgram" className="space-y-3 pt-1">
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Deepgram transcribe con el modelo <span className="font-mono">nova-2</span>{" "}
                en español. No hace chat: la curva de tensión se calculará con
                la heurística local (marcada como «heurístico»).
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="ia-clave-dg" className="text-xs text-zinc-500">
                  Clave de Deepgram {estado?.deepgram?.tieneClave && (
                    <span className="text-zinc-600">
                      (guardada: {estado.deepgram.pistaClave})
                    </span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="ia-clave-dg"
                    type={verClaveDg ? "text" : "password"}
                    value={claveDg}
                    onChange={(e) => setClaveDg(e.target.value)}
                    placeholder={
                      estado?.deepgram?.tieneClave
                        ? "Deja vacío para conservar la guardada… o pega otra"
                        : "Tu clave de Deepgram"
                    }
                    disabled={probando !== null}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-9 flex-1 border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 placeholder:font-sans"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 shrink-0 border-zinc-700 p-0 text-zinc-400"
                    onClick={() => setVerClaveDg((v) => !v)}
                    title={verClaveDg ? "Ocultar la clave" : "Mostrar la clave"}
                    aria-label={
                      verClaveDg ? "Ocultar la clave" : "Mostrar la clave"
                    }
                  >
                    {verClaveDg ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-9 gap-1.5 bg-amber-500 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                  disabled={
                    probando !== null ||
                    (claveDg.trim().length < 8 &&
                      !estado?.deepgram?.tieneClave)
                  }
                  onClick={() =>
                    void enviar(
                      "deepgram",
                      { apiKey: claveDg.trim() },
                      "Deepgram guardado y probado: la Fase 2 transcribe con TU clave."
                    )
                  }
                  title="Guarda la clave y prueba el servicio de verdad"
                >
                  {probando === "deepgram" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PlugZap className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Guardar y probar
                </Button>
                {estado?.deepgram?.tieneClave && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 border-rose-800/60 text-xs text-rose-300 hover:bg-rose-500/10"
                    onClick={() => void quitar("deepgram")}
                    disabled={probando !== null}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Quitar
                  </Button>
                )}
              </div>
            </TabsContent>
          </Tabs>
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

        {activo === "ninguno" && !cargando && (
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

        <Separator className="bg-zinc-800" />

        <DialogFooter className="gap-2">
          <p className="me-auto max-w-[280px] text-[10px] leading-relaxed text-zinc-600">
            Avanzado: también puedes crear un archivo{" "}
            <span className="font-mono">.z-ai-config</span> con credenciales
            propias junto al servidor (ver LEEME).
          </p>
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
