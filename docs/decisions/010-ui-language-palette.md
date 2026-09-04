# ADR-010 · Idioma y paleta de la UI

**Estado:** Aceptada
**Contexto:** Task 1 (inicio) · reafirmada en todas las fases

## Contexto

El producto es para hispanohablantes (el usuario escribe en español; el dominio del proyecto —musicalización de narraciones— también). El entorno de desarrollo aplica una restricción de estilo dura: prohibido azul/índigo salvo petición expresa.

## Decisión

- **UI 100 % en español**, incluidos aria-labels, mensajes de error, unidades y formatos de timecode (`HH:MM:SS.mmm`, coma decimal en textos).
- **Paleta zinc/ámbar/esmeralda** sobre tema oscuro propio: ámbar = activo/análisis/voz, esmeralda = aprobado/éxito, rosa/rose = silencios y ducking, colores de ánimo (teal/violeta/orange/red/amber) para pistas y escenas. **Sin azul/índigo.**
- Tipografía mono para timecodes y valores numéricos; jerarquía con `text-zinc-400/500` para texto de apoyo.
- Controles mínimos táctiles ≥44 px; tablas con `max-h` + scroll fino propio.

## Alternativas consideradas

- **i18n desde el inicio**: complejidad sin usuarios no-hispanohablantes; los textos viven centralizados en componentes si algún día hace falta.
- **Paleta por defecto de shadcn (zinc+azul primario)**: incumple la restricción de estilo del entorno.

## Consecuencias

- ✅ Coherencia visual y de tono en las 6 fases; identidad cálida distinguible de un admin genérico.
- ✅ A11y cuidada en español (roles, etiquetas, navegación por teclado, barra espaciadora = play).
- ⚠️ Textos hardcodeados en español: una futura internacionalización requiere pase por todos los componentes.
