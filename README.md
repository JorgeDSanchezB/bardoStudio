# Bardo Studio

Musicalización **auditable** de narraciones largas (3+ horas): carga la narración y la app transcribe, analiza la tensión dramática, asigna música por escena, mezcla automáticamente con ducking y te deja editarla como en **Camtasia Studio** antes de exportar los archivos finales.

Todo corre **en local**: el análisis de audio ocurre en tu navegador, la música es CC0 (sintetizada) o **la tuya**, y los proyectos se guardan en tu equipo.

## Cómo empezar

```bash
bun run dev   # servidor en http://localhost:3000 (puerto 3000)
```

Abre la app y pulsa **«Demo con voz real (recomendada)»** para recorrer el pipeline completo en 3 minutos de audio.

### Versión de escritorio para Windows

Botón **«Instalador Windows»** de la cabecera (o `/BardoStudio-Setup-1.0.0.exe`, ~151 MB): instalador NSIS en español con todo dentro — servidor Next standalone, biblioteca de música/SFX, demo y **Python embebido para el PDF**. Tras instalar, la app corre sin conexión y guarda tus datos en `%APPDATA%\Bardo Studio` (ver `LEEME-INSTALACION.txt`). Para recompilarlo: `bash desktop/empaquetar.sh` (ADR-012).

## El pipeline de 7 fases

| Fase | Qué hace | Puerta |
|---|---|---|
| 1 · Ingestión | Picos + envolvente RMS, detección de silencios ajustable en vivo | Aprobar silencios |
| 2 · Transcripción | ASR reanudable por bloques + tensión 0–100 y ánimo por escena (LLM); curva corregible | Aprobar curva |
| 2.5 · Efectos (SFX) | Detecta **palabras clave** en la transcripción (trueno, pasos, espada…) y coloca efectos de sonido sincronizados; biblioteca de 37 SFX CC0 + **importa los tuyos** (WAV/MP3…) + auditoría por evento | Aprobar efectos |
| 3 · Música | Biblioteca CC0 (9 pistas) + **importa tu propia música** (WAV/MP3/OGG/M4A ≤100 MB) | Aprobar banda sonora |
| 4 · Mezcla automática | Bloques por escena, crossfades, ducking según voz y silencios; los efectos suenan a su nivel (−12 dB) y respetan el ducking si la config lo dice | Aprobar arreglo |
| 5 · Editor tipo Camtasia | Escucha en vivo (voz + música + **efectos**, cada uno con su medidor): cuchilla, mover, **recortar/alargar por los bordes** (con bucle automático), silenciar, cambiar pista o archivo, volumen por clip, añadir efectos en el cursor | Aprobar mezcla |
| 6 · Exportación | Render offline: mezcla + stems (voz/música/**efectos**) + informe PDF con la sección de SFX | Descarga |

## Características destacadas

- **Efectos de sonido automáticos (SFX)**: la Fase 2.5 analiza la transcripción en busca de **381 palabras clave** (ES/EN, con sinónimos, plurales y derivados — *truenos*, *thunder*, *rugiendo*…) y coloca el efecto correspondiente en el segundo exacto de cada mención. Todo auditable: activa, cambia, desplaza, silencia o añade efectos a mano; el diccionario es editable (panel + `config/sfx_config.json`) y también puedes **importar tus propios SFX** (WAV/MP3 ≤30 MB, servidos desde `db/user-sfx/`). En la Fase 5 los clips de efectos se editan como bloques de música (arrastrar, cuchilla, bordes, volumen por clip) y la exportación hornea la pista «Efectos» con su propio stem.
- **Edición por bordes estilo Camtasia**: mantén pulsado el borde de un bloque para comprimirlo o alargarlo; el borde izquierdo decide en qué segundo del tema original entra la música y el derecho estira la pista en bucle.
- **Proyectos guardables**: «Guardar / Guardar como copia / Abrir / Eliminar», archivo portátil **`.bsproj`** con el análisis incrustado y re-adjunte de audio tras recargar (como Camtasia).
- **Tu música**: importación múltiple, metadatos editables, banda de tensión sugerida por la energía real del archivo; los archivos originales **nunca se re-codifican**.
- **Trazabilidad**: cada edición queda registrada («Entrada recortada a 00:00:08.388»…) y el informe PDF documenta todo el proceso.
- **Archivos de 3+ horas**: la línea de tiempo es virtualizada (se dibuja solo lo visible) y el análisis va por bloques ≤5 min con RAM acotada.

## Stack

Next.js 16 (App Router) · TypeScript 5 · Tailwind CSS 4 · shadcn/ui · Zustand (+persist + IndexedDB) · Web Audio API · Canvas 2D · z-ai-web-dev-sdk (ASR + LLM, solo backend).

## Documentación

| Documento | Contenido |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | Guía de agente: comandos, reglas del proyecto, protocolo de verificación |
| [`docs/architecture.md`](docs/architecture.md) | Arquitectura completa: pipeline, módulos, modelo de datos, persistencia, API |
| [`docs/current-state.md`](docs/current-state.md) | Estado actual del proyecto y limitaciones conocidas |
| [`docs/decisions/`](docs/decisions/) | Decisiones de arquitectura (ADRs) numeradas y contextuadas |
| [`worklog.md`](worklog.md) | Bitácora de trabajo acumulativa por tarea (fuente primaria de historia) |

## Estructura del repositorio

```
├── AGENTS.md            # guía de agente (espejo de CLAUDE.md)
├── CLAUDE.md            # guía de agente principal
├── README.md            # este archivo
├── docs/
│   ├── architecture.md  # arquitectura técnica
│   ├── current-state.md # estado actual
│   └── decisions/       # ADRs: 001-database, 002-authentication, …
├── config/              # config.json (Mapa de Atributos Dinámicos)
├── db/                  # proyectos guardados + user-music (originales)
├── prisma/              # schema.prisma (disponible, aún sin uso activo)
├── public/demo/         # WAVs demo deterministas
├── scripts/             # generador del demo sintético
├── src/                 # aplicación (app/, components/, lib/, store/)
├── tests/               # reservado para pruebas
└── worklog.md           # bitácora de trabajo
```

> Nota de licencia sobre la música: la biblioteca CC0 se sintetiza localmente y la música que importes sigue siendo tuya; los archivos se guardan tal cual en tu equipo.
