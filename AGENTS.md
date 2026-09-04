# AGENTS.md — Bardo Studio

> Guía de agente para contribuir a este repositorio. Fuente de verdad espejada en `CLAUDE.md`; mantener ambas sincronizadas al cambiar arquitectura o convenciones. Documentación completa en `docs/` (arquitectura, estado, ADRs); bitácora detallada de cada entrega en `worklog.md` (anexar, nunca sobrescribir).

## Qué es

**Bardo Studio** — app web (Next.js 16 App Router, TypeScript 5, Tailwind 4 + shadcn/ui) que musicaliza narraciones largas (3+ h) mediante un pipeline auditable de 6 fases con puertas de aprobación: (1) ingestión/análisis de audio en el navegador, (2) transcripción ASR reanudable + curva de tensión LLM corregible, (3) biblioteca CC0 sintetizada + música propia importada + asignación por escena, (4) mezcla automática con ducking/crossfades, (5) editor tipo Camtasia en Web Audio (cuchilla, mover, **recorte/alargado por bordes**, silenciar, cambiar pista), (6) render offline + stems + informe PDF. Persistencia estilo Camtasia: proyectos guardables en el servidor, `.bsproj` portátil, re-adjunte de audio y restauración tras recarga.

## Comandos y entorno

| Comando | Uso |
|---|---|
| `bun run dev` | Dev server en **puerto 3000** (ya corre en background; no duplicar instancias; **prohibido `bun run build`**) |
| `bun run lint` | ESLint — mantener 0 errores |
| `bunx tsc --noEmit` | Type-check — ignorar errores preexistentes de `examples/` y `skills/` |
| `bun run db:push` | Aplicar `prisma/schema.prisma` (SQLite) |
| `tail /home/z/my-project/dev.log` | Solo lo más reciente |

## Mapa del código

- `src/app/page.tsx` — **única ruta visible**; orquesta las 6 fases y la cabecera Proyectos/Guardar.
- `src/app/api/` — handlers: `config`, `transcribe`, `analyze-tension`, `music-library`, `user-music` (+`track/[id]`), `proyectos` (+`[id]`, `/audio`, `/analysis`), `report`.
- `src/components/bardo/` — componentes de fase (waveform-timeline, tension-graph, escenas-table, transcript-view, fase2-6-seccion, mix-timeline, transport-mezcla, nivel-metros, importar-musica, guardar-dialog, proyectos-dialog, gate-fase, phase-stepper…).
- `src/lib/audio/` — picos/envolvente, parse WAV exacto, decode de comprimidos, worker, detección de silencios.
- `src/lib/fase2/` … `src/lib/fase6/` — lógica por fase. Destacan `fase5/ediciones.ts` (ediciones puras: `recortarBloque`, `dividirBloque`, `moverBloque`, `limitesBorde`, `buclesDe`), `fase5/motor.ts` (MotorMezcla Web Audio) y `fase6/render.ts` (render offline).
- `src/lib/proyecto/` — pack binario BSAN + tipos `.bsproj`.
- `src/lib/server/` — servir archivos con Range 206 y manifiesto de música propia.
- `src/store/project.ts` — zustand + persist (localStorage `bardo-project-v1`, IndexedDB `bardo-studio`).
- `config/config.json` — pesos/umbrales editables en caliente.
- `public/demo/` — WAVs demo (voz: `narracion-voz-demo.wav`, 176.8 s; sintética: 366 s).
- `db/` — audio de proyectos y `user-music/` (archivos originales del usuario; **nunca re-codificar ni borrar**).

## Reglas del proyecto

1. **Español** en toda la UI; paleta **zinc/ámbar/esmeralda**, **sin azul/índigo**.
2. Footer sticky (`min-h-screen flex flex-col` + `mt-auto`); verificar gap 0 con contenido corto.
3. React 19: nada de `setState` dentro de efectos render-dérmicos — derivar en render (lint lo bloquea).
4. Reusar shadcn/ui de `src/components/ui/`; targets táctiles ≥44px; a11y (aria-label, roles, tabIndex, Enter/Space).
5. `z-ai-web-dev-sdk` solo en backend; fetches relativos (`/api/...`); puertos extra solo con `?XTransformPort=`.
6. Canvas: dpr ≤2, ResizeObserver, zoom anclado con rueda, Pointer Events + `setPointerCapture` + `touch-none`.
7. Ediciones de Fase 5: funciones puras, grid 0.1 s, `origen: "edicion"`, mismos clamps en preview y commit (`limitesBorde`).
8. La Fase 5 materializa bloques desde la mezcla **aprobada** de la Fase 4 (guard del efecto) — no cambiar sin motivo.
9. No escribir tests salvo petición expresa; no crear rutas nuevas fuera de `/`.
10. Toda entrega se registra en `worklog.md` (sección `--- Task ID / Agent / Task / Work Log / Stage Summary`).

## Verificación tras cada cambio

`bun run lint` → `bunx tsc --noEmit` → revisar `dev.log` → **E2E con agent-browser** (open / snapshot -c / click @refs / `errors` y `console` vacíos) siguiendo el flujo dorado: demo con voz → aprobar Fases 1–4 → editar en Fase 5 (incl. drag real de bordes sobre el canvas) → aprobar/render si aplica. Al terminar: limpiar localStorage + IndexedDB y confirmar la primera visita limpia. La pista propia del usuario (`propia-001-…`) debe conservarse.

## Estado actual

Pipeline 6/6 completo y verificado. Últimos hitos: música propia (Fase 3), proyectos guardables/abribles con `.bsproj` (estilo Camtasia) y **recorte/alargado de bordes por arrastre en Fase 5** con `offsetOrigen` persistido (motor en vivo + render offline + cuchilla con continuidad). Ver detalle y E2E en `worklog.md` (Tasks 7-mus, 8-bordes, 9-verif) y el resumen por fase en `docs/current-state.md`.

## Mapa de documentación

```
README.md                    — visión general del producto y cómo empezar
CLAUDE.md / AGENTS.md        — guías de agente (espejos; comandos, reglas, verificación)
docs/architecture.md         — arquitectura: pipeline, módulos, API, modelo de datos, persistencia
docs/current-state.md        — estado actual por fase, hitos, limitaciones, datos vivos
docs/decisions/001…010-*.md — ADRs: database, authentication, audio-processing,
                              canvas-timeline, web-audio-engine, resumable-transcription,
                              edge-trim-offset, project-persistence, user-music,
                              ui-language-palette
worklog.md                   — bitácora acumulativa por Task ID (historia primaria)
```

Reglas de la documentación: nuevas decisiones → nuevo ADR numerado en `docs/decisions/` (Contexto/Decisión/Alternativas/Consecuencias); cambios de arquitectura o estado → actualizar `docs/architecture.md`/`docs/current-state.md` y reflejar la línea relevante aquí y en `CLAUDE.md`; cada entrega → anexar sección en `worklog.md`.
