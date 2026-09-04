import { NextResponse } from "next/server";
import {
  leerManifiesto,
  escribirManifiesto,
  existeAudioPista,
  borrarAudioPista,
  rutaAudioPista,
  validarMeta,
  type FilaMusicaPropia,
  type ManifiestoMusica,
} from "@/lib/server/user-music";
import { esIdValido, mimeDeExtension, servirArchivo } from "@/lib/server/archivos";

/**
 * GET    /api/user-music/track/[id] — sirve el audio (con Range, streaming).
 * PATCH  /api/user-music/track/[id] — edita los metadatos de la pista.
 * DELETE /api/user-music/track/[id] — quita la pista y su archivo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

async function buscarPista(
  id: string
): Promise<{ fila: FilaMusicaPropia; indice: number; manifiesto: ManifiestoMusica } | null> {
  if (!esIdValido(id)) return null;
  const manifiesto = await leerManifiesto();
  const indice = manifiesto.pistas.findIndex((p) => p.id === id);
  if (indice < 0) return null;
  return { fila: manifiesto.pistas[indice], indice, manifiesto };
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const hallada = await buscarPista(id);
  if (!hallada) {
    return NextResponse.json({ error: "Pista no encontrada." }, { status: 404 });
  }
  if (!hallada.fila.ext || !(await existeAudioPista(id, hallada.fila.ext))) {
    return NextResponse.json(
      { error: "El archivo de la pista no está en el servidor." },
      { status: 404 }
    );
  }
  return servirArchivo(
    rutaAudioPista(id, hallada.fila.ext),
    mimeDeExtension(hallada.fila.ext),
    req
  );
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const hallada = await buscarPista(id);
  if (!hallada) {
    return NextResponse.json({ error: "Pista no encontrada." }, { status: 404 });
  }
  let bruto: unknown = null;
  try {
    bruto = await req.json();
  } catch {
    bruto = null;
  }
  const v = validarMeta(bruto);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const fila: FilaMusicaPropia = {
    ...hallada.fila,
    titulo: v.meta.titulo,
    animo: v.meta.animo,
    tensionMin: v.meta.tensionMin,
    tensionMax: v.meta.tensionMax,
    bpm: v.meta.bpm,
    tonalidad: v.meta.tonalidad,
    descripcion: v.meta.descripcion,
  };
  hallada.manifiesto.pistas[hallada.indice] = fila;
  try {
    await escribirManifiesto(hallada.manifiesto);
  } catch {
    return NextResponse.json(
      { error: "No se pudo actualizar el manifiesto." },
      { status: 500 }
    );
  }
  return NextResponse.json({ pista: fila });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const hallada = await buscarPista(id);
  if (!hallada) {
    return NextResponse.json({ error: "Pista no encontrada." }, { status: 404 });
  }
  hallada.manifiesto.pistas.splice(hallada.indice, 1);
  try {
    await escribirManifiesto(hallada.manifiesto);
    if (hallada.fila.ext) await borrarAudioPista(id, hallada.fila.ext);
  } catch {
    return NextResponse.json(
      { error: "No se pudo borrar la pista." },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, id });
}
