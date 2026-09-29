# ADR 0001 — Monolito modular en TypeScript sobre PostgreSQL

- **Fecha:** 2026-09-28
- **Estado:** Aceptada (aprobada con la orden "CONSTRUIR V1")

## Contexto

V1 atiende de 10 a 100 usuarios con un equipo pequeño. El producto final aspira a muchos módulos (IA, marketplace, empresas, noticias, video).

## Decisión

- Un repositorio (npm workspaces), un despliegue web y un worker.
- TypeScript en todo el stack; Next.js para UI + API `/api/v1`.
- PostgreSQL 16 como fuente de verdad, con Row Level Security y pgvector.
- Cada módulo es dueño de sus tablas y expone servicios; no lee tablas ajenas.

## Consecuencias

- Menos piezas que operar y pagar en fase 1.
- Extraer Router de IA, búsqueda o descargas a servicios propios es posible cuando la carga lo justifique (fase 3).
- Dependencia de proveedor acotada: el código habla con Postgres estándar y S3 estándar.

## Alternativas descartadas

- Microservicios desde el día 1: costo operativo sin beneficio con este volumen.
- Base NoSQL: comercio, permisos y comisiones exigen integridad relacional.
