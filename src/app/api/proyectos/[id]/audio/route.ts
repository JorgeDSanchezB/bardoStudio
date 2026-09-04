import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { esIdValido, extensionDe, mimeDeExtension, servirArchivo } from "@/lib/server/archivos";

/**
 * GET /api/proyectos/[id]/audio — el audio original del proyecto
 * (streaming con soporte de Range para <audio> y fetch/decodeAudioData).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "db", "proyectos");

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!esIdValido(id)) {
    return NextResponse.json({ error: "Id no válido." }, { status: 400 });
  }
  const ruta = path.join(DIR, `${id}.audio`);
  // extensión real del original (guardada junto al nombre en el estado)
  let ext = "bin";
  try {
    const proyecto = JSON.parse(
      await readFile(path.join(DIR, `${id}.json`), "utf8")
    ) as {
      estado?: { fileMeta?: { name?: string } | null };
    };
    const nombre = proyecto.estado?.fileMeta?.name;
    if (nombre && extensionDe(nombre)) ext = extensionDe(nombre);
  } catch {
    /* sin json: se sirve como binario genérico */
  }
  return servirArchivo(ruta, mimeDeExtension(ext), req);
}
