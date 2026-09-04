import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/transcribe — skill ASR del SDK (z-ai-web-dev-sdk, SOLO backend).
 * Recibe { audioBase64 } (WAV mono 16 kHz, ≤ 30 s) y devuelve { texto }.
 * El servicio es estricto con el rate-limit (429): se reintenta con backoff.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INTENTOS = 3;
const PAUSA_MS = 1400;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    let ultimoError = "sin detalle";
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      try {
        const resp = await zai.audio.asr.create({ file_base64: audioBase64 });
        const texto = typeof resp?.text === "string" ? resp.text.trim() : "";
        return NextResponse.json(
          { texto },
          { headers: { "Cache-Control": "no-store" } }
        );
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e);
        const saturado = ultimoError.includes("429") || ultimoError.toLowerCase().includes("too many");
        if (!saturado || intento === MAX_INTENTOS) break;
        await dormir(PAUSA_MS * intento);
      }
    }

    return NextResponse.json(
      { error: `El servicio de transcripción falló: ${ultimoError}` },
      { status: 502 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Petición inválida: ${msg}` },
      { status: 500 }
    );
  }
}
