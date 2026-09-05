/**
 * Bardo Studio · configuración de electron-builder (instalador NSIS Windows)
 * ─────────────────────────────────────────────────────────────────────────
 * En JS (no yml) porque usa el hook afterPack, que parchea el icono del
 * exe de la app sin necesitar Windows ni wine:
 *   · win.signAndEditExecutable: false → evita rcedit/signtool vía wine
 *   · afterPack → sustituye los RT_ICON del exe con parchar-exe.py (LIEF)
 *
 * Si python3/lief no está disponible en la máquina que empaqueta, el
 * parche se omite con aviso (el exe conservaría el icono de Electron; los
 * accesos directos y el instalador siempre usan icono.ico).
 */
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const exe = path.join(context.appOutDir, "Bardo Studio.exe");
  const origen = path.join(__dirname, "icono-512.png");
  try {
    execFileSync(
      "python3",
      [path.join(__dirname, "parchar-exe.py"), exe, origen],
      { stdio: "inherit" }
    );
  } catch (e) {
    console.warn(
      `[bardo] aviso: no pude parchear el icono del exe (${e.message}). ` +
        "El exe conservará el icono de Electron (el instalador, los accesos " +
        "directos y la ventana en ejecución sí usan el icono de Bardo Studio)."
    );
  }
}

module.exports = {
  appId: "com.bardostudio.escritorio",
  productName: "Bardo Studio",
  copyright: "Copyright © 2026 Bardo Studio",

  directories: {
    output: "dist",
    buildResources: ".",
  },

  // dentro del asar solo va el envoltorio; la app viaja en extraResources
  files: ["main.cjs", "package.json"],

  extraResources: [
    // la app Next.js standalone + public + config + scripts + python embebido
    // (destino «bardo-app» para no chocar con el app.asar del envoltorio).
    // OJO: electron-builder siempre excluye el node_modules RAÍZ de cada
    // matcher (app-builder-lib/out/util/filter.js), así que se añade como
    // entrada propia con su propio origen.
    { from: "recursos-app", to: "bardo-app", filter: ["**/*", "!**/.env"] },
    { from: "recursos-app/node_modules", to: "bardo-app/node_modules" },
    { from: "LEEME-INSTALACION.txt", to: "LEEME-INSTALACION.txt" },
    { from: "icono.ico", to: "icono.ico" },
  ],

  asar: true,
  compression: "maximum",

  win: {
    icon: "icono.ico",
    // el icono/versión del exe lo parchea afterPack (sin wine)
    signAndEditExecutable: false,
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "BardoStudio-Setup-${version}.${ext}",
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Bardo Studio",
    license: "LICENCIA.txt",
    // 3082 = es_ES · asistente del instalador en español
    language: 3082,
    installerLanguages: ["es_ES"],
    deleteAppDataOnUninstall: false,
  },

  afterPack,
};
