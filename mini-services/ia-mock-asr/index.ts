/**
 * ia-mock-asr — servidor de PRUEBAS que simula un servicio de SOLO
 * transcripción (como whisper.cpp / whisper-server), para verificar de
 * punta a punta el flujo de «URL de transcripción aparte» de Bardo Studio:
 *
 *   · POST /v1/audio/transcriptions → texto DISTINTO al de ia-mock, para
 *     comprobar que la app usa ESTA URL y no la general.
 *   · Cualquier otra ruta → 404 (igual que whisper-server: no hay chat).
 *
 * Clave aceptada: sk-mock-1234567890 (Bearer). Puerto fijo: 3011.
 * Combinación de prueba con LM Studio simulado:
 *   chat → ia-mock (:3010) · transcripción → aquí (:3011).
 */

const PUERTO = 3011;
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
        `[mock-asr] transcripción: modelo=${modelo}, bytes=${typeof archivo === "object" && "size" in archivo ? (archivo as File).size : "?"}`
      );
      // texto distinto al de ia-mock: si la app devuelve ESTO, usó la URL aparte
      return json({ text: "prueba mock de transcripción ASR aparte" });
    }

    // como whisper-server: solo transcribe, no hay chat ni nada más
    return json({ error: { message: "no encontrado" } }, 404);
  },
});

console.log(`ia-mock-asr escuchando en http://127.0.0.1:${PUERTO}`);
