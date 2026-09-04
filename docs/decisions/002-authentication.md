# ADR-002 · Autenticación

**Estado:** Aceptada
**Contexto:** Task 1-8 (inicio del proyecto) · revisada en Task 10-docs

## Contexto

Bardo Studio es una herramienta de escritorio-web para un único usuario local: musicaliza sus narraciones con su propia música y guarda sus proyectos en su equipo. NextAuth.js v4 está disponible en el stack. No hay multiusuario, ni contenido compartido, ni datos sensibles de terceros en el servidor.

## Decisión

**Sin autenticación.** Ninguna route handler exige sesión; los endpoints (`/api/proyectos`, `/api/user-music`, `/api/transcribe`…) confían en el origen local. La privacidad del audio se garantiza por diseño: se analiza en el navegador y solo salen texto y archivos que el usuario pide guardar.

## Alternativas consideradas

- **NextAuth con login local**: añade fricción (credenciales, sesiones) sin ningún caso de uso que lo pida.
- **API key estática**: protege contra llamadas externas casuales, pero el servidor ya solo escucha en local tras el gateway.

## Consecuencias

- ✅ Flujo fricción-cero: abrir, trabajar, guardar.
- ✅ Sin superficie de gestión de cuentas.
- ⚠️ Si el proyecto se expone a una red o se convierte en multiusuario, habrá que gatear las rutas de escritura (borrado/actualización de proyectos y música) y las llamadas de IA (coste).
- ⚠️ Las rutas de IA quedan abiertas: en un despliegue público habría que añadir límites de tasa.
