# Envoltorio de escritorio (Electron)

`main.cjs` es el proceso principal de **Bardo Studio** para Windows: copia los
recursos empaquetados a `%APPDATA%\Bardo Studio\app`, arranca el servidor
Next.js standalone con el Node de Electron y abre la ventana apuntando a
`http://127.0.0.1:<puerto>`.

## Regla que no se puede romper: puerto fijo

El navegador aísla **Cache Storage, localStorage e IndexedDB por origen**
(`http://127.0.0.1:<puerto>`). Si el puerto cambia en cada arranque:

- el modelo local de Whisper (transformers.js, ~118 MB) se vuelve a descargar
  **siempre**, porque la caché vive bajo otro origen;
- se pierde el estado del navegador entre sesiones (proyecto en curso,
  preferencias del store persistido);
- se acumulan copias del modelo (se observaron 6 orígenes distintos y 1,2 GB
  en `%APPDATA%\Bardo Studio\Service Worker\CacheStorage`).

Por eso `puertoLibre()` reserva siempre `PUERTO_PREFERIDO = 60461`; si está ocupado
reintenta hasta 6 s (cierre/reapertura rápida) y solo entonces cae a un puerto
efímero. **No volver a `listen(0)`.**

`60461` no es arbitrario: coincide con el último origen usado por la versión
instalada, de modo que la caché del modelo ya descargada se reutiliza sin una
descarga extra.

## Instalación / actualización en un equipo

```bash
node scripts/instalar-main-escritorio.mjs
# o indicando el ASAR:
node scripts/instalar-main-escritorio.mjs "C:\ruta\resources\app.asar"
```

El script respalda el ASAR (`app.asar.bak-<fecha>`), escribe `main.cjs` y
`package.json`, y verifica la integridad SHA-256 de ambos al releer. Es
idempotente: si el ASAR ya está al día, no hace nada.

## Estructura del ASAR

`resources/app.asar` contiene solo dos entradas:

- `main.cjs` — este envoltorio;
- `package.json` — nombre, versión y `main`.

Los recursos de la aplicación (servidor Next, `public/`, `config/`, `scripts/`,
Python embebido) viven en `resources/bardo-app/` y se copian a la carpeta de
datos del usuario en cada cambio de versión, conservando `db/`,
`.z-ai-config` y `.bardo-ia.json`.
