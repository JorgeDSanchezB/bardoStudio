import type {
  Escena,
  Fase2Aviso,
  Fase2Config,
  Fase2Progreso,
  Fase2Resumen,
  Segmento,
} from "./types";
import { calcularCortes, calcularSubBloques } from "./cortes";
import { regionesDeVoz, alinearSubBloque } from "./align";
import { construirEscenas, dbMedioVoz } from "./escenas";
import { extraerPcm16k } from "./pcm";
import { encodeWavMono16, blobABase64 } from "./wav-encode";
import type { SilenceRegion } from "@/lib/audio/silence";

/**
 * Pipeline de la Fase 2 (se ejecuta en el cliente, llama a las API locales):
 *
 *  1. Cortes lógicos de ≤ bloqueSegundos (5 min) ajustados a los SILENCIOS
 *     APROBADOS de la Fase 1 → progreso y persistencia reanudable.
 *  2. Cada bloque se subdivide en sub-bloques ASR ≤ asrMaxSeg (el servicio
 *     admite 0-30 s), también cortados en silencios.
 *  3. Cada sub-bloque: PCM 16 k mono → WAV → base64 → POST /api/transcribe.
 *  4. El texto devuelto se alinea con las regiones de voz (energía Fase 1)
 *     → segmentos con tiempos estimados. Se persiste por bloque (reanudable).
 *  5. Escenas (rejilla escenaSegundos) + energía 0-100 → lotes a
 *     POST /api/analyze-tension (LLM + heurística + pesos de config.json).
 */

const CANCELADO = "cancelado";
const SR_ASR = 16000;

export interface Fase2Entrada {
  blob: Blob;
  envDb: Float32Array;
  hopSec: number;
  durationSec: number;
  silencios: SilenceRegion[];
  umbralDb: number;
  config: Fase2Config;
  claveFuente: string;
  previos?: { segmentos: Segmento[]; bloquesHechos: number[] };
}

export interface Fase2Manejadores {
  onProgreso: (p: Fase2Progreso) => void;
  onBloque: (
    bloque: number,
    nuevos: Segmento[],
    bloquesHechos: number[],
    todos: Segmento[]
  ) => void;
  onAviso: (a: Fase2Aviso) => void;
  cancel: () => boolean;
}

export interface Fase2Salida {
  escenas: Escena[];
  resumen: Fase2Resumen;
  avisos: Fase2Aviso[];
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function llamarAsr(
  wav: Blob,
  reintentos: number,
  pausaMs: number
): Promise<string> {
  const b64 = await blobABase64(wav);
  let ultimoError = "sin detalle";
  for (let intento = 0; intento <= reintentos; intento++) {
    if (intento > 0) await dormir(Math.max(1200, pausaMs) * intento);
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: b64 }),
      });
      const data = (await res.json().catch(() => null)) as {
        texto?: string;
        error?: string;
      } | null;
      if (!res.ok || !data) throw new Error(data?.error ?? `HTTP ${res.status}`);
      return (data.texto ?? "").trim();
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`El servicio de transcripción falló (${ultimoError})`);
}

interface ResultadoEmocion {
  id: string;
  tension: number;
  animo: Escena["animo"];
  fuente: Escena["fuente"];
  razon?: string;
}

async function analizarLote(
  escenas: Array<{ id: string; texto: string; energia: number }>
): Promise<{ motor: string; resultados: ResultadoEmocion[] } | null> {
  for (let intento = 0; intento < 2; intento++) {
    if (intento > 0) await dormir(1500);
    try {
      const res = await fetch("/api/analyze-tension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ escenas }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        motor?: string;
        resultados?: ResultadoEmocion[];
        aviso?: string;
      };
      if (Array.isArray(data.resultados)) {
        return { motor: data.motor ?? "llm", resultados: data.resultados };
      }
      throw new Error("respuesta sin resultados");
    } catch {
      // reintento
    }
  }
  return null;
}

