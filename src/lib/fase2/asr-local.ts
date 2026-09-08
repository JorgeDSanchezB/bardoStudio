/**
 * Enlace TypeScript con el worker del motor de transcripción LOCAL
 * (public/workers/asr-local.js): Whisper dentro del navegador, gratis
 * y sin claves (ADR: alternativa 100 % local a la IA de la Fase 2).
 */

export type IdModeloLocal = "rapido" | "equilibrado" | "detallado";
export type DispositivoLocal = "webgpu" | "wasm";

export interface ModeloLocal {
  id: IdModeloLocal;
  etiqueta: string;
  /** repo del hub de HuggingFace (ONNX para transformers.js) */
  repo: string;
  /** tamaño aproximado de la descarga inicial (MB) */
  tamanioMb: number;
  nota: string;
}

export const MODELOS_LOCALES: readonly ModeloLocal[] = [
  {
    id: "rapido",
    etiqueta: "Rápido",
    repo: "Xenova/whisper-tiny",
    tamanioMb: 42,
    nota: "El más veloz; calidad básica (Whisper tiny).",
  },
  {
    id: "equilibrado",
    etiqueta: "Equilibrado",
    repo: "onnx-community/whisper-base",
    tamanioMb: 80,
    nota: "Recomendado: buena calidad y velocidad (Whisper base).",
  },
  {
    id: "detallado",
    etiqueta: "Detallado",
    repo: "Xenova/whisper-small",
    tamanioMb: 250,
    nota: "Máxima calidad (Whisper small); lento sin WebGPU.",
  },
] as const;

export const MODELO_LOCAL_DEFECTO: IdModeloLocal = "equilibrado";

export function esIdModeloLocal(v: unknown): v is IdModeloLocal {
  return v === "rapido" || v === "equilibrado" || v === "detallado";
}

export interface ProgresoDescarga {
  archivo: string;
  /** 0-100 */
  progreso: number;
  cargadoMb: number;
  totalMb: number;
}

interface MensajeWorker {
  tipo: "descarga" | "listo" | "resultado" | "error";
  id?: number;
  dispositivo?: DispositivoLocal;
  archivo?: string;
  progreso?: number;
  cargadoMb?: number;
  totalMb?: number;
  texto?: string;
  mensaje?: string;
}

/**
 * Motor ASR local. Un worker por instancia (reutilizado para todos los
 * sub-bloques de la Fase 2: el modelo queda cargado en memoria).
 */
export class AsrLocal {
  private worker: Worker | null = null;
  private secuencia = 0;
  private readonly pendientes = new Map<
    number,
    { resuelve: (v: string) => void; rechaza: (e: Error) => void }
  >();
  private dispositivo: DispositivoLocal = "wasm";
  private readonly repo: string;
  private readonly onDescarga: ((p: ProgresoDescarga) => void) | undefined;

  constructor(
    modelo: IdModeloLocal,
    onDescarga?: (p: ProgresoDescarga) => void
  ) {
    const def = MODELOS_LOCALES.find((m) => m.id === modelo);
    this.repo = def ? def.repo : MODELOS_LOCALES[1].repo;
    this.onDescarga = onDescarga;
  }

  /** WebGPU si el navegador lo declara; si no, WASM (CPU). */
  private detectarDispositivo(): DispositivoLocal {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      return "webgpu";
    }
    return "wasm";
  }

  private asegurarWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker("/workers/asr-local.js", { type: "module" });
    w.onmessage = (ev: MessageEvent<MensajeWorker>) => {
      const m = ev.data;
      if (!m || typeof m !== "object") return;
      if (m.tipo === "descarga") {
        this.onDescarga?.({
          archivo: m.archivo ?? "",
          progreso: m.progreso ?? 0,
          cargadoMb: m.cargadoMb ?? 0,
          totalMb: m.totalMb ?? 0,
        });
        return;
      }
      const pend = typeof m.id === "number" ? this.pendientes.get(m.id) : null;
      if (!pend) return;
      this.pendientes.delete(m.id);
      if (m.tipo === "resultado") {
        pend.resuelve(typeof m.texto === "string" ? m.texto : "");
      } else if (m.tipo === "error") {
        pend.rechaza(new Error(m.mensaje ?? "error del motor local"));
      } else if (m.tipo === "listo") {
        pend.resuelve("");
      }
    };
    w.onerror = () => {
      // worker roto: fallar todo lo pendiente con mensaje claro
      for (const [, pend] of this.pendientes) {
        pend.rechaza(
          new Error(
            "El motor local no arrancó (comprueba que el navegador permite Web Workers)."
          )
        );
      }
      this.pendientes.clear();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private enviar(mensaje: Record<string, unknown>): Promise<string> {
    const w = this.asegurarWorker();
    const id = ++this.secuencia;
    return new Promise<string>((resuelve, rechaza) => {
      this.pendientes.set(id, { resuelve, rechaza });
      w.postMessage({ ...mensaje, id });
    });
  }

  /**
   * Carga el modelo (con progreso de descarga). Si WebGPU falla al
   * inicializarse, reintenta automáticamente con WASM.
   */
  async preparar(): Promise<void> {
    this.dispositivo = this.detectarDispositivo();
    const errorAmable = (e: unknown) =>
      new Error(
        `No se pudo cargar el modelo local (${e instanceof Error ? e.message : String(e)}). ` +
          "La primera vez necesita internet para descargarlo (~decenas de MB); después queda cacheado."
      );
    try {
      await this.enviar({
        tipo: "preparar",
        modelo: this.repo,
        dispositivo: this.dispositivo,
      });
    } catch (e) {
      if (this.dispositivo !== "webgpu") throw errorAmable(e);
      // WebGPU prometido pero fallido (drivers, kernels…): caer a CPU (WASM)
      this.dispositivo = "wasm";
      this.cerrar();
      try {
        await this.enviar({
          tipo: "preparar",
          modelo: this.repo,
          dispositivo: this.dispositivo,
        });
      } catch (e2) {
        throw errorAmable(e2);
      }
    }
  }

  /** Transcribe un sub-bloque PCM 16 kHz mono (≤ ~30 s). */
  async transcribir(pcm: Float32Array): Promise<string> {
    if (this.dispositivo === "webgpu") {
      try {
        return await this.enviar({
          tipo: "transcribir",
          pcm,
          modelo: this.repo,
          dispositivo: this.dispositivo,
        });
      } catch {
        // falla en GPU (kernels no soportados): caer a WASM y reintentar
        this.dispositivo = "wasm";
        this.cerrar();
        await this.enviar({
          tipo: "preparar",
          modelo: this.repo,
          dispositivo: this.dispositivo,
        });
        return await this.enviar({
          tipo: "transcribir",
          pcm,
          modelo: this.repo,
          dispositivo: this.dispositivo,
        });
      }
    }
    return await this.enviar({
      tipo: "transcribir",
      pcm,
      modelo: this.repo,
      dispositivo: this.dispositivo,
    });
  }

  get dispositivoEfectivo(): DispositivoLocal {
    return this.dispositivo;
  }

  /** Termina el worker (el modelo deja de ocupar memoria). */
  cerrar(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, pend] of this.pendientes) {
      pend.rechaza(new Error("Motor local cerrado."));
    }
    this.pendientes.clear();
  }
}
