import { NextResponse } from "next/server";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * GET /api/sfx-config — sirve el módulo SFX: palabras clave por categoría
 * (config/sfx_config.json, editable por el usuario) + biblioteca
 * (config/sfx.json, generada por scripts/generate-sfx-library.ts),
 * verificando que los WAV existan en public/sfx/. Todo local, sin red.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SfxDefBruto {
  id?: unknown;
  nombre?: unknown;
  archivo?: unknown;
  durSec?: unknown;
  etiquetas?: unknown;
}

interface SfxCatBruta {
  categoria?: unknown;
  etiqueta?: unknown;
  sfxId?: unknown;
  activo?: unknown;
  volumenDb?: unknown;
  palabras?: unknown;
}

export async function GET() {
  try {
    const rutaConfig = path.join(process.cwd(), "config", "sfx_config.json");
    const rutaBib = path.join(process.cwd(), "config", "sfx.json");
    const brutoCfg = JSON.parse(await readFile(rutaConfig, "utf8")) as {
      version?: number;
      defectos?: Record<string, unknown>;
      categorias?: SfxCatBruta[];
    };
    const brutoBib = JSON.parse(await readFile(rutaBib, "utf8")) as {
      version?: number;
      sfx?: SfxDefBruto[];
    };

    // ---- biblioteca: solo entradas cuyo WAV existe ----
    const biblioteca: Array<{
      id: string;
      nombre: string;
      archivo: string;
      durSec: number;
      etiquetas?: string[];
    }> = [];
    for (const f of brutoBib.sfx ?? []) {
      if (!f || typeof f !== "object") continue;
      const id = typeof f.id === "string" ? f.id : null;
      const archivo = typeof f.archivo === "string" ? f.archivo : null;
      const durSec = typeof f.durSec === "number" ? f.durSec : null;
      if (!id || !archivo || durSec === null) continue;
      try {
        await access(
          path.join(process.cwd(), "public", archivo.replace(/^\//, ""))
        );
      } catch {
        continue;
      }
      biblioteca.push({
        id,
        nombre: typeof f.nombre === "string" ? f.nombre : id,
        archivo,
        durSec,
        etiquetas: Array.isArray(f.etiquetas)
          ? f.etiquetas.filter((e): e is string => typeof e === "string")
          : undefined,
      });
    }

    // ---- categorías: validación defensiva + sfx existente ----
    const idsBib = new Set(biblioteca.map((b) => b.id));
    const categorias = (brutoCfg.categorias ?? [])
      .filter((c) => c && typeof c === "object")
      .map((c) => ({
        categoria: typeof c.categoria === "string" ? c.categoria.slice(0, 64) : "",
        etiqueta: typeof c.etiqueta === "string" ? c.etiqueta.slice(0, 80) : "",
        sfxId: typeof c.sfxId === "string" ? c.sfxId.slice(0, 64) : "",
        activo: c.activo !== false,
        volumenDb:
          typeof c.volumenDb === "number" && Number.isFinite(c.volumenDb)
            ? c.volumenDb
            : null,
        palabras: Array.isArray(c.palabras)
          ? c.palabras.filter((p): p is string => typeof p === "string").slice(0, 60)
          : [],
      }))
      .filter(
        (c) =>
          c.categoria.length > 0 &&
          c.sfxId.length > 0 &&
          (idsBib.has(c.sfxId) || biblioteca.length === 0)
      );

    const d = brutoCfg.defectos ?? {};
    const num = (v: unknown, def: number, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v)
        ? Math.min(max, Math.max(min, v))
        : def;

    return NextResponse.json(
      {
        version: brutoCfg.version ?? 1,
        defectos: {
          nivelDb: num(d.nivelDb, -12, -60, 6),
          crossfadeSeg: num(d.crossfadeSeg, 0.5, 0, 3),
          minSeparacionSeg: num(d.minSeparacionSeg, 1.5, 0, 30),
          respetarDucking: d.respetarDucking !== false,
          maxEventos: Math.trunc(num(d.maxEventos, 400, 1, 1000)),
        },
        categorias,
        biblioteca,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "No se pudo leer el módulo SFX (config/sfx_config.json y config/sfx.json). Ejecuta scripts/generate-sfx-library.ts.",
      },
      { status: 500 }
    );
  }
}
