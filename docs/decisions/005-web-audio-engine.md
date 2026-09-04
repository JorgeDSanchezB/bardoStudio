# ADR-005 · Doble motor de audio: Web Audio en vivo + render offline

**Estado:** Aceptada
**Contexto:** Tasks 5-8 (Fases 5 y 6) · consolidada en Task 8-bordes

## Contexto

La Fase 5 necesita escuchar la mezcla editándose **en vivo** (cambios audibles al instante) y la Fase 6 necesita renderizar el resultado exacto a archivos. Riesgo clásico: que lo que se escucha no sea lo que se exporta.

## Decisión

**Dos motores que comparten el mismo modelo de bloques** (`BloqueMusica[]` + params):

- **`lib/fase5/motor.ts` (`MotorMezcla`)** — reproducción Web Audio en vivo: voz + buffers de pista decodificados en memoria, ducking calculado contra la envolvente, crossfades, medidores (`medir()`), `reconfigurar()` sin reconstruir cuando solo cambian bloques/parámetros y los buffers siguen válidos; invalidación y re-decodificación si cambia la fuente o faltan pistas.
- **`lib/fase6/render.ts`** — render offline (Sample-rate exacto, normalización opcional) que recorre los mismos bloques y produce mezcla + stems.

Ambos usan la misma fórmula de arranque: `src.start(cuando, (offsetOrigen + avance) % durBuffer)` — punto de entrada y bucle idénticos en vivo y en export.

## Alternativas consideradas

- **Renderizar a WAV en cada cambio y reproducirlo**: segundos de latencia por edición; inaceptable para afinar a oído.
- **Un solo motor offline con preview aproximada**: divergencia entre escucha y export (el bug clásico).

## Consecuencias

- ✅ Ediciones audibles al instante; export fiel a lo aprobado (misma fórmula de bucle/offset).
- ✅ La reaprobación de Fase 5 reinicia Fase 6 y se re-renderiza exactamente lo oído.
- ⚠️ Duplicidad conceptual: todo cambio de semántica de bloques (offset, bucles, fades) debe reflejarse en ambos motores.
- ⚠️ El motor vivo requiere `AudioContext` con gesto de usuario y decodifica bajo demanda (spinner «Decodificando…»).
