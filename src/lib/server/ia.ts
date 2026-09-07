import { readFile, writeFile, unlink } from "fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Proveedores de IA de Bardo Studio (Fase 2) — ADR-014.
 * ─────────────────────────────────────────────────────
 * La IA (transcripción ASR + análisis de tensión con LLM) es REEMPLAZABLE:
 *
 *   · "zai"      → Z.AI incluida: el SDK lee .z-ai-config (cwd → home → /etc).
 *                  En la web del sandbox funciona directa; en la app de
 *                  escritorio ese archivo apunta al relé de la web.
 *   · "openai"   → API PROPIA compatible con OpenAI (OpenAI, Groq, Mistral,
 *                  servidores locales…): el usuario pone su URL base y su
 *                  clave en «Ajustes de IA».
 *   · "deepgram" → API propia de Deepgram (solo transcripción; la tensión
 *                  cae a la heurística local).
 *
 * La configuración del usuario vive en .bardo-ia.json junto al servidor
 * (cwd): %APPDATA%\Bardo Studio\app en el escritorio, carpeta del proyecto en
 * la web. Nunca se empaqueta ni se expone por API (solo pistas enmascaradas).
 *
 * Resolución del proveedor activo:
 *   1. .bardo-ia.json → activo + sección válida → ese proveedor.
 *   2. Si no hay selección (o quedó incompleta) → Z.AI si hay .z-ai-config.
 *   3. Si no → «ninguno» (la UI muestra cómo conectar; la tensión usa la
 *      heurística local).
 */

export type IdProveedor = "zai" | "openai" | "deepgram";

export interface ProveedorIa {
  id: IdProveedor;
  /** nombre corto para mensajes de error/UI */
  nombre: string;
  /** transcribe un WAV mono 16 kHz (base64) → texto */
  transcribirWav(base64: string): Promise<string>;
  /** chat de una sola vuelta (sistema + usuario) → contenido del mensaje */
  chat(
    sistema: string,
    usuario: string,
    opts?: { maxTokens?: number }
  ): Promise<string>;
}

export interface ConfigOpenai {
  baseUrl: string;
  apiKey: string;
  modeloAsr?: string;
  modeloChat?: string;
}

export interface ConfigDeepgram {
  apiKey: string;
}

export interface ConfigIaArchivo {
  activo?: IdProveedor;
  openai?: ConfigOpenai;
  deepgram?: ConfigDeepgram;
}

export interface EstadoZai {
  modo: "servidor" | "rele" | "ninguno";
  baseUrl?: string;
}

export interface EstadoIa {
  activo: IdProveedor | "ninguno";
  zai: EstadoZai;
  openai: {
    baseUrl?: string;
    modeloAsr?: string;
    modeloChat?: string;
    tieneClave: boolean;
    /** últimos 4 caracteres de la clave, para reconocerla sin revelarla */
    pistaClave?: string;
  } | null;
  deepgram: { tieneClave: boolean; pistaClave?: string } | null;
}

// ───────────────────────── archivos de configuración ─────────────────────────

const rutaBardoIa = () => path.join(process.cwd(), ".bardo-ia.json");

/** rutas donde el SDK de Z.AI busca .z-ai-config (misma prioridad) */
const rutasZai = () => [
  path.join(process.cwd(), ".z-ai-config"),
  path.join(os.homedir(), ".z-ai-config"),
  "/etc/.z-ai-config",
];

async function leerJson(ruta: string): Promise<Record<string, unknown> | null> {
  try {
    const bruto = await readFile(ruta, "utf8");
    const cfg = JSON.parse(bruto);
    if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
      return cfg as Record<string, unknown>;
    }
  } catch {
    /* no existe o no es válido */
  }
  return null;
}

async function leerBardoIa(): Promise<ConfigIaArchivo | null> {
  const cfg = await leerJson(rutaBardoIa());
  return cfg as ConfigIaArchivo | null;
}

/** Lectura pública (para rutas que fusionan claves ya guardadas). */
export const leerConfigIa = leerBardoIa;

/** Escribe .bardo-ia.json (600) fusionando con lo que ya hubiera.
 *  Si no queda nada, elimina el archivo. */
