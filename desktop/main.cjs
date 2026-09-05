/**
 * Bardo Studio · versión de escritorio (Electron)
 * ─────────────────────────────────────────────────
 * Envoltorio de la app Next.js standalone:
 *
 *  1. Al arrancar copia los recursos empaquetados (servidor Next, public,
 *     config, scripts y el Python embebido del PDF) a una carpeta ESCRITURABLE
 *     del usuario (%APPDATA%\Bardo Studio\app en Windows), conservando los
 *     datos del usuario (db/, .z-ai-config) entre actualizaciones.
 *  2. Lanza el servidor con el Node integrado de Electron (puerto local
 *     libre, solo 127.0.0.1) y espera a que responda.
 *  3. Abre una ventana apuntando al servidor local.
 *
 * Sin dependencias externas: solo módulos de Node y la API de Electron.
 * El registro del servidor queda en <datos>/bardo-servidor.log.
 */
"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const net = require("net");
const http = require("http");
const fs = require("fs");
const path = require("path");

const NOMBRE = "Bardo Studio";
const APP_ID = "com.bardostudio.escritorio";

/** carpeta de datos del usuario (creada por Electron) */
const dirUsuario = () => app.getPath("userData");
/** carpeta ejecutable y escribible de la app (copia de los recursos) */
const dirApp = () => path.join(dirUsuario(), "app");
const rutaLog = () => path.join(dirUsuario(), "bardo-servidor.log");
const rutaVersion = () => path.join(dirUsuario(), "version-instalada.txt");

/** recursos empaquetados (instalador) o carpeta local (desarrollo) */
const origenRecursos = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "bardo-app")
    : path.join(__dirname, "recursos-app");

const rutaIcono = () =>
  app.isPackaged
    ? path.join(process.resourcesPath, "icono.ico")
    : path.join(__dirname, "icono.ico");

/** estado del envoltorio */
let ventana = null;
let hijo = null;
let puerto = 0;
let saliendo = false;

// ────────────────────────── utilidades ──────────────────────────

