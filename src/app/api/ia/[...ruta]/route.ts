import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * POST /api/ia/<ruta> — RELÉ del servicio de IA.
 *
 * La API de IA (transcripción ASR + chat) solo es alcanzable desde la red del
 * servidor de esta web: la app de escritorio no puede llamarla directamente.
 * Este relé reenvía un conjunto MUY acotado de rutas con las credenciales del
 * servidor, de modo que la app instalada pueda usar la Fase 2 conectándose a
 * la URL pública de esta web (ver /api/ia-proveedores y Ajustes de IA en la UI).
 *
 * Rutas admitidas (whitelist): chat/completions y audio/asr — exactamente las
 * que usa la app. El resto → 404.
 *
 * La configuración se lee con la MISMA prioridad que z-ai-web-dev-sdk
 * (cwd → home → /etc), en cada petición, sin exponer credenciales.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConfigIa {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  userId?: string;
  token?: string;
}

const RUTAS_ADMITIDAS = new Set(["chat/completions", "audio/asr"]);

const CUERPO_MAX = 8 * 1024 * 1024; // 8 MB (ASR: ~1.4 MB por 30 s en base64)
const TIMEOUT_MS = 120_000;

async function leerConfigIa(): Promise<ConfigIa | null> {
  const rutas = [
    path.join(process.cwd(), ".z-ai-config"),
    path.join(os.homedir(), ".z-ai-config"),
    "/etc/.z-ai-config",
  ];
  for (const ruta of rutas) {
    try {
      const bruto = await readFile(ruta, "utf8");
      const cfg = JSON.parse(bruto) as Partial<ConfigIa>;
      if (typeof cfg.baseUrl === "string" && typeof cfg.apiKey === "string") {
        // los configs «relé» (baseUrl …/api/ia, p. ej. el de la app de
        // escritorio) son PUNTEROS de cliente, no credenciales del servidor:
        // el relé nunca debe reenviar a otro relé (bucle infinito)
        if (cfg.baseUrl.includes("/api/ia")) continue;
        return {
          baseUrl: cfg.baseUrl.replace(/\/+$/, ""),
          apiKey: cfg.apiKey,
          chatId: typeof cfg.chatId === "string" ? cfg.chatId : undefined,
          userId: typeof cfg.userId === "string" ? cfg.userId : undefined,
          token: typeof cfg.token === "string" ? cfg.token : undefined,
        };
      }
    } catch {
      // no existe o no es válido: probar la siguiente ruta
    }
  }
  return null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ ruta?: string[] }> }
) {
  const { ruta } = await ctx.params;
  const relativa = (ruta ?? []).map((s) => String(s)).join("/");

  if (!RUTAS_ADMITIDAS.has(relativa)) {
    return NextResponse.json(
      { error: `Ruta de IA no admitida por el relé: ${relativa}` },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const cfg = await leerConfigIa();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "El relé no tiene credenciales de IA en el servidor (falta .z-ai-config).",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // cuerpo tal cual (JSON del SDK), con tope de tamaño defensivo
  const cuerpo = await req.text();
  if (cuerpo.length > CUERPO_MAX) {
    return NextResponse.json(
      { error: "La petición supera el tamaño máximo del relé (8 MB)." },
      { status: 413, headers: { "Cache-Control": "no-store" } }
    );
  }

  const destino = `${cfg.baseUrl}/${relativa}`;

  // blindaje anti-bucle: nunca reenviar a este mismo servidor
  // (localhost/127.0.0.1/[::1] son el mismo equipo aunque Next cambie el host)
  try {
    const propio = new URL(req.nextUrl.origin);
    const destinoUrl = new URL(destino);
    const norm = (h: string) =>
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h)
        ? `local${h.replace(/^[^:]+/, "")}`
        : h.toLowerCase();
    if (
      destinoUrl.protocol === propio.protocol &&
      norm(destinoUrl.host) === norm(propio.host)
    ) {
      return NextResponse.json(
        {
          error:
            "El relé no puede reenviar a sí mismo (la configuración apunta a esta misma web).",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch {
    // URL malformada: se dejará fallar en el fetch con su error
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "X-Z-AI-From": "Z",
  };
  if (cfg.chatId) headers["X-Chat-Id"] = cfg.chatId;
  if (cfg.userId) headers["X-User-Id"] = cfg.userId;
  if (cfg.token) headers["X-Token"] = cfg.token;

  try {
    const resp = await fetch(destino, {
      method: "POST",
      headers,
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const texto = await resp.text();
    return new NextResponse(texto, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[relé IA] fallo ${destino}: ${msg}`);
    return NextResponse.json(
      { error: `El servicio de IA no respondió a tiempo (${msg}).` },
      { status: 504, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// solo POST: nada de GET/PUT/PATCH en el relé
export async function GET() {
  return NextResponse.json(
    { error: "El relé de IA solo acepta POST." },
    { status: 405, headers: { "Cache-Control": "no-store" } }
  );
}
