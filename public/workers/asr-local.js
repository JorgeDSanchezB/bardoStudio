/**
 * Motor de transcripción LOCAL y GRATUITO de Bardo Studio (Fase 2).
 * ────────────────────────────────────────────────────────────────────
 * Ejecuta Whisper (transformers.js) DENTRO del navegador del usuario,
 * en un Web Worker para no bloquear la interfaz:
 *
 *   · Sin claves, sin cuentas, sin coste, sin servidores ajenos.
 *   · El audio NUNCA sale del equipo del usuario.
 *   · La primera vez se descarga el modelo desde el hub público de
 *     HuggingFace (jsdelivr para la librería); después queda cacheado
 *     por el navegador (Cache Storage) y funciona también sin red.
 *   · WebGPU si el navegador lo soporta (muy rápido); si no, WASM.
 *
 * Protocolo de mensajes:
 *   → { tipo: "preparar",    modelo, dispositivo }
 *     ← { tipo: "descarga",  archivo, progreso, cargadoMb, totalMb }  (0..n)
 *     ← { tipo: "listo",     dispositivo }
 *   → { tipo: "transcribir", id, pcm: Float32Array (16 kHz mono), modelo, dispositivo }
 *     ← { tipo: "resultado", id, texto }
 *   ← { tipo: "error",       id?, mensaje }  (para cualquier fallo)
 */
"use strict";

const VERSION_TRANSFORMERS = "3.8.1";
const URL_TRANSFORMERS =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@" +
  VERSION_TRANSFORMERS;

/** pipeline cacheada por (modelo, dispositivo) */
let cache = null; // { modelo, dispositivo, pipe }
let modulo = null;

async function obtenerModulo() {
  if (!modulo) {
    // import dinámico desde CDN (módulo ES): la librería y su
    // onnxruntime-web (wasm/webgpu) se resuelven desde el mismo CDN.
    modulo = await import(URL_TRANSFORMERS);
  }
  return modulo;
}

async function obtenerPipeline(modelo, dispositivo) {
  if (
    cache &&
    cache.modelo === modelo &&
    cache.dispositivo === dispositivo
  ) {
    return cache.pipe;
  }
  const { pipeline, env } = await obtenerModulo();
  // los modelos SIEMPRE desde el hub de HuggingFace (nunca ./models local)
  env.allowLocalModels = false;

  // dtype por dispositivo:
  //  · webgpu → encoder fp32 + decoder q4 (combinación del ejemplo oficial
  //    de Whisper WebGPU; los kernels cuantizados q8 no siempre existen en GPU)
  //  · wasm   → q8 uniforme (rápido en CPU, ~4× más pequeño que fp32)
  const dtype =
    dispositivo === "webgpu"
      ? { encoder_model: "fp32", decoder_model_merged: "q4" }
      : "q8";

  cache = {
    modelo,
    dispositivo,
    pipe: await pipeline("automatic-speech-recognition", modelo, {
      device: dispositivo,
      dtype,
      progress_callback: (p) => {
        if (
          p &&
          p.status === "progress" &&
          typeof p.total === "number" &&
          p.total > 0
        ) {
          self.postMessage({
            tipo: "descarga",
            archivo: typeof p.file === "string" ? p.file : "",
            progreso: Math.round((p.loaded / p.total) * 100),
            cargadoMb: +(p.loaded / 1048576).toFixed(1),
            totalMb: +(p.total / 1048576).toFixed(1),
          });
        }
      },
    }),
  };
  return cache.pipe;
}

self.onmessage = async (evento) => {
  const m = evento.data;
  if (!m || typeof m !== "object") return;
  try {
    if (m.tipo === "preparar") {
      await obtenerPipeline(m.modelo, m.dispositivo);
      // «listo» DEBE devolver el id: el cliente resuelve la promesa con él
      self.postMessage({
        tipo: "listo",
        id: m.id,
        dispositivo: m.dispositivo,
      });
      return;
    }
    if (m.tipo === "transcribir") {
      if (!(m.pcm instanceof Float32Array) || m.pcm.length === 0) {
        self.postMessage({
          tipo: "error",
          id: m.id,
          mensaje: "PCM inválido (se esperaba Float32Array 16 kHz mono).",
        });
        return;
      }
      const pipe = await obtenerPipeline(m.modelo, m.dispositivo);
      // sub-bloques ≤ ~29,5 s: una sola ventana de Whisper, en español
      const salida = await pipe(m.pcm, {
        language: "es",
        task: "transcribe",
      });
      self.postMessage({
        tipo: "resultado",
        id: m.id,
        texto:
          salida && typeof salida.text === "string" ? salida.text.trim() : "",
      });
      return;
    }
  } catch (err) {
    self.postMessage({
      tipo: "error",
      id: typeof m.id === "number" ? m.id : undefined,
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
};
