# ADR-011 · Módulo SFX: efectos de sonido por palabras clave (Fase 2.5)

**Estado:** Aceptada (Entregas 1–3 completas y verificadas E2E)
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

## Decisión (Entrega 2 — pista «Efectos» en el editor)

1. **`SfxClip`** (`src/lib/sfx/tipos.ts`): espeja el contrato de `BloqueMusica` (inicio/fin, fades, `offsetOrigen`, muted, origen `"auto"|"manual"|"edicion"`) + `volumenDb` y trazabilidad (`eventoId`, `palabra`, `categoria`). Las ediciones son **funciones puras** en `src/lib/sfx/clips.ts` (mismo estilo que `fase5/ediciones.ts`): `materializarClips`, `recortarClip`, `dividirClip`, `moverClip`, `silenciarClip`, `cambiarSfxClip`, `ajustarVolumenClip`, `crearClipSuelto`; mínimos 0.3 s por clip/lado de corte.
2. **Materialización junto a los bloques**: al aprobar la Fase 4, `fase5-seccion` materializa bloques Y clips (store: `faseSfx.clips` + `edicionesSfx` + `detalleEdicionesSfx`). Reset simétrico en `reabrirFase3/4`, `reabrirFaseSfx`, `reiniciarSfx` (que ahora también resetea 3–6: la re-detección invalida la mezcla). «Descartar ediciones» re-materializa ambos.
3. **Timeline** (`mix-timeline.tsx`): tercera pista **EFECTOS** (56 px) bajo MÚSICA; clips coloreados por `colorCategoria`, etiqueta palabra+volumen+bucles, cuñas de fundido, costuras de bucle, asas de borde, estado MUTE. Arrastre unificado (`Arrastre.tipo: "musica"|"sfx"`), hit-test propio, misma interacción que los bloques. La pista se pasa también a la vista previa de la Fase 4 (no editable). El alto del canvas crece solo si hay pista.
4. **Motor vivo** (`fase5/motor.ts`): bus `busSfx → gainDuckSfx → analizadorSfx → master`; por clip, la MISMA `montarFuente` compartida con la música (bucle, `offsetOrigen`, fades) escalada por `db2gain(volumenDb)`. `decodificarFuentes` también trae los WAV de SFX. Tercer medidor **EFECTOS** (naranja) en `nivel-metros`. Inspector de clip (archivo, cuchilla, silenciar, eliminar, slider de volumen) y «añadir efecto en el cursor» desde la biblioteca.
5. **Ducking de SFX** (`fase4/mezcla.ts`): `Mezcla.duckSfxDb` = `duckDb × 0.5` si `defectos.respetarDucking` («baja ligeramente»), 0 si no. Es la envolvente del `gainDuckSfx`.

## Decisión (Entrega 3 — mezcla, exportación y persistencia)

1. **Render offline a 6 canales** (`fase6/render.ts`): voz L/R (0/1), música L/R (2/3), **efectos L/R (4/5)**; `montarFuenteOffline` compartida; cola final y normalización aplicadas a los cuatro archivos; `ResultadoRender.sfx` + stem **`-efectos-.wav`** (`ExportInfo.tipo: "efectos"`).
2. **Informe PDF**: sección `sfx` del contrato (detección, nivel, ducking, clips con palabra/archivo/volumen, ediciones) renderizada por `seccion_sfx` en `scripts/report-pdf.py` (retrocompatible: sin `sfx`, sin sección). Auditoría con **fila 2.5** y portada «7 FASES».
3. **SFX propios del usuario**: `db/user-sfx/` + `GET/POST /api/user-sfx` (multipart, ≤30 MB, nunca re-codifica) + `GET /api/user-sfx/track/[id]` (Range). El cliente decodifica para medir la duración, sube y añade a la biblioteca del store (`añadirSfxBiblioteca`, deduplicado); al montar, la Fase 2.5 incorpora los del manifiesto que falten.
4. **Persistencia**: `clips`/`edicionesSfx`/`detalleEdicionesSfx` dentro de `faseSfx` → localStorage, `.bsproj` (snapshot) y proyectos del servidor vía `validarSfxClip` (defensivo, ≤600 clips). Recarga y reapertura de proyecto restauran la edición tal cual.

### Por qué estas formas
- **Reutilizar el contrato de BloqueMusica** en vez de fusionar tipos: la música y los SFX tienen catálogos, volúmenes y semánticas distintas; compartir la FORMA (bordes/cuchilla/offset) sin compartir el tipo mantiene cada pista auditable y evita rewrites del editor.
- **½ profundidad de ducking** para SFX: «baja ligeramente» según la especificación; configurable con un switch en vez de un slider adicional.
- **Bucle de archivo en SFX largos**: ambientes (lluvia, viento, fuego…) se benefician del mismo mecanismo de bucle de la música; los golpistas simplemente terminan antes.

## Consecuencias (entregas 2–3)

- ✅ E2E completo verificado: pista Efectos audible en vivo (medidor EFECTOS 66→44 % durante el rugido del dragón), 6 operaciones de edición SFX aplicadas y persistidas tras recarga (mover 2.1→45.7 s, acortar a 48.1, cortar en 47.3 con offset 1.6 s, volumen −12→−9 dB, cambiar archivo, eliminar), render 4 archivos (mezcla + voz + música + efectos) y PDF con sección «Efectos de sonido» (nivel, ducking, tabla de clips, fila 2.5).
- ✅ Importación de SFX propio verificada E2E (wolf-howl-01 → `db/user-sfx/` → biblioteca 38 → servido con Range).
- ⚠️ La métrica RMS/pico mostrada en las tarjetas de stems es la de la mezcla (compartida del render, igual que en las entregas previas).
- ⚠️ No hay automatización multipunto por clip (curva de volumen dentro del clip): volumen plano por clip, editable con slider — suficiente para el caso de uso (golpes/ambientes cortos).
