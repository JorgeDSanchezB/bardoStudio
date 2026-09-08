import { NextResponse } from "next/server";
import { readdir, readFile, writeFile, access, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { esIdValido, idSeguro } from "@/lib/server/archivos";
import type { ProyectoResumen } from "@/lib/proyecto/tipos";

/**
 * GET  /api/proyectos — lista los proyectos guardados en db/proyectos.
 * POST /api/proyectos — guarda/actualiza un proyecto (multipart:
 *                       proyecto JSON + audio opcional + análisis opcional).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DIR_PROYECTOS = path.join(process.cwd(), "db", "proyectos");

const MAX_JSON = 8 * 1024 * 1024; // 8 MB
const MAX_AUDIO = 400 * 1024 * 1024; // 400 MB
const MAX_ANALISIS = 96 * 1024 * 1024; // 96 MB (≈ 5 h de picos+envolvente)

async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

/** Nº de fases aprobadas según el estado (defensivo). */
function fasesAprobadas(estado: Record<string, unknown>): number {
  let n = 0;
  if (estado.status === "approved") n++;
  const fases = [2, 3, 4, 5, 6] as const;
  for (const f of fases) {
    const fx = estado[`fase${f}`] as Record<string, unknown> | undefined;
    if (fx && typeof fx === "object" && fx.status === "approved") n++;
  }
  return n;
}

export async function GET() {
  try {
    const nombres = await readdir(DIR_PROYECTOS);
    const resumenes: ProyectoResumen[] = [];
    for (const nombre of nombres) {
      if (!nombre.endsWith(".json")) continue;
      const id = nombre.slice(0, -5);
      if (!esIdValido(id)) continue;
      try {
        const bruto = JSON.parse(
          await readFile(path.join(DIR_PROYECTOS, nombre), "utf8")
        ) as Record<string, unknown>;
        const meta = bruto.meta as Record<string, unknown> | undefined;
        const estado = bruto.estado as Record<string, unknown> | undefined;
        if (!meta || !estado) continue;
        const fileMeta = estado.fileMeta as
          | { name?: unknown }
          | null
          | undefined;
        resumenes.push({
          id,
          nombre: typeof meta.nombre === "string" ? meta.nombre : id,
          creadoEn: Number(meta.creadoEn) || 0,
          guardadoEn: Number(meta.guardadoEn) || 0,
          fases: fasesAprobadas(estado),
          archivo:
            fileMeta && typeof fileMeta.name === "string" ? fileMeta.name : "—",
          duracionSec:
            Number(
              (estado.savedResult as { durationSec?: unknown } | undefined)
                ?.durationSec
            ) || 0,
          escenas: Array.isArray(
            (estado.fase2 as Record<string, unknown> | undefined)?.escenas
          )
            ? ((estado.fase2 as { escenas: unknown[] }).escenas.length as number)
            : 0,
          tieneAudio: await existe(path.join(DIR_PROYECTOS, `${id}.audio`)),
          tieneAnalisis: await existe(path.join(DIR_PROYECTOS, `${id}.an`)),
        });
      } catch {
        /* json corrupto: se ignora en el listado */
      }
    }
    resumenes.sort((a, b) => b.guardadoEn - a.guardadoEn);
    return NextResponse.json(
      { proyectos: resumenes },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ proyectos: [] });
  }
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

  const campoProyecto = form.get("proyecto");
  if (typeof campoProyecto !== "string" || campoProyecto.length > MAX_JSON) {
    return NextResponse.json(
      { error: "Falta el estado del proyecto o supera el máximo de 8 MB." },
      { status: 400 }
    );
  }
  let bruto: Record<string, unknown>;
  try {
    bruto = JSON.parse(campoProyecto) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El campo «proyecto» no es JSON válido." },
      { status: 400 }
    );
  }
  const metaBruta = bruto.meta as Record<string, unknown> | undefined;
  const nombre =
    typeof metaBruta?.nombre === "string" ? metaBruta.nombre.trim().slice(0, 80) : "";
  if (!metaBruta || !nombre) {
    return NextResponse.json(
      { error: "El proyecto necesita un nombre." },
      { status: 400 }
    );
  }
  const estado = bruto.estado;
  if (!estado || typeof estado !== "object") {
    return NextResponse.json(
      { error: "El proyecto no trae el estado del pipeline." },
      { status: 400 }
    );
  }

  const audio = form.get("audio");
  const analisis = form.get("analisis");
  if (audio && !(audio instanceof File)) {
    return NextResponse.json({ error: "«audio» debe ser un archivo." }, { status: 400 });
  }
  if (analisis && !(analisis instanceof File)) {
    return NextResponse.json({ error: "«analisis» debe ser un archivo." }, { status: 400 });
  }
  if (audio instanceof File && audio.size > MAX_AUDIO) {
    return NextResponse.json(
      { error: "El audio supera el máximo de 400 MB por proyecto." },
      { status: 413 }
    );
  }
  if (analisis instanceof File && analisis.size > MAX_ANALISIS) {
    return NextResponse.json(
      { error: "El paquete de análisis supera el máximo de 96 MB." },
      { status: 413 }
    );
  }

  // decidir id: actualizar el existente o crear uno nuevo
  const idPropuesto = typeof metaBruta.id === "string" ? metaBruta.id : "";
  let id = "";
  let creadoEn = Date.now();
  let actualizando = false;
  if (idPropuesto && esIdValido(idPropuesto)) {
    const rutaJson = path.join(DIR_PROYECTOS, `${idPropuesto}.json`);
    if (await existe(rutaJson)) {
      try {
        const previo = JSON.parse(await readFile(rutaJson, "utf8")) as {
          meta?: { creadoEn?: unknown };
        };
        const c = Number(previo.meta?.creadoEn);
        if (Number.isFinite(c) && c > 0) creadoEn = c;
      } catch {
        /* se regenera creadoEn */
      }
      id = idPropuesto;
      actualizando = true;
    }
  }
  if (!id) {
    id = idSeguro(nombre, "proy");
    while (await existe(path.join(DIR_PROYECTOS, `${id}.json`))) {
      id = idSeguro(`${nombre}-${Date.now()}`, "proy");
    }
  }

  const guardadoEn = Date.now();
  const proyecto = {
    tipo: "bardo-studio-proyecto",
    version: 1,
    meta: { id, nombre, creadoEn, guardadoEn },
    estado,
    musicaPropia: Array.isArray(bruto.musicaPropia) ? bruto.musicaPropia : [],
  };

  try {
    // garantiza db/proyectos (primer arranque tras instalar o carpeta perdida)
    await mkdir(DIR_PROYECTOS, { recursive: true });
    await writeFile(
      path.join(DIR_PROYECTOS, `${id}.json`),
      JSON.stringify(proyecto),
      "utf8"
    );
  } catch {
    return NextResponse.json(
      { error: "No se pudo escribir el proyecto en el servidor local." },
      { status: 500 }
    );
  }

  let bytesAudio = 0;
  let reemplazoAudio = false;
  if (audio instanceof File && audio.size > 0) {
    try {
      const buf = Buffer.from(await audio.arrayBuffer());
      await writeFile(path.join(DIR_PROYECTOS, `${id}.audio`), buf);
      bytesAudio = buf.byteLength;
      reemplazoAudio = true;
    } catch {
      return NextResponse.json(
        { error: "No se pudo guardar el audio del proyecto." },
        { status: 500 }
      );
    }
  }

  if (analisis instanceof File && analisis.size > 0) {
    try {
      const buf = Buffer.from(await analisis.arrayBuffer());
      await writeFile(path.join(DIR_PROYECTOS, `${id}.an`), buf);
    } catch {
      return NextResponse.json(
        { error: "No se pudo guardar el análisis del proyecto." },
        { status: 500 }
      );
    }
  } else if (reemplazoAudio || !actualizando) {
    // audio nuevo sin análisis nuevo (o proyecto recién creado sin él):
    // un .an previo ya no corresponde seguro al audio
    try {
      await unlink(path.join(DIR_PROYECTOS, `${id}.an`));
    } catch {
      /* no existía */
    }
  }

  return NextResponse.json(
    {
      id,
      nombre,
      creadoEn,
      guardadoEn,
      bytesAudio,
      tieneAudio: await existe(path.join(DIR_PROYECTOS, `${id}.audio`)),
      tieneAnalisis: await existe(path.join(DIR_PROYECTOS, `${id}.an`)),
    },
    { status: actualizando ? 200 : 201 }
  );
}
