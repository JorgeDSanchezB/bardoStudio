# ADR-003 · Procesamiento de audio 100 % en el navegador, por bloques

**Estado:** Aceptada
**Contexto:** Task 1 (diseño de la Fase 1)

## Contexto

La spec exige narraciones de **3+ horas** con RAM acotada y privacidad (el audio del usuario no debe viajar al servidor sin necesidad). El navegador debe calcular picos y envolvente de WAV/MP3/M4A/OGG.

## Decisión

- **WAV**: parse RIFF exacto propio y lectura **secuencial por bloques** (PCM 8/16/24/32 + float32) — sin decodificar nada completo.
- **MP3/M4A/OGG**: `decodeAudioData` **por bloques con carry alineado** a la rejilla global; fallback a decodificación única a 8 kHz si el navegador limita.
- Cómputo en **Web Worker con transferibles** (respaldo inline): picos 50/s + envolvente RMS 100 ms en rejilla global alineada.
- Análisis por bloques **≤5 min** (largos 300 s / cortos 60 s) con progreso por bloque.

## Alternativas consideradas

- **Decodificar el archivo entero**: ~3 h estéreo 44.1 kHz ≈ GBs en RAM — inviable.
- **Decodificar en el servidor**: rompe la privacidad y añade latencia/infraestructura.

## Consecuencias

- ✅ RAM acotada y barra de progreso real por bloques; funciona con archivos enormes.
- ✅ Privacidad: del audio solo salen fragmentos de texto al ASR (Fase 2).
- ⚠️ Comprimidos exóticos pueden caer al fallback a 8 kHz (envolvente válida, calidad de onda menor).
- ⚠️ Dos rutas de código (WAV exacto vs decodeAudioData) que mantener sincronizadas con la misma rejilla.
