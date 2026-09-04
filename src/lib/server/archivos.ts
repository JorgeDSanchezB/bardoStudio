/**
 * Helpers de servidor compartidos por las APIs de archivos locales
 * (música propia del usuario y proyectos guardados).
 *
 * Todo vive en db/ del proyecto: archivos auditables en disco + manifiestos
 * JSON. Sin base de datos externa, sin llamadas a internet.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/** Extensiones de audio aceptadas para importar. */
export const EXTENSIONES_AUDIO = [
  "wav",
  "mp3",
  "m4a",
  "ogg",
  "oga",
  "flac",
  "opus",
  "aac",
  "webm",
] as const;

export type ExtAudio = (typeof EXTENSIONES_AUDIO)[number];

const MIMES: Record<ExtAudio, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  opus: "audio/ogg",
  aac: "audio/aac",
  webm: "audio/webm",
};

/** Extensión (sin punto, minúsculas) de un nombre de archivo; "" si no tiene. */
export function extensionDe(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  if (i < 0 || i === nombre.length - 1) return "";
  return nombre.slice(i + 1).toLowerCase();
}

/** ¿La extensión es un audio aceptado? */
export function esAudioAceptado(nombre: string): boolean {
  return (EXTENSIONES_AUDIO as readonly string[]).includes(extensionDe(nombre));
}

export function mimeDeExtension(ext: string): string {
  const e = ext.toLowerCase() as ExtAudio;
  return MIMES[e] ?? "application/octet-stream";
}

/** Sanitiza un id de pista/proyecto para usarlo como nombre de archivo. */
export function idSeguro(bruto: string, prefijo: string): string {
  const base = bruto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const aleatorio = Array.from({ length: 6 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)]
  ).join("");
  return `${prefijo}-${base || "pista"}-${aleatorio}`;
}

/** Valida que un id solo contenga caracteres seguros para el sistema de archivos. */
export function esIdValido(id: string): boolean {
  return /^[a-zA-Z0-9-]{4,80}$/.test(id);
}

/**
 * Respuesta de archivo con soporte de Range (para que <audio> pueda
 * buscar sin re-descargar todo). Sirve por streaming: no carga el archivo
 * completo en memoria.
 */
export async function servirArchivo(
  ruta: string,
  mime: string,
  req: Request
): Promise<Response> {
  let st;
  try {
    st = await stat(ruta);
  } catch {
    return Response.json({ error: "Archivo no encontrado." }, { status: 404 });
  }
  if (!st.isFile()) {
    return Response.json({ error: "Ruta no válida." }, { status: 404 });
  }
  const total = st.size;
  const cabeceraBase: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  const rango = req.headers.get("range");
  if (rango) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rango.trim());
    if (m) {
      let inicio = m[1] ? parseInt(m[1], 10) : 0;
      let fin = m[2] ? parseInt(m[2], 10) : total - 1;
      if (Number.isNaN(inicio) || Number.isNaN(fin)) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      if (inicio > fin || inicio >= total) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      fin = Math.min(fin, total - 1);
      const stream = createReadStream(ruta, { start: inicio, end: fin });
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          ...cabeceraBase,
          "Content-Range": `bytes ${inicio}-${fin}/${total}`,
          "Content-Length": String(fin - inicio + 1),
        },
      });
    }
  }

  const stream = createReadStream(ruta);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...cabeceraBase, "Content-Length": String(total) },
  });
}

/** clamp numérico defensivo para metadatos JSON. */
export function numClamp(
  v: unknown,
  def: number,
  min: number,
  max: number
): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
