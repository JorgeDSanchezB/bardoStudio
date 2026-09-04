/// Analiza WAV por bloques dentro de un Web Worker (RAM acotada y UI fluida).
/// El Blob se transfiere por clonación estructurada; los arrays de cada bloque
/// se devuelven como transferibles para evitar copias.
import { analyzeWavInline, type WavEmitMessage } from "./wav-analyze";
import type { AnalysisOptions } from "./types";

interface WorkerSelf {
  postMessage: (m: WavEmitMessage, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent) => void) | null;
}

const sw = self as unknown as WorkerSelf;

interface StartMessage {
  file: Blob;
  opts: AnalysisOptions;
}

sw.onmessage = async (e: MessageEvent) => {
  const { file, opts } = e.data as StartMessage;
  try {
    const result = await analyzeWavInline(file, opts, (m) => {
      if (m.type === "chunk") {
        sw.postMessage(m, [
          m.stats.peaksMin.buffer,
          m.stats.peaksMax.buffer,
          m.stats.envDb.buffer,
        ]);
      } else {
        sw.postMessage(m);
      }
      return true;
    });
    sw.postMessage({ type: "done", result } satisfies WavEmitMessage);
  } catch (err) {
    sw.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies WavEmitMessage);
  }
};
