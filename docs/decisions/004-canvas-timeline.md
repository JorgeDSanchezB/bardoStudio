# ADR-004 · Líneas de tiempo en canvas propio, virtualizadas

**Estado:** Aceptada
**Contexto:** Task 1 (Fase 1) · reutilizada en Fases 2, 4 y 5

## Contexto

Hay tres visores temporales pesados (onda de Fase 1, curva de tensión de Fase 2, mezcla de Fases 4/5) sobre archivos de 3+ h. Un DOM con miles de nodos o dibujar todo el archivo en canvas mataría el rendimiento y la memoria.

## Decisión

**Canvas 2D propio por visor** (no componentes DOM, no librerías externas):

- **Virtualización por píxel**: solo se dibuja la ventana visible; a baja resolución los picos se agrupan por píxel (máx/mín por columna).
- dpr capado a 2; `ResizeObserver` para el ancho; **vista derivada en render** (cumple la regla set-state-in-effect de React 19).
- Interacción unificada: rueda = **zoom anclado** en el puntero, arrastre de la regla = pan, scrub/playhead con auto-follow, hover con tooltip sin desbordes.
- Pointer Events con `setPointerCapture` + `touch-none` (mouse/touch/pen con un solo camino).
- Regla y helpers compartidos (`pickRulerStep`, `formatRulerTick`, `clamp` de `lib/format`).

## Alternativas consideradas

- **Wavesurfer/librerías**: opinionadas para un solo waveform, difíciles de adaptar al carril de mezcla editable y a la curva de tensión.
- **DOM/SVG**: cientos de miles de elementos para 3 h a 50 picos/s.

## Consecuencias

- ✅ Un mismo paradigma en las 4 vistas; performance estable con horas de audio.
- ✅ Control total del render (bloques de silencio, asas de borde, costuras de bucle, ducking…).
- ⚠️ Coste de mantenimiento: hit-testing y accesibilidad hay que hacerlos a mano (aria-label descriptivos, alternativas en tablas).
