/**
 * Genera public/demo/narracion-voz-demo.wav — narración D&D con VOZ real (TTS)
 * para demostrar la Fase 2 (transcripción ASR + análisis de tensión).
 *
 * 5 partes con tensión creciente (calma → misterio → tensión → batalla →
 * victoria) separadas por pausas de 3 s (silencios ≥ 2 s detectables en
 * Fase 1). Voz "chuichui" = mejor round-trip ASR en español de las probadas.
 *
 * Ejecutar:  bun run scripts/generate-demo-voz.ts
 * (usa z-ai-web-dev-sdk en backend + ffmpeg para normalizar y concatenar)
 */
import ZAI from "z-ai-web-dev-sdk";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(import.meta.dir, "..");
const TMP = path.join(RAIZ, "scripts", "tmp-tts", "build");
const SALIDA = path.join(RAIZ, "public", "demo", "narracion-voz-demo.wav");

const VOZ = "chuichui";
const VELOCIDAD = 0.95;
const SR = 24000;
const PAUSA_S = 3.2;

const PARTES: string[] = [
  // 1 · CALMA
  "La posada del Dragón Dormido huele a pan recién horneado. Los cinco aventureros comparten cena, vino y viejas historias junto al fuego. La nieve cae con suavidad fuera, y el posadero canta bajito mientras limpia las copas. Esta noche, por fin, el grupo descansa.",
  // 2 · MISTERIO
  "De pronto la puerta se abre sin hacer ruido. Un desconocido cubierto por una capa oscura deja un pergamino sobre la mesa y desaparece entre las sombras. Las runas del pergamino parecen moverse. La lámpara parpadea dos veces, y el aire de la sala se vuelve frío de golpe. Nadie se atreve a hablar.",
  // 3 · TENSIÓN
  "Algo cruje en el piso del pasillo. Pasos lentos se acercan a la habitación. El guerrero apaga la lámpara y todos contienen la respiración. Un golpe seco sacude la puerta. Luego otro. El pomo de latón gira lentamente, y una voz susurra un nombre que nadie recuerda haber oído antes.",
  // 4 · BATALLA
  "La puerta estalla en mil astillas! Tres goblins armados irrumpen rugiendo en la sala. La espada del guerrero choca contra el escudo enemigo y las chispas iluminan el combate. El mago invoca una llamarada que atraviesa la habitación. Las mesas vuelan, los gritos se mezclan, y la sangre mancha el suelo de madera.",
  // 5 · VICTORIA / CALMA FINAL
  "Cuando el último goblin cae, un gran silencio devuelve la posada al mundo. Los aventureros revisan sus heridas, respiran y por fin sonríen. Han ganado su primera batalla juntos. El fuego vuelve a crepitar, y con él nace la promesa de nuevas canciones. La noche, al fin, es de ellos.",
];

function ff(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { cwd: RAIZ });
}

async function main() {
  if (PARTES.some((p) => p.length > 1024)) {
    throw new Error("Una parte supera el límite de 1024 caracteres del TTS");
  }
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const zai = await ZAI.create();
  const normalizadas: string[] = [];

  for (let i = 0; i < PARTES.length; i++) {
    const t0 = Date.now();
    const resp = await zai.audio.tts.create({
      input: PARTES[i],
      voice: VOZ,
      speed: VELOCIDAD,
      response_format: "wav",
      stream: false,
    });
    const ab = await resp.arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(ab));
    const bruta = path.join(TMP, `parte-${i + 1}.wav`);
    writeFileSync(bruta, buffer);

    const norm = path.join(TMP, `n${i + 1}.wav`);
    ff(["-i", bruta, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", norm]);
    normalizadas.push(norm);
    console.log(
      `parte ${i + 1}/${PARTES.length}: ${buffer.length} bytes → ${(buffer.length / 1024).toFixed(0)} KB en ${Date.now() - t0} ms`
    );
  }

  // Pausa de silencio digital entre partes (detectable por la Fase 1)
  const sil = path.join(TMP, "sil.wav");
  ff([
    "-f", "lavfi", "-t", String(PAUSA_S),
    "-i", `anullsrc=r=${SR}:cl=mono`,
    "-c:a", "pcm_s16le", sil,
  ]);

  const entradas: string[] = [];
  normalizadas.forEach((f, i) => {
    entradas.push(f);
    if (i < normalizadas.length - 1) entradas.push(sil);
  });
  const lista = path.join(TMP, "list.txt");
  writeFileSync(lista, entradas.map((f) => `file '${f}'`).join("\n") + "\n");

  ff([
    "-f", "concat", "-safe", "0", "-i", lista,
    "-c:a", "pcm_s16le", SALIDA,
  ]);

  if (!existsSync(SALIDA)) throw new Error("No se generó la salida");
  const durStr = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SALIDA],
    { cwd: RAIZ }
  )
    .toString()
    .trim();
  const bytes = statSync(SALIDA).size;
  console.log(
    `OK ${path.relative(RAIZ, SALIDA)} · duración ${Number(durStr).toFixed(1)} s · ${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MB)`
  );
}

main().catch((e) => {
  console.error("FALLO:", e);
  process.exit(1);
});
