# ADR-014 · IA reemplazable: proveedores múltiples para la Fase 2

**Estado**: aceptado · **Fecha**: 2026-09-07 · **Versión**: 1.0.2

## Contexto

La 1.0.1 resolvió el fallo de Fase 2 en la app instalada con un RELÉ: la
web reenviaba las peticiones de IA con sus credenciales y el escritorio se
conectaba a la URL de la web (ADR-013). El usuario lo rechazó como
arquitectura para un «programa serio»: la app no puede depender de UNA IA
externa que SOLO el servidor web de Bardo Studio puede alcanzar.
Requisito nuevo: la IA debe ser **reemplazable por una o varias APIs de
distintas IA**.

## Decisión

1. **Abstracción `ProveedorIa`** (`src/lib/server/ia.ts`):
   `transcribirWav(base64)` + `chat(sistema, usuario)` + `nombre`.
   `/api/transcribe` y `/api/analyze-tension` llaman al proveedor activo,
   nunca al SDK directamente.
2. **Tres proveedores**:
   - `zai` (incluida): el SDK de Z.AI leyendo `.z-ai-config`
     (cwd → home → /etc). En la web funciona directa; en el escritorio ese
     archivo es el puntero al relé de la 1.0.1 (compatible).
   - `openai`: API propia **compatible con el formato de OpenAI**
     (OpenAI, Groq, Mistral, servidores locales whisper.cpp/LM Studio…).
     ASR por `/audio/transcriptions` (multipart) y chat por
     `/chat/completions`. El usuario pone SU URL base, SU clave y SUS
     modelos. Cubre decenas de servicios con UNA sola implementación.
   - `deepgram`: `/v1/listen` (nova-2, español). Solo ASR; la tensión cae
     a la heurística local existente.
3. **Configuración del usuario**: `.bardo-ia.json` junto al servidor
   (cwd; `%APPDATA%\Bardo Studio\app` en el escritorio), permisos 600,
   NUNCA empaquetado (exclusiones en empaquetar.sh) ni expuesto por GET
   (solo pistas `••••1234`). Se conserva entre versiones (main.cjs).
   Resolución del activo: selección explícita → Z.AI si hay config →
   «ninguno» (aviso accionable).
4. **Gestión `/api/ia-proveedores`** (GET/POST/DELETE): guarda con
   **PRUEBA REAL** antes de escribir (chat mínimo y/o transcripción de
   0,5 s generada al vuelo; Deepgram con 0,5 s). Clave vacía = conservar
   la guardada (cambiar solo URL/modelos). La ruta reemplaza a
   `/api/ia-config` (borrada) e incluye su lógica de relé intacta
   (normalización, guardia anti-bucle, ping real, no pisar credenciales
   manuales). El relé `/api/ia/[...ruta]` se conserva tal cual.
5. **UI**: «Ajustes de IA» con pestañas (Incluida / API propia /
   Deepgram), preajustes que rellenan URL+modelos, clave ocultable,
   pruebas con resultado en línea, estado enmascarado y «Quitar».

## Consecuencias

- La app de escritorio puede transcribir con servicios públicos
  (OpenAI/Groq/…) o un servidor LOCAL, sin depender de la web de Bardo
  Studio. El relé pasa a ser UNA opción más, no el único camino.
- Las claves del usuario viven en su equipo, no en el servidor web.
- La heurística local de tensión garantiza que la Fase 2.5+ nunca se
  bloquea aunque el proveedor no tenga chat.
- Coste: una prueba real de 0,5 s al guardar una API propia (una vez);
  complejidad de tres formularios en la UI.
- Verificación E2E: mock OpenAI-compatible local (mini-services/ia-mock)
  — guardar/probar → transcribir → analizar → quitar, más zai real.
