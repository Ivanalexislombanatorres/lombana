# Despliegue

| Pieza | Servicio | Estado |
| --- | --- | --- |
| Web (`apps/web`) | Vercel, proyecto `lombana` | En línea: https://lombana.vercel.app |
| Código | GitHub `Ivanalexislombanatorres/lombana` | Cada push a `main` despliega en Vercel |
| Base de datos | Supabase, región East US (North Virginia) | Creada; migraciones pendientes |

## Conectar la base de datos (una vez)

Las contraseñas **nunca** pasan por el chat ni por el código: viven en los secretos de GitHub y en las variables de entorno de Vercel.

### 1. Crear la contraseña del rol de la aplicación

Genera una contraseña larga (40 caracteres o más, solo letras y números para evitar problemas en la URL). Es la del usuario `lombana_app`, **distinta** de la contraseña de la base de Supabase.

### 2. Secretos en GitHub

`Settings → Secrets and variables → Actions → New repository secret`:

| Nombre | Valor |
| --- | --- |
| `DATABASE_ADMIN_URL` | Cadena de Supabase `Connect → Session pooler` (usuario `postgres.<ref>`, puerto 5432) con la contraseña de la base |
| `LOMBANA_APP_DB_PASSWORD` | La contraseña del paso 1 |
| `DATABASE_CA_CERT` (recomendado) | Contenido del certificado de Supabase (`Database → Settings → SSL Configuration → Download certificate`) |

### 3. Migrar

`Actions → Migrar base de datos → Run workflow`, escribir `MIGRAR`. Debe terminar con `✓` en las 10 migraciones.

### 4. Variables en Vercel

`Project → Settings → Environment Variables` (entorno *Production*):

| Nombre | Valor |
| --- | --- |
| `DATABASE_URL` | Cadena del *Transaction pooler* (puerto **6543**) cambiando el usuario `postgres.<ref>` por `lombana_app.<ref>` y la contraseña por la del paso 1 |
| `DATABASE_CA_CERT` | El mismo certificado del paso 2 |
| `APP_ENV` | `production` |

Luego `Deployments → ⋯ → Redeploy`. Verificación: `https://lombana.vercel.app/api/v1/health` debe responder `"status":"ok"`.

## Requisitos del rol de migración

La migración `0010_hosting_hardening` se detiene si el rol no tiene `BYPASSRLS` (o superusuario), lo agrega a `lombana_privileged` y retira todo privilegio de `anon`, `authenticated` y `service_role` (LOMBANA no usa la Data API de Supabase). Se validó en una simulación local con un rol no superusuario y esos tres roles con privilegios por defecto.
