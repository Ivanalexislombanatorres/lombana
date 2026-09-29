# ADR 0002 — Aislamiento multi-organización en la base de datos (RLS)

- **Fecha:** 2026-09-28
- **Estado:** Aceptada

## Decisión

El aislamiento entre organizaciones lo impone PostgreSQL, no solo el código de la aplicación.

| Pieza | Qué hace |
| --- | --- |
| Rol `lombana_app` | Único rol con el que corre la aplicación. `NOBYPASSRLS`, no es dueño de tablas, sin TEMP. |
| `app.set_context(user, org)` | Fija usuario y organización activa **solo para la transacción**. Lo llama `withTenant`. |
| Políticas RLS | Toda tabla con `org_id` tiene RLS activado **y forzado**. Una fila es visible si pertenece a la organización activa y el usuario es miembro activo. |
| FK compuestas `(id, org_id)` | Una fila hija no puede apuntar a un padre de otra organización. |
| Permisos por rol | Leads, descargas, auditoría y consumo de IA exigen permiso explícito además de membresía. |
| Rol `lombana_privileged` | Marca a los actores de moderación/administración. Las funciones `SECURITY DEFINER` corren como su dueño, que pertenece a este rol. Las guardas de negocio aplican a todo actor no privilegiado. |
| Tablas append-only | Eventos, auditoría, versiones, consumo de IA, consentimientos: sin UPDATE; DELETE solo por cascada privilegiada. |
| Secretos | `download_tokens` e `integration_secrets`: RLS sin políticas y cero privilegios para la app. |

## Supuesto de confianza (explícito)

`set_context` confía en el usuario que la aplicación le pasa. RLS protege contra **errores** del código (una consulta sin filtro), no contra un servidor de aplicación comprometido o una inyección SQL. Por eso toda consulta usa parámetros y el paso de Auth valida la sesión antes de fijar el contexto.

## Requisito de despliegue

El rol dueño de las tablas (el que ejecuta migraciones) debe:

- tener `BYPASSRLS` (o ser superusuario), porque las tablas usan `FORCE ROW LEVEL SECURITY` y las funciones privilegiadas corren como ese dueño;
- ser miembro de `lombana_privileged`.

En Supabase: **REQUIERE VALIDACIÓN** de qué atributos tiene el rol `postgres` del proyecto antes de migrar.

## Cómo se verifica

`packages/db/test/schema-guards.test.ts` falla si una tabla nueva con `org_id` no tiene RLS forzado, si una tabla sin RLS no está en la lista de catálogos de solo lectura, si una vista no respeta RLS, o si una función de `app` queda ejecutable por PUBLIC. Se comprobó que la guarda detecta una tabla mal configurada (prueba negativa deliberada).
