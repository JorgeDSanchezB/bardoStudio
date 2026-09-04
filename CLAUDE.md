# CLAUDE.md — Bardo Studio

## Qué es este proyecto

**Bardo Studio**: app web (Next.js 16 App Router + TypeScript + shadcn/ui + Tailwind 4) que genera la banda sonora de narraciones de 3+ horas con pipeline auditable de **6 fases**, cada una con puerta de aprobación:

1. **Ingestión y análisis visual** — carga de audio, picos 50/s + envolvente RMS 100 ms, detección de silencios ajustable (dB + duración), timeline canvas virtualizado.
2. **Transcripción y curva de tensión** — ASR por sub-bloques ≤28 s (reanudable, persiste por bloque), análisis dramático LLM (ánimo + tensión 0–100 por escena de 20 s), curva corregible arrastrando puntos o numéricamente.
3. **Gestión de música** — biblioteca CC0 sintetizada (9 pistas, se generan como WAV al vuelo) + **música propia del usuario** (importar WAV/MP3/OGG/M4A ≤100 MB, metadatos editables, banda de tensión sugerida por RMS); asignación por escena automática (matching tensión/animo) o manual.
4. **Mezcla automática** — bloques de música por escena con crossfades y ducking (envolvente + silencios), parámetros editables, timeline de vista previa.
5. **Editor de mezcla tipo Camtasia** — motor Web Audio en vivo (voz + música), cuchilla, arrastrar para mover, **recorte/alargado por los bordes** (borde izq. = punto de entrada en la pista via `offsetOrigen`; borde der. = estirar con bucle automático), silenciar, cambiar pista, medidores.
6. **Exportación** — render offline (mezcla + stems voz/música) + informe PDF descargable.

Extras Camtasia: **proyectos guardables** (Guardar / Guardar como copia / Abrir / Eliminar en el servidor local), **.bsproj portátil** con análisis incrustado, re-adjunte de audio tras recargar, restauración total tras recarga.

## Comandos

- `bun run dev` — servidor de desarrollo en **puerto 3000** (ya corre en background; NUNCA `bun run build`).
- `bun run lint` — ESLint (mantener 0 errores).
- `bunx tsc --noEmit` — type-check (solo importan errores en `src/`; los de `examples/` y `skills/` son ruido preexistente).
- `bun run db:push` — aplicar `prisma/schema.prisma` a SQLite (aún no se usa; la persistencia actual es localStorage/IndexedDB + archivos en `db/`).
- Logs: `tail /home/z/my-project/dev.log` (leer solo lo más reciente).

## Estructura clave

```
src/app/page.tsx            — TODA la UI vive aquí (única ruta visible); orquesta las 6 fases
src/app/api/                — route handlers: config, transcribe, analyze-tension,
                              music-library, user-music(+track/[id]), proyectos(+[id]/audio/analysis), report
src/components/bardo/       — todos los componentes de fase: waveform-timeline, tension-graph,
                              escenas-table, transcript-view, fase{2,3,4,5,6}-seccion, mix-timeline,
                              transport-mezcla, nivel-metros, importar-musica, guardar-dialog,
                              proyectos-dialog, gate-fase, phase-stepper, approval-gate…
src/lib/audio/              — types, peaks, wav (parse RIFF exacto), decode (MP3/M4A/OGG),
                              wav-analyze + wav-worker, analyze, silence
src/lib/fase2/…fase6/       — tipos + lógica por fase; fase5/ediciones.ts (recortarBloque,
                              dividirBloque, moverBloque, limitesBorde, buclesDe), fase5/motor.ts
                              (MotorMezcla Web Audio), fase6/render.ts (offline)
src/lib/proyecto/           — pack (BSAN binario: peaks+envolvente) y tipos (.bsproj)
src/lib/server/             — archivos (Range 206), user-music (manifiesto JSON en db/user-music/)
src/store/project.ts        — zustand + persist(localStorage) + IndexedDB (picos/envolvente);
                              aplicarProyecto, materializarFase5, validarBloque (clampea offsetOrigen)
config/config.json          — Mapa de Atributos Dinámicos (pesos/umbrales editables)
public/demo/                — narracion-voz-demo.wav (176.8 s, recomendada) y demo sintética
scripts/generate-demo-audio.ts — WAV demo determinista (regenerable byte a byte)
db/                         — audio de proyectos + user-music (NUNCA re-codificar)
```

## Convenciones NO negociables

- **UI 100% en español**. Paleta **zinc/ámbar/esmeralda** — **PROHIBIDO azul/índigo**.
- Fondo del proyecto: blanco; la app dibuja su tema oscuro con wrapper propio.
- Footer sticky: `min-h-screen flex flex-col` + `mt-auto` en el footer (verificar gap 0 en página corta).
- Reglas set-state-in-effect de React 19: derivar en render, no setear en efectos (lint lo exige).
- shadcn/ui existente en `src/components/ui/` — no reimplementar; targets táctiles ≥44px; a11y (aria-label, roles, sr-only).
- `z-ai-web-dev-sdk` **solo en backend** (rutas /api), nunca en cliente.
- Fetch del cliente: **rutas relativas** (`/api/...`); puertos extra solo vía query `?XTransformPort=`.
- Canvas: dpr capado a 2, ResizeObserver, vista derivada en render, Pointer Events con `setPointerCapture` y `touch-none`.
- Ediciones de Fase 5: funciones puras en `src/lib/fase5/ediciones.ts`, grid de 0.1 s, `origen: "edicion"` para trazabilidad; clamps compartidos entre preview y commit (`limitesBorde`).
- La Fase 5 materializa bloques **solo tras aprobar la Fase 4** (guard en el efecto) — así los cambios manuales de pista de la Fase 3 sí llegan al editor y al render.

## Estado actual (post Task 9-verif)

Pipeline 6/6 fases completo y verificado E2E. Últimas features: importación de música propia, proyectos guardables/abribles (.bsproj + servidor) y **recorte/alargado de bordes estilo Camtasia** en Fase 5 (Task 8-bordes del worklog). Estado de primera visita limpio; la pista propia del usuario (*The Four Seasons*, `propia-001-…`) está en el servidor y **no debe borrarse** en limpiezas.

## Flujo de verificación obligatorio

Tras cualquier cambio: `bun run lint` + `bunx tsc --noEmit` + revisar `dev.log` + **agent-browser E2E real** (open → snapshot -c → click @refs → `agent-browser errors`/`console` vacíos) con el flujo dorado (demo voz → aprobar 1→4 → editar en 5). Limpiar localStorage (`bardo-project-v1`) + IndexedDB (`bardo-studio`) al terminar y confirmar primera visita limpia. Registro de trabajo en `worklog.md` (anexar, nunca sobrescribir).
