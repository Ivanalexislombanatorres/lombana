# Arquitectura de LOMBANA ESTUDIOS v1.0

## Visión general

Monolito modular: un solo proceso FastAPI sirve la API y la interfaz React ya compilada. Está preparado para separar servicios (gateway de IA, runtime) si el crecimiento lo justifica, porque cada componente vive en su propio paquete y se comunica por funciones/servicios, no por variables globales.

```
Navegador ──► FastAPI (127.0.0.1:8000)
                ├─ /api/...            LOMBANA ERP FACTORY  ─► lombana_factory (base central)
                ├─ /api/erps (+gen)    ERP GENERATOR        ─► crea erp_<sector>_NNN + migraciones
                ├─ /api/rt/{slug}/...  ERP RUNTIME          ─► SOLO la base del ERP {slug}
                ├─ /api/ai/...         LOMBANA AI GATEWAY   ─► proveedores de IA (adaptadores)
                └─ /*                  interfaz React (frontend/dist)
```

## Modos de despliegue

| Modo | Base de datos | Aislamiento por ERP | Respaldos | Uso |
|---|---|---|---|---|
| Local | SQLite | un archivo por ERP | carpeta `backups` | un usuario, sin internet |
| Servidor propio | PostgreSQL | una base por ERP | carpeta `backups` | varios usuarios en red |
| Nube (Vercel + Supabase) | PostgreSQL | **un esquema por ERP** en una sola base | tabla `backup_files` | internet |

En modo nube (`api/index.py`) cada consulta se reescribe con el esquema del ERP (`schema_translate_map`), lo que funciona detrás del *Transaction pooler* de Supabase. Las conexiones no se reutilizan entre invocaciones (`NullPool`), las migraciones toman un bloqueo (`pg_advisory_xact_lock`) para que dos instancias no migren a la vez, la clave maestra es obligatoria por variable de entorno, el bloqueo de intentos se guarda en la base y crear el primer administrador exige `LOMBANA_SETUP_CODE`.

## Estructura del proyecto

| Ruta | Contenido |
|---|---|
| `backend/app/core` | Configuración, seguridad (bcrypt, JWT, cifrado Fernet), dependencias y limitador de intentos |
| `backend/app/factory` | Modelos de la base central y API de la fábrica (ERP, clientes, planes, licencias, marca, respaldos, auditoría) |
| `backend/app/erp_generator` | Esquemas validados de configuración y marca, catálogo de módulos y plantillas, servicio de creación/versionado/publicación/duplicado |
| `backend/app/erp_runtime` | Modelos y API de cada ERP: usuarios, roles, permisos, clientes, proveedores, productos, ventas, inventario, registros personalizados, reportes, auditoría |
| `backend/app/database` | Motor de bases: conexión por ERP, creación, migraciones Alembic, respaldos y restauración |
| `backend/app/formulas` | Motor de fórmulas restringido (AST + Decimal) y su API |
| `backend/app/ai_gateway` | Adaptadores de proveedores, enrutamiento por tarea, límites, registro y agentes |
| `backend/migrations/factory`, `/tenant` | Migraciones Alembic de la base central y de las bases de ERP |
| `templates/sectores/*.json` | Plantillas de sector (editables; generadas por `scripts/_generar_plantillas.py`) |
| `frontend/src/factory` | Pantallas de la fábrica (tema oscuro + dorado) |
| `frontend/src/runtime` | Pantallas del ERP del cliente (tema según su marca) |
| `api/index.py`, `vercel.json`, `requirements.txt` | Empaquetado para Vercel |
| `tests/backend`, `tests/e2e` | Pruebas Pytest y Playwright |
| `scripts/admin.py` | Respaldar / migrar / estado desde consola |

Las carpetas `branding`, `security`, `automation`, `reports` y `modules` del plan original quedaron integradas así: la marca está en `erp_generator/schemas.py` (validación) + `factory/api.py` (API) + `frontend/src/factory/BrandEditor.tsx`; la seguridad en `core/`; los reportes en el runtime; los módulos universales en el catálogo del generador y el runtime. `automation` no existe todavía (Fase 8 pendiente).

## Decisiones técnicas

1. **Una base por ERP.** El runtime abre una conexión exclusiva a la base del ERP del token; no existe ninguna consulta que cruce empresas. Los tokens llevan un ámbito (`factory` o `erp:<slug>`) y se rechazan fuera de él.
2. **El constructor produce configuración, no código.** Módulos, entidades, campos y fórmulas son JSON validado con Pydantic y versionado (`erp_versions`). El runtime interpreta esa configuración. Nunca se ejecuta código generado por IA.
3. **Publicación explícita.** Editar crea una versión nueva; el ERP sigue usando la versión publicada hasta que se publique otra. Cualquier versión se puede restaurar (crea una versión nueva, nunca reescribe la historia).
4. **Dinero con Decimal.** Tipo `Money`: NUMERIC(18,4) en PostgreSQL y texto en SQLite (SQLite convertiría a float). Mismo formato de salida en ambos motores.
5. **Fechas en UTC, días en hora local.** Todo se guarda en UTC (`UTCDateTime`); los tableros y reportes agrupan por la zona horaria de cada empresa.
6. **Migraciones solo hacia adelante.** `migrar` siempre hace respaldo previo; no hay `downgrade` automático en producción.
7. **Respaldos lógicos portables** (`.json.gz`): independientes del motor, verifican que el esquema coincida y restauran en una sola transacción (si falla, nada cambia), con respaldo de seguridad previo.
8. **SQLite como alternativa explícita** para un solo usuario (WAL + claves foráneas activadas). PostgreSQL para multiusuario. Ambos motores se prueban con la misma batería de pruebas.

## Seguridad implementada

- Contraseñas con bcrypt (12 rondas), mínimo 8 caracteres; bloqueo de 5 minutos tras 5 intentos fallidos.
- Sesiones JWT firmadas con clave maestra local (`data/secret.key`), con expiración.
- Permisos por módulo y acción (`ventas:crear`, `*:ver`, `*`) verificados en el servidor en cada solicitud; el módulo además debe estar activo en el ERP.
- Protección del último administrador de cada ERP; usuarios desactivados pierden la sesión inmediatamente.
- API keys de IA cifradas (Fernet) y nunca enviadas al navegador (solo una pista `sk-••••1234`); nunca se registran en auditoría.
- SQLAlchemy con parámetros enlazados; los nombres de base se validan con expresión regular antes de `CREATE DATABASE`.
- Fórmulas: solo nodos y funciones de lista blanca, límites de longitud, complejidad, exponentes y magnitud.
- Imágenes de marca: solo PNG/JPG/WEBP en base64 ≤ 400 KB (SVG excluido para evitar scripts).
- Cabeceras `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; API sin caché; servidor solo en 127.0.0.1.
- Auditoría en la fábrica y en cada ERP (incluye consultas de agentes de IA).
- Agentes de IA con herramientas de solo lectura y contexto limitado a una empresa.

## Versiones

Backend (Python 3.11–3.13): ver `backend/requirements.txt` — FastAPI 0.165, SQLAlchemy 2.1, Alembic 1.20, Pydantic 2.13, bcrypt 5.0, PyJWT 2.15, cryptography 50, httpx 0.28, psycopg2 2.9.
Frontend: React 19.3, React Router 7.18, Vite 8.3, TypeScript 7.0, Tailwind CSS 4.3, ECharts 6.1, lucide-react.
Probado con PostgreSQL 16.15 y SQLite 3 (incluido en Python).