export async function ejecutarFase2(
  ent: Fase2Entrada,
  h: Fase2Manejadores
): Promise<Fase2Salida> {
  const cfg = ent.config;
  const tr = cfg.transcripcion;
  const avisos: Fase2Aviso[] = [];

  // ---------- cortes lógicos (bloques ≤ 5 min ajustados a silencios) ----------
  const cortes = calcularCortes(
    ent.durationSec,
    ent.silencios,
    Math.max(30, tr.bloqueSegundos),
    Math.max(10, tr.ajusteSilencioSeg)
  );
  const totalBloques = cortes.length - 1;

  const segmentos: Segmento[] = ent.previos ? [...ent.previos.segmentos] : [];
  const hechos = new Set<number>(ent.previos?.bloquesHechos ?? []);
  let idBase = segmentos.length;
  let solicitudes = 0;

  h.onProgreso({
    etapa: "preparando",
    bloque: 0,
    totalBloques,
    subInicio: 0,
    subFin: 0,
    frases: segmentos.length,
    mensaje: "Calculando cortes con los silencios aprobados…",
  });

  // ---------- transcripción bloque a bloque ----------
  for (let b = 0; b < totalBloques; b++) {
    if (hechos.has(b)) continue;
    const t0 = cortes[b];
    const t1 = cortes[b + 1];
    const subs = calcularSubBloques(t0, t1, ent.silencios, Math.min(29.5, tr.asrMaxSeg));
    const nuevos: Segmento[] = [];

    for (const sub of subs) {
      if (h.cancel()) throw new Error(CANCELADO);

      h.onProgreso({
        etapa: "transcribiendo",
        bloque: b + 1,
        totalBloques,
        subInicio: Math.round(sub.inicio),
        subFin: Math.round(sub.fin),
        frases: segmentos.length + nuevos.length,
        mensaje: `Transcribiendo ${Math.round(sub.inicio)}s → ${Math.round(sub.fin)}s`,
      });

      // regiones de voz del sub-bloque (para saltar tramos mudos)
      const regiones = regionesDeVoz(
        ent.envDb,
        ent.hopSec,
        sub.inicio,
        sub.fin,
        ent.umbralDb
      );
      const durVoz = regiones.reduce((s, r) => s + (r.end - r.start), 0);
      if (durVoz < 0.4) continue; // sub-bloque sin voz (pausa larga)

      const pcm = await extraerPcm16k(
        ent.blob,
        sub.inicio,
        sub.fin,
        ent.claveFuente
      );
      if (pcm.length < SR_ASR * 0.3) continue;

      const texto = await llamarAsr(
        encodeWavMono16(pcm, SR_ASR),
        Math.max(0, tr.reintentos),
        tr.pausaEntreSolicitudesMs
      );
      solicitudes++;

      if (texto) {
        nuevos.push(
          ...alinearSubBloque(b, sub.inicio, sub.fin, texto, regiones, idBase)
        );
        idBase += nuevos.length;
      }

      // respiro entre solicitudes (respeta el rate-limit del servicio)
      await dormir(Math.max(300, tr.pausaEntreSolicitudesMs));
    }

    // persistir el bloque → reanudable tras recarga/cancelación
    segmentos.push(...nuevos);
    hechos.add(b);
    h.onBloque(b, nuevos, [...hechos].sort((x, y) => x - y), segmentos);
  }

  // ---------- escenas + energía ----------
  if (h.cancel()) throw new Error(CANCELADO);
  h.onProgreso({
    etapa: "analizando",
    bloque: totalBloques,
    totalBloques,
    subInicio: 0,
    subFin: 0,
    frases: segmentos.length,
    mensaje: "Construyendo escenas y analizando la tensión…",
  });

  const dbProm = dbMedioVoz(ent.envDb, ent.umbralDb);
  const escenas = construirEscenas({
    durationSec: ent.durationSec,
    escenaSeg: Math.max(5, cfg.escenaSegundos),
    segmentos,
    envDb: ent.envDb,
    hopSec: ent.hopSec,
    umbralDb: ent.umbralDb,
    dbProm,
  });

  // ---------- análisis de emoción por lotes ----------
  let motorEmocion = "energía de audio";
  const lote = Math.max(4, cfg.loteEmocion);
  for (let i = 0; i < escenas.length; i += lote) {
    if (h.cancel()) throw new Error(CANCELADO);
    const grupo = escenas.slice(i, i + lote);
    const respuesta = await analizarLote(
      grupo.map((e) => ({ id: e.id, texto: e.texto.slice(0, 600), energia: e.energia }))
    );
    if (respuesta) {
      motorEmocion = respuesta.motor;
      const mapa = new Map(respuesta.resultados.map((r) => [r.id, r]));
      for (const e of grupo) {
        const r = mapa.get(e.id);
        if (r && Number.isFinite(r.tension)) {
          e.tensionAuto = Math.round(r.tension);
          e.tension = e.tensionAuto;
          e.animo = r.animo;
          e.fuente = r.fuente;
          e.razon = r.razon;
        } else {
          e.tensionAuto = e.energia;
          e.tension = e.energia;
          e.fuente = "energia";
        }
      }
    } else {
      for (const e of grupo) {
        e.tensionAuto = e.energia;
        e.tension = e.energia;
        e.fuente = "energia";
      }
      avisos.push({
        nivel: "aviso",
        texto:
          "El motor de emoción no respondió para las escenas " +
          `${grupo[0].n}–${grupo[grupo.length - 1].n}; se usó energía de audio.`,
      });
    }
    await dormir(Math.max(300, tr.pausaEntreSolicitudesMs));
  }

  const caracteres = segmentos.reduce((s, x) => s + x.texto.length, 0);
  const resumen: Fase2Resumen = {
    motorTranscripcion: `ASR por bloques ≤ ${Math.round(tr.asrMaxSeg)} s (reanudable)`,
    motorEmocion,
    duracionSec: Math.round(ent.durationSec * 10) / 10,
    bloques: totalBloques,
    solicitudesAsr: solicitudes,
    segmentos: segmentos.length,
    escenas: escenas.length,
    caracteres,
  };

  h.onProgreso({
    etapa: "completado",
    bloque: totalBloques,
    totalBloques,
    subInicio: 0,
    subFin: 0,
    frases: segmentos.length,
    mensaje: "Análisis completado",
  });

  return { escenas, resumen, avisos };
}
