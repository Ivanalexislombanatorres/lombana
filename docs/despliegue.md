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

`Actions → Migrar base de datos → Run workflow`, escribir `MIGRAR`. Debe terminar con `✓` en las 11 migraciones.

### 4. Variables en Vercel

`Project → Settings → Environment Variables` (entorno *Production*):

| Nombre | Valor |
| --- | --- |
| `DATABASE_URL` | Cadena del *Transaction pooler* (puerto **6543**) cambiando el usuario `postgres.<ref>` por `lombana_app.<ref>` y la contraseña por la del paso 1 |
| `DATABASE_CA_CERT` | El mismo certificado del paso 2 |
| `APP_ENV` | `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | La clave **Publishable** (`sb_publishable_…`). Nunca la *Secret* ni la `service_role`. |
| `SITE_URL` | `https://lombana.vercel.app` (los enlaces de confirmación de los correos se arman con este valor, nunca con la cabecera de la petición) |

Luego `Deployments → ⋯ → Redeploy`. Verificación: `https://lombana.vercel.app/api/v1/health` debe responder `"status":"ok"`.

### 5. URLs de Supabase Auth

`Authentication → URL Configuration`:

- **Site URL:** `https://lombana.vercel.app`
- **Redirect URLs:** `https://lombana.vercel.app/auth/callback`

La plantilla de correo de confirmación debe quedar la de fábrica (`{{ .ConfirmationURL }}`): el callback solo acepta el flujo PKCE (`code`) y rechaza `token_hash` a propósito. El correo de fábrica de Supabase tiene un límite bajo de envíos por hora: sirve para pruebas, no para el lanzamiento (falta decidir proveedor de email).

La Data API de Supabase debe seguir **desactivada**.

## Requisitos del rol de migración

La migración `0010_hosting_hardening` se detiene si el rol no tiene `BYPASSRLS` (o superusuario), lo agrega a `lombana_privileged` y retira todo privilegio de `anon`, `authenticated` y `service_role` (LOMBANA no usa la Data API de Supabase). Se validó en una simulación local con un rol no superusuario y esos tres roles con privilegios por defecto.
