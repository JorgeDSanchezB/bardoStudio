# ADR-013: Relé de IA para la app de escritorio (fix Fase 2)

## Contexto

Tras instalar `BardoStudio-Setup-1.0.0.exe`, la Fase 2 fallaba de forma
crítica con:

> El servicio de transcripción falló (Petición inválida: Configuration file
> not found or invalid. Please create .z-ai-config in your project, home
> directory, or /etc.)

Causa raíz (doble):

1. El instalador **no empaquetaba** `.z-ai-config` (decisión de ADR-012:
   «credenciales no empaquetadas, el usuario pone las suyas»), pero la app
   no ofrecía ningún mecanismo para que el usuario las pusiera.
2. Aunque se hubieran empaquetado, **no habrían funcionado**: la API de IA
   (`https://internal-api.z.ai/v1`) resuelve (DNS público incluido, vía DoH
   Google/Cloudflare) a IPs privadas `172.25.x.x` (ALB interno de Aliyun).
   Solo es alcanzable desde la red del servidor de la web, no desde el
   Windows del usuario.

La app de escritorio ejecuta el servidor Next localmente, por lo que sus
llamadas al SDK (`/api/transcribe`, `/api/analyze-tension`) salen desde el
equipo del usuario → imposibilitado por la red.

## Decisión

**Relé de IA a través de la web pública + diálogo «Ajustes de IA»**:

1. **`POST /api/ia/<ruta>` (web)** — relé con whitelist exacta
   (`chat/completions`, `audio/asr`): reenvía al servicio interno con las
   credenciales del servidor (mismas prioridades de `.z-ai-config` que el
   SDK: cwd → home → /etc), pasando el estado/cuerpo tal cual (los 429 del
   upstream conservan la semántica de reintento del cliente). Protecciones:
   tope de 8 MB, timeout 120 s, solo POST,configs «relé» ignorados al
   cargar credenciales (evita reenviar un relé a otro relé) y guardia
   anti-auto-reenvío normalizando localhost/127.0.0.1/[::1] (Next puede
   informar el host como `localhost` aunque la petición llegue por
   `127.0.0.1`).
2. **`/api/ia-config` (GET/POST/DELETE)** — gestión de la conexión:
   - GET: estado (`servidor` | `rele` | `ninguno`) sin secretos.
   - POST `{url}`: normaliza (origen o `…/api/ia`), **prueba real**
     (chat mínimo), rechaza autoconexión (bucle) y credenciales manuales
     (409), y escribe `.z-ai-config` en el cwd del servidor (en el
     escritorio: `%APPDATA%\Bardo Studio\app\.z-ai-config`, exactamente
     la primera ruta que busca el SDK y que `main.cjs` conserva entre
     versiones). El SDK local queda apuntando al relé **sin cambios de
     código en las rutas existentes**.
   - DELETE: quita la conexión de relé; nunca toca credenciales manuales.
3. **Diálogo «Ajustes de IA»** (`ajustes-ia-dialog.tsx`) en la cabecera:
   - Web: badge «conectada» + URL de la propia web con botón de copiar
     (para pegarla en la app de escritorio).
   - Escritorio: campo URL + «Conectar» (prueba real) / «Probar» /
     «Desconectar»; mensajes de error accionables.
4. **Alerta Fase 2 accionable**: cuando el error contiene la firma del SDK
   («Configuration file not found») o el nuevo mensaje traducido
   («Ajustes de IA»), la Fase 2 muestra un alerta ámbar con botón
   «Conectar la IA…» que abre el diálogo directamente (el resto de
   errores mantiene el alerta rojo técnico). `/api/transcribe` traduce
   esa firma a un mensaje en español con instrucciones.
5. **Punto ámbar en el engranaje** de la cabecera cuando `modo=ninguno`
   (consulta `/api/ia-config` al montar; en la web nunca salta porque
   `/etc/.z-ai-config` existe).

Bump de versión **1.0.1** (para que los equipos con 1.0.0 reinstalen los
recursos: `main.cjs` solo recopia si cambia la versión, conservando `db/`
y `.z-ai-config`). El botón «Instalador Windows» de la cabecera pasa a
`BardoStudio-Setup-1.0.1.exe`.

## Alternativas descartadas

- **Empaquetar `/etc/.z-ai-config`**: inútil (endpoint con IPs privadas
  RFC1918, inalcanzable desde el equipo del usuario). Verificado con DoH.
- **Relé embebido por defecto**: requiere conocer la URL pública de la
  web en tiempo de compilación y la acopla de forma frágil; se prefirió
  un pegado único verificable por el usuario (la URL se copia con un
  botón desde la propia web).
- **Whisper local embebido**: cubriría el ASR pero no el análisis de
  tensión (chat), añadiría ~100 MB al instalador y binarios de terceros
  sin poder probarlos en Windows desde aquí.
- **UI de credenciales propias completas**: el usuario no dispone de
  credenciales compatibles con el SDK; se mantiene como opción avanzada
  documentada (archivo manual con prioridad y nunca sobrescrito).

## Consecuencias

- ✅ La Fase 2 de la app instalada funciona (transcripción real probada a
  través del relé: 320 ms por bloque en la simulación completa).
- ✅ La web no cambia su comportamiento (usa `/etc` directamente) y sus
  credenciales nunca salen del servidor (el relé actúa solo de puente).
- ⚠️ La app de escritorio necesita la web accesible mientras use la IA
  (transcripción/tensión); documentado honestamente en el LEEME. El
  editor, la mezcla, los efectos y la exportación siguen 100 % locales.
- ⚠️ Superficie del relé: expone las dos rutas de IA con las cuotas del
  proyecto a quien conozca la URL pública — equivalente a lo ya expuesto
  por `/api/transcribe` y `/api/analyze-tension` (no nueva clase de
  riesgo); el whitelist impide cualquier otro uso del proxy.
