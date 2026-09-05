#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
#  Bardo Studio · empaquetado del instalador de Windows (.exe NSIS)
# ────────────────────────────────────────────────────────────────────
#  Uso:        bash desktop/empaquetar.sh
#  Produce:    desktop/dist no — se compila en /tmp; el instalador se
#              publica en public/BardoStudio-Setup-<versión>.exe
#              (descargable desde la propia web).
#
#  Qué hace (por pasos):
#    1. Copia el repositorio a una carpeta de trabajo (/tmp) SIN tocar el
#       proyecto en desarrollo ni el servidor de 3000.
#    2. Instala dependencias y compila Next.js en modo standalone.
#    3. Ensambla recursos-app: servidor + public + config + scripts.
#    4. Descarga Python embebido para Windows + ruedas de ReportLab
#       (PDF sin dependencias del sistema).
#    5. Instala Electron + electron-builder y prueba la app de verdad
#       (arranque + servidor + ventana) con xvfb en modo «smoke».
#    6. Empaqueta el instalador NSIS y lo copia a public/.
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP="$RAIZ/desktop"
ETAPA="${ETAPA:-/tmp/bardo-empaquetado}"
ELEC="$ETAPA/electron"
RECURSOS="$ELEC/recursos-app"

PYVER="3.12.10"          # Python embebido para Windows (PDF)
RLVER="4.4.9"            # ReportLab (misma versión que el entorno de desarrollo)

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -x "$RAIZ/bun.lock" ] || [ -f "$RAIZ/bun.lock" ] || true
[ -d "$RAIZ/src/app" ] || die "No encuentro el proyecto en $RAIZ"
command -v bun      >/dev/null || die "Falta bun"
command -v node     >/dev/null || die "Falta node"
command -v curl     >/dev/null || die "Falta curl"
command -v unzip    >/dev/null || die "Falta unzip"

# ── 1 · copia de trabajo ────────────────────────────────────────────
say "1/7 · Copiando el repositorio a $ETAPA (sin datos de usuario)"
rm -rf "$ETAPA"
mkdir -p "$ETAPA" "$ELEC"
cd "$RAIZ"
tar cf - \
  --exclude=./.git \
  --exclude=./node_modules \
  --exclude=./.next \
  --exclude=./db \
  --exclude=./dev.log \
  --exclude=./server.log \
  --exclude=./desktop/dist \
  --exclude=./desktop/recursos-app \
  --exclude='./public/BardoStudio-Setup-*.exe' \
  --exclude=./.z-ai-config \
  --exclude=./.env \
  . | (cd "$ETAPA" && tar xf -)

# ── 2 · build standalone ────────────────────────────────────────────
say "2/7 · Instalando dependencias y compilando Next.js standalone (en la copia)"
cd "$ETAPA"
bun install --quiet
bun run build
[ -f "$ETAPA/.next/standalone/server.js" ] || die "El build no produjo server.js"

# ── 3 · recursos de la app ──────────────────────────────────────────
say "3/7 · Ensamblando recursos-app (servidor + public + config + scripts)"
mkdir -p "$RECURSOS"
cp -r "$ETAPA/.next/standalone/." "$RECURSOS/"
# config/ y scripts/ se resuelven con process.cwd() en el servidor
cp -r "$ETAPA/config" "$RECURSOS/config"
cp -r "$ETAPA/scripts" "$RECURSOS/scripts"
find "$RECURSOS/scripts" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
# comprobaciones de sanidad
[ -f "$RECURSOS/server.js" ]                                   || die "falta server.js"
[ -f "$RECURSOS/public/demo/narracion-voz-demo.wav" ]          || die "falta la demo de voz"
[ -f "$RECURSOS/config/musica.json" ]                          || die "falta config/musica.json"
[ -f "$RECURSOS/scripts/report-pdf.py" ]                       || die "falta report-pdf.py"
[ -d "$RECURSOS/public/sfx" ]                                  || die "falta la biblioteca de SFX"
# nada de binarios linux innecesarios
rm -rf "$RECURSOS/node_modules/sharp" "$RECURSOS/node_modules/@img" 2>/dev/null || true
# Next standalone incluye el .env del entorno: fuera (higiene)
rm -f "$RECURSOS/.env"

# ── 4 · Python embebido para Windows (PDF) ──────────────────────────
say "4/7 · Descargando Python $PYVER embebido (win64) + ReportLab $RLVER"
curl -fL --retry 3 --retry-delay 2 \
  -o "$ETAPA/python-embed.zip" \
  "https://www.python.org/ftp/python/$PYVER/python-$PYVER-embed-amd64.zip"
mkdir -p "$RECURSOS/py-win"
unzip -qo "$ETAPA/python-embed.zip" -d "$RECURSOS/py-win"

mkdir -p "$ETAPA/wheels"
python3 -m pip download "reportlab==$RLVER" \
  --platform win_amd64 --implementation cp --python-version 3.12 \
  --only-binary=:all: -d "$ETAPA/wheels" \
  || die "No pude descargar las ruedas de ReportLab para Windows"

