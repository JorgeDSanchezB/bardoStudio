# ADR-001 · Base de datos / persistencia

**Estado:** Aceptada
**Contexto:** Task 1-8 (inicio del proyecto) · revisada en Task 10-docs

## Contexto

Bardo Studio maneja: estado de 6 fases (KB–decenas de KB), picos/envolvente de audio de 3+ h (Float32Array de MBs), archivos de audio originales (decenas–cientos de MB) y manifiestos de música. El stack ofrece Prisma + SQLite. Requisito duro: todo local, sin servicios externos, RAM acotada, y el audio jamás re-codificado.

## Decisión

**No usar Prisma/SQLite para la persistencia core.** Cuatro capas especializadas:

1. **localStorage** (`bardo-project-v1`, vía zustand `persist`) — estado de fases, silencios, escenas, bloques, parámetros.
2. **IndexedDB** (`bardo-studio`) — picos y envolvente (binarios grandes; sobrevive recargas sin re-analizar).
3. **Sistema de archivos** (`db/proyectos/`, `db/user-music/`) — audio original y música del usuario **tal cual**, servidos por route handlers con **Range 206** para streaming.
4. **Archivo portátil `.bsproj`** — estado + análisis embebido en base64 (pack binario BSAN), para compartir/reabrir entre equipos.

## Alternativas consideradas

- **SQLite/Prisma para todo**: obligaría a trocear blobs binarios y volcar audio por la API; añade fricción sin beneficio para una app de un solo usuario.
- **Todo en localStorage**: cuota insuficiente para picos de 3+ h.
- **Servidor de archivos + IndexedDB sin pack portátil**: perdía el flujo Camtasia de llevarse el proyecto a otro equipo.

## Consecuencias

- ✅ Cada dato vive en la capa que mejor le sienta (estado liviano, blobs indexados, archivos intactos).
- ✅ Restauración tras recarga sin re-análisis; proyectos reabribles con re-adjunte de medios como Camtasia.
- ⚠️ La validación de proyectos entrantes es manual y defensiva (`parsearProyecto`, `aplicarProyecto` en el store) en vez de restricciones de esquema SQL.
- ⚠️ Prisma queda instalado y listo (`bun run db:push`) pero sin uso activo; migrar en el futuro exige un paso de datos.
