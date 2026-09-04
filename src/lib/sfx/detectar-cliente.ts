/**
 * Runner de la detección SFX: intenta el Web Worker (no bloquea la UI) y si
 * el entorno lo impide, cae a la ejecución inline (misma función pura).
 */

import { detectarSfx, type EntradaDeteccionSfx } from "./detectar";
import type { SfxConfig, SfxDef, SfxEvento, SfxResumen } from "./tipos";

interface Resultado {
  eventos: SfxEvento[];
  resumen: SfxResumen;
}

async function viaWorker(
  entrada: EntradaDeteccionSfx,
  config: SfxConfig,
  biblioteca: SfxDef[]
): Promise<Resultado | null> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./detectar-worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    return null; // entorno sin workers → inline
  }
  return await new Promise<Resultado | null>((resolve) => {
    const tiempoFuera = setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, 10000);
    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(tiempoFuera);
      worker.terminate();
      const m = e.data as {
        ok: boolean;
        error?: string;
        eventos?: SfxEvento[];
        resumen?: SfxResumen;
      };
      if (m?.ok && m.eventos && m.resumen) {
        resolve({ eventos: m.eventos, resumen: m.resumen });
      } else {
        console.warn("[sfx] worker falló:", m?.error);
        resolve(null);
      }
    };
    worker.onerror = () => {
      clearTimeout(tiempoFuera);
      worker.terminate();
      resolve(null);
    };
    worker.postMessage({ entrada, config, biblioteca });
  });
}

/** Detección por worker con respaldo inline (misma lógica pura). */
export async function detectarSfxFondo(
  entrada: EntradaDeteccionSfx,
  config: SfxConfig,
  biblioteca: SfxDef[]
): Promise<Resultado> {
  const porWorker = await viaWorker(entrada, config, biblioteca).catch(() => null);
  if (porWorker) return porWorker;
  return detectarSfx(entrada, config, biblioteca);
}