mkdir -p "$RECURSOS/py-win/Lib/site-packages"
for rueda in "$ETAPA"/wheels/*.whl; do
  unzip -qo "$rueda" -d "$RECURSOS/py-win/Lib/site-packages"
done
[ -d "$RECURSOS/py-win/Lib/site-packages/reportlab" ] || die "ReportLab no se descomprimió"
[ -d "$RECURSOS/py-win/Lib/site-packages/PIL" ]       || die "Pillow no se descomprimió"
[ -f "$RECURSOS/py-win/python.exe" ]                  || die "falta python.exe embebido"

# ._pth: activar site-packages dentro del embebido
cat > "$RECURSOS/py-win/python312._pth" <<EOF
python312.zip
.
Lib\\site-packages
import site
EOF

# ── 5 · carpeta electron ────────────────────────────────────────────
say "5/7 · Preparando el envoltorio Electron"
cp "$DESKTOP/main.cjs" \
   "$DESKTOP/package.json" \
   "$DESKTOP/electron-builder.cjs" \
   "$DESKTOP/parchar-exe.py" \
   "$DESKTOP/LICENCIA.txt" \
   "$DESKTOP/LEEME-INSTALACION.txt" \
   "$DESKTOP/icono.ico" \
   "$DESKTOP/icono-512.png" \
   "$ELEC/"
cp "$DESKTOP/LEEME-INSTALACION.txt" "$RECURSOS/LEEME-INSTALACION.txt"

# dependencias python del parche de iconos (LIEF reconstruye .rsrc sin wine)
python3 -c "import lief, pefile, PIL" 2>/dev/null || \
  python3 -m pip install --quiet lief pefile pillow

cd "$ELEC"
bun install --quiet
# bun no siempre ejecuta el postinstalado de electron
if [ ! -x node_modules/electron/dist/electron ]; then
  say "Descargando el binario de Electron…"
  ( cd node_modules/electron && node install.js )
fi
[ -x node_modules/electron/dist/electron ] || die "Electron no se descargó"

# parche: extraer el desinstalador sin wine en Linux (UninstallerReader es
# JS puro, como en la rama de macOS; wine no existe en este entorno)
python3 - <<'PYEOF'
ruta = "node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js"
src = open(ruta).read()
viejo = '''        else {
            const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
            await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
        }'''
nuevo = '''        else {
            // BARDO: extraer el desinstalador sin wine (lector PE en JS puro,
            // como en la rama de macOS Catalina). Si falla, se cae a wine.
            try {
                await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
            } catch (error) {
                const wineVm = new WineVm_1.WineVmManager((_a = packager.config.toolsets) === null || _a === void 0 ? void 0 : _a.wine);
                await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });
            }
        }'''
if nuevo.strip() not in src:
    assert viejo in src, "patrón NSIS/wine no encontrado en NsisTarget.js"
    open(ruta, "w").write(src.replace(viejo, nuevo))
    print("NsisTarget.js parcheado (desinstalador sin wine) ✓")
else:
    print("NsisTarget.js ya estaba parcheado ✓")
PYEOF

# ── 6 · prueba real de la app (arranque + servidor + ventana) ───────
say "6/7 · Prueba de humo real de la app: primer arranque y servidor"
if command -v Xvfb >/dev/null 2>&1; then
  # Xvfb persistente (xvfb-run exige xauth, que no siempre está)
  setsid Xvfb :77 -screen 0 1280x800x24 >/dev/null 2>&1 < /dev/null &
  XVFB_PID=$!
  sleep 1
  if DISPLAY=:77 timeout 240 node_modules/.bin/electron . --bardo-smoke --no-sandbox > "$ETAPA/smoke.log" 2>&1; then
    grep -q "BARDO_SMOKE_OK" "$ETAPA/smoke.log" || die "La prueba de humo no confirmó el arranque"
    say "Prueba de humo superada (primer arranque, copia de recursos, servidor y ventana OK)"
  else
    kill $XVFB_PID 2>/dev/null || true
    die "La prueba de humo de Electron falló (ver $ETAPA/smoke.log)"
  fi
  kill $XVFB_PID 2>/dev/null || true
else
  say "(sin Xvfb disponible: se omite la prueba de humo)"
fi

# ── 7 · instalador NSIS ─────────────────────────────────────────────
say "7/7 · Empaquetando el instalador NSIS para Windows"
bunx electron-builder --win nsis --x64 --config electron-builder.cjs
VERSION="$(node -p "require('$ELEC/package.json').version")"
EXE="$ELEC/dist/BardoStudio-Setup-$VERSION.exe"
[ -f "$EXE" ] || die "No se generó $EXE"

say "Publicando el instalador en public/"
mkdir -p "$RAIZ/public"
cp "$EXE" "$RAIZ/public/"
HASH="$(sha256sum "$RAIZ/public/BardoStudio-Setup-$VERSION.exe" | cut -d' ' -f1)"
TAM="$(du -h "$RAIZ/public/BardoStudio-Setup-$VERSION.exe" | cut -f1)"

echo
echo "╔══════════════════════════════════════════════════════════╗"
echo "  ✔ Instalador listo"
echo "  Archivo : public/BardoStudio-Setup-$VERSION.exe ($TAM)"
echo "  SHA256  : $HASH"
echo "  Descarga: <tu-preview>/BardoStudio-Setup-$VERSION.exe"
echo "╚══════════════════════════════════════════════════════════╝"
