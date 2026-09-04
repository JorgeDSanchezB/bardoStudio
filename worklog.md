# Worklog — Bardo Studio (musicalización auditable de narraciones)

Proyecto: app web (Next.js 16 + TS + shadcn/ui) que implementa el pipeline de 6 fases
pedido por el usuario (ingestión/análisis, transcripción+tensión, música CC0,
mezcla automática con ducking/crossfade, editor tipo Camtasia, exportación+PDF).
Entrega incremental: solo FASE 1 en este ciclo.

Reglas de calidad respetadas: análisis por bloques ≤5 min (RAM acotada), gates de
aprobación por fase, timeline virtualizado, 100% local, config.json editable.

---

Task ID: 1
Agent: main (Z.ai Code)
Task: Explorar el proyecto, inicializar entorno fullstack y planificar la Fase 1

Work Log:
- Ejecutado init-fullstack.sh (dev server gestionado por el sistema).
- Inventario de shadcn/ui disponible (slider, table, progress, checkbox, card, alert, sonner...).
- Stack confirmado: Next 16, React 19, zustand 5, framer-motion, lucide-react.
- Diseño decidido: audio se procesa 100% en el navegador por bloques (WAV parse
  exacto en Web Worker; MP3/M4A/OGG por decodeAudioData por bloques con fallback
  a decodificación única a 8 kHz). Picos 50/s + envolvente RMS 100 ms →
  detección de silencios ajustable (dB + duración) con re-detección en vivo.
- UI: timeline canvas propio (zoom rueda, pan, scrub, playhead, bloques de
  silencio), transporte con timecode HH:MM:SS.mmm, tabla de silencios,
  stepper de 6 fases con gate de aprobación.

Stage Summary:
- Fase 1 lista para implementarse. Subagente T2 genera el audio demo.

---
Task ID: 2
Agent: demo-audio-generator
Task: Generar el WAV demo de narración sintética (audio determinista) para probar/demos el pipeline de detección de silencios de la Fase 1.

Work Log:
- Creado scripts/generate-demo-audio.ts (TypeScript, ejecutado con Bun, cero dependencias externas; solo node:fs/node:path). No se tocó src/, package.json ni tests.
- Síntesis 100% determinista con un único LCG (seed 20260903, sin Math.random): portador = armónicos 1–5 de f0 115–175 Hz con drift lineal ±4 Hz y fases aleatorias pequeñas; ruido de formante (blanco → LPF un polo @1.2 kHz) a −14 dB respecto al portador; envolvente silábica 3.5–5.5 Hz (ataque 30 ms, decaimiento a piso 0.15, picos 0.7–1.0); pausas de frase de 0.3–0.5 s cada 6–12 s dentro de cada párrafo (envolvente → piso de ruido); RMS por párrafo calibrado a −20 dBFS (0.1); piso de ruido blanco continuo a −46 dBFS en TODO el archivo; soft-limit tanh @0.95 antes de cuantizar a int16 LE.
- Timeline exacto embebido (19 segmentos): room tone 0–3 s + 9 párrafos P1–P9 + 8 pausas (L 3.0 / S 1.8 / L 5.0 / S 1.5 / MEGA 8.0 / L 3.2 / S 1.4 / L 3.9). Total 366.000 s.
- Escrito public/demo/narration-demo.wav: RIFF/WAVE PCM 16-bit · mono · 22050 Hz · 366.000 s · 16,140,644 B (15.4 MiB), cabecera de 44 B con tamaños RIFF correctos. Re-ejecutar sobrescribe con bytes idénticos (sha256 672a197148ed…1620bd6): idempotente y reproducible.
- Nota de tamaño: la spec de referencia decía ≈16,138,924 B; con duración EXACTA de 366.0 s @22050 Hz/16-bit el tamaño estructural correcto es 44 + 2·8,070,300 = 16,140,644 B (Δ +1,720 B = 0.011%, dentro de la tolerancia "pequeña"). Se priorizó la duración exacta.
- El script re-lee el archivo y verifica: magic bytes, fmt PCM/mono/22050/16, byteRate 44100, blockAlign 2, tamaños RIFF/data, duración 366.000 ± 0.05, tamaño ± tolerancia, pico −5.0 dBFS (sin clipping), room tone −46.0 dBFS, RMS por párrafo −20.1/−20.2 dBFS, mínimo RMS 100 ms dentro del habla −26.8 dBFS (≥ −30 ⇒ sin silencios falsos en sílabas). Termina con "VERIFICATION OK" y exit 0 (genera en ~4 s).
- Auto-chequeo del detector espejo (bloques RMS de 100 ms, umbral ≤ −38 dBFS, min 2.0 s): exactamente 5 silencios interiores detectados — 3.0 s @38.5–41.5, 5.0 @112–117, 8.0 @208–216, 3.2 @252–255.2, 3.9 @338–341.9 (duraciones medidas exactas). Las 3 pausas cortas (1.8/1.5/1.4 s) NO se detectan con min 2 s. Las 32 pausas de frase (0.3–0.5 s) solo aparecen al bajar el slider de duración mínima. El room tone inicial (0–3 s, −46 dBFS) también queda por debajo del umbral: si el detector de la app NO recorta el silencio inicial, reportará 6 (la extra es la cabecera de 3 s).
- tsc --noEmit y eslint sobre el script: sin errores nuevos (los errores previos de tsc están solo en examples/ y skills/, ajenos a esta tarea).

