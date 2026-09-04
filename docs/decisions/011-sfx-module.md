# ADR-011 · Módulo SFX: efectos de sonido por palabras clave (Fase 2.5)

**Estado:** Aceptada (Entrega 1 de 3 — detección + auditoría)
**Contexto:** Task 12-sfx (petición del usuario: módulo que detecte palabras clave en la transcripción y coloque efectos de sonido sincronizados)

## Contexto

Tras la transcripción (Fase 2) el texto con timestamps permite localizar menciones de sonidos («trueno», «pasos», «espada»…). El usuario pidió: diccionario ES/EN editable (30+ palabras), pista «Efectos» en el editor (Entrega 2), integración en mezcla/render/persistencia (Entrega 3) y **ventana de auditoría** con lista aprueba-por-efecto. Entrega incremental con aprobación entre pasos.

## Decisión (Entrega 1)

1. **Fase 2.5** entre la 2 y la 3: se monta al aprobar la Fase 2; su puerta desbloquea la Fase 3 (la 3-6 requiere `faseSfx.status === "approved"`). El stepper pasa de 6 a **7 pasos** (n: 2.5).
2. **Biblioteca CC0 sintetizada**: 37 WAVs deterministas (22050 Hz mono) generados por `scripts/generate-sfx-library.ts` (mismo patrón que la música CC0) → `public/sfx/` + `config/sfx.json`. **35 categorías · 381 palabras clave** ES/EN con sinónimos y flexiones.
3. **Config editable** en `config/sfx_config.json` (archivo pedido por el usuario; semilla del generador) servida y validada por `GET /api/sfx-config` (verifica existencia de WAVs como music-library). El panel (`SfxPanel`) edita categorías/palabras/defectos en el store (persistido), con exportar/importar JSON y restaurar del servidor. La semilla nunca pisa una config editada (`configTouched`).
4. **Detección pura** (`src/lib/sfx/detectar.ts`): normalización (minúsculas + sin acentos), token→categoría con índice y flexión de plurales (confidencia 1 exacta / 0.9 plural), posición temporal proporcional al offset de caracteres del token dentro del segmento, **anti-ametralladora** (misma categoría a < `minSeparacionSeg` se funde), tope `maxEventos`. Corre en **Web Worker** (`detectar-worker.ts` + `detectar-cliente.ts` con respaldo inline), requisito explícito.
5. **Estado** `faseSfx` en el store (Zustand): eventos editables (activo/sfx/vol/inicio), config, biblioteca, aprobación; persistido en localStorage y fluye a `.bsproj` vía `estadoPersistido`/`snapshotProyecto` con validadores defensivos (`validarSfxEvento`, `normalizarConfigSfx`, `validarSfxDef`). `reabrirFase2`/`rehacerFase2` resetean la 2.5; `reabrirFaseSfx` resetea 3-6.
6. **Auditoría visual** (`SfxSeccion`): tabla con checkbox por evento, palabra encontrada (badge, «*» si plural), categoría coloreada (paleta sin azules), Select de efecto por evento, volumen dB, posición editable (grid 0.1 s), duración, previsualización de audio real (`<audio>` por key+autoPlay), eliminar; bulk activar/silenciar/eliminar todos; **biblioteca** con audición y «añadir en el cursor»; puerta de auditoría + «Volver a detectar» (regenera conservando la config).

### Por qué estas formas
- **Sin decodificar audio para detectar**: la detección es solo texto+timestamps (instantánea); el audio se oye bajo demanda por HTTP estático.
- **pos = offset de caracteres × duración del segmento**: la mejor estimación disponible sin alineación palabra-a-palabra del ASR.
- **Worker con respaldo inline**: cumple el requisito sin romper entornos sin workers (misma función pura).

## Alternativas consideradas

- **LLM para extraer eventos del texto**: menos determinista y más caro por frase; el diccionario ES/EN editable cumple mejor «extensible sin modificar código».
- **Time-stretch del SFX para ajustarlo a la mención**: innecesario; el SFX es un golpe puntual (la duración del clip se editará en Fase 5, Entrega 2).

## Consecuencias

- ✅ Pipeline auditable con la fase 2.5 completa y verificada E2E (14 eventos en la demo, incl. flexiones «rugiendo»/«copas» y re-detección tras editar palabras).
- ✅ Config 100 % editable (archivo + panel + import/export) sin tocar código.
- ⚠️ Entregas pendientes (aprobadas por el usuario de forma explícita): **E2** pista «Efectos» en el timeline del editor + reproducción en vivo; **E3** render offline + stems + informe PDF + validación completa en `.bsproj` guardado en servidor.
- ⚠️ La estimación temporal por caracteres hereda la alineación por energía de la Fase 2 (± un par de segundos en segmentos largos); el usuario puede ajustar el segundo a mano.