function log(msg) {
  try {
    fs.appendFileSync(rutaLog(), `\n[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    /* sin disco: ignorar */
  }
}

/** Lee un archivo .env opcional (CLAVE=VALOR, comentarios con #). */
function leerEnvUsuario() {
  const env = {};
  try {
    const texto = fs.readFileSync(path.join(dirUsuario(), "bardo.env"), "utf8");
    for (const linea of texto.split(/\r?\n/)) {
      const l = linea.trim();
      if (!l || l.startsWith("#")) continue;
      const i = l.indexOf("=");
      if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
  } catch {
    /* sin archivo: valores por defecto */
  }
  return env;
}

/**
 * Copia los recursos a la carpeta del usuario si la versión cambió.
 * Conserva entre versiones: db/ (música y SFX propios, proyectos) y
 * .z-ai-config (credenciales de IA del usuario, si las puso).
 */
function instalarRecursos() {
  const destino = dirApp();
  const instalada = fs.existsSync(rutaVersion())
    ? fs.readFileSync(rutaVersion(), "utf8").trim()
    : "";
  if (instalada === app.getVersion() && fs.existsSync(path.join(destino, "server.js"))) {
    return false; // ya está en la versión actual
  }
  const origen = origenRecursos();
  if (!fs.existsSync(path.join(origen, "server.js"))) {
    throw new Error(`No encontré los recursos de la app en «${origen}».`);
  }

  // respaldo temporal de los datos del usuario
  const respaldo = path.join(dirUsuario(), "respaldo-datos");
  fs.rmSync(respaldo, { recursive: true, force: true });
  fs.mkdirSync(respaldo, { recursive: true });
  const conservar = ["db", ".z-ai-config"];
  for (const nombre of conservar) {
    const ruta = path.join(destino, nombre);
    if (fs.existsSync(ruta)) {
      fs.renameSync(ruta, path.join(respaldo, nombre));
    }
  }

  fs.rmSync(destino, { recursive: true, force: true });
  fs.cpSync(origen, destino, {
    recursive: true,
    // nunca sobrescribir datos del usuario ni credenciales desde el paquete
    filter: (src) => {
      const rel = path.relative(origen, src);
      return (
        rel !== "db" &&
        !rel.startsWith(`db${path.sep}`) &&
        rel !== ".z-ai-config" &&
        rel !== "bardo.env"
      );
    },
  });

  // restaurar datos del usuario
  for (const nombre of conservar) {
    const bak = path.join(respaldo, nombre);
    if (fs.existsSync(bak)) {
      fs.cpSync(bak, path.join(destino, nombre), { recursive: true });
    }
  }
  // estructura de datos garantizada
  for (const d of ["user-music", "user-sfx", "proyectos"]) {
    fs.mkdirSync(path.join(destino, "db", d), { recursive: true });
  }
  fs.writeFileSync(rutaVersion(), app.getVersion(), "utf8");
  fs.rmSync(respaldo, { recursive: true, force: true });
  return true;
}

/** Busca un puerto TCP libre en 127.0.0.1. */
function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const srv = net.createServer();
    srv.on("error", rechazar);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolver(p));
    });
  });
}

/** Lanza el servidor Next.js standalone con el Node de Electron. */
function arrancarServidor(puertoDestino) {
  const rutaPy = path.join(dirApp(), "py-win", "python.exe");
  const stream = fs.createWriteStream(rutaLog(), { flags: "a" });
  stream.write(
    `\n==== ${new Date().toISOString()} · arranque v${app.getVersion()} · puerto ${puertoDestino} ====\n`
  );
  const env = {
    ...process.env,
    ...leerEnvUsuario(),
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(puertoDestino),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    // Python embebido para el informe PDF (si existe en el paquete)
    BARDO_PYTHON: fs.existsSync(rutaPy) ? rutaPy : "",
  };
  const proc = spawn(process.execPath, [path.join(dirApp(), "server.js")], {
    cwd: dirApp(), // rutas relativas: config/, scripts/, db/, public/
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  proc.stdout.pipe(stream);
  proc.stderr.pipe(stream);
  return proc;
}

/** Espera a que /api/config responda (primer arranque: copia ~200 MB). */
function esperarServidor(puertoDestino, msLimite) {
  const inicio = Date.now();
  return new Promise((resolver, rechazar) => {
    const reintentar = () => {
      if (Date.now() - inicio > msLimite) {
        rechazar(new Error("timeout"));
        return;
      }
      setTimeout(probar, 250);
    };
    const probar = () => {
      const req = http.get(
        { host: "127.0.0.1", port: puertoDestino, path: "/api/config", timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolver(true);
          else reintentar();
        }
      );
      req.on("error", reintentar);
      req.on("timeout", () => {
        req.destroy();
        reintentar();
      });
    };
    probar();
  });
}

function matarHijo() {
  if (!hijo || hijo.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      hijo.kill("SIGTERM");
    }
  } catch (e) {
    log(`no pude detener el servidor: ${e}`);
  }
}

function fatal(mensaje) {
  log(`FATAL: ${mensaje}`);
  try {
    dialog.showErrorBox(NOMBRE, `${mensaje}\n\nRegistro: ${rutaLog()}`);
  } catch {
    /* sin diálogo: continuar */
  }
  app.exit(1);
}

// ────────────────────────── vistas HTML ──────────────────────────

function urlDatos(html) {
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

const BASE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{background:#09090b;color:#a1a1aa;font:14px/1.6 ui-sans-serif,system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center}
  .caja{max-width:420px;text-align:center;padding:24px}
  h1{color:#fbbf24;font-size:20px;margin:0 0 6px;letter-spacing:.04em}
  p{margin:4px 0}
  .peque{font-size:11.5px;color:#52525b}
  .giro{width:34px;height:34px;margin:0 auto 18px;border-radius:50%;
        border:3px solid #27272a;border-top-color:#fbbf24;
        animation:g 1s linear infinite}
  @keyframes g{to{transform:rotate(360deg)}}
  code{color:#71717a;font-size:10.5px}
</style></head><body><div class="caja">`;

const htmlCargando =
  BASE_HTML +
  `<div class="giro" role="status" aria-label="Cargando"></div>
   <h1>Bardo Studio</h1>
   <p>Preparando el estudio…</p>
   <p class="peque">El primer arranque copia los recursos a tu carpeta de datos.<br>Puede tardar unos segundos.</p>
   </div></body></html>`;

const htmlError = (detalle) =>
  BASE_HTML +
  `<h1>No se pudo iniciar</h1>
   <p>${detalle}</p>
   <p class="peque">Revisa el registro en<br><code>bardo-servidor.log</code> junto a los datos de la app.</p>
   <p class="peque">Cierra y vuelve a abrir la aplicación para reintentar.</p>
   </div></body></html>`;

// ────────────────────────── ventana ──────────────────────────

function crearVentana() {
  const v = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#09090b",
    show: false,
    title: NOMBRE,
    icon: rutaIcono(),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  v.removeMenu();
  v.once("ready-to-show", () => v.show());

  // enlaces externos → navegador del sistema; nunca navegar fuera
  v.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${puerto}`)) {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  v.webContents.on("will-navigate", (evento, url) => {
    if (!url.startsWith(`http://127.0.0.1:${puerto}`) && !url.startsWith("data:")) {
      evento.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  return v;
}

// ────────────────────────── flujo principal ──────────────────────────

async function iniciar() {
  const smoke = process.argv.includes("--bardo-smoke");

  try {
    instalarRecursos();
  } catch (e) {
    fatal(`Error al preparar los recursos: ${e.message}`);
    return;
  }

  puerto = await puertoLibre();
  hijo = arrancarServidor(puerto);
  hijo.on("exit", (codigo) => {
    if (saliendo) return;
    log(`el servidor terminó inesperadamente (código ${codigo})`);
    if (ventana && !ventana.isDestroyed()) {
      ventana.loadURL(urlDatos(htmlError("El servidor interno se detuvo.")));
    }
  });

  ventana = crearVentana();
  await ventana.loadURL(urlDatos(htmlCargando));

  try {
    // primer arranque: margen amplio por la copia de recursos
    await esperarServidor(puerto, smoke ? 240000 : 180000);
  } catch {
    fatal(
      "El servidor interno no respondió a tiempo. " +
        "Vuelve a abrir la aplicación; si persiste, revisa el registro."
    );
    return;
  }

  try {
    await ventana.loadURL(`http://127.0.0.1:${puerto}/`);
  } catch (e) {
    fatal(`No se pudo cargar la interfaz: ${e.message}`);
    return;
  }

  if (smoke) {
    console.log(`BARDO_SMOKE_OK puerto=${puerto}`);
    setTimeout(() => app.exit(0), 250);
  }
}

// ────────────────────────── ciclo de vida de la app ──────────────────────────

app.setAppUserModelId(APP_ID);

const conCerrojo = app.requestSingleInstanceLock();
if (!conCerrojo) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (ventana) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });

  app.whenReady().then(() => void iniciar().catch((e) => fatal(e.message)));

  app.on("before-quit", () => {
    saliendo = true;
    matarHijo();
  });
  app.on("window-all-closed", () => {
    saliendo = true;
    app.quit();
  });
  app.on("quit", () => {
    saliendo = true;
    matarHijo();
  });
}
