# LOMBANA AI

Ecosistema digital: convertir ideas en resultados reales.

Estado: **V1 en construcción — pasos 1 (base) y 2 (base de datos) terminados.** Ver [docs/estado.md](docs/estado.md).

## Estructura

```
lombana/
├── apps/web/            Next.js: UI, páginas públicas y API /api/v1
├── packages/db/         PostgreSQL: migraciones, RLS, acceso con contexto de organización, pruebas
│   ├── migrations/      0001…0009 (cada una con .up.sql y .down.sql)
│   ├── src/             migrador + withTenant / withAnonymous
│   └── test/            aislamiento, reglas de negocio, guardas del esquema, regresiones de seguridad
├── docs/                estado, decisiones de arquitectura (adr/), registro de cambios
└── .github/workflows/   CI
```

## Requisitos

- Node.js 22 o superior
- PostgreSQL 16 con la extensión `pgvector`

## Puesta en marcha (desarrollo)

```bash
cp .env.example .env          # completar valores
npm install
createdb lombana
DATABASE_ADMIN_URL=... LOMBANA_APP_DB_PASSWORD=... npm run db:migrate
npm run dev                   # http://localhost:3000 · salud: /api/v1/health
```

## Pruebas

Las pruebas **recrean** una base cuyo nombre debe terminar en `_test` (por seguridad no tocan otra).

```bash
createdb lombana_test
TEST_DATABASE_ADMIN_URL=postgres://postgres@localhost/lombana_test \
LOMBANA_APP_DB_PASSWORD=dev_app_pw npm test
```

`npm run ci` ejecuta tipos, pruebas y build, igual que la CI.

## Seguridad en una línea

La aplicación se conecta como `lombana_app`, que **no puede saltarse Row Level Security**. Cada consulta de negocio pasa por `withTenant(db, { userId, orgId }, fn)`; sin ese contexto la base devuelve cero filas. Detalle en [docs/adr/0002-aislamiento-rls.md](docs/adr/0002-aislamiento-rls.md).

## Etiquetas de veracidad

`REQUIERE VALIDACIÓN` · `REQUIERE CREDENCIAL` · `REQUIERE APROBACIÓN` · `REQUIERE VALIDACIÓN LEGAL` · `PLACEHOLDER`. Nada en el código finge una capacidad que no existe.
