# ADR-012: Instalador de escritorio para Windows (.exe NSIS)

## Contexto

Bardo Studio vivía solo como aplicación web local (puerto 3000 del entorno de
desarrollo). El usuario pidió un instalador `.exe` para Windows para usar la
aplicación como producto de escritorio, sin depender del navegador ni del
entorno de desarrollo.

Restricciones del entorno de empaquetado (Linux sin root, sin wine):

- `apt` no está disponible (sin sudo) → no se puede instalar wine.
- electron-builder necesita wine en Linux para firmar/editar exes
  (`signAndEditExecutable`) y para extraer el desinstalador NSIS.
- El proyecto en desarrollo NO puede tocarse (`bun run build` está prohibido
  sobre el repo vivo, el dev server de 3000 debe seguir funcionando).

## Decisión

Empaquetar la app como **Electron + instalador NSIS de 64 bits** construido
desde Linux, con estas piezas:

1. **`desktop/empaquetar.sh`**: pipeline reproducible (7 pasos) que trabaja
   en una copia en `/tmp` (el repo y el dev server quedan intactos):
   copia del repo → `bun run build` standalone → ensamblado de
   `recursos-app/` (servidor Next + public + config + scripts + Python
   embebido) → Electron → prueba de humo → NSIS.
2. **`desktop/main.cjs`**: envoltorio Electron sin dependencias. Al arrancar
   copia `resources/bardo-app` a `%APPDATA%\Bardo Studio\app` (carpeta
   escribible, conservando `db/` y `.z-ai-config` entre versiones), lanza el
   servidor Next standalone con el Node de Electron (`ELECTRON_RUN_AS_NODE=1`,
   puerto libre en 127.0.0.1, `BARDO_PYTHON` al Python embebido), espera
   `/api/config` y abre la ventana. Atajos/descargas/enlaces externos
   gestionados por Electron.
3. **Python embebido** (`python-3.12.10-embed-amd64.zip` + ruedas de
   ReportLab 4.4.9/Pillow para win64): el informe PDF de la Fase 6 funciona
   sin que el usuario instale nada. La ruta `/api/report` ahora es portátil
   (candidatos `BARDO_PYTHON` → venv del desarrollo → `python3`/`python`/`py`,
   script relativo a `process.cwd()`, temporal en `os.tmpdir()`).
4. **Sin wine, en tres frentes**:
   - `win.signAndEditExecutable: false` (no rcedit/signtool).
   - Icono del exe: hook `afterPack` → `desktop/parchar-exe.py` (LIEF puro)
     sustituye los RT_ICON (16/32/48 DIB + 256 PNG) del exe copiado y
     reconstruye `.rsrc` al escribir. Verificado extrayendo el icono y
     comparándolo visualmente (lira dorada).
   - Desinstalador NSIS: parche de 10 líneas en `NsisTarget.js` (solo en la
     copia de trabajo) para usar `UninstallerReader` (lector PE en JS puro,
     la misma rama que usa macOS) en vez de ejecutar el instalador con wine.
5. **Distribución**: el `.exe` se publica en `public/` y se descarga desde la
   propia web con el botón «Instalador Windows» de la cabecera
   (`/BardoStudio-Setup-1.0.0.exe`, ~151 MB, `Accept-Ranges` activo). El
   `LEEME-INSTALACION.txt` también se sirve en `public/`.

Detalles de la fuga de node_modules: electron-builder SIEMPRE excluye el
`node_modules` raíz de cada matcher de `extraResources`
(`app-builder-lib/out/util/filter.js`) — por eso `node_modules` del standalone
viaja como entrada propia con origen `recursos-app/node_modules`. El destino
de la app es `resources/bardo-app` (no `resources/app`) para no crear
ambigüedad de carga con el `app.asar` del envoltorio.

Credenciales de IA: NO se empaquetan (el `.z-ai-config` del entorno queda
fuertemente excluido del stage). El usuario puede poner el suyo en
`%APPDATA%\Bardo Studio\app\.z-ai-config` (o `%USERPROFILE%`) para habilitar
la Fase 2; sin él, la app lo demás funciona y el fallo se muestra en español.
Variables extra opcionales en `%APPDATA%\Bardo Studio\bardo.env`.

## Alternativas consideradas

- **Pedir al usuario que ejecute `bun dev`**: requiere instalar Bun/Node y
  clonar el repo; experiencia de usuario mala.
- **Instalar wine**: imposible sin root en este entorno.
- **Tauri**: necesita Rust + cadena de compilación cruzada a Windows, más
  pesado de mantener aquí.
- **Portable sin instalador** (.zip con electron descomprimido): válido pero
  el usuario pidió explícitamente un instalador .exe.
- **Empaquetar las credenciales del entorno**: descartado por seguridad
  (filtrado de secretos).

## Consecuencias

- **Positivas**: producto de escritorio real y autocontenido (Next + Python +
  bibliotecas de audio incluidas), instalador en español con página de
  licencia, actualizaciones que conservan los datos del usuario, ruta del PDF
  portátil también para el entorno de desarrollo, pipeline reproducible con
  un comando (`bash desktop/empaquetar.sh`).
- **Negativas/riesgos**: el instalador no está firmado (SmartScreen avisa;
  documentado en LICENCIA.txt y LEEME), los metadatos de versión del exe
  siguen siendo los de Electron (cosmético; el icono sí es el nuestro), el
  Python embebido y el flujo Windows no se pueden ejecutar en Linux (se
  verifican por partes: ruedas correctas, mismo ReportLab que en desarrollo,
  lógica del envoltorio probada con la prueba de humo real en Linux), y
  reconstruir en otra máquina requiere Python con `lief`/`pefile` para el
  parche del icono (si faltan, el exe conserva el icono de Electron y todo lo
  demás funciona).
- Verificación E2E hecha en Linux: prueba de humo de Electron con Xvfb
  (primer arranque, copia de recursos, servidor Next «Ready», ventana cargada
  → `BARDO_SMOKE_OK`), endpoints del standalone con curl (10 rutas 200, PDF
  200/45 KB), instalador con PE válido + firma NSIS + icono parcheado, y la
  web publica el botón y sirve el `.exe` con reanudación.
