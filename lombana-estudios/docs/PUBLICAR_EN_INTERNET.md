# Publicar LOMBANA ESTUDIOS en internet (Supabase + Vercel)

Resultado: una dirección como `https://lombana-estudios.vercel.app` donde entras desde cualquier computador o celular, y cada cliente entra a su ERP en `https://lombana-estudios.vercel.app/erp/<su-erp>/login`.

- **Supabase** guarda los datos (PostgreSQL). Cada ERP queda en su propio *esquema* aislado dentro de la base.
- **Vercel** ejecuta la aplicación y la interfaz.
- Ambos tienen plan gratuito suficiente para empezar.

Tiempo estimado: 10–15 minutos con la ruta rápida.

---

## Ruta rápida (recomendada): 3 pasos, sin copiar contraseñas

El código ya está en tu repositorio de GitHub `lombana`, carpeta `lombana-estudios`.

**Paso 1 — Importar en Vercel**
1. Entra a <https://vercel.com/new> e importa el repositorio **lombana**.
2. En **Root Directory** pulsa *Edit* y elige la carpeta **`lombana-estudios`**. (Muy importante: así no se mezcla con tu otro proyecto.)
3. **Framework Preset:** `Other`. En **Environment Variables** agrega una sola:
   `LOMBANA_SETUP_CODE` = una palabra secreta tuya (por ejemplo `MiFabrica-2026!`). Sirve para crear tu cuenta de administrador la primera vez.
4. Pulsa **Deploy**. El primer despliegue mostrará un aviso de configuración incompleta: es normal, falta la base de datos.

**Paso 2 — Conectar Supabase desde Vercel**
1. En tu proyecto de Vercel abre la pestaña **Storage** → **Create Database** (o *Marketplace*) → **Supabase** → crea la base en la región **Washington, D.C. (iad1) / East US**.
2. Conéctala al proyecto (marca Production y Preview). Vercel agrega solo las variables `POSTGRES_URL` y `SUPABASE_JWT_SECRET`; la app las usa automáticamente.
3. Ve a **Deployments** → en el último pulsa **⋯ → Redeploy**.

**Paso 3 — Primer ingreso**
Abre la dirección de tu proyecto (`https://<nombre>.vercel.app`). Verás **Configuración inicial**: escribe tu código de instalación, tu nombre, correo y contraseña. Listo.

> La clave maestra se deriva de `SUPABASE_JWT_SECRET`. Si algún día rotas ese secreto en Supabase, define antes `LOMBANA_SECRET_KEY` con una clave propia (ver ruta manual) o tendrás que volver a escribir las API keys de IA.

---

## Ruta manual (si prefieres un proyecto de Supabase propio)

1. **Supabase:** <https://supabase.com/dashboard> → *New project* (región East US). Guarda la contraseña de la base. Luego **Connect → Transaction pooler** (puerto 6543), copia la URI y reemplaza `[YOUR-PASSWORD]`.
2. **Vercel:** importa el repositorio con Root Directory `lombana-estudios` y agrega estas variables:

| Nombre | Valor |
|---|---|
| `LOMBANA_PG_URL` | La URI del Transaction pooler |
| `LOMBANA_SECRET_KEY` | Clave larga aleatoria. En PowerShell: `py -c "import secrets; print(secrets.token_urlsafe(48))"`. Guárdala y **nunca la cambies** |
| `LOMBANA_SETUP_CODE` | Tu palabra secreta de instalación |

3. Deploy y primer ingreso igual que en la ruta rápida.

## Si algo sale mal

| Lo que ves | Causa y solución |
|---|---|
| Un mensaje "no pudo iniciar en la nube… LOMBANA_SECRET_KEY" | Falta la variable o tiene menos de 32 caracteres. Corrígela en Vercel → Settings → Environment Variables y vuelve a desplegar (Deployments → ⋯ → Redeploy) |
| "…OperationalError… password authentication failed" | La contraseña dentro de `LOMBANA_PG_URL` está mal |
| "…could not translate host name" o tiempo agotado | Usaste la conexión directa: usa la del **Transaction pooler** (puerto 6543) |
| "Código de instalación incorrecto" | Escribe exactamente el valor de `LOMBANA_SETUP_CODE` |
| La primera carga tarda unos segundos | Normal: el servidor "despierta" tras un rato sin uso |

## Qué cambia frente a la versión local

- Los respaldos se guardan dentro de la base (no hay carpeta `backups`). Supabase además hace sus propios respaldos diarios en planes de pago.
- El bloqueo por intentos fallidos se guarda en la base, así funciona aunque Vercel use varias copias del servidor.
- Las API keys de IA siguen cifradas; las tablas no quedan expuestas en la API pública de Supabase (no se usa el esquema `public`).
- La versión local (`INICIAR.bat`) sigue funcionando igual; son instalaciones independientes.
