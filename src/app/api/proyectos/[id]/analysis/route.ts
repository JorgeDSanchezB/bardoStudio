import { NextResponse } from "next/server";
import { esIdValido, servirArchivo } from "@/lib/server/archivos";
import path from "node:path";

/**
 * GET /api/proyectos/[id]/analysis — paquete binario BSAN con los picos y la
 * envolvente de la Fase 1 (evita re-analizar al reabrir un proyecto).
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
  return servirArchivo(
    path.join(DIR, `${id}.an`),
    "application/octet-stream",
    req
  );
}
