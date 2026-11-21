/**
 * Bardo Studio — regenera catálogo + WAVs de efectos de sonido desde los MP3 reales.
 *
 * Fuente:   "Efectos de sonido/*.mp3"
 * Salida:   public/sfx/<slug>.wav   (mono, 22050 Hz, PCM 16-bit)
 *           config/sfx.json         (duraciones reales, nombres con acentos correctos)
 *
 * Uso:
 *   node scripts/regen-sfx-from-mp3.mjs            # solo repo
 *   node scripts/regen-sfx-from-mp3.mjs --deploy    # + instalación del usuario (Roaming/resources)
 */

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MP3_DIR = path.join(ROOT, "Efectos de sonido");
const OUT_DIR = path.join(ROOT, "public", "sfx");
const CONFIG_SFX = path.join(ROOT, "config", "sfx.json");
const CONFIG_KW = path.join(ROOT, "config", "sfx_config.json");

const DEPLOY = process.argv.includes("--deploy");
const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");

/** Entornos destino cuando se despliega (config + public/sfx). */
const ENVS = [
  {
    nombre: "repo",
    config: path.join(ROOT, "config"),
    sfx: OUT_DIR,
  },
  {
    nombre: "roaming",
    config: path.join(APPDATA, "Bardo Studio", "app", "config"),
    sfx: path.join(APPDATA, "Bardo Studio", "app", "public", "sfx"),
  },
  {
    nombre: "resources",
    config: path.join(LOCALAPPDATA, "Programs", "Bardo Studio", "resources", "bardo-app", "config"),
    sfx: path.join(LOCALAPPDATA, "Programs", "Bardo Studio", "resources", "bardo-app", "public", "sfx"),
  },
];

/** Nombres visibles con ortografía correcta (clave = slug). */
const NOMBRES = {
  "cristal-rompiendose": "Cristal rompiéndose",
  "destello-magico": "Destello mágico",
  "doble-whoosh": "Doble whoosh",
  explosion: "Explosión",
  "grunido-de-monstruo": "Gruñido de monstruo",
  "latido-del-corazon": "Latido del corazón",
  pajaros: "Pájaros",
  "rugido-de-dragon": "Rugido de dragón",
  "viento-invernal": "Viento invernal",
};

/** Alias de sfxId antiguos que pudieran quedar en sfx_config.json. */
const ALIAS_SFXID = {
  "campanada-grave": "campana-grave",
  campanada: "campana-grave",
  "glass-shattering": "cristal-rompiendose",
  "cristal": "cristal-rompiendose",
  "heart-beat": "latido-del-corazon",
  "heartbeat": "latido-del-corazon",
};

/** slug: minúsculas, sin acentos, espacios -> guiones. */
function slug(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Convierte un MP3 a WAV mono 22050 Hz PCM 16-bit. */
function convertir(mp3, wav) {
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", mp3, "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", wav],
    { stdio: "inherit" }
  );
}

/** Duración exacta leyendo el chunk `data` del WAV. */
function durSecWav(wav) {
  const b = readFileSync(wav);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`WAV inválido: ${wav}`);
  }
  let off = 12;
  let fmt = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === "fmt ") {
      fmt = {
        formato: b.readUInt16LE(off + 8),
        canales: b.readUInt16LE(off + 10),
        hz: b.readUInt32LE(off + 12),
        bits: b.readUInt16LE(off + 22),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error(`WAV sin fmt: ${wav}`);
      if (fmt.formato !== 1 || fmt.canales !== 1 || fmt.hz !== 22050 || fmt.bits !== 16) {
        throw new Error(`WAV con formato inesperado (${JSON.stringify(fmt)}): ${wav}`);
      }
      return Math.round((len / (fmt.hz * fmt.canales * (fmt.bits / 8))) * 100) / 100;
    }
    off += 8 + len + (len % 2);
  }
  throw new Error(`WAV sin chunk data: ${wav}`);
}

/** Repara texto UTF-8 que fue leído como latin1 (p. ej. "seÃ±al" -> "señal"). */
function repararMojibake(texto) {
  if (typeof texto !== "string") return texto;
  if (!/Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]/.test(texto)) return texto;
  try {
    return Buffer.from(texto, "latin1").toString("utf8");
  } catch {
    return texto;
  }
}

/** Escribe JSON UTF-8 sin BOM y con salto final. */
function escribirJson(destino, objeto) {
  writeFileSync(destino, JSON.stringify(objeto, null, 2) + "\n", "utf8");
}

// ---- 1. etiquetas heredadas del catálogo anterior (por id) ----
const etiquetasPorId = new Map();
if (existsSync(CONFIG_SFX)) {
  try {
    const previo = JSON.parse(readFileSync(CONFIG_SFX, "utf8"));
    for (const e of previo.sfx ?? []) {
      if (typeof e.id === "string" && Array.isArray(e.etiquetas)) {
        etiquetasPorId.set(e.id, e.etiquetas.filter((t) => typeof t === "string"));
      }
    }
  } catch {
    /* catálogo previo ilegible: se ignora */
  }
}

