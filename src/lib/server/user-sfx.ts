/**
 * Manifiesto de los SFX propios del usuario (Fase 2.5 → biblioteca).
 *
 * db/user-sfx/manifiesto.json — metadatos de los efectos importados
 * db/user-sfx/<id>.<ext>      — archivos de audio tal cual los subió el
 *                               usuario (nunca se re-codifican)
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  esAudioAceptado,
  esIdValido,
  extensionDe,
  numClamp,
} from "@/lib/server/archivos";
import type { SfxDef } from "@/lib/sfx/tipos";

export interface FilaSfxPropia {
  id: string;
  nombre: string;
  /** URL servida por /api/user-sfx/track/<id> */
  archivo: string;
  durSec: number;
  ext: string;
  bytes: number;
  agregadaEn: number;
}

export interface ManifiestoSfx {
  version: number;
  sfx: FilaSfxPropia[];
}

const DIR = path.join(process.cwd(), "db", "user-sfx");
const RUTA_MANIFIESTO = path.join(DIR, "manifiesto.json");

/** Tamaño máximo por SFX importado (30 MB). */
export const MAX_BYTES_SFX = 30 * 1024 * 1024;

/** Crea el directorio de efectos propios si aún no existe. */
export async function asegurarDirSfx(): Promise<void> {
  await mkdir(DIR, { recursive: true });
}

export async function leerManifiestoSfx(): Promise<ManifiestoSfx> {
  try {
    const bruto = JSON.parse(await readFile(RUTA_MANIFIESTO, "utf8")) as {
      version?: unknown;
      sfx?: unknown;
    };
    const filas = Array.isArray(bruto.sfx) ? bruto.sfx : [];
    const sfx: FilaSfxPropia[] = [];
    for (const f of filas) {
      const p = normalizarFilaSfx(f);
      if (p) sfx.push(p);
    }
    return { version: 1, sfx };
  } catch {
    return { version: 1, sfx: [] };
  }
}

export async function escribirManifiestoSfx(
  m: ManifiestoSfx
): Promise<void> {
  await writeFile(RUTA_MANIFIESTO, JSON.stringify(m, null, 2), "utf8");
}

/** Normaliza una fila cruda del manifiesto (defensivo). */
export function normalizarFilaSfx(bruto: unknown): FilaSfxPropia | null {
  if (!bruto || typeof bruto !== "object") return null;
  const f = bruto as Record<string, unknown>;
  const id = typeof f.id === "string" ? f.id : null;
  const nombre =
    typeof f.nombre === "string" && f.nombre.trim() ? f.nombre : null;
  if (!id || !nombre || !esIdValido(id)) return null;
  return {
    id,
    nombre: nombre.slice(0, 80),
    archivo: `/api/user-sfx/track/${id}`,
    durSec: numClamp(f.durSec, 3, 0.1, 600),
    ext: typeof f.ext === "string" ? f.ext : "",
    bytes: numClamp(f.bytes, 0, 0, 2 ** 30),
    agregadaEn: numClamp(f.agregadaEn, Date.now(), 0, 4102444800000),
  };
}

/** Ruta del archivo de audio de un SFX propio. */
export function rutaAudioSfx(id: string, ext: string): string {
  return path.join(DIR, `${id}.${ext}`);
}

/** ¿Existe el archivo de audio del SFX? */
export async function existeAudioSfx(
  id: string,
  ext: string
): Promise<boolean> {
  try {
    await access(rutaAudioSfx(id, ext));
    return true;
  } catch {
    return false;
  }
}

/** ¿El archivo subido es un audio admitido? */
export function sfxSubidoValido(nombre: string): boolean {
  return esAudioAceptado(nombre);
}

/** Fila → SfxDef de la biblioteca del cliente. */
export function aDef(f: FilaSfxPropia): SfxDef {
  return {
    id: f.id,
    nombre: f.nombre,
    archivo: f.archivo,
    durSec: Math.round(f.durSec * 10) / 10,
    etiquetas: ["propio"],
  };
}

/** Validación del meta enviado junto al archivo. */
export function validarMetaSfx(bruto: unknown): {
  ok: boolean;
  error?: string;
  meta: { nombre: string; durSec: number };
} {
  const f = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const nombre =
    typeof f.nombre === "string" && f.nombre.trim()
      ? f.nombre.trim().slice(0, 80)
      : "";
  const durSec = numClamp(f.durSec, 0, 0.1, 600);
  if (!nombre) return { ok: false, error: "Falta el nombre del efecto.", meta: { nombre: "", durSec: 3 } };
  if (durSec <= 0) return { ok: false, error: "Duración no válida (debe ser > 0).", meta: { nombre, durSec: 3 } };
  return { ok: true, meta: { nombre, durSec } };
}