export async function escribirBardoIa(
  cambios: ConfigIaArchivo
): Promise<ConfigIaArchivo> {
  const actual = (await leerBardoIa()) ?? {};
  const fusion = { ...actual, ...cambios };
  // secciones «undefined» → se quitan del archivo
  for (const clave of ["activo", "openai", "deepgram"] as const) {
    if (fusion[clave] === undefined) delete fusion[clave];
  }
  const claves = Object.keys(fusion) as Array<keyof ConfigIaArchivo>;
  if (claves.length === 0) {
    try {
      await unlink(rutaBardoIa());
    } catch {
      /* no existía: nada que borrar */
    }
    return {};
  }
  await writeFile(rutaBardoIa(), JSON.stringify(fusion, null, 2) + "\n", {
    mode: 0o600,
  });
  return fusion;
}

async function leerZaiConfig(): Promise<{
  baseUrl: string;
  apiKey: string;
} | null> {
  for (const ruta of rutasZai()) {
    const cfg = await leerJson(ruta);
    if (
      typeof cfg?.baseUrl === "string" &&
      typeof cfg?.apiKey === "string" &&
      cfg.baseUrl &&
      cfg.apiKey
    ) {
      return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
    }
  }
  return null;
}

const pista = (clave: string) =>
  clave.length >= 4 ? `••••${clave.slice(-4)}` : "••••";

// ───────────────────────── estado (para la UI) ─────────────────────────

export async function obtenerEstado(): Promise<EstadoIa> {
  const cfg = (await leerBardoIa()) ?? {};
  const zai = await leerZaiConfig();
  const zaiEstado: EstadoZai = zai
    ? zai.baseUrl.includes("/api/ia")
      ? { modo: "rele", baseUrl: zai.baseUrl }
      : { modo: "servidor", baseUrl: zai.baseUrl }
    : { modo: "ninguno" };

  let activo: IdProveedor | "ninguno" = "ninguno";
  if (cfg.activo === "openai" && cfg.openai?.apiKey && cfg.openai.baseUrl) {
    activo = "openai";
  } else if (cfg.activo === "deepgram" && cfg.deepgram?.apiKey) {
    activo = "deepgram";
  } else if (zai) {
    activo = "zai";
  }

  return {
    activo,
    zai: zaiEstado,
    openai: cfg.openai
      ? {
          baseUrl: cfg.openai.baseUrl,
          modeloAsr: cfg.openai.modeloAsr,
          modeloChat: cfg.openai.modeloChat,
          tieneClave: Boolean(cfg.openai.apiKey),
          pistaClave: cfg.openai.apiKey ? pista(cfg.openai.apiKey) : undefined,
        }
      : null,
    deepgram: cfg.deepgram
      ? {
          tieneClave: Boolean(cfg.deepgram.apiKey),
          pistaClave: cfg.deepgram.apiKey ? pista(cfg.deepgram.apiKey) : undefined,
        }
      : null,
  };
}

// ───────────────────────── errores con estado HTTP ─────────────────────────

export class ErrorIa extends Error {
  status: number;
  constructor(mensaje: string, status = 502) {
    super(mensaje);
    this.name = "ErrorIa";
    this.status = status;
  }
}

const TIMEOUT_MS = 120_000;

async function detalleHttp(resp: Response, contexto: string): Promise<never> {
  const texto = (await resp.text().catch(() => "")).slice(0, 220);
  throw new ErrorIa(
    `El servicio respondió ${resp.status} al ${contexto}${texto ? `: ${texto}` : ""}`,
    resp.status
  );
}

// ───────────────────────── proveedor Z.AI (incluida) ─────────────────────────

interface ZaiSdk {
  audio: { asr: { create(p: { file_base64: string }): Promise<{ text?: unknown }> } };
  chat: {
    completions: {
      create(p: Record<string, unknown>): Promise<{
        choices?: Array<{ message?: { content?: unknown } }>;
      }>;
    };
  };
}

function crearZai(): ProveedorIa {
  let instancia: Promise<ZaiSdk> | null = null;
  const zai = () => {
    if (!instancia) {
      instancia = import("z-ai-web-dev-sdk").then(
        (m) => (m.default as unknown as { create(): Promise<ZaiSdk> }).create()
      );
    }
    return instancia;
  };
  return {
    id: "zai",
    nombre: "Z.AI incluida",
    async transcribirWav(base64) {
      const sdk = await zai();
      const resp = await sdk.audio.asr.create({ file_base64: base64 });
      return typeof resp?.text === "string" ? resp.text.trim() : "";
    },
    async chat(sistema, usuario, opts) {
      const sdk = await zai();
      const peticion: Record<string, unknown> = {
        messages: [
          { role: "assistant", content: sistema },
          { role: "user", content: usuario },
        ],
        thinking: { type: "disabled" },
      };
      if (opts?.maxTokens) peticion.max_tokens = opts.maxTokens;
      const resp = await sdk.chat.completions.create(peticion);
      const contenido = resp?.choices?.[0]?.message?.content;
      return typeof contenido === "string" ? contenido : "";
    },
  };
}

