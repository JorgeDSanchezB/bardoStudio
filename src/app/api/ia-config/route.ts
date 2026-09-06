import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink } from "fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * GET/POST/DELETE /api/ia-config — gestión de la conexión de IA.
 *
 * · GET    → estado (modo "servidor" | "rele" | "ninguno") sin secretos.
 * · POST   → { url } conecta la app al RELÉ de una web de Bardo Studio:
 *            valida la URL, hace una PRUEBA REAL (chat mínimo) y, si responde,
 *            escribe .z-ai-config junto al servidor (cwd) con baseUrl=…/api/ia
 *            — justo donde z-ai-web-dev-sdk lo busca primero. El envoltorio de
 *            la app de escritorio conserva ese archivo entre versiones.
 * · DELETE → quita la conexión de relé (las credenciales manuales nunca se
 *            tocan: avisan con 409).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConfigIaParcial {
  baseUrl?: string;
  apiKey?: string;
}

const rutaLocal = () => path.join(process.cwd(), ".z-ai-config");

/** localhost, 127.0.0.1 y [::1] son el mismo equipo (Next normaliza el host). */
function mismoServidor(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    const norm = (h: string) =>
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h)
        ? `local${h.replace(/^[^:]+/, "")}`
        : h.toLowerCase();
    return a.protocol === b.protocol && norm(a.host) === norm(b.host);
  } catch {
    return false;
  }
}

async function leerConfig(
  ruta: string
): Promise<{ baseUrl: string; apiKey: string } | null> {
  try {
    const bruto = await readFile(ruta, "utf8");
    const cfg = JSON.parse(bruto) as ConfigIaParcial;
    if (typeof cfg.baseUrl === "string" && typeof cfg.apiKey === "string") {
      return { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
    }
  } catch {
    // no existe o no es válido
  }
  return null;
}

/** Estado efectivo con la prioridad del SDK: cwd → home → /etc. */
async function estadoActual(): Promise<{ modo: string; baseUrl?: string }> {
  const rutas = [
    rutaLocal(),
    path.join(os.homedir(), ".z-ai-config"),
    "/etc/.z-ai-config",
  ];
  for (const ruta of rutas) {
    const cfg = await leerConfig(ruta);
    if (cfg) {
      return cfg.baseUrl.includes("/api/ia")
        ? { modo: "rele", baseUrl: cfg.baseUrl }
        : { modo: "servidor", baseUrl: cfg.baseUrl };
    }
  }
  return { modo: "ninguno" };
}

/** Normaliza lo que el usuario pega: origen o …/api/ia → baseUrl del relé. */
function normalizarUrl(entrada: string): string | null {
  let cruda = entrada.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cruda)) cruda = `https://${cruda}`;
  let u: URL;
  try {
    u = new URL(cruda);
  } catch {
    return null;
  }
  if (!u.hostname.includes(".")) return null; // p. ej. "https://abc"
  const ruta = u.pathname.replace(/\/+$/, "");
  if (ruta === "" || ruta === "/api/ia") {
    return `${u.origin}/api/ia`;
  }
  return null; // rutas extrañas: se rechaza con mensaje claro
}

const sinAlmacen = (extra: Record<string, unknown> = {}) =>
  NextResponse.json(extra, { headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return sinAlmacen(await estadoActual());
}

export async function POST(req: NextRequest) {
  try {
    const cuerpo = (await req.json()) as { url?: unknown };
    const baseUrl = normalizarUrl(
      typeof cuerpo.url === "string" ? cuerpo.url : ""
    );
    if (!baseUrl) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Escribe la dirección de tu Bardo Studio web (por ejemplo https://…), sin rutas adicionales.",
        },
        { status: 400 }
      );
    }

    // nunca conectar un servidor a su propio relé (la IA local acabaría
    // reenviando a sí misma: bucle). El relé es para la app de escritorio.
    if (mismoServidor(baseUrl, `${req.nextUrl.origin}/api/ia`)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Esa es la dirección de esta misma web: aquí la IA ya funciona directa. El relé se configura en la APP DE ESCRITORIO, pegando la dirección de la web.",
        },
        { status: 400 }
      );
    }

    // nunca pisar credenciales manuales del usuario
    const local = await leerConfig(rutaLocal());
    if (local && !local.baseUrl.includes("/api/ia")) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Ya existe un .z-ai-config con credenciales manuales; quítalo a mano si quieres usar el relé.",
        },
        { status: 409 }
      );
    }

    // PRUEBA REAL contra el relé de la web indicada (chat mínimo)
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "PING" }],
          max_tokens: 8,
          thinking: { type: "disabled" },
        }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (!resp.ok) {
        const detalle = await resp.text().catch(() => "");
        return NextResponse.json(
          {
            ok: false,
            error: `La web respondió con error ${resp.status} al probar la IA. ${
              detalle.slice(0, 140) || "Sin detalle."
            }`,
          },
          { status: 502 }
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          ok: false,
          error: `No se pudo contactar con ${baseUrl.replace("/api/ia", "")} (${msg}). Comprueba la dirección y que la web esté abierta.`,
        },
        { status: 502 }
      );
    }

    // guardar (cwd = carpeta del servidor: %APPDATA%\Bardo Studio\app en el
    // escritorio — el SDK la lee primero y el actualizador la conserva)
    await writeFile(
      rutaLocal(),
      JSON.stringify(
        {
          baseUrl,
          apiKey: "rele-bardo",
          origen: "ajustes-ia (relé de la web de Bardo Studio)",
        },
        null,
        2
      ) + "\n",
      { mode: 0o600 }
    );

    return sinAlmacen({ ok: true, modo: "rele", baseUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: `No se pudo guardar la conexión: ${msg}` },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const local = await leerConfig(rutaLocal());
  if (local && !local.baseUrl.includes("/api/ia")) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "El .z-ai-config contiene credenciales manuales: no se borra automáticamente.",
      },
      { status: 409 }
    );
  }
  if (local) {
    await unlink(rutaLocal());
  }
  return sinAlmacen({ ok: true, ...(await estadoActual()) });
}
