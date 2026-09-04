import { NextResponse } from "next/server";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

/**
 * GET /api/music-library — sirve config/musica.json (biblioteca CC0 local
 * generada por scripts/generate-music-library.ts) verificando que los WAV
 * existan en public/. No hay llamadas externas: todo local.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ruta = path.join(process.cwd(), "config", "musica.json");
    const bruto = JSON.parse(await readFile(ruta, "utf8")) as {
      version?: number;
      generadoPor?: string;
      licencia?: string;
      pistas?: Array<Record<string, unknown>>;
    };
    const filas = Array.isArray(bruto.pistas) ? bruto.pistas : [];
    const pistas: Array<Record<string, unknown>> = [];
    for (const f of filas) {
      if (!f || typeof f !== "object") continue;
      const id = typeof f.id === "string" ? f.id : null;
      const archivo = typeof f.archivo === "string" ? f.archivo : null;
      if (!id || !archivo) continue;
      // comprobar que el WAV existe en public/
      try {
        await access(
          path.join(process.cwd(), "public", archivo.replace(/^\//, ""))
        );
      } catch {
        continue;
      }
      pistas.push(f);
    }
    return NextResponse.json(
      {
        version: bruto.version ?? 1,
        generadoPor:
          typeof bruto.generadoPor === "string"
            ? bruto.generadoPor
            : "síntesis determinista local",
        licencia: typeof bruto.licencia === "string" ? bruto.licencia : "CC0",
        pistas,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "No se pudo leer la biblioteca musical (config/musica.json). Ejecuta scripts/generate-music-library.ts.",
      },
      { status: 500 }
    );
  }
}
