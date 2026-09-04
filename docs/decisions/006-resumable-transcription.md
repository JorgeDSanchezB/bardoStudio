# ADR-006 · Transcripción reanudable por sub-bloques

**Estado:** Aceptada
**Contexto:** Task 2 (Fase 2)

## Contexto

Narraciones de 3+ h ⇒ horas de ASR con riesgo de 429, cortes de red y recargas del navegador. Una transcripción monolítica perdería todo al fallar.

## Decisión

- Transcripción por **sub-bloques ≤28 s** al ASR del servicio (vía `/api/transcribe`, backend con `z-ai-web-dev-sdk`).
- **Persistencia por bloque**: cada sub-bloque completado se guarda en el store al instante (persist a localStorage); progreso visible por bloques.
- **Reanudación**: cancelar, recargar o fallar conserva las frases ya listas («reanudado · N frases ya listas»); reintentos y pausas entre solicitudes ante 429.
- Análisis dramático posterior por **lotes de escenas** (`/api/analyze-tension`) combinando texto (0.7) + energía de voz (0.3), pesos editables en `config.json`.

## Alternativas consideradas

- **Una llamada gigante**: límite de tokens del ASR y pérdida total ante fallo.
- **Chunk a archivo temporal en el servidor**: rompía la privacidad y añadía estado servidor que limpiar.

## Consecuencias

- ✅ Robustez ante 429/recargas; coste predecible y observable por bloque.
- ✅ Cancelación explícita «se guarda el progreso».
- ⚠️ Más complejidad de UI (progreso, reanudación, contadores).
- ⚠️ Los 429 ocasionales siguen apareciendo en `dev.log` (gestionados, no errores de usuario).
