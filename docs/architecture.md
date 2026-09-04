# Arquitectura — Bardo Studio

Referencia técnica completa. Para el estado del proyecto en un momento dado, ver [`current-state.md`](current-state.md); para el porqué de cada decisión, ver [`decisions/`](decisions/).

## Visión general

```
┌─────────────────────────── Navegador ────────────────────────────┐
│  page.tsx (única ruta)                                           │
│  ├── Fase 1: análisis local (WAV exacto / decodeAudioData)       │
│  ├── Fase 2: ASR + LLM (vía /api) + curva de tensión corregible  │
│  ├── Fase 3: catálogo CC0 + música propia (vía /api)             │
│  ├── Fase 4: cálculo de la mezcla (bloques, ducking, crossfades) │
│  ├── Fase 5: MotorMezcla (Web Audio en vivo) + ediciones puras   │
│  └── Fase 6: render offline + informe PDF (vía /api)             │
│                                                                   │
│  store/project.ts (zustand) ── persist ──▶ localStorage           │
│         │                        picos/envolvente ▶ IndexedDB     │
└─────────┼─────────────────────────────────────────────────────────┘
          │ fetch relativo (/api/...)
┌─────────▼────────────────── Servidor (route handlers) ───────────┐
│  /api/transcribe, /api/analyze-tension   ← z-ai-web-dev-sdk       │
│  /api/music-library, /api/report                                  │
│  /api/user-music[.../track/[id]]      → db/user-music/ (Range 206)│
│  /api/proyectos[.../[id]/audio|analysis] → db/ (audio + .bsproj)  │
└───────────────────────────────────────────────────────────────────┘
```

Principios rectores:

1. **Pipeline auditable**: 6 fases secuenciales, cada una con puerta de aprobación explícita (checkbox + botón) que desbloquea la siguiente.
2. **Privacidad y control**: el audio se analiza en el navegador; al servidor solo van texto (transcripción), archivos que el usuario pide guardar/servir y llamadas de IA.
3. **RAM acotada** para narraciones de 3+ horas: análisis por bloques ≤5 min, timeline virtualizada por píxel.
4. **Determinismo donde importa**: demos regenerables byte a byte, ediciones en grid de 0.1 s, funciones puras.

## Frontend

- **`src/app/page.tsx`** — única ruta visible. Orquesta las 6 fases, la cabecera de proyectos (Guardar/Proyectos), la restauración tras recarga y el `<audio>` principal (siempre montado).
- **`src/components/bardo/`** — componentes de fase, desacoplados del store (solo props/callbacks):

| Componente | Fase | Rol |
|---|---|---|
| `upload-panel`, `analysis-progress` | 1 | carga + progreso por bloques |
| `waveform-timeline` | 1 | canvas: onda virtualizada, silencios, zoom/pan/scrub |
| `threshold-panel`, `silence-table` | 1 | umbrales en vivo + tabla clicable (CSV) |
| `tension-graph`, `escenas-table`, `transcript-view`, `fase2-progress`, `fase2-gate` | 2 | curva arrastrable, escenas, frases, progreso reanudable |
| `fase3-seccion`, `importar-musica` | 3 | catálogo CC0 + Tu música, importación y metadatos |
| `fase4-seccion` | 4 | parámetros de mezcla + timeline de vista previa |
| `fase5-seccion`, `mix-timeline`, `transport-mezcla`, `nivel-metros` | 5 | editor Camtasia: cuchilla, mover, bordes, mute, pista |
| `fase6-seccion` | 6 | render + descargas + PDF |
| `gate-fase`, `approval-gate`, `phase-stepper`, `phase-teasers` | — | puertas de auditoría y navegación de fases |
| `guardar-dialog`, `proyectos-dialog` | — | proyectos estilo Camtasia |

- **`src/store/project.ts`** — Zustand con `persist` a **localStorage** (`bardo-project-v1`); picos y envolvente viven en **IndexedDB** (`bardo-studio`, `src/lib/idb.ts`) para no re-analizar tras recargar. Acciones clave: `aplicarProyecto` (validador profundo campo a campo), `materializarFase5`, `aplicarEdicionFase5`, `aprobarFaseN/reabrirFaseN`.

## Pipeline fase por fase

### Fase 1 — Ingestión y análisis
- WAV: parse RIFF exacto por bloques (`lib/audio/wav.ts`, PCM 8/16/24/32 + float32). MP3/M4A/OGG: `decodeAudioData` por bloques con carry alineado y fallback a decodificación única a 8 kHz (`lib/audio/decode.ts`).
- Web Worker con transferibles (`wav-analyze.ts` + `wav-worker.ts`, respaldo inline): **picos 50/s** + **envolvente RMS 100 ms** en una rejilla global alineada.
- Detección de silencios (`silence.ts`): umbral dBFS + duración mínima + fusión de huecos, recalculada en vivo al mover los sliders.

### Fase 2 — Transcripción y tensión
- Sub-bloques ≤28 s al ASR (`POST /api/transcribe`); el progreso se guarda **por bloque** (cancelar/recargar y reanudar sin repetir llamadas; reintentos y pausas ante 429).
- Análisis dramático por lote (`POST /api/analyze-tension`): LLM asigna ánimo + tensión 0–100 por **escena de 20 s**, combinando texto (0.7) y energía de voz (0.3) — pesos editables en `config.json`.
- Curva corregible arrastrando puntos (canvas `tension-graph`) o numéricamente en `escenas-table`.

