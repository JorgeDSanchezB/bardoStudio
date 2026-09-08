# ADR-015 · Motor 100 % local y gratis para la Fase 2

**Estado**: aceptado · **Fecha**: 2026-09-08 · **Versión**: 1.0.5

## Contexto

Los proveedores de IA de la ADR-014 funcionan, pero comparten tres problemas
que el usuario reportó como decisivos:

1. **Fiabilidad**: los servicios de IA en la nube fallan con frecuencia
   (429, 5xx, timeouts), en mitad de una transcripción larga.
2. **Coste**: toda IA de pago acaba trasladándose al usuario (claves,
   suscripciones, límites por minuto).
3. **Accesibilidad**: hay usuarios que quieren una opción COMPLETAMENTE
   gratis, sin cuentas ni claves, y sin depender de que «la IA del servidor»
   esté viva.

Requisito: la Fase 2 (transcripción + curva de tensión) debe poder ejecutarse
con recursos del PROPIO equipo, por puro código, fácil de usar y sin fricción.

## Decisión

Añadir un segundo **motor** a la Fase 2, seleccionable en la propia tarjeta
de arranque (radiogroup accesible, persistido en `localStorage`):

```
motor: "servidor"  →  como siempre: proveedor activo (Z.AI / API propia / Deepgram)
motor: "local"     →  100 % gratis: Whisper EN EL NAVEGADOR + heurística local
```

Por defecto: la última elección del usuario; si nunca eligió y no hay IA
conectada, se arranca directamente en «local».

### 1. Transcripción local: Whisper en un Web Worker

- `public/workers/asr-local.js`: carga **transformers.js 3.8.1** desde jsdelivr
  (CDN) dentro de un Web Worker y ejecuta Whisper (ONNX) con
  `automatic-speech-recognition`. WebGPU si el navegador lo soporta;
  **caída automática a WASM/CPU** al fallar (drivers, kernels, headless).
  dtype: `fp32+q4` en WebGPU (receta oficial del ejemplo Whisper WebGPU),
  `q8` en CPU.
- Modelos (hub de HuggingFace, cacheados por el navegador tras la 1.ª
  descarga — después funciona incluso sin internet):
  - **Rápido** `Xenova/whisper-tiny` (~42 MB)
  - **Equilibrado** (defecto) `onnx-community/whisper-base` (~80 MB)
  - **Detallado** `Xenova/whisper-small` (~250 MB)
- `src/lib/fase2/asr-local.ts`: clase `AsrLocal` — protocolo de mensajes con
  la promesa por `id`, progreso de descarga en MB reenviado a la UI, cierre
  del worker al terminar (libera memoria), y reintento WebGPU→WASM.
- El pipeline (`src/lib/fase2/pipeline.ts`) reutiliza el mismo worker para
  todos los sub-bloques (≤ 29,5 s) y **no aplica la pausa anti rate-limit**
  (no hay servicio al que respetar). El audio NUNCA sale del equipo.

### 2. Tensión local: heurística ampliada (sin LLM)

- `/api/analyze-tension` con `{ motor: "local" }` **no llama a ningún
  proveedor**: puntúa solo con los léxicos de `config/config.json`
  (editables por el usuario, sin tocar código).
- Ampliada para que el modo gratis sea útil de verdad:
  - **Raíz ligera** (`raizLigera`): «espadas» coincide con «espada»,
    «goblins» con «goblin» (antes solo coincidía el singular exacto).
  - **Léxicos ampliados** con vocabulario de narración D&D/fantasía
    (dragón, bestia, cripta, espectro, hechizo, amanecer, brisa…).
- Sigue combinándose con la energía de audio (pesos de config.json) y
  marcándose con `fuente="heuristico"` en la UI.

### 3. UI

- Radiogroup «Motor de transcripción y análisis»: **IA conectada** (ámbar,
  muestra el nombre del proveedor activo) vs **100 % local · gratis**
  (esmeralda, «sin claves ni coste»).
- Al elegir «local»: selector de calidad de modelo + nota de la 1.ª
  descarga y WebGPU/CPU.
- El aviso «la IA no está conectada» gana el botón **«Usar el motor local
  (gratis)»** que cambia de motor y relanza la Fase 2 en el mismo clic
  (`motorForzado` evita el closure obsoleto).
- Progreso de descarga del modelo integrado en `Fase2Progress`
  («Descargando el modelo … 18.1/82.7 MB · 22 %»).

## Consecuencias

- **Gratis y sin fricción**: sin claves, sin cuentas, sin rate-limits, sin
  coste; funciona igual en la web y en la app de escritorio (el worker se
  sirve de `public/`, incluido en el instalador).
- **Privacidad**: con motor local, el audio no sale del equipo del usuario.
- **Dependencia residual**: la PRIMERA vez por modelo necesita internet
  (jsdelivr para la librería + HuggingFace para el modelo; después caché).
  La calidad tiny/base/small es menor que un LLM grande para la tensión,
  pero la heurística ampliada cubre el dramatismo básico y es editable.
- **Coste técnico**: ~250 líneas nuevas (worker + clase + UI) y un motor
  extra en el pipeline; el flujo «servidor» queda intacto (regresión
  cubierta: si `motor` no llega, el pipeline usa «servidor»).
- **Verificación E2E real** (navegador del sandbox): demo con voz → Fase 1
  aprobada → motor «local» + modelo «Rápido» → descarga real de 82,7 MB con
  progreso → transcripción real en el navegador («La pasada del dragón…»)
  → 9 escenas puntuadas con heurística → **0 llamadas a
  `/api/transcribe`** (cero nube) → recarga: motor, modelo y proyecto
  persistidos.
