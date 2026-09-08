import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "node:path";
import { esAnimo, type Animo, type FuenteEmocion } from "@/lib/fase2/types";
import { obtenerProveedor } from "@/lib/server/ia";

/**
 * POST /api/analyze-tension — LLM del PROVEEDOR ACTIVO (ADR-014) con
 * respaldo local. Recibe { escenas: [{ id, texto, energia }] } y puntúa cada
 * una: tensión 0-100 + ánimo + razón. El motor combina (con los pesos de
 * config/config.json) la tensión TEXTUAL con la ENERGÍA de audio enviada.
 *
 * Respaldo «modo seguro»: si el LLM falla (o el proveedor solo transcribe,
 * p. ej. Deepgram) → heurística local con los léxicos editables de
 * config.json (marcada con fuente="heuristico" en la UI).
 *
 * Motor 100 % local (Fase 2 gratis): con { motor: "local" } en el cuerpo NO
 * se llama a ningún LLM — solo la heurística local (sin coste, sin claves).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EscenaEntrada {
  id: string;
  texto: string;
  energia: number;
}

interface ResultadoEscena {
  id: string;
  tension: number;
  animo: Animo;
  fuente: FuenteEmocion;
  razon?: string;
}

interface Fase2ConfigArchivo {
  emocion?: { pesosTexto?: number; pesosAudio?: number };
  lexicos?: Record<string, string[]>;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

async function leerConfigFase2(): Promise<Fase2ConfigArchivo> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "config", "config.json"),
      "utf8"
    );
    const json = JSON.parse(raw) as { fase2?: Fase2ConfigArchivo };
    return json.fase2 ?? {};
  } catch {
    return {};
  }
}

function quitarAcentos(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Raíz ligera en español: «espadas»→«espada», «goblins»→«goblin».
 *  Así el léxico de config.json coincide con plurales sin duplicar entradas. */
function raizLigera(s: string): string {
  if (s.length > 4 && s.endsWith("es")) return s.slice(0, -2);
  if (s.length > 3 && s.endsWith("s")) return s.slice(0, -1);
  return s;
}

