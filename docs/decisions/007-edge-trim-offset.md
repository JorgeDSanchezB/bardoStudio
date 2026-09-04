# ADR-007 · Edición por bordes estilo Camtasia con `offsetOrigen`

**Estado:** Aceptada
**Contexto:** Task 8-bordes (petición del usuario: «en camtasia studio se pueden manipular las postas de audio comprimiéndolas y alargándolas con un simple click mantenido en sus bordes»)

## Contexto

La Fase 5 tenía cuchilla/mover/eliminar/silenciar/cambiar pista, pero no el gesto central de Camtasia: **mantener pulsado el borde de un clip para comprimirlo o alargarlo**. Además, recortar la entrada de un clip debe revelar o descartar contenido *de la pista original*, no solo mover el recorte en el tiempo.

## Decisión

1. **`BloqueMusica.offsetOrigen?: number`** — punto de entrada dentro de la pista original (0/ausente = desde el principio). Semántica:
   - **Borde izquierdo** hacia dentro ⇒ recorta la entrada y **avanza** el offset (la música entra más adentro del tema).
   - **Borde izquierdo** hacia fuera ⇒ **revela** contenido previo, con tope en el segundo 0 de la pista (`inicioMin = inicio − offset`).
   - **Borde derecho** hacia fuera ⇒ estira el bloque; si la pista se agota, **continúa en bucle** (`% durBuffer`, costuras punteadas en la UI, `buclesDe` para la etiqueta «bucle×N»).
2. **Función pura** `recortarBloque(bloques, id, lado, valor, duracionSec)` con `limitesBorde` **compartido entre vista previa y commit** (el arrastre en vivo clampea igual que el resultado).
3. **Propagación**: la cuchilla reparte el offset entre mitades (la derecha continúa donde la izquierda dejó); `cambiarPista` lo resetea a 0.
4. Persistido y validado en el store (`validarBloque` clampea 0–86400, defecto 0 ⇒ proyectos antiguos compatibles); respetado por motor vivo y render offline (ADR-005).

## Alternativas consideradas

- **Solo recortar en el tiempo** (estirar = rellenar con silencio): traiciona la expectativa de Camtasia (la música sigue sonando).
- **Time-stretch DSP** (estirar el audio deformándolo): carísimo y cambia el carácter musical; el bucle logra «alargar» gratis.

## Consecuencias

- ✅ Gesto Camtasia completo con vista previa viva, cursor `ew-resize`, asas visibles y trazabilidad («Entrada recortada a…» / «Salida alargada hasta…»).
- ✅ Proyectos antiguos y demás ediciones intactos (offset ausente = 0).
- ⚠️ El concepto de offset cruza todas las capas (tipos, ediciones, motor, render, store, .bsproj) — toda la cadena lo debe respetar.
