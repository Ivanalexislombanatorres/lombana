# Instalación y operación en Windows 10 / 11

## Requisitos

- Windows 10 u 11 (64 bits).
- Python 3.11, 3.12 o 3.13 con la opción **Add python.exe to PATH**.
- Internet solo para la instalación y para usar IA en la nube. **El ERP funciona sin internet.**
- No se requiere Docker ni Node.js.

> Si al escribir `python` en la terminal se abre la Microsoft Store, desactiva los "Alias de ejecución de aplicaciones" de Python en *Configuración → Aplicaciones → Configuración avanzada de aplicaciones*, o instala Python desde python.org.

## Instalar

1. Descomprime `lombana-estudios` en una ruta sin caracteres raros, por ejemplo `C:\LombanaEstudios`.
2. Ejecuta `INSTALAR.bat`. Crea `.venv`, instala las dependencias de `backend\requirements.txt` y prepara la base central.
3. Ejecuta `INICIAR.bat`. El navegador abre `http://127.0.0.1:8000`.

El servidor escucha solo en `127.0.0.1` (este computador). Otros equipos de la red no pueden entrar, lo cual es lo seguro para el modo local.

## Encender, apagar

- Encender: `INICIAR.bat` (deja abierta esa ventana negra).
- Apagar: `DETENER.bat`, o Ctrl+C en la ventana del servidor.

## Dónde quedan los datos

| Carpeta | Contenido |
|---|---|
| `data\lombana_factory.db` | Base central de la fábrica (clientes, ERP, licencias, IA, fórmulas) |
| `data\erps\erp_*.db` | Una base operacional por ERP |
| `data\secret.key` | Clave maestra: firma sesiones y cifra las API keys. **Respáldala aparte y no la compartas.** Si se pierde, habrá que volver a escribir las API keys. |
| `backups\` | Respaldos `.json.gz` |

## Respaldos y restauración

- `RESPALDAR.bat` respalda todo. También puedes respaldar un ERP desde **Mis ERP → Gestionar → Base de datos**.
- Restaurar: en esa misma pestaña, botón **Restaurar**. Antes de restaurar se guarda automáticamente un respaldo de seguridad del estado actual.
- Los respaldos son portables entre SQLite y PostgreSQL (mismo esquema).
- Recomendación: copia la carpeta `backups\` y el archivo `data\secret.key` a una unidad externa o a la nube cada semana.

## Actualizar a una versión nueva

1. Ejecuta `RESPALDAR.bat`.
2. Reemplaza las carpetas `backend`, `frontend`, `templates` y `scripts` por las de la versión nueva. **No borres `data`, `backups` ni `.env`.**
3. Ejecuta `ACTUALIZAR.bat` (respalda otra vez, actualiza dependencias y aplica migraciones; las migraciones solo agregan, nunca borran datos).

## Usar PostgreSQL (varios usuarios simultáneos)

SQLite es para uso local de un solo usuario. Para varios usuarios a la vez usa PostgreSQL:

1. Instala PostgreSQL 15 o 16 para Windows (instalador de EDB).
2. En *pgAdmin* o `psql` crea un usuario con permiso para crear bases:
   `CREATE ROLE lombana LOGIN PASSWORD 'una-clave-fuerte' CREATEDB;`
3. Copia `.env.example` como `.env` y deja:
   ```
   LOMBANA_DB_ENGINE=postgresql
   LOMBANA_PG_URL=postgresql+psycopg2://lombana:una-clave-fuerte@localhost:5432
   ```
4. Ejecuta `INSTALAR.bat` y luego `INICIAR.bat`. La fábrica crea `lombana_factory` y cada `erp_*` automáticamente.

Para pasar datos de SQLite a PostgreSQL: respalda en SQLite, crea el mismo ERP en PostgreSQL y restaura su respaldo (los respaldos son portables). Este flujo de migración entre motores está probado a nivel de respaldo/restauración, no como asistente automático.

## IA local con Ollama (opcional)

1. Instala Ollama desde <https://ollama.com> y descarga un modelo: `ollama pull llama3.2`.
2. En **AI Gateway** agrega "Ollama (IA local)" y pulsa **Probar conexión**. Si Ollama está abierto, aparecerán tus modelos.
3. Actívalo y asígnalo a las tareas. Con Ollama ningún dato sale de tu computador.

## Para desarrolladores

```bat
.venv\Scripts\pip install -r backend\requirements-dev.txt
.venv\Scripts\python -m playwright install chromium
cd tests\backend && ..\..\.venv\Scripts\python -m pytest -q
```
Interfaz (requiere Node.js 20+): `cd frontend && npm install && npm run build` (o `npm run dev` con el backend en el puerto 8000).
Las pruebas de navegador: `scripts/e2e_local.sh` (Linux/macOS) o, en Windows, iniciar el servidor con una carpeta de datos vacía y ejecutar `pytest tests\e2e`.

## Problemas comunes

| Síntoma | Solución |
|---|---|
| "No se encontró Python" | Reinstala Python marcando "Add to PATH" y abre una ventana nueva |
| El navegador dice que no conecta | La ventana del servidor debe estar abierta; mira si muestra un error |
| "Address already in use" | Otro programa usa el puerto 8000: pon `LOMBANA_PORT=8010` en `.env` |
| "Demasiados intentos fallidos" | Espera 5 minutos; es la protección contra adivinar contraseñas |
| Olvidé la contraseña de la fábrica | Restaura un respaldo de la fábrica o pide soporte; por seguridad no existe una puerta trasera |
