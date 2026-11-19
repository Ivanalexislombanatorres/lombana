# Informe de entrega — LOMBANA ESTUDIOS v1.0

Fecha: 18 de noviembre de 2026 · Método: construcción por etapas → auditoría → corrección → nueva prueba.

## 1. Resultado de las pruebas (última ejecución)

| Batería | Motor | Resultado |
|---|---|---|
| Pytest backend (33 pruebas) | SQLite | ✅ 33/33 |
| Pytest backend (33 pruebas) | PostgreSQL 16.15 real | ✅ 33/33 |
| Pytest backend en entorno virtual limpio con `requirements.txt` | SQLite | ✅ 33/33 |
| Playwright + Chromium, flujo completo (6 recorridos) | SQLite | ✅ 6/6, sin errores de consola |
| TypeScript (`tsc -b`) y build de producción | — | ✅ 0 errores |

### Qué cubren las pruebas

- **Fábrica:** configuración inicial única, login, bloqueo por intentos, dashboard, catálogo, auditoría.
- **Generador:** creación con base independiente (`erp_barberia_001`, `_002`), validación (sector, módulos no disponibles, dependencias, contraseña) sin dejar nada a medias, versiones, publicación, restauración, duplicado.
- **Aislamiento:** datos de un ERP invisibles en otro; token de un ERP rechazado en otro; token de fábrica rechazado en el runtime y viceversa; ERP suspendido bloqueado.
- **Runtime:** ventas con descuento e impuesto calculados con Decimal (13.000 − 1.300 + 1.710 = 13.410), stock insuficiente sin efectos parciales, anulación que devuelve inventario, movimientos y ajustes, integridad referencial (no borrar cliente/producto con ventas), reporte y CSV, permisos por rol (vendedor sin acceso a usuarios, sin cambiar precios), protección del último administrador, desactivar usuario invalida su sesión, módulo inactivo inaccesible.
- **Formularios:** campos calculados (comisión 40 % de 30.000 = 12.000), listas, relaciones, rangos, fechas, relación entre entidades personalizadas con protección de borrado.
- **Marca:** independencia entre ERP, validación de colores e imágenes (SVG rechazado), plantillas.
- **Respaldos:** respaldo → cambio → restauración exacta, respaldo de seguridad automático, rechazo de rutas maliciosas (`../../secret.key`), secuencias de PostgreSQL correctas tras restaurar.
- **Fórmulas:** precisión decimal (0,1 + 0,2 = 0,3), funciones empresariales, 11 intentos de inyección de código bloqueados, división por cero, potencias gigantes, versiones.
- **AI Gateway:** sin clave → error real; clave inválida → 401 real; clave válida → modelos listados; clave nunca expuesta ni auditada; límite mensual; enrutamiento por tarea a Anthropic; agente con contexto de una sola empresa y regla de solo lectura en las instrucciones; proveedor inalcanzable.

## 2. Hallazgos de la auditoría y correcciones aplicadas

| # | Hallazgo | Impacto | Corrección |
|---|---|---|---|
| 1 | Las ventas de "hoy", del mes y los reportes se agrupaban por día UTC | Una venta a las 8 p. m. en Colombia aparecía en el día siguiente | Días y meses calculados con la zona horaria configurada de cada empresa; dependencia `tzdata` para Windows |
| 2 | SQLite devolvía fechas sin zona horaria | Horas mal mostradas en el navegador | Nuevo tipo `UTCDateTime` en todos los modelos |
| 3 | El dinero salía con formatos distintos en SQLite (`708`) y PostgreSQL (`708.0000`) | Inconsistencias entre instalaciones | Escala uniforme de 4 decimales en el tipo `Money` y relectura tras confirmar |
| 4 | Planes ordenados alfabéticamente por precio en SQLite (`119` antes de `29`) | Orden comercial incorrecto | Orden exacto en Python para ambos motores |
| 5 | Resultados de fórmulas en notación científica (`1.2E+5`) | Ilegible para el usuario | Formato decimal normal (`120000`) |
| 6 | En el ERP del cliente, los enlaces relativos dentro de rutas comodín (React Router 7) llevaban a páginas en blanco y "Dashboard" siempre aparecía activo | Navegación rota | Rutas absolutas `/erp/<slug>/...` |
| 7 | El perfil del usuario se volvía a pedir al servidor en cada cambio de página | Solicitudes innecesarias | Se carga una sola vez por sesión |
| 8 | Textos de ayuda dentro de la etiqueta de los campos | Lectores de pantalla leían "Contraseña Mínimo 8 caracteres" | Ayuda fuera de la etiqueta |
| 9 | "ERP por Sector" mostraba "Empresa" tres veces | Confuso | Nombre corto por sector en las plantillas |
| 10 | Gráfico del cliente con números en formato inglés (80,000) | Inconsistente con COP | Formato es-CO y barras |

## 3. Archivos principales creados

- Backend: `backend/app/**` (25 módulos Python), migraciones `backend/migrations/{factory,tenant}`, `requirements*.txt`.
- Frontend: `frontend/src/**` (26 componentes/páginas TypeScript), compilado en `frontend/dist`.
- Plantillas: `templates/sectores/*.json` (13 sectores).
- Pruebas: `tests/backend/*.py` (5 archivos), `tests/e2e/test_flujo_completo.py`.
- Operación: `INSTALAR.bat`, `INICIAR.bat`, `DETENER.bat`, `RESPALDAR.bat`, `ACTUALIZAR.bat`, `scripts/admin.py`, `scripts/e2e_local.sh`, `.env.example`.
- Documentación: `README.md`, `docs/*.md`, `docs/capturas/*.png` (12 capturas generadas por las pruebas).

Total aproximado: 7.200 líneas de código y pruebas.

## 4. Lo que NO se verificó aquí (honestidad)

- Los `.bat` se escribieron para Windows 10/11 pero este entorno es Linux: no se ejecutaron en Windows real. La lógica que llaman (`pip install`, `scripts/admin.py`, `uvicorn`) sí se probó.
- Ningún proveedor de IA se probó contra su servicio real (sin claves ni acceso). Ver `ESTADO_Y_PENDIENTES.md`.
- Gemini, Cohere y Azure OpenAI no tienen prueba automática.

Ver `ESTADO_Y_PENDIENTES.md` para fases y módulos pendientes.