Stage Summary:
- Asset de Fase 1 listo: public/demo/narration-demo.wav (366 s, ~16.1 MB, determinista, verificable byte a byte) + generador scripts/generate-demo-audio.ts. Con el detector por defecto (≤ −38 dB, ≥ 2.0 s) deben salir exactamente las 5 pausas largas (3.0/5.0/8.0/3.2/3.9); el slider de duración mínima revela las 3 cortas y las 32 pausas de frase. La app puede servarlo desde /demo/narration-demo.wav.

---
Task ID: 1-8 (main, Z.ai Code)
Task: Implementar, integrar y verificar la FASE 1 completa de Bardo Studio

Work Log:
- config/config.json (Mapa de Atributos Dinámicos) + GET /api/config (route handler, sin build).
- src/lib/audio/: types.ts, peaks.ts (grid alineada global: picos 50/s + envolvente RMS 100 ms),
  wav.ts (cabecera RIFF + lectura secuencial por bloques, PCM 8/16/24/32 y float32),
  decode.ts (MP3/M4A/OGG por decodeAudioData por bloques con carry alineado + fallback fullDecodeAt8k),
  wav-analyze.ts + wav-worker.ts (Web Worker con transferibles; respaldo inline),
  analyze.ts (orquestador: WAV exacto; comprimidos por bloques), silence.ts (detector con fusión de huecos).
- src/store/project.ts: zustand + persist (localStorage) + IndexedDB (picos/envolvente, src/lib/idb.ts).
- Componentes bardo/: waveform-timeline (canvas: regla, onda virtualizada por píxel, bloques de
  silencio, carril de envolvente con umbral, zoom rueda anclado, pan en regla, scrub, playhead con
  auto-follow derivado), transport-bar (play/pausa/stop/±5s/salto a silencio, timecode HH:MM:SS.mmm),
  silence-table (tabla clicable + CSV), threshold-panel (sliders controlados), approval-gate
  (checkbox + Aprobar → bloquea Fase 2), phase-stepper, upload-panel, analysis-progress, phase-teasers.
- page.tsx orquesta: carga/demo, análisis con progreso por bloque, restauración tras recarga,
  barra espaciadora, footer sticky (flex min-h-screen + mt-auto), layout.tsx (lang=es, dark).
- Correcciones durante verificación: <audio> siempre montado en page (eventos/src se conectan desde
  el primer render); vista del timeline derivada en render (lint set-state-in-effect) y sliders
  controlados por el store.
- QA: bun run lint OK, tsc --noEmit OK (solo errores preexistentes en examples/skills).
- Agent Browser E2E: render vacío OK; demo → 6 bloques de análisis → workspace con exactamente
  6 silencios esperados (0–2.9, 38.5–41.4, 112–116.9, 208–215.9, 252–255.1, 338–341.8);
  reproducir → timecode avanza; slider duración 2→4 s → recuento 6→2 (re-detección viva);
  fila de tabla → seek exacto a 00:00:38.500; checkbox + Aprobar → banner Fase 1 aprobada +
  teaser Fase 2; restauración tras recarga desde IndexedDB OK; footer: gap 0 con contenido
  corto y empuje natural con contenido largo (desktop y móvil 390×844); píxeles de canvas
  verificados (63 640 ámbar de onda, 890 rosa de silencios); sin errores de consola ni de
  dev.log. Estado reseteado para primera visita del usuario.

