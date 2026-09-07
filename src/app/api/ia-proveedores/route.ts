import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, unlink } from "fs/promises";
import path from "node:path";
import {
  DEEPGRAM_BASE,
  escribirBardoIa,
  leerConfigIa,
  obtenerEstado,
  wavPrueba,
} from "@/lib/server/ia";

/**
 * GET/POST/DELETE /api/ia-proveedores — gestión de la IA de la Fase 2.
 *
 * La IA es reemplazable (ADR-014). Tres proveedores:
 *
 *  · zai      → incluida: directa en la web del servidor; en la app de
 *              escritorio vía RELÉ (POST { proveedor: "zai", url: "https://…" }
 *              escribe .z-ai-config apuntando a la web, igual que la 1.0.1).
 *  · openai   → API propia compatible con OpenAI (OpenAI, Groq, Mistral,
 *              servidores locales): POST { proveedor: "openai", baseUrl,
 *              apiKey, modeloAsr?, modeloChat? } — PRUEBA REAL antes de
 *              guardar (chat mínimo y/o transcripción de 0,5 s).
 *  · deepgram → API propia de Deepgram (solo transcripción): POST
 *              { proveedor: "deepgram", apiKey } — prueba real con 0,5 s.
 *
 * DELETE { proveedor } quita la configuración de ese proveedor. Las claves
 * nunca salen por GET (solo pistas enmascaradas) ni se empaquetan.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sinAlmacen = (extra: unknown, status = 200) =>
  NextResponse.json(extra, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

// ───────────────────────── GET: estado sin secretos ─────────────────────────

export async function GET() {
  return sinAlmacen(await obtenerEstado());
}

// ───────────────────────── validaciones ─────────────────────────

/** URL base de API propia: http(s), host válido; se rellena /v1 si falta. */
function normalizarBaseUrl(entrada: string): string | null {
  let cruda = entrada.trim();
  if (!cruda) return null;
  if (!/^https?:\/\//i.test(cruda)) cruda = `https://${cruda}`;
  cruda = cruda.replace(/\/+$/, "");
  let u: URL;
  try {
    u = new URL(cruda);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  // host con punto (api.openai.com), local (localhost:8080) o IP
  const host = u.hostname;
  const hostValido =
    host.includes(".") ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!hostValido) return null;
  if (u.pathname === "" || u.pathname === "/") u.pathname = "/v1";
  return u.toString().replace(/\/+$/, "");
}

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

/** Normaliza la URL de la WEB para el relé: origen o …/api/ia → …/api/ia. */
function normalizarUrlRele(entrada: string): string | null {
  let cruda = entrada.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(cruda)) cruda = `https://${cruda}`;
  let u: URL;
  try {
    u = new URL(cruda);
  } catch {
    return null;
  }
  if (!u.hostname.includes(".")) return null;
  const ruta = u.pathname.replace(/\/+$/, "");
  if (ruta === "" || ruta === "/api/ia") {
    return `${u.origin}/api/ia`;
  }
  return null;
}

const limpiar = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

async function leerArchivoTexto(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, "utf8");
  } catch {
    return null;
  }
}

/** fetch de prueba con errores de red traducidos a mensaje claro. */
async function fetchPrueba(
  url: string,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `no se pudo contactar con ${url} (${msg}). Comprueba la URL, que la API sea accesible desde este equipo y vuelve a intentarlo.`
    );
  }
}

// ───────────────────────── POST: guardar (con prueba real) ─────────────────────────

interface CuerpoPost {
  proveedor?: unknown;
  url?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  modeloAsr?: unknown;
  modeloChat?: unknown;
}

