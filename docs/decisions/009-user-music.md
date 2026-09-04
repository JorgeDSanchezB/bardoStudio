# ADR-009 · Música propia del usuario: importar sin re-codificar

**Estado:** Aceptada
**Contexto:** Task 7-mus (petición del usuario: «en fase 3 el usuario podría querer cargar sus propias músicas…»)

## Contexto

El usuario querrá musicalizar con temas propios (no solo la CC0). Esos archivos son de su propiedad y de calidad variable: WAV/MP3/OGG/M4A de hasta 100 MB. Además, para el matching automático la app necesita duración y una banda de tensión de cada pista.

## Decisión

- **Importación múltiple** por diálogo: WAV/MP3/OGG/M4A ≤100 MB vía `POST /api/user-music` (multipart con metadatos).
- **Almacenamiento tal cual** en `db/user-music/` + manifiesto JSON: **nunca se re-codifican ni se toca el audio**; servidos con **Range 206** para audición en streaming.
- **Decodificación local en el navegador al importar** solo para medir duración real y sugerir la **banda de tensión** por RMS del archivo; el usuario edita título/ánimo/tensión/BPM/tonalidad (`PATCH`).
- Las pistas propias viven junto a la CC0 («Tu música · N») con el mismo contrato `Pista` (campo `propia: true`) ⇒ fluyen por matching, mezcla, editor, render e informe **sin código especial**.

## Alternativas consideradas

- **Re-codificar a WAV uniforme**: pérdida de calidad/discos gigantes; innecesario porque el motor decodifica en memoria.
- **Solo metadatos manuales (sin análisis)**: mala sugerencia de tensión y duración inexacta para bucles.

## Consecuencias

- ✅ El usuario controla sus archivos (borrar/editar; el original nunca se altera) y el pipeline los trata como cualquier pista.
- ✅ Sugerencia de tensión basada en la energía real del archivo.
- ⚠️ El manifiesto JSON puede desincronizarse de los archivos ⇒ toda lectura valida ids/extensiones.
- ⚠️ Formatos exóticos dentro del contenedor pueden fallar en `decodeAudioData` (se reporta con error claro al importar).
