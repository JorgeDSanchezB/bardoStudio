import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import {
  aDef,
  asegurarDirSfx,
  escribirManifiestoSfx,
  existeAudioSfx,
  leerManifiestoSfx,
  MAX_BYTES_SFX,
  rutaAudioSfx,
  sfxSubidoValido,
  validarMetaSfx,
  type FilaSfxPropia,
} from "@/lib/server/user-sfx";
import { extensionDe, idSeguro } from "@/lib/server/archivos";

/**
 * GET  /api/user-sfx — efectos propios del usuario (db/user-sfx).
 * POST /api/user-sfx — importa un SFX (multipart: meta + archivo WAV/MP3…).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const m = await leerManifiestoSfx();
  return NextResponse.json(
    { version: m.version, sfx: m.sfx },
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
  if (!sfxSubidoValido(archivo.name)) {
    return NextResponse.json(
      {
        error:
          "Formato no admitido. Usa WAV, MP3, M4A, OGG, FLAC, Opus, AAC o WebM.",
      },
      { status: 415 }
    );
  }
  if (archivo.size > MAX_BYTES_SFX) {
    return NextResponse.json(
      { error: "El efecto supera el máximo de 30 MB." },
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
  const v = validarMetaSfx(metaBruta);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const manifiesto = await leerManifiestoSfx();

  // id único y seguro
  let id = idSeguro(v.meta.nombre, "sfx-propio");
  while (
    manifiesto.sfx.some((p) => p.id === id) ||
    (await existeAudioSfx(id, extensionDe(archivo.name)))
  ) {
    id = idSeguro(`${v.meta.nombre}-${Date.now()}`, "sfx-propio");
  }
  const ext = extensionDe(archivo.name);

  try {
    await asegurarDirSfx();
    await writeFile(
      rutaAudioSfx(id, ext),
      Buffer.from(await archivo.arrayBuffer())
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo guardar el archivo de audio en el servidor local." },
      { status: 500 }
    );
  }

  const fila: FilaSfxPropia = {
    id,
    nombre: v.meta.nombre,
    archivo: `/api/user-sfx/track/${id}`,
    durSec: Math.round(v.meta.durSec * 10) / 10,
    ext,
    bytes: archivo.size,
    agregadaEn: Date.now(),
  };

  manifiesto.sfx.push(fila);
  try {
    await escribirManifiestoSfx(manifiesto);
  } catch {
    return NextResponse.json(
      { error: "No se pudo actualizar el manifiesto de efectos propios." },
      { status: 500 }
    );
  }

  return NextResponse.json({ sfx: aDef(fila) }, { status: 201 });
}
