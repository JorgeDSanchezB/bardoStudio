# Estado actual — Bardo Studio

Última verificación completa: **Task 13-sfx-e2e3 (Entregas 2 y 3 del módulo SFX)** (E2E real con agent-browser, ver `worklog.md`). Estado general: **pipeline de 7 fases completo de punta a punta, incluida la pista «Efectos» en el editor, la exportación con stem de efectos y el módulo SFX terminado (3/3 entregas)**.

## Funcionalidad por fase

| Fase | Estado | Incluye |
|---|---|---|
| 1 · Ingestión | ✅ completa | WAV exacto + comprimidos, picos/envolvente, silencios ajustables en vivo, restauración tras recarga |
| 2 · Transcripción | ✅ completa | ASR reanudable por bloques, tensión+ánimo LLM, curva arrastrable, escenas y transcripción con CSV |
| 2.5 · SFX | ✅ **completa (3/3)** | detección por palabras clave (Worker, 35 categorías/381 palabras ES-EN editables), auditoría visual, biblioteca 37 CC0 + **importar SFX propios** (`/api/user-sfx`), persistencia total |
| 3 · Música | ✅ completa | 9 pistas CC0 + música propia (multi-archivo, metadatos, sugerencia de tensión), asignación auto/manual |
| 4 · Mezcla | ✅ completa | bloques/crossfades/ducking editables; **preview de la pista Efectos** + parámetros SFX (nivel, ducking, fundidos) |
| 5 · Editor Camtasia | ✅ completa | motor Web Audio en vivo (voz+música+**efectos con medidor propio**), cuchilla, mover, bordes con offset/bucle, silenciar, cambiar pista/archivo, **volumen por clip SFX**, añadir efecto en el cursor |
| 6 · Exportación | ✅ completa | render offline 6 canales: mezcla + stems voz/música/**efectos**, normalización, informe PDF con **sección «Efectos de sonido»** y auditoría 7 fases |

## Hitos recientes (ver `worklog.md`)

- **Task 16-rele (relé de IA para el escritorio)** — fix del fallo crítico de Fase 2 en la app instalada (1.0.0): la API de IA es interna (IPs privadas 172.25.x, verificada por DoH) e inalcanzable desde Windows. Solución (ADR-013): relé `POST /api/ia/<ruta>` (whitelist `chat/completions`+`audio/asr`, credenciales del servidor, guardas anti-bucle) + `/api/ia-config` (GET/POST/DELETE con prueba real de conexión que escribe `.z-ai-config` en el cwd del servidor = `%APPDATA%\Bardo Studio\app`, conservado entre versiones) + diálogo «Ajustes de IA» (web: URL copiable; escritorio: conectar/probar/desconectar) + alerta Fase 2 accionable + punto ámbar en el engranaje. Instalador 1.0.1 (`BardoStudio-Setup-1.0.1.exe`). Cadena completa verificada localmente simulando el escritorio (conectar → transcribir vía relé 320 ms → desconectar).
- **Task 15-exe (instalador Windows)** — `BardoStudio-Setup-1.0.0.exe` (NSIS 64 bits, ~151 MB, español) generado desde Linux sin wine: envoltorio Electron (`desktop/main.cjs`) que copia los recursos a `%APPDATA%\Bardo Studio\app`, sirve el Next standalone con el Node de Electron y abre la ventana; Python 3.12 embebido + ReportLab 4.4.9 para el PDF; icono del exe parcheado con LIEF (hook `afterPack`); parche del builder para extraer el desinstalador con `UninstallerReader` (JS puro). Distribución: botón «Instalador Windows» de la cabecera + `/BardoStudio-Setup-1.0.0.exe` + `LEEME-INSTALACION.txt` en `public/`. Reconstruible con `bash desktop/empaquetar.sh` (ADR-012).
- **Task 14-sfx-verif** — re-verificación E2E completa de las Entregas 2+3 del módulo SFX (ediciones reales de clips, medidor EFECTOS en vivo, render 4 archivos, PDF con sección SFX, persistencia).
- **Task 13-sfx-e2e3 (Entregas 2+3)** — módulo SFX terminado: pista «Efectos» en el timeline de Fases 4/5 (arrastre, cuchilla, recorte de bordes con `offsetOrigen` y bucle, silenciar, volumen por clip, cambio de archivo, añadir en el cursor, inspector propio); motor vivo con bus SFX y ducking configurable (½ profundidad); render offline a 6 canales con stem `efectos`; informe PDF con sección SFX y fila 2.5; importación de SFX propios (`db/user-sfx/`, ≤30 MB, nunca re-codificados); clips y ediciones persistidos (localStorage/.bsproj/servidor) y verificados tras recarga.
- **Task 12-sfx (Entrega 1)** — Fase 2.5: detección por palabras clave sobre la transcripción, biblioteca de 37 SFX CC0 sintetizados, auditoría visual completa, panel de palabras clave editable, stepper de 7 fases.
- **Task 7-mus** — música propia del usuario y proyectos estilo Camtasia (`.bsproj` portátil, re-adjunte, restauración total tras recarga).
- **Task 8-bordes** — manipulación de bordes estilo Camtasia en Fase 5: arrastre del borde para comprimir/alargar, `offsetOrigen` persistido (motor vivo, render offline, cuchilla con continuidad, inspector, trazabilidad).
- **Task 9-verif** — re-verificación E2E real de bordes (recorte 0→8.4, alargado 20→26, revelado 8.4→5 con offsets correctos) + reproducción + limpieza de estado.
- **Task 10-docs / 11** — documentación de agente y esta estructura `docs/`.

## Datos vivos en el servidor (no tocar en limpiezas)

- `db/user-music/` — pista propia del usuario: `propia-001-the-four-seasons-spr-09cf77` (*The Four Seasons, Spring Op-81 1-Allegro*, 218 s), usada por el auto-asignador del flujo dorado. **Conservar.**
- `db/user-sfx/` — efectos importados por el usuario (los de las pruebas E2E se limpian; la carpeta/manifiesto se recrean solos al importar).
- `db/proyectos/` — sin proyectos residuales (las pruebas se borran tras cada E2E).

Estado de primera visita: limpio (localStorage `bardo-project-v1` e IndexedDB `bardo-studio` vacíos tras la última limpieza).

## Limitaciones conocidas y notas operativas

- **429 del ASR**: gestionados con reintentos y pausas entre solicitudes; la transcripción es reanudable por bloque, así que un fallo puntual no pierde progreso.
- **Deshacer/rehacer granular**: no existe histórico por edición; la puerta ofrece «Descartar ediciones» (vuelve al arreglo automático de la Fase 4). Un undo granular sería una mejora natural.
- **Solapes de bloques/clips**: permitidos a propósito (como Camtasia, dos bloques suman); no hay «magnetismo» entre bordes.
- **Volumen por clip SFX**: plano dentro del clip (slider, grid 0.5 dB); no hay curva de automatización multipunto.
- **Audio tras recarga** (proyecto no guardado): el archivo original no está en memoria; la app muestra el panel «Re-adjuntar el audio original» y la edición sigue disponible. Los proyectos guardados en el servidor restauran el audio solos.
- **Prisma**: instalado y configurado (`prisma/schema.prisma` + `bun run db:push`) pero **sin uso activo** — la persistencia actual es localStorage/IndexedDB + archivos (ver ADR-001). Disponible si el proyecto crece hacia multiusuario o catálogos relacionales.
- **tests/**: carpeta reservada, sin pruebas (política actual: verificación E2E con agent-browser + lint + tsc).
- **Instalador de Windows** (ADR-012/013): sin firma digital (SmartScreen avisa; documentado), metadatos de versión del exe = Electron (el icono sí es propio), el Python embebido y el flujo de Windows se verifican por partes en Linux (no se puede ejecutar un .exe aquí). La Fase 2 del instalado se conecta por **relé** a la web del usuario («Ajustes IA», ADR-013): mientras la web esté accesible funciona; las credenciales del entorno nunca se empaquetan.

## Ideas futuras candidatas

- Undo/redo granular de ediciones (stack de `aplicarEdicionFase5`).
- Atajo de teclado para el recorte por bordes y asas más grandes en pantallas táctiles.
- Exportación por capítulos o marcadores; cola de render en background.
- Zoom/selección por arrastre en la regla (marquee) para cortes múltiples.
