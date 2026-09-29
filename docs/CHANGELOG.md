# Registro de cambios

| Versión | Fecha | Cambio | Razón | Impacto | Prueba | Plan de reversión |
| --- | --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-09-28 | Base del repositorio, app web mínima con health check, CI | Paso 1 de V1 | Ninguno para usuarios (PLACEHOLDER) | typecheck, build, health contra base real | Revertir commit |
| 0.1.0 | 2026-09-28 | Migraciones 0001–0008: identidad, proyectos, IA, herramientas, búsqueda, noticias, productos, descargas, leads, sistema, catálogos | Paso 2 de V1 | Esquema inicial | 87 pruebas; down/up completo idéntico | `npm run rollback --workspace @lombana/db -- all` (en base sin datos) |
| 0.1.0 | 2026-09-28 | Migración 0009: YouTube (integraciones, videos, subidas) | Pedido del propietario | Módulo nuevo en diseño | Pruebas de YouTube y regresiones | `npm run rollback --workspace @lombana/db` |
| 0.1.0 | 2026-09-28 | Correcciones de 13 hallazgos de seguridad (3 rondas de revisión) | Revisión independiente | Reglas más estrictas en membresías, productos, archivos, videos, auditoría | Regresión por hallazgo en `security-regressions.test.ts` | Incluidas en las migraciones 0001–0009 |
| 0.1.1 | 2026-09-29 | TypeScript declarado en apps/web | Build de Vercel fallaba | Despliegue funciona | Build limpio desde apps/web | Revertir commit |
| 0.1.2 | 2026-09-29 | Migración 0010 (rol de migración, cierre de roles de Supabase), conexión SSL, workflow de migración | Preparar Supabase | Sin cambio para usuarios | 90 pruebas + simulación tipo Supabase | `db:rollback` (0010 no reabre permisos a propósito) |

Nota: al no existir aún ninguna base desplegada, las migraciones 0001–0009 se editaron en lugar de añadir nuevas. **Desde el primer despliegue, las migraciones aplicadas son inmutables** (el migrador lo verifica por checksum) y todo cambio va en una migración nueva.
