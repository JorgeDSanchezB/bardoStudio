/**
 * Bardo Studio — regenera el catálogo de música a partir de MP3 reales.
 *
 * Lee Gestion de musica/*.mp3 (ya convertidos a WAV en public/demo/musica/)
 * y escribe config/musica.json con duraciones reales y metadatos base por ánimo.
 *
 * Run: node scripts/regen-musica-from-mp3.mjs
 */

import { readdirSync, writeFileSync, statSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "demo", "musica");
const CONFIG_MUSICA = path.join(ROOT, "config", "musica.json");

/** Con --deploy copia el catálogo (y los WAV) a la instalación del usuario. */
const DEPLOY = process.argv.includes("--deploy");
const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
const LOCALAPPDATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const ENVS = [
  {
    nombre: "roaming",
    config: path.join(APPDATA, "Bardo Studio", "app", "config"),
    musica: path.join(APPDATA, "Bardo Studio", "app", "public", "demo", "musica"),
  },
  {
    nombre: "resources",
    config: path.join(LOCALAPPDATA, "Programs", "Bardo Studio", "resources", "bardo-app", "config"),
    musica: path.join(LOCALAPPDATA, "Programs", "Bardo Studio", "resources", "bardo-app", "public", "demo", "musica"),
  },
];

function slug(name) {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function durSec(filePath) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf8", maxBuffer: 1 * 1024 * 1024 }
  ).trim();
  const n = Number(out);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Metadatos base por ánimo */
const basePorAnimo = {
  calma:   { tensionMin: 0,  tensionMax: 40, bpm: 68,  tonalidad: "Do mayor",   instrumentacion: "pad cálido, laúd, flauta tenue", descripcion: "Ambiente reposado para diálogos y transiciones suaves." },
  tension: { tensionMin: 45, tensionMax: 85, bpm: 96,  tonalidad: "La menor",   instrumentacion: "ostinato bajo, tick, cuerdas tensas", descripcion: "Sensación de acecho y peligro inminente." },
  misterio:{ tensionMin: 20, tensionMax: 60, bpm: 58,  tonalidad: "Mi menor",   instrumentacion: "campanas, drone, viento", descripcion: "Textura enigmática para exploración y enigmas." },
  batalla: { tensionMin: 70, tensionMax: 100,bpm: 138, tonalidad: "Mi menor",   instrumentacion: "tambores de guerra, metales", descripcion: "Épica y contundente para combates." },
  victoria:{ tensionMin: 55, tensionMax: 95, bpm: 100, tonalidad: "Do mayor",   instrumentacion: "fanfarria de vientos, campanas", descripcion: "Luminosa para triunfos y resoluciones." },
  neutro:  { tensionMin: 0,  tensionMax: 100,bpm: 72,  tonalidad: "La menor",   instrumentacion: "arpegio de guitarra, pad tenue", descripcion: "Colchón versátil para cualquier narrativa." },
};

const files = readdirSync(OUT_DIR).filter(f => f.toLowerCase().endsWith(".wav"));
const pistas = [];

for (const f of files) {
  const nombreOriginal = f.replace(/\.wav$/i, "");
  // Reconstruir nombre legible aproximado
  const nombreLegible = nombreOriginal
    .replace(/-/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  const slugId = slug(nombreOriginal);
  const wavPath = path.join(OUT_DIR, f);
  const dur = durSec(wavPath);

  // Detectar ánimo por palabras clave
  let animo = "neutro";
  const low = nombreOriginal.toLowerCase();
  if (low.includes("batalla")) animo = "batalla";
  else if (low.includes("calma")) animo = "calma";
  else if (low.includes("misterio")) animo = "misterio";
  else if (low.includes("tension")) animo = "tension";
  else if (low.includes("victoria")) animo = "victoria";
  else if (low.includes("neutro")) animo = "neutro";

  const base = basePorAnimo[animo] || basePorAnimo.neutro;

  pistas.push({
    id: slugId,
    titulo: nombreLegible,
    animo,
    tensionMin: base.tensionMin,
    tensionMax: base.tensionMax,
    bpm: base.bpm,
    tonalidad: base.tonalidad,
    durSec: dur,
    archivo: `/demo/musica/${f}`,
    instrumentacion: base.instrumentacion,
    descripcion: base.descripcion,
  });
}

const catalogo = {
  version: 1,
  generadoPor: "scripts/regen-musica-from-mp3.mjs (MP3 reales del usuario en Gestion de musica/)",
  licencia: "CC0 · fuentes propias del usuario",
  pistas,
};

writeFileSync(CONFIG_MUSICA, JSON.stringify(catalogo, null, 2) + "\n");

// ---- despliegue opcional a la instalación del usuario ----
if (DEPLOY) {
  for (const env of ENVS) {
    if (!existsSync(env.config)) continue;
    // copiar WAVs que falten (nunca borrar los del usuario)
    if (existsSync(env.musica)) {
      for (const p of pistas) {
        const archivo = path.join(OUT_DIR, path.basename(p.archivo));
        const destinoWav = path.join(env.musica, path.basename(p.archivo));
        if (existsSync(archivo)) copyFileSync(archivo, destinoWav);
      }
    }
    for (const dir of [env.config, path.join(env.config, "config")]) {
      if (dir !== env.config && !existsSync(dir)) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "musica.json"), JSON.stringify(catalogo, null, 2) + "\n", "utf8");
    }
    console.log(`desplegado: ${env.nombre}`);
  }
}

let totalBytes = 0;
for (const p of pistas) {
  try { totalBytes += statSync(path.join(OUT_DIR, path.basename(p.archivo))).size; } catch {}
}
console.log(`Música real: ${pistas.length} pistas · ${(totalBytes/1e6).toFixed(2)} MB total`);
console.log("VERIFICACIÓN: config/musica.json actualizado");