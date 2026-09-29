# Estado de V1

Actualizado: 2026-09-29

## Control de desarrollo — pasos 1 y 2

| Campo | Contenido |
| --- | --- |
| STATUS | Paso 1 (arquitectura base) y paso 2 (base de datos) terminados y probados. Nada de V1 está disponible para usuarios aún. |
| BUILT | Monorepo TypeScript; app web Next.js que compila, con cabeceras de seguridad y `/api/v1/health` real; paquete `@lombana/db` con migrador (up/down, checksums, bloqueo concurrente) y `withTenant`; 10 migraciones (~50 tablas); CI y workflow manual de migración en GitHub Actions. |
| TESTED | 90 pruebas automáticas en verde, repetibles: reversibilidad total del esquema, aislamiento entre organizaciones, permisos por rol, reglas de negocio, guardas del esquema y regresiones de seguridad. `npm audit`: 0 vulnerabilidades. Build y typecheck en verde. |
| SECURITY REVIEW | Revisión independiente en 3 rondas contra la base real. Ronda 1: 7 hallazgos (3 altos). Ronda 2: 5 (1 crítico). Ronda 3: 1 alto. Todos corregidos y con prueba de regresión. El hallazgo de la ronda 3 no pasó por una cuarta revisión independiente. |
| PENDING | Pasos 3 a 14 de V1. |
| BLOCKED | Publicación en YouTube (credenciales + aprobación Google); ingesta de noticias (términos de uso por fuente); ebook por tendencias (fuente de datos de tendencias); lanzamiento público de descargas y leads (validación legal); pagos (V2). |
| RISKS | Tratamiento de datos de terceros (leads); costos de IA sin ingresos en V1. |
| DEPLOY | Web en línea en https://lombana.vercel.app (Vercel, desde GitHub `main`). Supabase creado; migraciones y conexión pendientes: ver [despliegue.md](despliegue.md). |
| DECISIONS | ADR 0001 (monolito modular), ADR 0002 (RLS), ADR 0003 (YouTube). US$5 interpretado como precio mínimo de productos pagos (configurable). |
| COST | Cero: no se ha contratado ningún servicio. |
| TECH DEBT | Conexión a Supabase cifrada pero sin verificar certificado mientras no se cargue `DATABASE_CA_CERT`; vector de búsqueda sin dimensión ni índice hasta elegir proveedor de embeddings; cola de trabajos sin implementar (llega con el worker); sin linter configurado; sin pruebas e2e de la web (llegan con UI). |
| NEXT STEP | Migrar Supabase y conectar Vercel (despliegue.md); luego paso 3 — Auth. |

## Módulos

| Módulo | Fase | Estado |
| --- | --- | --- |
| Arquitectura base | V1 | READY |
| Base de datos | V1 | READY |
| Auth | V1 | PLANNED (bloqueado por decisión de proveedor) |
| Layout / Dashboard | V1 | PLANNED |
| CLAU + Intent Engine + Orchestrator | V1 | PLANNED |
| AI Router + créditos | V1 | PLANNED (REQUIERE CREDENCIAL: proveedor de IA) |
| Search | V1 | PLANNED |
| Tools (5 + video estructurado) | V1 | PLANNED |
| Product Lab | V1 | PLANNED |
| Mis Proyectos | V1 | PLANNED |
| Download Engine + Leads | V1 | PLANNED |
| LOMBANA NEWS | V1 | PLANNED (ingesta BLOCKED) |
| YouTube: publicar | V1 | BLOCKED |
| Admin básico | V1 | PLANNED |

## Decisiones que necesito

1. **Proveedor de login:** Supabase Auth o Auth.js. Bloquea el paso 3.
2. **Proveedor de IA** y cuenta. Bloquea el paso 7.
3. **Proveedor de email transaccional.** Bloquea descargas.
4. **País de operación** (define la ley de datos aplicable a los leads).
5. **Confirmar US$5:** ¿precio mínimo de productos pagos (implementado) o tarifa que paga el creador por crear un producto?
