import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import {
  leerManifiesto,
  escribirManifiesto,
  validarMeta,
  rutaAudioPista,
  audioSubidoValido,
  extensionDe,
  MAX_BYTES_PISTA,
  type FilaMusicaPropia,
} from "@/lib/server/user-music";
import { idSeguro } from "@/lib/server/archivos";

/**
 * GET /api/user-music — pistas propias del usuario (db/user-music).
 * POST /api/user-music — importa una pista (multipart: meta + archivo).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const m = await leerManifiesto();
  return NextResponse.json(
    { version: m.version, pistas: m.pistas },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "La petición debe ser multipart/form-data." },
      { status: 400 }
    );
  }

  const archivo = form.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json(
      { error: "Falta el archivo de audio." },
      { status: 400 }
    );
  }
  if (!audioSubidoValido(archivo.name)) {
    return NextResponse.json(
      {
        error:
          "Formato no admitido. Usa WAV, MP3, M4A, OGG, FLAC, Opus, AAC o WebM.",
      },
      { status: 415 }
    );
  }
  if (archivo.size > MAX_BYTES_PISTA) {
    return NextResponse.json(
      { error: "La pista supera el máximo de 100 MB." },
      { status: 413 }
    );
  }

  let metaBruta: unknown = null;
  const metaCampo = form.get("meta");
  if (typeof metaCampo === "string") {
    try {
      metaBruta = JSON.parse(metaCampo);
    } catch {
      metaBruta = null;
    }
  }
  const v = validarMeta(metaBruta);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const manifiesto = await leerManifiesto();

  // id único y seguro
  let id = idSeguro(v.meta.titulo, "propia");
  while (manifiesto.pistas.some((p) => p.id === id)) {
    id = idSeguro(`${v.meta.titulo}-${Date.now()}`, "propia");
  }
  const ext = extensionDe(archivo.name);

  try {
    await writeFile(
      rutaAudioPista(id, ext),
      Buffer.from(await archivo.arrayBuffer())
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo guardar el archivo de audio en el servidor local." },
      { status: 500 }
    );
  }

  const fila: FilaMusicaPropia = {
    id,
    titulo: v.meta.titulo,
    animo: v.meta.animo,
    tensionMin: v.meta.tensionMin,
    tensionMax: v.meta.tensionMax,
    bpm: v.meta.bpm,
    tonalidad: v.meta.tonalidad,
    durSec: Math.round(v.meta.durSec * 10) / 10,
    archivo: `/api/user-music/track/${id}`,
    instrumentacion: "importada por ti",
    descripcion: v.meta.descripcion,
    propia: true,
    ext,
    bytes: archivo.size,
    agregadaEn: Date.now(),
  };

  manifiesto.pistas.push(fila);
  try {
    await escribirManifiesto(manifiesto);
  } catch {
    return NextResponse.json(
      { error: "No se pudo actualizar el manifiesto de música propia." },
      { status: 500 }
    );
  }

  return NextResponse.json({ pista: fila }, { status: 201 });
}