// ---- 2. MP3 -> WAV + catálogo ----
const mp3s = readdirSync(MP3_DIR)
  .filter((f) => f.toLowerCase().endsWith(".mp3"))
  .sort();

if (mp3s.length === 0) {
  console.error(`No hay MP3 en ${MP3_DIR}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const biblioteca = [];
const usados = new Set();

for (const f of mp3s) {
  const base = path.basename(f, path.extname(f));
  const id = slug(base);
  if (usados.has(id)) throw new Error(`Slug duplicado: ${id} (${f})`);
  usados.add(id);

  const wav = path.join(OUT_DIR, `${id}.wav`);
  convertir(path.join(MP3_DIR, f), wav);
  const durSec = durSecWav(wav);

  biblioteca.push({
    id,
    nombre: NOMBRES[id] ?? base,
    archivo: `/sfx/${id}.wav`,
    durSec,
    etiquetas: (etiquetasPorId.get(id) ?? []).map(repararMojibake),
  });
}

// normalizar mayúsculas residuales en el propio repo (Windows es case-insensitive,
// por eso se pasa por un nombre temporal antes de borrar el original)
for (const f of readdirSync(OUT_DIR)) {
  if (!f.toLowerCase().endsWith(".wav")) continue;
  const base = path.basename(f, path.extname(f));
  const esperado = `${slug(base)}.wav`;
  if (f === esperado) continue;
  const origen = path.join(OUT_DIR, f);
  const temporal = path.join(OUT_DIR, `${esperado}.tmp`);
  const destino = path.join(OUT_DIR, esperado);
  copyFileSync(origen, temporal);
  rmSync(origen, { force: true });
  copyFileSync(temporal, destino);
  rmSync(temporal, { force: true });
}

biblioteca.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

const catalogo = {
  version: 1,
  generadoPor: "scripts/regen-sfx-from-mp3.mjs (MP3 reales del usuario en Efectos de sonido/)",
  licencia: "CC0 · fuentes propias del usuario",
  sfx: biblioteca,
};

// ---- 3. validar/reparar sfxId de las categorías ----
const ids = new Set(biblioteca.map((b) => b.id));
const cfg = JSON.parse(readFileSync(CONFIG_KW, "utf8"));
const reparadas = [];
for (const c of cfg.categorias ?? []) {
  if (typeof c.sfxId !== "string" || ids.has(c.sfxId)) continue;
  const alias = ALIAS_SFXID[c.sfxId];
  if (alias && ids.has(alias)) {
    reparadas.push(`${c.sfxId} -> ${alias}`);
    c.sfxId = alias;
    continue;
  }
  // coincidencia difusa por prefijo/sufijo del slug
  const cand = biblioteca.find(
    (b) => b.id.startsWith(c.sfxId) || c.sfxId.startsWith(b.id.split("-")[0])
  );
  if (cand) {
    reparadas.push(`${c.sfxId} -> ${cand.id}`);
    c.sfxId = cand.id;
  }
}
const invalidas = (cfg.categorias ?? []).filter((c) => !ids.has(c.sfxId));

// ---- 4. escribir en repo ----
escribirJson(CONFIG_SFX, catalogo);
escribirJson(CONFIG_KW, cfg);

// ---- 5. desplegar a la instalación del usuario ----
if (DEPLOY) {
  for (const env of ENVS) {
    if (!existsSync(env.config)) continue;
    const esRepo = path.resolve(env.config) === path.resolve(path.join(ROOT, "config"));

    if (!esRepo) {
      // limpiar WAVs antiguos para no dejar restos con otro nombre
      if (existsSync(env.sfx)) {
        for (const f of readdirSync(env.sfx)) {
          if (f.toLowerCase().endsWith(".wav")) rmSync(path.join(env.sfx, f), { force: true });
        }
      }
      mkdirSync(env.sfx, { recursive: true });
      for (const b of biblioteca) {
        copyFileSync(path.join(OUT_DIR, `${b.id}.wav`), path.join(env.sfx, `${b.id}.wav`));
      }
    }

    const copias = [env.config, path.join(env.config, "config")];
    for (const dir of copias) {
      if (dir !== env.config && !existsSync(dir)) continue;
      mkdirSync(dir, { recursive: true });
      escribirJson(path.join(dir, "sfx.json"), catalogo);
      escribirJson(path.join(dir, "sfx_config.json"), cfg);
    }
    console.log(`desplegado: ${env.nombre}`);
  }
}

const bytes = biblioteca.reduce((n, b) => n + statSync(path.join(OUT_DIR, `${b.id}.wav`)).size, 0);
console.log(`SFX: ${biblioteca.length} archivos · ${(bytes / 1e6).toFixed(2)} MB · mono 22050 Hz PCM16`);
if (reparadas.length) console.log(`sfxId reparados: ${reparadas.join(", ")}`);
if (invalidas.length) {
  console.log(`ATENCIÓN: ${invalidas.length} categorías con sfxId inexistente:`);
  for (const c of invalidas) console.log(`  - ${c.categoria} -> ${c.sfxId}`);
} else {
  console.log("VERIFICACIÓN: todas las categorías apuntan a un efecto existente");
}
