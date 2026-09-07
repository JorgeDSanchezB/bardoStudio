/**
 * ia-mock — servidor de PRUEBAS compatible con la API de OpenAI.
 * ────────────────────────────────────────────────────────────────
 * Simula un proveedor externo para verificar de punta a punta el
 * proveedor «API propia» de Bardo Studio (Fase 2) sin salir a internet:
 *
 *   · POST /v1/chat/completions   → "PONG" para PING; para el análisis de
 *     tensión (JSON con «escenas») devuelve puntuaciones fijas.
 *   · POST /v1/audio/transcriptions → texto fijo (valida multipart + model).
 *
 * Clave aceptada: sk-mock-1234567890 (Bearer). Puerto fijo: 3010.
 */

const PUERTO = 3010;
const CLAVE = "sk-mock-1234567890";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const authValida = (req: Request) =>
  req.headers.get("authorization") === `Bearer ${CLAVE}`;

const server = Bun.serve({
  port: PUERTO,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/v1/chat/completions") {
      if (!authValida(req)) {
        return json({ error: { message: "clave incorrecta" } }, 401);
      }
      const body = (await req.json().catch(() => null)) as {
        messages?: Array<{ role: string; content: string }>;
      } | null;
      const usuarios = (body?.messages ?? []).filter(
        (m) => m.role === "user"
      );
      const ultimo = usuarios[usuarios.length - 1]?.content ?? "";
      let contenido = "PONG";
      try {
        const datos = JSON.parse(ultimo) as {
          escenas?: Array<{ id: string }>;
        };
        if (datos && Array.isArray(datos.escenas)) {
          contenido = JSON.stringify({
            resultados: datos.escenas.map((e) => ({
              id: e.id,
              tension: 63,
              animo: "misterio",
              razon: "puntuado por el mock de pruebas",
            })),
          });
        }
      } catch {
        /* no era JSON: respuesta PING → PONG */
      }
      return json({
        id: "mock-chat",
        choices: [{ index: 0, message: { role: "assistant", content: contenido } }],
      });
    }

    if (url.pathname === "/v1/audio/transcriptions") {
      if (!authValida(req)) {
        return json({ error: { message: "clave incorrecta" } }, 401);
      }
      const form = await req.formData().catch(() => null);
      const modelo = form?.get("model");
      const archivo = form?.get("file");
      if (!modelo || typeof modelo !== "string") {
        return json({ error: { message: "falta el model" } }, 400);
      }
      if (!archivo) {
        return json({ error: { message: "falta el file" } }, 400);
      }
      console.log(
        `[mock] transcripción: modelo=${modelo}, bytes=${typeof archivo === "object" && "size" in archivo ? (archivo as File).size : "?"}`
      );
      return json({ text: "prueba mock de transcripción" });
    }

    return json({ ok: true, servicio: "ia-mock" });
  },
});

console.log(`ia-mock escuchando en http://127.0.0.1:${PUERTO}`);
