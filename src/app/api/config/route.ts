import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

// Mapa de Atributos Dinámicos: la UI lee los umbrales/parámetros desde
// config/config.json — editable por el usuario sin tocar código.
export async function GET() {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "config", "config.json"),
      "utf8"
    );
    const json = JSON.parse(raw) as unknown;
    return NextResponse.json(json, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "No se pudo leer config/config.json" },
      { status: 500 }
    );
  }
}
