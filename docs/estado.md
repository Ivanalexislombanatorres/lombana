# Estado de V1

Actualizado: 2026-09-29

## Control de desarrollo — pasos 3, 3b y 3c (login, panel, Product Lab, LOMBANA NEWS)

| Campo | Contenido |
| --- | --- |
| STATUS | Pasos 1, 2 y 3 terminados y probados. El login y el panel están listos en el código; se activan en https://lombana.vercel.app cuando Supabase quede migrado y las variables de Vercel configuradas. |
| BUILT | Registro e inicio de sesión (Supabase Auth, verificación de firma del token en cada petición); alta automática de cuenta con espacio personal (migración 0011); panel con "¿Qué necesitas lograr hoy?" que crea proyectos reales; Mis Proyectos (pasos, progreso calculado, estados, historial); catálogo de herramientas desde la base con su estado real (ninguna simula uso); página de cuenta; cambio de espacio; diseño adaptado a móvil. **Product Lab:** crear productos (gratis o de pago con mínimo US$5 validado en la web y en la base), editar en borrador, enviar a revisión, volver a borrador, archivar; aviso real de pagos deshabilitados. **LOMBANA NEWS:** periódico público `/noticias` (titulares con enlace al original y aportes aprobados) y `Mis aportes` (borrador, enviar a moderación, retirar); publicar exige moderación privilegiada. `/api/v1/status` para diagnosticar el despliegue sin exponer valores. |
| TESTED | 99 pruebas de base de datos, 48 unitarias y 16 e2e con navegador real contra un simulador de Supabase Auth (registro, proyectos, aislamiento entre cuentas, seguridad del login, desborde en móvil). Todas corren en la CI de GitHub. |
| SECURITY REVIEW | Revisión independiente del login: 2 hallazgos confirmados (redirección abierta con caracteres de control; cuentas dadas de baja que volvían a entrar) y 5 de endurecimiento (cookies accesibles desde JavaScript, enlace de correo con la cabecera Host, flujo `token_hash`, bucle de cuentas suspendidas, alta simultánea). Todos corregidos con prueba de regresión. |
| PENDING | Pasos 4 a 14 de V1 (CLAU, AI Router, búsqueda, herramientas, Product Lab, descargas y leads, noticias, YouTube, admin). Recuperar contraseña (necesita proveedor de email). |
| BLOCKED | Activación en producción: clave del rol `lombana_app` y variables de Vercel (las pone el propietario). YouTube, ingesta de noticias, ebook por tendencias, lanzamiento de descargas/leads, pagos: igual que antes. |
| RISKS | El correo de fábrica de Supabase tiene un límite bajo de envíos por hora: no sirve para el lanzamiento. Leads y costos de IA, como antes. |
| DEPLOY | Web en https://lombana.vercel.app. Supabase `fazdgwkofhluapbmrjor` (PostgreSQL 17) **migrado 2026-09-29**: 11 migraciones aplicadas con el conector de Supabase, esquema verificado idéntico al probado (columnas, políticas, funciones, restricciones, triggers, permisos, datos iniciales, checksums). anon/authenticated/service_role sin privilegios. Falta: clave de `lombana_app`, variables de Vercel y URLs de Auth ([despliegue.md](despliegue.md)). |
| DECISIONS | Supabase Auth como proveedor de login (el propietario creó el proyecto). Sin vinculación automática de cuentas con el mismo correo. Callback solo PKCE. ADR 0001–0003. |
| COST | Cero: Vercel Hobby y Supabase gratuito. |
| TECH DEBT | Extensión `vector` quedó en el esquema public (aviso WARN de Supabase; sin exposición porque la Data API está cerrada y los roles de Supabase no tienen privilegios): moverla a `extensions` en una migración futura. Certificado de Supabase sin verificar mientras no se cargue `DATABASE_CA_CERT`; sin linter; sin recuperación de contraseña; límites de intentos de login delegados a Supabase. |
| NEXT STEP | Clave de `lombana_app`, variables de Vercel y URLs de Auth; luego paso 4 — CLAU + Intent Engine (necesita proveedor de IA). |

## Módulos

| Módulo | Fase | Estado |
| --- | --- | --- |
| Arquitectura base | V1 | READY |
| Base de datos | V1 | READY |
| Auth | V1 | READY (activación en producción pendiente de configuración) |
| Layout / Dashboard | V1 | READY |
| CLAU + Intent Engine + Orchestrator | V1 | PLANNED |
| AI Router + créditos | V1 | PLANNED (REQUIERE CREDENCIAL: proveedor de IA) |
| Search | V1 | PLANNED |
| Tools (5 + video estructurado) | V1 | PLANNED |
| Product Lab | V1 | IN PROGRESS (productos, precio y revisión listos; archivos esperan almacenamiento; aprobación espera Admin) |
| Mis Proyectos | V1 | READY |
| Download Engine + Leads | V1 | PLANNED |
| LOMBANA NEWS | V1 | IN PROGRESS (periódico y aportes listos; moderación espera Admin; ingesta BLOCKED) |
| YouTube: publicar | V1 | BLOCKED |
| Admin básico | V1 | PLANNED |

## Decisiones que necesito

1. **Proveedor de IA** y cuenta. Bloquea CLAU (paso 4) y el AI Router.
2. **Proveedor de email transaccional.** Bloquea descargas y recuperar contraseña.
3. **País de operación** (define la ley de datos aplicable a los leads).
4. **Confirmar US$5:** ¿precio mínimo de productos pagos (implementado) o tarifa que paga el creador por crear un producto?
