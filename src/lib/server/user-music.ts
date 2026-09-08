/**
 * Manifiesto de la música propia del usuario (Fase 3).
 *
 * db/user-music/manifiesto.json  — metadatos de las pistas importadas
 * db/user-music/<id>.<ext>       — archivos de audio tal cual los subió el
 *                                  usuario (nunca se re-codifican)
 */

import { readFile, writeFile, access, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { esAnimo, type Animo } from "@/lib/fase2/types";
import {
  esAudioAceptado,
  esIdValido,
  extensionDe,
  numClamp,
} from "@/lib/server/archivos";

export interface FilaMusicaPropia {
  id: string;
  titulo: string;
  animo: Animo;
  tensionMin: number;
  tensionMax: number;
  bpm: number;
  tonalidad: string;
  durSec: number;
  /** URL servida por /api/user-music/track/<id> */
  archivo: string;
  instrumentacion: string;
  descripcion: string;
  /** marca de origen para la UI (biblioteca propia ≠ CC0 de la casa) */
  propia: true;
  ext: string;
  bytes: number;
  agregadaEn: number;
}

export interface ManifiestoMusica {
  version: number;
  pistas: FilaMusicaPropia[];
}

const DIR = path.join(process.cwd(), "db", "user-music");
const RUTA_MANIFIESTO = path.join(DIR, "manifiesto.json");

/** Tamaño máximo por pista importada (100 MB). */
export const MAX_BYTES_PISTA = 100 * 1024 * 1024;

export async function leerManifiesto(): Promise<ManifiestoMusica> {
  try {
    const bruto = JSON.parse(await readFile(RUTA_MANIFIESTO, "utf8")) as {
      version?: unknown;
      pistas?: unknown;
    };
    const filas = Array.isArray(bruto.pistas) ? bruto.pistas : [];
    const pistas: FilaMusicaPropia[] = [];
    for (const f of filas) {
      const p = normalizarFila(f);
      if (p) pistas.push(p);
    }
    return { version: 1, pistas };
  } catch {
    return { version: 1, pistas: [] };
  }
}

export async function escribirManifiesto(m: ManifiestoMusica): Promise<void> {
  // garantiza db/user-music (primer arranque tras instalar o carpeta perdida)
  await mkdir(DIR, { recursive: true });
  await writeFile(
    RUTA_MANIFIESTO,
    JSON.stringify(m, null, 2),
    "utf8"
  );
}

/** Normaliza una fila cruda del manifiesto (defensivo). */
export function normalizarFila(bruto: unknown): FilaMusicaPropia | null {
  if (!bruto || typeof bruto !== "object") return null;
  const f = bruto as Record<string, unknown>;
  const id = typeof f.id === "string" ? f.id : null;
  const titulo = typeof f.titulo === "string" && f.titulo.trim() ? f.titulo : null;
  if (!id || !titulo || !esIdValido(id)) return null;
  return {
    id,
    titulo: titulo.slice(0, 80),
    animo: esAnimo(f.animo) ? f.animo : "neutro",
    tensionMin: numClamp(f.tensionMin, 0, 0, 100),
    tensionMax: numClamp(f.tensionMax, 100, 0, 100),
    bpm: numClamp(f.bpm, 90, 20, 300),
    tonalidad: typeof f.tonalidad === "string" ? f.tonalidad.slice(0, 24) : "—",
    durSec: numClamp(f.durSec, 60, 3, 3600),
    archivo: `/api/user-music/track/${id}`,
    instrumentacion:
      typeof f.instrumentacion === "string"
        ? f.instrumentacion.slice(0, 120)
        : "importada por ti",
    descripcion:
      typeof f.descripcion === "string" ? f.descripcion.slice(0, 400) : "",
    propia: true,
    ext: typeof f.ext === "string" ? f.ext : "",
    bytes: numClamp(f.bytes, 0, 0, 2 ** 40),
    agregadaEn: numClamp(f.agregadaEn, Date.now(), 0, 4102444800000),
  };
}

/** Ruta del archivo de audio de una pista propia. */
export function rutaAudioPista(id: string, ext: string): string {
  return path.join(DIR, `${id}.${ext}`);
}

/** ¿Existe el archivo de audio de la pista? */
export async function existeAudioPista(
  id: string,
  ext: string
): Promise<boolean> {
  try {
    await access(rutaAudioPista(id, ext));
    return true;
  } catch {
    return false;
  }
}

/** Elimina el archivo de audio de una pista (si existe). */
export async function borrarAudioPista(
  id: string,
  ext: string
): Promise<void> {
  try {
    await unlink(rutaAudioPista(id, ext));
  } catch {
    /* ya no existe */
  }
}

/**
 * Metadatos válidos para el alta/edición desde el cliente.
 * Devuelve errores en español para mostrarlos tal cual.
 */
export function validarMeta(
  bruto: unknown
): {
  ok: true;
  meta: {
    titulo: string;
    animo: Animo;
    tensionMin: number;
    tensionMax: number;
    bpm: number;
    tonalidad: string;
    durSec: number;
    descripcion: string;
  };
} | { ok: false; error: string } {
  if (!bruto || typeof bruto !== "object") {
    return { ok: false, error: "Faltan los metadatos de la pista." };
  }
  const m = bruto as Record<string, unknown>;
  const titulo =
    typeof m.titulo === "string" ? m.titulo.trim().slice(0, 80) : "";
  if (!titulo) {
    return { ok: false, error: "La pista necesita un título." };
  }
  const animo = esAnimo(m.animo) ? m.animo : null;
  if (!animo) {
    return { ok: false, error: "El ánimo no es válido." };
  }
  const tensionMin = numClamp(m.tensionMin, 0, 0, 100);
  const tensionMax = numClamp(m.tensionMax, 100, 0, 100);
  if (tensionMax <= tensionMin) {
    return {
      ok: false,
      error: "La tensión máxima debe ser mayor que la mínima.",
    };
  }
  return {
    ok: true,
    meta: {
      titulo,
      animo,
      tensionMin: Math.round(tensionMin),
      tensionMax: Math.round(tensionMax),
      bpm: Math.round(numClamp(m.bpm, 90, 20, 300)),
      tonalidad:
        typeof m.tonalidad === "string" && m.tonalidad.trim()
          ? m.tonalidad.trim().slice(0, 24)
          : "—",
      durSec: numClamp(m.durSec, 60, 3, 3600),
      descripcion:
        typeof m.descripcion === "string" ? m.descripcion.slice(0, 400) : "",
    },
  };
}

/** ¿El nombre de archivo subido es un audio aceptado? */
export function audioSubidoValido(nombre: string): boolean {
  return esAudioAceptado(nombre);
}

export { extensionDe, DIR as DIR_USER_MUSIC };
