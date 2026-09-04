/// Detección de SFX dentro de un Web Worker (la UI no se bloquea, requisito
/// del módulo: «usa Web Workers para el análisis de texto»). Recibe la
/// transcripción con timestamps + config + biblioteca, devuelve eventos.
import { detectarSfx } from "./detectar";
import type { SfxConfig, SfxDef } from "./tipos";
import type { EntradaDeteccionSfx } from "./detectar";

interface StartMessage {
  entrada: EntradaDeteccionSfx;
  config: SfxConfig;
  biblioteca: SfxDef[];
}

interface ResultMessage {
  ok: boolean;
  error?: string;
  eventos?: ReturnType<typeof detectarSfx>["eventos"];
  resumen?: ReturnType<typeof detectarSfx>["resumen"];
}

const sw = self as unknown as {
  postMessage: (m: ResultMessage) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};

sw.onmessage = (e: MessageEvent) => {
  const { entrada, config, biblioteca } = e.data as StartMessage;
  try {
    const { eventos, resumen } = detectarSfx(entrada, config, biblioteca);
    sw.postMessage({ ok: true, eventos, resumen });
  } catch (err) {
    sw.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