export async function POST(req: NextRequest) {
  let cuerpo: CuerpoPost;
  try {
    cuerpo = (await req.json()) as CuerpoPost;
  } catch {
    return sinAlmacen({ ok: false, error: "Cuerpo inválido." }, 400);
  }
  const proveedor = typeof cuerpo.proveedor === "string" ? cuerpo.proveedor : "";

  try {
    // ── Z.AI: relé de la web (escritorio) o activación directa (web) ──
    if (proveedor === "zai") {
      if (typeof cuerpo.url === "string" && cuerpo.url.trim()) {
        return await conectarRele(cuerpo.url, req);
      }
      // activar la Z.AI del servidor (web): solo si existe config directa
      const estado = await obtenerEstado();
      if (estado.zai.modo !== "servidor") {
        return sinAlmacen(
          {
            ok: false,
            error:
              "Aquí no hay Z.AI directa: en la app de escritorio usa la URL de tu Bardo Studio web.",
          },
          400
        );
      }
      await escribirBardoIa({
        activo: "zai",
        openai: undefined,
        deepgram: undefined,
      });
      return sinAlmacen({ ok: true, estado: await obtenerEstado() });
    }

    // ── API propia compatible OpenAI ──
    if (proveedor === "openai") {
      const baseUrl = normalizarBaseUrl(
        typeof cuerpo.baseUrl === "string" ? cuerpo.baseUrl : ""
      );
      if (!baseUrl) {
        return sinAlmacen(
          {
            ok: false,
            error:
              "La URL base no es válida (ej.: https://api.openai.com/v1 o http://localhost:8080/v1).",
          },
          400
        );
      }
      // clave nueva, o la ya guardada si se deja vacía (cambiar solo URL/modelos)
      const existente = (await leerConfigIa()) ?? {};
      const claveBruta =
        typeof cuerpo.apiKey === "string" ? cuerpo.apiKey.trim() : "";
      const apiKey = claveBruta || existente.openai?.apiKey || "";
      if (apiKey.length < 8 || /\s/.test(apiKey)) {
        return sinAlmacen(
          {
            ok: false,
            error:
              "La clave de API no parece válida (mínimo 8 caracteres, sin espacios).",
          },
          400
        );
      }
      const modeloAsr = limpiar(cuerpo.modeloAsr);
      const modeloChat = limpiar(cuerpo.modeloChat);
      if (!modeloAsr && !modeloChat) {
        return sinAlmacen(
          {
            ok: false,
            error:
              "Indica al menos un modelo: el de transcripción (whisper…) o el de chat.",
          },
          400
        );
      }

      // PRUEBAS REALES antes de guardar
      const auth = { Authorization: `Bearer ${apiKey}` };
      try {
        if (modeloAsr) {
          const fd = new FormData();
          fd.append(
            "file",
            new Blob([new Uint8Array(wavPrueba(500))], { type: "audio/wav" }),
            "audio.wav"
          );
          fd.append("model", modeloAsr);
          fd.append("response_format", "json");
          const resp = await fetchPrueba(`${baseUrl}/audio/transcriptions`, {
            method: "POST",
            headers: auth,
            body: fd,
            signal: AbortSignal.timeout(30_000),
          });
          if (!resp.ok) {
            const detalle = (await resp.text().catch(() => "")).slice(0, 200);
            return sinAlmacen(
              {
                ok: false,
                error: `La prueba de transcripción falló (${resp.status})${
                  detalle ? `: ${detalle}` : ""
                }. Revisa URL, clave y modelo.`,
              },
              502
            );
          }
        }
        if (modeloChat) {
          const resp = await fetchPrueba(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: modeloChat,
              messages: [{ role: "user", content: "PING" }],
              max_tokens: 8,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!resp.ok) {
            const detalle = (await resp.text().catch(() => "")).slice(0, 200);
            return sinAlmacen(
              {
                ok: false,
                error: `La prueba de chat falló (${resp.status})${
                  detalle ? `: ${detalle}` : ""
                }. Revisa URL, clave y modelo.`,
              },
              502
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return sinAlmacen({ ok: false, error: `La prueba falló: ${msg}` }, 502);
      }

      await escribirBardoIa({
        activo: "openai",
        openai: { baseUrl, apiKey, modeloAsr, modeloChat },
      });
      return sinAlmacen({ ok: true, estado: await obtenerEstado() });
    }

    // ── Deepgram (solo transcripción) ──
    if (proveedor === "deepgram") {
      // clave nueva, o la ya guardada si se deja vacía
      const existente = (await leerConfigIa()) ?? {};
      const claveBruta =
        typeof cuerpo.apiKey === "string" ? cuerpo.apiKey.trim() : "";
      const apiKey = claveBruta || existente.deepgram?.apiKey || "";
      if (apiKey.length < 8 || /\s/.test(apiKey)) {
        return sinAlmacen(
          {
            ok: false,
            error:
              "La clave de Deepgram no parece válida (mínimo 8 caracteres, sin espacios).",
          },
          400
        );
      }
      // PRUEBA REAL: transcripción de 0,5 s (verifica clave y permiso)
      try {
        const resp = await fetchPrueba(
          `${DEEPGRAM_BASE}/v1/listen?model=nova-2&smart_format=true&language=es`,
          {
            method: "POST",
            headers: {
              Authorization: `Token ${apiKey}`,
              "Content-Type": "audio/wav",
            },
            body: new Uint8Array(wavPrueba(500)),
            signal: AbortSignal.timeout(30_000),
          }
        );
        if (!resp.ok) {
          const detalle = (await resp.text().catch(() => "")).slice(0, 200);
          return sinAlmacen(
            {
              ok: false,
              error: `La prueba de Deepgram falló (${resp.status})${
                detalle ? `: ${detalle}` : ""
              }. Revisa la clave (Deepgram → API Keys).`,
            },
            502
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return sinAlmacen({ ok: false, error: `La prueba falló: ${msg}` }, 502);
      }
      await escribirBardoIa({
        activo: "deepgram",
        deepgram: { apiKey },
      });
      return sinAlmacen({ ok: true, estado: await obtenerEstado() });
    }

    return sinAlmacen(
      { ok: false, error: `Proveedor desconocido: «${proveedor}».` },
      400
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return sinAlmacen(
      {
        ok: false,
        error: `No se pudo guardar la configuración: ${msg}`,
      },
      500
    );
  }
}

/** Conecta el RELÉ de la web de Bardo Studio (lógica de la 1.0.1). */
async function conectarRele(
  entrada: string,
  req: NextRequest
): Promise<NextResponse> {
  const baseUrl = normalizarUrlRele(entrada);
  if (!baseUrl) {
    return sinAlmacen(
      {
        ok: false,
        error:
          "Escribe la dirección de tu Bardo Studio web (por ejemplo https://…), sin rutas adicionales.",
      },
      400
    );
  }

  // nunca conectar un servidor a su propio relé (bucle infinito)
  if (mismoServidor(baseUrl, `${req.nextUrl.origin}/api/ia`)) {
    return sinAlmacen(
      {
        ok: false,
        error:
          "Esa es la dirección de esta misma web: aquí la IA ya funciona directa. El relé se configura en la APP DE ESCRITORIO, pegando la dirección de la web.",
      },
      400
    );
  }

  const rutaLocal = path.join(process.cwd(), ".z-ai-config");
  const bruto = await leerArchivoTexto(rutaLocal);
  if (bruto) {
    try {
      const cfg = JSON.parse(bruto) as { baseUrl?: string };
      if (typeof cfg.baseUrl === "string" && !cfg.baseUrl.includes("/api/ia")) {
        return sinAlmacen(
          {
            ok: false,
            error:
              "Ya existe un .z-ai-config con credenciales manuales; quítalo a mano si quieres usar el relé.",
          },
          409
        );
      }
    } catch {
      /* archivo ilegible: se sobrescribe con el relé */
    }
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
      return sinAlmacen(
        {
          ok: false,
          error: `La web respondió con error ${resp.status} al probar la IA. ${
            detalle.slice(0, 140) || "Sin detalle."
          }`,
        },
        502
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return sinAlmacen(
      {
        ok: false,
        error: `No se pudo contactar con ${baseUrl.replace("/api/ia", "")} (${msg}). Comprueba la dirección y que la web esté abierta.`,
      },
      502
    );
  }

  // guardar (cwd = carpeta del servidor: %APPDATA%\Bardo Studio\app en el
  // escritorio — el SDK la lee primero y el actualizador la conserva)
  await writeFile(
    rutaLocal,
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
  await escribirBardoIa({
    activo: "zai",
    openai: undefined,
    deepgram: undefined,
  });
  return sinAlmacen({ ok: true, estado: await obtenerEstado() });
}

// ───────────────────────── DELETE: quitar proveedor ─────────────────────────

export async function DELETE(req: NextRequest) {
  let proveedor = "";
  try {
    const cuerpo = (await req.json()) as { proveedor?: unknown };
    proveedor = typeof cuerpo.proveedor === "string" ? cuerpo.proveedor : "";
  } catch {
    /* sin cuerpo: sin proveedor */
  }

  try {
    if (proveedor === "openai" || proveedor === "deepgram") {
      const cambios: Record<string, undefined> = {
        [proveedor]: undefined,
        activo: undefined,
      };
      await escribirBardoIa(
        cambios as Parameters<typeof escribirBardoIa>[0]
      );
      return sinAlmacen({ ok: true, estado: await obtenerEstado() });
    }

    if (proveedor === "zai") {
      const rutaLocal = path.join(process.cwd(), ".z-ai-config");
      const bruto = await leerArchivoTexto(rutaLocal);
      if (bruto) {
        try {
          const cfg = JSON.parse(bruto) as { baseUrl?: string };
          if (
            typeof cfg.baseUrl === "string" &&
            !cfg.baseUrl.includes("/api/ia")
          ) {
            return sinAlmacen(
              {
                ok: false,
                error:
                  "El .z-ai-config contiene credenciales manuales: no se borra automáticamente.",
              },
              409
            );
          }
        } catch {
          /* ilegible: se considera del relé y se quita */
        }
        await unlink(rutaLocal);
      }
      await escribirBardoIa({ activo: undefined });
      return sinAlmacen({ ok: true, estado: await obtenerEstado() });
    }

    return sinAlmacen(
      { ok: false, error: `Proveedor desconocido: «${proveedor}».` },
      400
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return sinAlmacen(
      { ok: false, error: `No se pudo quitar la configuración: ${msg}` },
      500
    );
  }
}