### Fase 3 — Música y asignación
- Biblioteca CC0: 9 pistas sintetizadas como WAV al vuelo (`GET /api/music-library`).
- Música propia: `POST /api/user-music` (multipart, ≤100 MB, WAV/MP3/OGG/M4A) → `db/user-music/` con manifiesto JSON; `GET .../track/[id]` sirve con **Range 206**; `PATCH` edita metadatos. La duración y la banda de tensión **sugerida** se decodifican en el navegador al importar.
- Asignación por escena: matching automático (tensión + ánimo) o manual desde la tabla; `Pista.propia` distingue el origen.

### Fase 4 — Mezcla automática
- `lib/fase4/mezcla.ts` (`calcularMezcla`): bloques por escena, crossfades (3 s), ducking por envolvente (ataque/liberación), hinchado de música en silencios. Parámetros editables con re-cálculo instantáneo.

### Fase 5 — Editor tipo Camtasia
- **Motor en vivo** (`lib/fase5/motor.ts`, `MotorMezcla`): Web Audio, voz + buffers de pista decodificados, ducking con la envolvente, `src.start(cuando, (offsetOrigen + avance) % durBuffer)` para respetar el punto de entrada y el bucle.
- **Ediciones puras** (`lib/fase5/ediciones.ts`): `recortarBloque`, `dividirBloque` (la cuchilla propaga `offsetOrigen`), `moverBloque`, `eliminarBloque`, `silenciarBloque`, `cambiarPistaBloque`; `limitesBorde` compartido entre vista previa y commit; `buclesDe` para la UI.
- `mix-timeline.tsx`: canvas con asas de borde (agarre 9 px), cursor `ew-resize`, arrastre con `setPointerCapture`, vista previa en vivo, costuras de bucle punteadas.
- La materialización de bloques ocurre **solo al aprobar la Fase 4** (guard del efecto) — así los cambios manuales de pista de la Fase 3 llegan al editor y al render.

### Fase 6 — Exportación
- `lib/fase6/render.ts`: render offline de la mezcla + stems (voz / música) con el mismo modelo de bloques; `POST /api/report` genera el **informe PDF** con la trazabilidad completa.

## Persistencia (capas)

| Capa | Qué guarda | Cuándo |
|---|---|---|
| localStorage `bardo-project-v1` | estado de las 6 fases, silencios, escenas, bloques, params | continuo (persist) |
| IndexedDB `bardo-studio` | picos + envolvente (grandes Float32Array) | tras análisis |
| `db/proyectos/…` | audio original + `.bsproj` + `.an` (pack BSAN de análisis) | al Guardar |
| `db/user-music/` | archivos de música del usuario **tal cual** + manifiesto | al importar |
| `.bsproj` descargable | estado + análisis embebido en base64 (portátil) | «Descargar .bsproj» |

El **pack BSAN** (`lib/proyecto/pack.ts`) serializa picos+envolvente en binario compacto para reabrir proyectos sin re-analizar. `parsearProyecto` (`lib/proyecto/tipos.ts`) valida defensivamente el paquete entrante.

## API (route handlers)

| Ruta | Método | Rol |
|---|---|---|
| `/api/config` | GET | mapa de atributos dinámico de `config/config.json` |
| `/api/transcribe` | POST | ASR por sub-bloque (z-ai-web-dev-sdk) |
| `/api/analyze-tension` | POST | LLM: ánimo + tensión por escena |
| `/api/music-library` | GET | catálogo CC0 (9 pistas) |
| `/api/user-music` | GET/POST | listar / importar música propia (multipart ≤100 MB) |
| `/api/user-music/track/[id]` | GET/PATCH/DELETE | servir (Range 206) / editar metadatos / borrar |
| `/api/proyectos` | GET/POST | listar / guardar o actualizar (multipart audio+análisis) |
| `/api/proyectos/[id]` | DELETE | eliminar |
| `/api/proyectos/[id]/audio` | GET | audio del proyecto (Range 206) |
| `/api/proyectos/[id]/analysis` | GET | pack de análisis (.an) |
| `/api/report` | POST | informe PDF |

## Modelo de datos (tipos clave)

- `AnalysisData` — `peaksMax/peaksMin` (50/s), `envDb` (hop 100 ms), `durationSec`, formato.
- `SilenceRegion { start, end }` — silencios aprobados en Fase 1.
- `Escena` — 20 s: `texto`, `energia`, `tensionAuto/tension`, `animo`, `corregido`, `razon`.
- `Pista` — `id, titulo, animo, tension, bpm, tonalidad, durSec, archivo`, `propia?`.
- `BloqueMusica` — `pistaId, inicio, fin, fadeInSeg, fadeOutSeg, muted, origen ("auto"|"edicion")`, **`offsetOrigen?`** (punto de entrada en la pista, 0 por defecto).
- `ProyectoGuardado` — estado completo + audio + análisis (para `.bsproj` y el servidor).

## Convenciones de implementación

- Canvas: dpr capado a 2, `ResizeObserver`, vista derivada en render (no `setState` en efectos), Pointer Events con `setPointerCapture` y `touch-none`.
- UI 100 % en español; paleta zinc/ámbar/esmeralda (sin azul/índigo); footer sticky con `min-h-screen flex flex-col` + `mt-auto`.
- `z-ai-web-dev-sdk` solo en route handlers; fetches del cliente siempre relativos (`/api/...`); puertos extra solo con `?XTransformPort=`.
- Ediciones con grid de 0.1 s y `origen: "edicion"` para trazabilidad.
