# Estado real del producto (v1.0)

Leyenda: ✅ terminado y probado · 🟡 parcial (se indica qué falta) · ⏳ pendiente

## Por fase

| Fase | Estado | Detalle |
|---|---|---|
| 1 — Fábrica visual | ✅ | Estructura, navegación, dashboard con datos reales, gestión de proyectos, identidad dorada |
| 2 — Constructor de ERP | ✅ | 13 sectores, asistente de 6 pasos, módulos con dependencias, diseñador de formularios/entidades (8 tipos de campo, relaciones, validaciones, campos calculados), versiones |
| 3 — Motor de bases de datos | ✅ | Base central + base por ERP, Alembic, respaldo/restauración, SQLite y PostgreSQL probados |
| 4 — Runtime | ✅ | Login por ERP, usuarios, roles, permisos, dashboard, clientes, proveedores, productos/servicios, ventas con inventario y anulación, registros personalizados, reportes CSV, auditoría |
| 5 — White Label | ✅ | Editor con vista previa en vivo, logo/favicon/imagen de login, colores, tipografía, tema, textos, contacto, plantillas de factura, plantillas de marca (guardar/aplicar/eliminar/restaurar), nombres de módulos y menús |
| 6 — AI Gateway | 🟡 | Ver detalle abajo |
| 7 — Agentes | 🟡 | 11 agentes de solo lectura con objetivo, instrucciones, herramientas, modelo por tarea, límites y auditoría. Falta: agentes que propongan cambios con cola de aprobación humana |
| 8 — Fórmulas y automatización | 🟡 | Motor de fórmulas ✅ (crear, validar, probar, versionar, documentar, asociar a módulo, usar en campos calculados). Automatizaciones (disparadores, recordatorios, tareas programadas) ⏳ |
| 9 — Seguridad y comercialización | 🟡 | Seguridad ✅, clientes/planes/licencias/renovaciones/estado de pago ✅. Falta: pasarela de pagos real, aplicación de límites del plan dentro del ERP, activación de licencias en instalaciones separadas |
| 10 — Pruebas y despliegue | 🟡 | 33 pruebas backend (SQLite y PostgreSQL) + 6 recorridos de navegador ✅; scripts de Windows escritos pero **no ejecutados en un Windows real** en este entorno |

## Versión en internet (Vercel + Supabase)

✅ Probado aquí: 37 pruebas en PostgreSQL con un esquema por ERP, respaldos en la base, bloqueo de intentos compartido, código de instalación; recorrido completo en navegador en modo nube; compilación con la herramienta oficial de Vercel (`vercel build`) y ejecución de la función empaquetada con Python 3.12.
⚠️ No probado aquí: el despliegue real en tu cuenta de Vercel y la conexión a tu Supabase (requieren tus cuentas). Si algo falla, la app muestra un mensaje con la causa.

## AI Gateway: qué está realmente verificado

| Proveedor | Adaptador | Verificación |
|---|---|---|
| OpenAI, Groq, DeepSeek, xAI, OpenRouter, Mistral, Ollama | OpenAI-compatible (`/models`, `/chat/completions`) | ✅ probado contra un servidor HTTP local que implementa ese protocolo (claves válidas, inválidas 401, sin conexión, límites) |
| Anthropic Claude | `/v1/messages`, `/v1/models` | ✅ probado contra servidor local con el mismo protocolo |
| Google Gemini, Cohere, Azure OpenAI | Implementados según su API pública | ⚠️ sin prueba automática |
| **Todos** | — | ⚠️ **No probados contra los servicios reales** (este entorno no tiene tus claves ni acceso a esos dominios). La primera prueba real ocurre cuando pulses "Probar conexión" con tu API key; el sistema solo marca "conectado" si esa prueba responde bien |

Control de costos: se cuentan solicitudes y tokens por proveedor y hay límite mensual de solicitudes. No se convierte a dinero porque los precios por modelo cambian; el campo de presupuesto en dólares existe en la base para una fase posterior.

## Módulos universales

Operativos: Dashboard, Clientes/CRM, Proveedores, Productos y servicios, Ventas, Inventario, Registros personalizados, Reportes, Usuarios y roles, Auditoría.

Planificados (aparecen marcados "próxima fase" y **no se pueden activar**): Compras, Caja, Bancos, Contabilidad, Cuentas por cobrar, Cuentas por pagar, Presupuestos, Nómina (liquidación), Recursos humanos, Activos fijos, Facturación electrónica, Automatizaciones.
Mientras tanto, nómina y RR. HH. pueden llevarse como registros personalizados (plantilla "Nómina y gestión humana": empleados y novedades).

## Limitaciones conocidas

- El comprobante de venta es un documento interno imprimible; **no es factura electrónica** DIAN/SAT.
- Diseñador de procesos (eventos/condiciones/acciones) y diseñador libre de dashboards: pendientes; los indicadores del tablero son fijos por módulo.
- SQLite: un usuario a la vez. Para varios cajeros/sucursales usa PostgreSQL.
- Los ERP se ejecutan dentro del mismo servidor de la fábrica. Empaquetar un ERP como instalador independiente para cada cliente, sincronización online/offline y activación de licencia remota son fases futuras.
- Los respaldos guardan datos sin cifrar (las contraseñas sí van con hash y las API keys cifradas): protege la carpeta `backups`.
- Solo hay una cuenta administradora de la fábrica (no hay gestión de varios usuarios de fábrica todavía).

## Siguiente paso recomendado

Fase 8 (automatizaciones: alerta de inventario bajo, recordatorio de citas, pagos pendientes) y el módulo de Caja/Compras, porque convierten los ERP actuales en operación diaria completa para barberías, tiendas y restaurantes.

## Versión dentro de Claude (artifact)

Fábrica publicada como artifact de Claude: <https://claude.ai/artifact/RTGSXwBjHAjwP2X1tYfcuM>
- Toda la lógica del servidor reescrita en el navegador (`frontend/src/local/`), con los datos en la base del artifact (privada: solo el propietario y sus Editores).
- La IA y los agentes usan Claude directamente (sin API keys). Los proveedores externos siguen en la versión de servidor.
- Pruebas: 19 del motor local (`npm test` en `frontend/`) y recorrido completo en navegador con una base simulada.
- Límites propios: 256 KB por registro (imágenes de marca ≤ 120 KB en total, respaldos ≤ 240 KB por ERP), 25.000 registros por artifact, sin impresión directa.
- Compilar: `npm run build:artifact`.
