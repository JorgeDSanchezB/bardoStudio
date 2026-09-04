# ADR-008 · Persistencia de proyectos estilo Camtasia (`.bsproj` + servidor)

**Estado:** Aceptada
**Contexto:** Task 7-mus (petición del usuario: «al igual que en camtasia studio puedo guardar mi proyecto y volver después a él para modificarlo»)

## Contexto

El usuario quiere cerrar la app y volver después: audio, análisis, 6 fases aprobadas y ediciones intactas. Además, como en Camtasia, llevarse el proyecto a otro equipo y re-adjuntar medios si falta el audio.

## Decisión

Dos formatos complementarios:

1. **Servidor local** (`/api/proyectos`): cada proyecto = audio original **sin tocar** + **`.bsproj`** (estado) + **`.an`** (pack binario BSAN de picos+envolvente). Operaciones: Guardar / Guardar como copia (update por `meta.id`), Abrir (restaura audio vía Range + análisis del pack ⇒ **sin re-analizar**), Eliminar, lista con progreso X/6 y aviso «sin audio».
2. **`.bsproj` portátil descargable**: mismo estado con el análisis **embebido en base64**; «Importar .bsproj» lo restaura en otro equipo/navegador.

Flujo de medios: si al reabrir falta el audio (p. ej. proyecto importado), aparece el panel **«Re-adjuntar el audio original»** con verificación de coincidencia. La restauración tras recarga cubre también proyectos del servidor (audio incluido). El store valida todo lo entrante con `parsearProyecto`/`aplicarProyecto` (clamps y filtros campo a campo).

## Alternativas consideradas

- **Solo localStorage**: no sobrevive cambios de navegador ni se puede compartir; y la cuota impide el audio.
- **Guardar el audio re-codificado/comprimido**: viola la regla de jamás re-codificar y ralentiza el guardado.

## Consecuencias

- ✅ Volver después y seguir editando/exportando es idéntico a Camtasia; el proyecto viaja en un archivo.
- ✅ Reapertura sin re-análisis (pack BSAN) y audio en streaming (Range 206).
- ⚠️ Estado servidor duplicado con el del navegador ⇒ el store necesita validadores defensivos profundos.
- ⚠️ Los archivos `.bsproj` con análisis embebido pesan MBs (aceptable; el audio va aparte).
