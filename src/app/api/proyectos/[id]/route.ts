import { NextResponse } from "next/server";
import { readFile, unlink } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import { esIdValido } from "@/lib/server/archivos";

/**
 * GET    /api/proyectos/[id] — el proyecto completo (JSON) + disponibilidad
 *         de audio/análisis.
 * DELETE /api/proyectos/[id] — borra el proyecto y sus archivos.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "db", "proyectos");

interface Ctx {
  params: Promise<{ id: string }>;
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!esIdValido(id)) {
    return NextResponse.json({ error: "Id no válido." }, { status: 400 });
  }
  const rutaJson = path.join(DIR, `${id}.json`);
  try {
    const proyecto = JSON.parse(await readFile(rutaJson, "utf8"));
    return NextResponse.json(
      {
        proyecto,
        tieneAudio: await existe(path.join(DIR, `${id}.audio`)),
        tieneAnalisis: await existe(path.join(DIR, `${id}.an`)),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Proyecto no encontrado." },
      { status: 404 }
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!esIdValido(id)) {
    return NextResponse.json({ error: "Id no válido." }, { status: 400 });
  }
  const rutas = [
    path.join(DIR, `${id}.json`),
    path.join(DIR, `${id}.audio`),
    path.join(DIR, `${id}.an`),
  ];
  let borradoAlgo = false;
  for (const ruta of rutas) {
    try {
      await unlink(ruta);
      borradoAlgo = true;
    } catch {
      /* no existía */
    }
  }
  if (!borradoAlgo) {
    return NextResponse.json(
      { error: "Proyecto no encontrado." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, id });
}