// ─────────────────── proveedor API propia (compatible OpenAI) ───────────────────

export function crearOpenai(cfg: ConfigOpenai): ProveedorIa {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return {
    id: "openai",
    nombre: "API propia",
    async transcribirWav(base64) {
      if (!cfg.modeloAsr) {
        throw new ErrorIa(
          "La API propia no tiene modelo de transcripción: ponlo en «Ajustes de IA» (p. ej. whisper-1 o whisper-large-v3).",
          400
        );
      }
      const buf = Buffer.from(base64, "base64");
      const fd = new FormData();
      fd.append(
        "file",
        new Blob([new Uint8Array(buf)], { type: "audio/wav" }),
        "audio.wav"
      );
      fd.append("model", cfg.modeloAsr);
      fd.append("response_format", "json");
      const resp = await fetch(`${base}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!resp.ok) await detalleHttp(resp, "transcribir");
      const data = (await resp.json().catch(() => null)) as {
        text?: unknown;
      } | null;
      return typeof data?.text === "string" ? data.text.trim() : "";
    },
    async chat(sistema, usuario, opts) {
      if (!cfg.modeloChat) {
        throw new ErrorIa(
          "La API propia no tiene modelo de chat: el análisis de tensión usará la heurística local (pon un modelo en «Ajustes de IA» si quieres LLM).",
          400
        );
      }
      const cuerpo: Record<string, unknown> = {
        model: cfg.modeloChat,
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      };
      if (opts?.maxTokens) cuerpo.max_tokens = opts.maxTokens;
      const resp = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!resp.ok) await detalleHttp(resp, "chatear");
      const data = (await resp.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      } | null;
      const contenido = data?.choices?.[0]?.message?.content;
      return typeof contenido === "string" ? contenido : "";
    },
  };
}

// ───────────────────────── proveedor Deepgram ─────────────────────────

export const DEEPGRAM_BASE = "https://api.deepgram.com";

export function crearDeepgram(cfg: ConfigDeepgram): ProveedorIa {
  return {
    id: "deepgram",
    nombre: "Deepgram",
    async transcribirWav(base64) {
      const buf = Buffer.from(base64, "base64");
      const resp = await fetch(
        `${DEEPGRAM_BASE}/v1/listen?model=nova-2&smart_format=true&language=es`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${cfg.apiKey}`,
            "Content-Type": "audio/wav",
          },
          body: new Uint8Array(buf),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        }
      );
      if (!resp.ok) await detalleHttp(resp, "transcribir");
      const data = (await resp.json().catch(() => null)) as {
        results?: {
          channels?: Array<{
            alternatives?: Array<{ transcript?: unknown }>;
          }>;
        };
      } | null;
      const texto =
        data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      return typeof texto === "string" ? texto.trim() : "";
    },
    async chat() {
      throw new ErrorIa(
        "Deepgram solo transcribe: el análisis de tensión se hace con la heurística local.",
        400
      );
    },
  };
}

// ───────────────────────── resolución del activo ─────────────────────────

/** Devuelve el proveedor activo o null si no hay ninguno conectado. */
export async function obtenerProveedor(): Promise<ProveedorIa | null> {
  const cfg = (await leerBardoIa()) ?? {};

  if (cfg.activo === "openai" && cfg.openai?.apiKey && cfg.openai.baseUrl) {
    return crearOpenai(cfg.openai);
  }
  if (cfg.activo === "deepgram" && cfg.deepgram?.apiKey) {
    return crearDeepgram(cfg.deepgram);
  }

  // sin selección explícita (o incompleta) → Z.AI si está disponible
  if (await leerZaiConfig()) return crearZai();
  return null;
}

// ───────────────────────── utilidades de prueba ─────────────────────────

/** WAV mono 16 kHz con un tono suave (para probar un proveedor de verdad). */
export function wavPrueba(ms = 500): Buffer {
  const sr = 16000;
  const n = Math.floor((sr * ms) / 1000);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(
      Math.round(2800 * Math.sin((2 * Math.PI * 440 * i) / sr)),
      44 + i * 2
    );
  }
  return buf;
}
