# Estado actual — Bardo Studio

Última verificación completa: **Task 9-verif** (E2E real con agent-browser, ver `worklog.md`). Estado general: **pipeline 6/6 fases completo, integrado y verificado de punta a punta**.

## Funcionalidad por fase

| Fase | Estado | Incluye |
|---|---|---|
| 1 · Ingestión | ✅ completa | WAV exacto + comprimidos, picos/envolvente, silencios ajustables en vivo, restauración tras recarga |
| 2 · Transcripción | ✅ completa | ASR reanudable por bloques, tensión+ánimo LLM, curva arrastrable, escenas y transcripción con CSV |
| 3 · Música | ✅ completa | 9 pistas CC0 + importación de música propia (multi-archivo, metadatos, sugerencia de tensión), asignación auto/manual |
| 4 · Mezcla | ✅ completa | bloques/crossfades/ducking con parámetros editables y vista previa |
| 5 · Editor Camtasia | ✅ completa | motor Web Audio en vivo, cuchilla, mover, **recorte/alargado por bordes** (offset + bucle), silenciar, cambiar pista, medidores |
| 6 · Exportación | ✅ completa | render offline (mezcla + stems) + informe PDF |

## Hitos recientes (ver `worklog.md`)

- **Task 7-mus** — música propia del usuario (importar/editar/audicionar/asignar, archivos nunca re-codificados) y proyectos estilo Camtasia (guardar/abrir/copias, `.bsproj` portátil, re-adjunte, restauración total tras recarga). Incluye la corrección del bug latente de materialización (Fase 5 usaba la mezcla inicial en vez de la aprobada).
- **Task 8-bordes** — manipulación de bordes estilo Camtasia en Fase 5: arrastre del borde para comprimir/alargar, `offsetOrigen` persistido (motor vivo, render offline, cuchilla con continuidad, inspector, trazabilidad).
- **Task 9-verif** — re-verificación E2E real de bordes (recorte 0→8.4, alargado 20→26, revelado 8.4→5 con offsets correctos) + reproducción + limpieza de estado.
- **Task 10-docs / 11** — documentación de agente y esta estructura `docs/`.

## Datos vivos en el servidor (no tocar en limpiezas)

- `db/user-music/` — pista propia del usuario: `propia-001-the-four-seasons-spr-09cf77` (*The Four Seasons, Spring Op-81 1-Allegro*, 218 s), usada por el auto-asignador del flujo dorado. **Conservar.**
- `db/proyectos/` — sin proyectos residuales (las pruebas se borran tras cada E2E).

Estado de primera visita: limpio (localStorage `bardo-project-v1` e IndexedDB `bardo-studio` vacíos tras la última limpieza).

## Limitaciones conocidas y notas operativas

- **429 del ASR**: gestionados con reintentos y pausas entre solicitudes; la transcripción es reanudable por bloque, así que un fallo puntual no pierde progreso.
- **Deshacer/rehacer granular**: no existe histórico por edición; la puerta ofrece «Descartar ediciones» (vuelve al arreglo automático de la Fase 4). Un undo granular sería una mejora natural.
- **Solapes de bloques**: permitidos a propósito (como Camtasia, dos bloques suman); no hay «magnetismo» entre bordes.
- **Audio tras recarga** (proyecto no guardado): el archivo original no está en memoria; la app muestra el panel «Re-adjuntar el audio original» y la edición sigue disponible. Los proyectos guardados en el servidor restauran el audio solos.
- **Prisma**: instalado y configurado (`prisma/schema.prisma` + `bun run db:push`) pero **sin uso activo** — la persistencia actual es localStorage/IndexedDB + archivos (ver ADR-001). Disponible si el proyecto crece hacia multiusuario o catálogos relacionales.
- **tests/**: carpeta reservada, sin pruebas (política actual: verificación E2E con agent-browser + lint + tsc).

## Ideas futuras candidatas

- Undo/redo granular de ediciones (stack de `aplicarEdicionFase5`).
- Atajo de teclado para el recorte por bordes y asas más grandes en pantallas táctiles.
- Exportación por capítulos o marcadores; cola de render en background.
- Zoom/selección por arrastre en la regla (marquee) para cortes múltiples.