Stage Summary:
- FASE 1 completa y verificada E2E en el navegador. Demo: public/demo/narration-demo.wav
  (366 s, 22 050 Hz, mono, 16-bit) con 5 pausas ≥2 s + 3 cortas + tono de sala inicial.
- Arquitectura lista para Fase 2 (Whisper por bloques + curva de tensión) sin cambios de base.

---
Task ID: 2-b
Agent: full-stack-developer
Task: Componentes UI de la Fase 2 (curva de tensión arrastrable, tabla de escenas, progreso, puerta de aprobación, stepper y transcripción)

Work Log:
- Leídos los patrones de referencia antes de escribir nada: src/lib/fase2/types.ts (contrato Escena/Segmento/Fase2Progreso/ANIMO_ETIQUETAS/ANIMO_COLORES), waveform-timeline.tsx (dpr, ResizeObserver, view/clampView/effView derivado, zoom rueda anclado, pan con setPointerCapture, tooltip hover), silence-table.tsx (tabla + CSV BOM + max-h scroll-thin), approval-gate.tsx, analysis-progress.tsx, phase-stepper.tsx y src/lib/format.ts.
- Creado src/components/bardo/tension-graph.tsx (735 líneas): canvas propio con RULER_H=26 + PLOT_H=240; regla clonada de waveform (pickRulerStep/formatRulerTick); rejilla Y 0-100 cada 10 con etiqueta cada 25 y base 0 sólida; curva actual #34d399 2px con relleno rgba(52,211,153,0.10); curva automática punteada rgba(165,163,175,0.55) solo cuando hay correcciones; puntos r=4.5 con ANIMO_COLORES + anillo ámbar (corregido) y blanco (selección); playhead con triángulo en la regla; estado vacío "Aún no hay análisis de tensión.".
- Interacción del tension-graph con Pointer Events + touch-none: hit-test ≤16px → ARRASTRE del punto con setPointerCapture y onCorregir(id, clamp(round(100*(1-(y-plotTop)/plotH)),0,100)) en cada cambio (soloLectura únicamente selecciona); pan desde la regla; clic en vacío → escena más cercana en x → onSeleccionar + onSeek(inicio), o pan si supera 5px; clic simple en regla → onSeek; rueda = zoom anclado (preventDefault passive:false); hover con tooltip (timecode + tensión + ánimo + 80 chars de texto) posicionado sin desbordes; cursor dinámico crosshair/grab/grabbing.
- Cabecera del tension-graph con chip de zoom px/s, hint completo en lg y corto en móvil, ZoomOut/ZoomIn/Maximize2 (h-8 w-8 ghost) y botón "Restaurar automáticos" (RotateCcw) solo si onRestaurar y corregidas>0. Chip absoluto de escena seleccionada (MM:SS · tensión N · Ánimo, razon truncado a 60 chars en 2ª línea con title completo) + banda de resaltado del rango [inicio,fin] en el canvas. Leyenda con los 6 ánimos + anillo ámbar "corregido manualmente" y nota a11y sobre edición numérica en la tabla.
- Creado src/components/bardo/escenas-table.tsx (287 líneas): card estilo silence-table con Badge count y CSV (BOM, columnas n/inicio_tc/fin_tc/tension_auto/tension/corregido/animo/razon/texto con escape de comillas/quotes/saltos); tabla Nº|Inicio|Fin|Tensión|Ánimo|Texto con mini-barra w-16 h-1.5 (color del ánimo o ámbar si corregido), editor numérico w-14 (commit en blur/Enter, clamp 0-100, ignora vacío, sin set-state-in-effect: el borrador solo vive enfocado y el valor en reposo se deriva de la prop), Badge por ánimo con paleta teal/violeta/orange/red/amber/zinc (sin azules), texto truncado max-w-[280px] con title; filas clicables con tabIndex+Enter/Space, seleccionada bg-amber-500/10; contenedor max-h-[420px] overflow-auto scroll-thin con cabecera sticky bg-zinc-900; MAX_ROWS 600 + nota; empty state.
- Creado src/components/bardo/transcript-view.tsx (139 líneas): card "Transcripción por bloques" + Badge de nº de frases + CSV (n/bloque/inicio_tc/fin_tc/texto); filas clicables (role=button, tabIndex, Enter/Space, min-h-[44px]) con chip mono MM:SS text-amber-200/90 (title con timecode completo y rango) y texto break-words text-xs zinc-300; max-h-[420px] scroll-thin; MAX_ROWS 800 + nota; empty state con el texto de reanudación por bloques.
- Creado src/components/bardo/fase2-progress.tsx (121 líneas): card estilo analysis-progress con Loader2 animate-spin ámbar; chip de etapa ES (Preparando/Transcribiendo/Analizando tensión/Completando); Progress con % estimado (preparando 2, transcribiendo ((bloque-1)/totalBloques)*100 tope 88, analizando 90, completando 96); fila mono "Bloque X de N · tc → tc" (formatTimecode de subInicio/subFin); métricas de frases acumuladas y duración total (formatDurSmart); progreso.mensaje si llega; nota de persistencia por bloque; botón outline con estilo destructivo (X) "Cancelar (se guarda el progreso)"; Badge "reanudado · N frases ya listas" si reanudadas>0.
- Creado src/components/bardo/fase2-gate.tsx (128 líneas): copia estructural/estética de approval-gate con los textos ES pedidos: sin aprobar (ámbar, Lock, "bloquea la Fase 3", checkbox con escenas/tensiónMedia/picoTension/corregidas, botón ámbar disabled hasta marcar, ghost "Volver a transcribir"); aprobado (esmeralda, "Volver a editar la curva" + "Rehacer análisis").
- Modificado src/components/bardo/phase-stepper.tsx (146 líneas): nueva prop opcional phase2Status ("locked"|"idle"|"running"|"review"|"approved", default "locked", tipo exportado Phase2StepperStatus) — approved → esmeralda + CheckCircle2; running → ámbar + badge ACTIVA + AudioLines con animate-pulse sutil; review → igual sin pulse; idle → border-amber-700/40 con AudioLines sin badge; locked → gris + Lock como antes. Fase 1 invariante; fases 3-6 siguen bloqueadas; compatible al 100% si no se pasa la prop (phase1Status sigue siendo el único argumento requerido).
- QA: `bun run lint` OK (0 errores/0 warnings tras sustituir un set-state-in-effect del editor numérico por derivación en render) y `bunx tsc --noEmit` sin errores en src/ (solo ruido preexistente de examples/skills/scripts, ignorado). dev.log sin errores de compilación. No se tocó page.tsx, store, src/lib/**, api ni otros componentes; verificación E2E delegada al orquestador.

Stage Summary:
- Capa presentacional de la Fase 2 completa y lista para integrar: TensionGraph (curva 0-100 con puntos arrastrables, curva automática fantasma, zoom/pan/tooltip/selección), EscenasTable (tabla con corrección numérica y CSV), TranscriptView (frases por bloque con seek), Fase2Progress (progreso por bloques con cancelación que preserva avances), Fase2Gate (puerta de auditoría) y PhaseStepper ampliado con los 5 estados de la Fase 2. Todo desacoplado del store (solo props/callbacks), español, zinc/ámbar/esmeralda sin azules, responsive mobile-first, a11y (roles, aria-label, tabIndex, Enter/Space) y targets táctiles ≥44px. Integración pendiente por el orquestador (Task 2-a): montar en page.tsx cableando el store.

---
Task ID: 2-a
Agent: main (Z.ai Code, orquestador)
Task: Fase 2 completa de Bardo Studio — transcripción por bloques + análisis de emoción/tensión 0-100 + curva corregible, integrada y verificada E2E

Work Log:
- Leídas las skills ASR/LLM/TTS del SDK (z-ai-web-dev-sdk, solo backend) y explorada la arquitectura de Fase 1 (page, store zustand+persist, lib/audio, componentes bardo).
- Experimentos previos: probadas 7 voces TTS en español (chuichui = mejor round-trip ASR); descubierto que el ASR (a) admite 0-30 s por archivo (400 "duración limitada a 0-30 segundos"), (b) sufre rate-limit 429 → diseño con reintentos/backoff y pausas entre solicitudes, (c) devuelve texto plano (sin marcas de tiempo) → alineación temporal por energía de voz.
- Demo con voz real: scripts/generate-demo-voz.ts (bun + SDK TTS + ffmpeg) → public/demo/narracion-voz-demo.wav (176,8 s · 24 kHz mono · 5 capítulos calma→misterio→tensión→batalla→victoria separados por pausas de 3,2 s). La demo sintética original se conserva como opción secundaria (no contiene habla).
- Contrato: src/lib/fase2/types.ts (Segmento, Escena, Fase2Progreso, Fase2Resumen, Fase2Config, ANIMO_COLORES/ETIQUETAS, esAnimo) + FASE2_CONFIG_DEFECTO.
- Lib de Fase 2: cortes.ts (calcularCortes con ajuste a silencios aprobados ±60 s + calcularSubBloques con tope duro asrMaxSeg), wav-encode.ts (WAV PCM16 mono 16 k + base64), pcm.ts (extracción exacta por cabecera RIFF para WAV — RAM acotada 3+ h — y decodificación única cacheada a 16 k para comprimidos), align.ts (regionesDeVoz desde la envolvente de Fase 1, dividirEnFrases, alinearSubBloque proporcional a la duración de cada región), escenas.ts (rejilla escenaSeg, energia 0-100 normalizada al dBFS medio de voz), pipeline.ts (orquestador reanudable: bloques lógicos ≤5 min → sub-bloques ≤28 s → POST /api/transcribe → alinear → persistir por bloque → escenas → lotes a /api/analyze-tension).
- Backend (skills del SDK): POST /api/transcribe (ASR file_base64, 3 reintentos con backoff en 429) y POST /api/analyze-tension (LLM con prompt de analista dramático → JSON {id,tension,animo,razon}; combinación servidor con pesos texto/energía de config.json; modo seguro heurístico con léxicos editables por ánimo si el LLM falla; escenas mudas → tensión por energía). config/config.json v2 con sección fase2 (bloques, asrMaxSeg, escenaSegundos, pesos, léxicos ES).
- Store (project.ts): slice fase2 completo (status/segmentos/escenas/bloquesHechos/resumen/avisos/configFase2 sembrada desde /api/config, progreso volátil) + acciones (iniciar/setProgreso/bloqueHecho/terminar/fallar/cancelar/corregirTension/restaurarTensiones/aprobarFase2/reabrirFase2/rehacerFase2) persistido en localStorage (JSON-safe, sin progreso).
- Subagente 2-b construyó la capa presentacional (ver su sección); integración en page.tsx: sección Fase 2 con arranque/reanudación, Fase2Progress en curso, resultados (TensionGraph + Tabs escenas/transcripción + resumen + avisos + Fase2Gate), stepper con phase2Status, badges/etiquetas honestas (Fase 1 local / Fase 2 por IA), upload-panel con las dos demos y corrección de fallarFase2.
- QA: bunx tsc --noEmit limpio en src/; bun run lint OK; curl E2E de ambas API (transcribe con WAV 20 s real; analyze-tension devolvió calma 22 / misterio 40 / tensión 57 / batalla 86 / muda→energía 30).
- Agent Browser E2E (flujo dorado completo): demo con voz → Fase 1 (6 silencios) → aprobar → Fase 2 → 9 llamadas ASR 200 + 3 analyze-tension 200 → 9 escenas con perfil dramático correcto (calma 15 … batalla 68 “Batalla” … calma final 34) → ARRASTRE de punto verificado (43→97, corregido=true) → tabla sincronizada → aprobar Fase 2 → recarga restaura TODO incluida la corrección (97) → móvil 390×844 (footer empujado natural) → 0 errores de consola/página → estado reseteado (localStorage+IndexedDB) para la primera visita del usuario.

Stage Summary:
- FASE 2 completa y verificada E2E: transcripción reanudable por bloques ≤5 min (sub-bloques ASR ≤28 s cortados en silencios aprobados), alineación temporal por energía de voz, tensión 0-100 + ánimo por escena (LLM + heurística de config.json + energía), curva de tensión con puntos ARRASTRABLES (canvas), tabla editable, transcripción navegable, puerta de auditoría que bloquea la Fase 3.
- Arquitectura lista para Fase 3 (gestión de música CC0 por ánimo/tensión): las escenas aprobadas con animo+tension quedan persistidas como base de la selección musical.
- Limitaciones conocidas documentadas: el ASR devuelve texto plano (los tiempos de frase son estimaciones por energía); la demo usa voz TTS (transcripción imperfecta, con narración humana real mejora); archivos comprimidos >1 h se decodifican completos para transcribir (recomendar WAV).
