import { NextResponse } from "next/server";
import {
  existeAudioSfx,
  leerManifiestoSfx,
  rutaAudioSfx,
  type FilaSfxPropia,
  type ManifiestoSfx,
} from "@/lib/server/user-sfx";
import { esIdValido, mimeDeExtension, servirArchivo } from "@/lib/server/archivos";

/**
 * GET /api/user-sfx/track/[id] — sirve el audio (con Range, streaming).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;

}

async function buscarSfx(
  id: string
): Promise<{ fila: FilaSfxPropia; manifiesto: ManifiestoSfx } | null> {
  if (!esIdValido(id)) return null;
  const manifiesto = await leerManifiestoSfx();
  const fila = manifiesto.sfx.find((p) => p.id === id);
  if (!fila) return null;
  return { fila, manifiesto };
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const hallado = await buscarSfx(id);
  if (!hallado) {
    return NextResponse.json({ error: "Efecto no encontrado." }, { status: 404 });
  }
  if (
    !hallado.fila.ext ||
    !(await existeAudioSfx(id, hallado.fila.ext))
  ) {
    return NextResponse.json(
      { error: "El archivo del efecto no está en el servidor." },
      { status: 404 }
    );
  }
  return servirArchivo(
    rutaAudioSfx(id, hallado.fila.ext),
    mimeDeExtension(hallado.fila.ext),
    req
  );
}
