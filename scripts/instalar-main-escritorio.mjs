/**
 * Instala/actualiza el envoltorio de escritorio (Electron) desde el repo.
 *
 * Copia `desktop/main.cjs` dentro de `resources/app.asar` de la instalación,
 * con respaldo previo y verificación de integridad del ASAR.
 *
 * Motivo: el envoltorio fija el PUERTO del servidor local. El navegador aísla
 * Cache Storage / localStorage / IndexedDB por origen, así que un puerto
 * aleatorio en cada arranque obliga a re-descargar el modelo de Whisper
 * (~118 MB) y pierde el estado local. Ver `desktop/LEEME.md`.
 *
 * Uso:
 *   node scripts/instalar-main-escritorio.mjs
 *   node scripts/instalar-main-escritorio.mjs "D:\\ruta\\a\\resources\\app.asar"
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MAIN = path.join(ROOT, "desktop", "main.cjs");

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const POR_DEFECTO = path.join(
  LOCALAPPDATA,
  "Programs",
  "Bardo Studio",
  "resources",
  "app.asar"
);

const destino = process.argv[2] ? path.resolve(process.argv[2]) : POR_DEFECTO;

if (!existsSync(destino)) {
  console.error(`No existe el ASAR: ${destino}`);
  process.exit(1);
}
if (!existsSync(MAIN)) {
  console.error(`No existe el envoltorio: ${MAIN}`);
  process.exit(1);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Lee un ASAR plano: cabecera pickle + ficheros concatenados. */
function leerAsar(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString("utf8"));
  const inicioDatos = 8 + buf.readUInt32LE(4);
  const extraer = (nombre) => {
    const meta = header.files[nombre];
    const desde = inicioDatos + Number(meta.offset);
    return buf.subarray(desde, desde + meta.size);
  };
  return { header, extraer };
}

/** Escribe un ASAR plano con los ficheros indicados (offsets + integridad). */
function escribirAsar(archivos) {
  let offset = 0;
  const files = {};
  const partes = [];
  for (const [nombre, buf] of archivos) {
    const hash = sha256(buf);
    files[nombre] = {
      size: buf.length,
      offset: String(offset),
      integrity: { algorithm: "SHA256", hash, blockSize: 4194304, blocks: [hash] },
    };
    offset += buf.length;
    partes.push(buf);
  }

  const json = Buffer.from(JSON.stringify({ files }), "utf8");
  const relleno = Buffer.alloc((4 - (json.length % 4)) % 4);
  const cuerpo = Buffer.concat([
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(json.length, 0);
      return b;
    })(),
    json,
    relleno,
  ]);
  const cabecera = Buffer.concat([
    (() => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(cuerpo.length, 0);
      return b;
    })(),
    cuerpo,
  ]);
  const prefijo = Buffer.alloc(8);
  prefijo.writeUInt32LE(4, 0);
  prefijo.writeUInt32LE(cabecera.length, 4);

  const salida = Buffer.concat([prefijo, cabecera, ...partes]);

  // verificación releyendo el resultado
  const { header, extraer } = leerAsar(salida);
  for (const nombre of Object.keys(files)) {
    if (sha256(extraer(nombre)) !== header.files[nombre].integrity.hash) {
      throw new Error(`integridad inválida al releer: ${nombre}`);
    }
  }
  return salida;
}

const original = readFileSync(destino);
const { extraer } = leerAsar(original);
const pkg = extraer("package.json");
const mainActual = extraer("main.cjs").toString("utf8");
const mainNuevo = readFileSync(MAIN);

if (!/const\s+PUERTO_PREFERIDO\s*=/.test(mainNuevo.toString("utf8"))) {
  console.error("desktop/main.cjs no define PUERTO_PREFERIDO: abortado");
  process.exit(1);
}

if (mainActual.includes("PUERTO_PREFERIDO") && mainActual === mainNuevo.toString("utf8")) {
  console.log("El ASAR ya tiene el envoltorio actualizado. Nada que hacer.");
  process.exit(0);
}

const respaldo = `${destino}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(destino, respaldo);

const nuevo = escribirAsar([
  ["main.cjs", mainNuevo],
  ["package.json", pkg],
]);
writeFileSync(destino, nuevo);

console.log(`respaldo: ${respaldo}`);
console.log(`ASAR actualizado: ${destino} (${original.length} -> ${nuevo.length} bytes)`);
console.log("Reinicia Bardo Studio para aplicar el puerto fijo.");
