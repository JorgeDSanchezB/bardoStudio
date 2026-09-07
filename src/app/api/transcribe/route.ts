import { NextRequest, NextResponse } from "next/server";
import { obtenerProveedor } from "@/lib/server/ia";

/**
 * POST /api/transcribe — transcripción ASR con el PROVEEDOR ACTIVO (ADR-014).
 *
 * La IA es reemplazable: Z.AI incluida, API propia compatible OpenAI
 * (OpenAI/Groq/Mistral/servidores locales) o Deepgram — ver «Ajustes de IA»
 * y /api/ia-proveedores. Recibe { audioBase64 } (WAV mono 16 kHz, ≤ 30 s)
 * y devuelve { texto }.
 *
 * Reintentos: 429 (rate-limit) y fallos transitorios de red, con backoff.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTENTOS = 3;
const PAUSA_MS = 1400;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const reintentable = (msg: string) =>
  /\b429\b/.test(msg) ||
  /\b5\d\d\b/.test(msg) ||
  /timeout|aborted|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(msg);

export async function POST(req: NextRequest) {
  try {
    const cuerpo = (await req.json()) as { audioBase64?: unknown };
    const audioBase64 = cuerpo.audioBase64;
    if (typeof audioBase64 !== "string" || audioBase64.length < 44) {
      return NextResponse.json(
        { error: "Falta el campo audioBase64 (WAV en base64)" },
        { status: 400 }
      );
    }

    const proveedor = await obtenerProveedor();
    if (!proveedor) {
      return NextResponse.json(
        {
          error:
            "La IA de transcripción no está conectada: abre «Ajustes de IA» (engranaje, arriba a la derecha) y conecta tu propia API (OpenAI, Groq, Mistral, Deepgram u otra compatible) o el servicio de la web de Bardo Studio.",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    let ultimoError = "sin detalle";
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      try {
        const texto = await proveedor.transcribirWav(audioBase64);
        return NextResponse.json(
          { texto },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e);
        if (!reintentable(ultimoError) || intento === MAX_INTENTOS) break;
        await dormir(PAUSA_MS * intento);
      }
    }

    return NextResponse.json(
      {
        error: `El proveedor de transcripción «${proveedor.nombre}» falló: ${ultimoError}`,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Petición inválida: ${msg}` },
      { status: 500 }
    );
  }
}
