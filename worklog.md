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
