# ADR 0003 — YouTube: estructurar videos y publicarlos en el canal del usuario

- **Fecha:** 2026-09-28
- **Estado:** Aceptada en diseño; publicación BLOCKED hasta tener credenciales y aprobación de Google.

## Hechos verificados

Documentación oficial de YouTube Data API v3, `videos.insert`, consultada el 2026-09-28:
<https://developers.google.com/youtube/v3/docs/videos/insert>

- Subir exige autorización OAuth del dueño del canal (scope `youtube.upload` u otro equivalente).
- Las subidas tienen su propia cuota: 100 llamadas por día.
- Proyectos de API sin verificar creados después del 28 de julio de 2020 suben videos restringidos a **privado** hasta pasar una auditoría de cumplimiento.

## Decisión

1. **V1 estructura el video**: guion con gancho, secciones y llamada a la acción; capítulos con marcas de tiempo; título, descripción, etiquetas y concepto de miniatura. Herramienta `youtube-video-planner`.
2. **El usuario sube su archivo de video.** Generar el video renderizado no está en V1 (depende de un proveedor de video; herramienta `video-generator` PLANNED).
3. **Publicar** (`youtube-publisher`, BLOCKED): el usuario conecta su canal por OAuth; aprueba el video; la app encola la subida; un worker privilegiado la ejecuta y registra el resultado real, incluida la privacidad que YouTube aplicó.
4. Mientras `youtube.api_project_audited = false`, la base solo acepta subidas **privadas**. La interfaz lo dice claramente, sin simular publicaciones públicas.

## Lo que impone la base de datos

- Integración "conectada" solo con cuenta externa identificada y fecha real.
- Tokens OAuth cifrados en `integration_secrets`, inaccesibles para la app.
- Aprobación fresca, en nombre propio, con permiso `video.publish` y archivo escaneado limpio; solo desde borrador.
- Un video aprobado no se edita; volver a borrador retira la aprobación.
- La app solo encola (columnas mínimas); los resultados los escribe el worker.
- Una sola subida activa por video.

## Pendiente (REQUIERE CREDENCIAL / REQUIERE APROBACIÓN)

- Proyecto en Google Cloud con YouTube Data API v3 habilitada.
- Pantalla de consentimiento OAuth verificada por Google.
- Auditoría de YouTube para permitir subidas públicas.