/** Heurística local: densidad de palabras clave por ánimo (config.json). */
function puntuarHeuristica(
  texto: string,
  lexicos: Record<string, string[]>
): { tension: number; animo: Animo } {
  const norm = quitarAcentos(texto);
  const tokens = (norm.match(/[a-z0-9ñ']+/g) ?? []).map(raizLigera);
  const n = Math.max(6, tokens.length);

  const dens: Record<string, number> = {};
  for (const [animo, palabras] of Object.entries(lexicos)) {
    if (!Array.isArray(palabras)) continue;
    let hits = 0;
    for (const p of palabras) {
      const pn = quitarAcentos(String(p));
      if (!pn) continue;
      if (pn.includes(" ")) {
        // frase hecha: se busca literal (sin raíces) sobre el texto normalizado
        hits += norm.split(pn).length - 1;
      } else {
        const pr = raizLigera(pn);
        for (const t of tokens) if (t === pr) hits++;
      }
    }
    dens[animo] = hits / n;
  }

  const escala = 3500;
  const exclam = (texto.match(/!/g) ?? []).length;
  let pTxt =
    escala *
    ((dens.tension ?? 0) + 0.8 * (dens.batalla ?? 0) + 0.35 * (dens.misterio ?? 0));
  pTxt += Math.min(20, 6 * exclam);
  pTxt -= Math.min(45, escala * (dens.calma ?? 0));

  const claves: Record<string, number> = {
    batalla: dens.batalla ?? 0,
    victoria: (dens.victoria ?? 0) * 1.15,
    misterio: dens.misterio ?? 0,
    tension: dens.tension ?? 0,
    calma: dens.calma ?? 0,
  };
  let mejor: Animo = "neutro";
  let mejorV = 12 / escala; // umbral mínimo de señal
  for (const [k, v] of Object.entries(claves)) {
    if (v > mejorV) {
      mejorV = v;
      mejor = k as Animo;
    }
  }
  return { tension: Math.round(clamp(pTxt, 0, 100)), animo: mejor };
}

/** Extrae el JSON de una respuesta del LLM (tolera vallas ```). */
function extraerJson(bruto: string): string | null {
  const limpio = bruto.replace(/```(?:json)?/gi, "").trim();
  const a = limpio.indexOf("{");
  const b = limpio.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  return limpio.slice(a, b + 1);
}

const SISTEMA = [
  "Eres el motor de análisis dramático de Bardo Studio (musicalización de narraciones de D&D y audiolibros).",
  "Recibes escenas de una narración en JSON y puntúas cada una.",
  "Respondes SOLO con JSON válido, sin texto adicional.",
  'Formato exacto: {"resultados":[{"id":"<id>","tension":<0-100>,"animo":"calma|misterio|tension|batalla|victoria|neutro","razon":"<máx 90 caracteres>"}]}',
  "Reglas de tensión (0-100): 0-20 calma o descripción serena; 21-40 intriga o misterio suave; 41-60 amenaza creciente o sospecha; 61-80 combate, persecución o peligro inmediato; 81-100 clímax épico.",
  "El ánimo resume el clima dramático dominante de la escena.",
  "Devuelve un resultado por cada escena recibida, con su id exacto.",
  "Si el texto está vacío o no es reconocible, devuelve tension 0 y animo neutro.",
].join("\n");

export async function POST(req: NextRequest) {
  try {
    const cuerpo = (await req.json()) as {
      escenas?: EscenaEntrada[];
      /** "local" → SOLO heurística local (Fase 2 100 % gratis, sin LLM) */
      motor?: unknown;
    };
    const escenas = Array.isArray(cuerpo.escenas)
      ? cuerpo.escenas.filter(
          (e) => e && typeof e.id === "string" && typeof e.texto === "string"
        )
      : [];
    if (escenas.length === 0) {
      return NextResponse.json(
        { error: "Falta el campo escenas ([] de {id, texto, energia})" },
        { status: 400 }
      );
    }
    const motorLocal = cuerpo.motor === "local";

    const cfg = await leerConfigFase2();
    const pesoTexto = clamp(Number(cfg.emocion?.pesosTexto ?? 0.7), 0, 1);
    const pesoAudio = clamp(Number(cfg.emocion?.pesosAudio ?? 0.3), 0, 1);
    const lexicos = cfg.lexicos ?? {};

    // ---- llamada al LLM del proveedor activo (reintentos heurísticos abajo) ----
    let crudos: Array<{
      id: string;
      tension: number;
      animo: string;
      razon?: string;
    }> | null = null;
    let motor = "llm";
    let aviso: string | undefined;

    try {
      if (motorLocal) {
        // Fase 2 100 % local: SIN LLM ni proveedor — heurística pura
        motor = "heuristico";
      } else {
      const proveedor = await obtenerProveedor();
      if (!proveedor) {
        motor = "heuristico";
        aviso =
          "La IA no está conectada (Ajustes de IA); se usó la heurística local.";
      } else {
        const lista = escenas.map((e) => ({
          id: e.id,
          texto: e.texto.slice(0, 600),
        }));
        const bruto = await proveedor.chat(
          SISTEMA,
          JSON.stringify({ escenas: lista })
        );
        const json = extraerJson(bruto);
        const parseado = json
          ? (JSON.parse(json) as { resultados?: unknown })
          : null;
        if (parseado && Array.isArray(parseado.resultados)) {
          crudos = parseado.resultados as {
            id: string;
            tension: number;
            animo: string;
            razon?: string;
          }[];
        } else {
          aviso = "El LLM no devolvió JSON válido; se usó la heurística local.";
          motor = "heuristico";
        }
      }
      }
    } catch {
      motor = "heuristico";
      aviso = "El motor LLM no respondió; se usó la heurística local (config.json).";
    }

    // ---- combinación texto + energía + respaldo heurístico ----
    const resultados: ResultadoEscena[] = escenas.map((e) => {
      const tieneTexto = (e.texto ?? "").trim().length > 0;
      if (!tieneTexto) {
        // escena muda: tensión por energía de audio
        return {
          id: e.id,
          tension: Math.round(clamp(Number(e.energia) || 0, 0, 100)),
          animo: "neutro" as Animo,
          fuente: "energia" as FuenteEmocion,
        };
      }
      const crudo = crudos?.find((r) => r && r.id === e.id);
      if (crudo && Number.isFinite(Number(crudo.tension))) {
        const tensionTexto = Math.round(clamp(Number(crudo.tension), 0, 100));
        const animo = esAnimo(crudo.animo) ? crudo.animo : "neutro";
        const tension = Math.round(
          clamp(
            pesoTexto * tensionTexto +
              pesoAudio * clamp(Number(e.energia) || 0, 0, 100),
            0,
            100
          )
        );
        return {
          id: e.id,
          tension,
          animo,
          fuente: "llm" as FuenteEmocion,
          razon:
            typeof crudo.razon === "string" ? crudo.razon.slice(0, 120) : undefined,
        };
      }
      // respaldo heurístico por escena
      const h = puntuarHeuristica(e.texto, lexicos);
      const tension = Math.round(
        clamp(
          pesoTexto * h.tension + pesoAudio * clamp(Number(e.energia) || 0, 0, 100),
          0,
          100
        )
      );
      return {
        id: e.id,
        tension,
        animo: h.animo,
        fuente: "heuristico" as FuenteEmocion,
        razon: "Puntuado con el léxico local de config.json",
      };
    });

    return NextResponse.json(
      { motor, resultados, aviso },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `No se pudo analizar la tensión: ${msg}` },
      { status: 500 }
    );
  }
}
