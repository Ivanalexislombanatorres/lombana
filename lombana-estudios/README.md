# LOMBANA ESTUDIOS — Fábrica Inteligente de ERP con IA · v1.0

Plataforma local para **crear, personalizar, administrar y vender ERP** para distintos sectores.
Cada ERP tiene su **propia base de datos**, sus usuarios, roles, módulos, formularios y su **marca blanca**.

## Dos formas de usarla

- **En internet (Vercel + Supabase):** sigue [`docs/PUBLICAR_EN_INTERNET.md`](docs/PUBLICAR_EN_INTERNET.md). Entras desde cualquier equipo o celular.
- **Local en Windows:** sigue los pasos de abajo. Funciona sin internet.

## Inicio rápido en Windows 10/11 (sin Docker)

1. Instala **Python 3.11 o superior** desde <https://www.python.org/downloads/> y marca **"Add python.exe to PATH"**.
2. Descomprime la carpeta `lombana-estudios` donde quieras (por ejemplo `C:\LombanaEstudios`).
3. Doble clic en **`INSTALAR.bat`** (solo la primera vez; necesita internet para descargar dependencias).
4. Doble clic en **`INICIAR.bat`**. Se abre el navegador en `http://127.0.0.1:8000`.
5. La primera vez el sistema pide crear la **cuenta administradora de la fábrica**.

| Archivo | Para qué sirve |
|---|---|
| `INSTALAR.bat` | Crea el entorno de Python, instala dependencias y prepara las bases |
| `INICIAR.bat` | Enciende el servidor y abre el navegador |
| `DETENER.bat` | Apaga el servidor |
| `RESPALDAR.bat` | Respalda la base central y todos los ERP en `backups\` |
| `ACTUALIZAR.bat` | Respalda, actualiza dependencias y aplica migraciones (nunca borra datos) |

No necesitas Node.js: la interfaz ya viene compilada en `frontend\dist`.

## Cómo se usa (flujo típico)

1. **Constructor de ERP** → eliges sector (barbería, restaurante, hotel…), datos de la empresa, módulos, formularios, colores y el usuario administrador del cliente. Al confirmar se crea la base `erp_<sector>_NNN` y el ERP queda publicado.
2. **Identidad de Marca** → logotipo, colores, tipografía, textos de inicio de sesión y facturas, con vista previa en vivo.
3. **Mis ERP → Abrir ERP** → el cliente entra en `http://127.0.0.1:8000/erp/<nombre>/login` con su propia marca y opera: clientes, productos/servicios, ventas con inventario, citas/reservas/registros propios, reportes exportables, usuarios y roles, auditoría.
4. **Clientes y Licencias** → clientes de la fábrica, planes, licencias y renovaciones.
5. **AI Gateway** → conectas tus proveedores de IA con tu API key; **Agentes de IA** analiza los datos de una empresa en modo solo lectura.

## Documentación

- [`docs/PUBLICAR_EN_INTERNET.md`](docs/PUBLICAR_EN_INTERNET.md) — publicar en Supabase + Vercel paso a paso.
- [`docs/INSTALACION_WINDOWS.md`](docs/INSTALACION_WINDOWS.md) — instalación, PostgreSQL, respaldos, actualización, problemas comunes.
- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — estructura, decisiones técnicas, seguridad, versiones.
- [`docs/ESTADO_Y_PENDIENTES.md`](docs/ESTADO_Y_PENDIENTES.md) — qué está terminado, qué está pendiente y limitaciones reales.
- [`docs/INFORME_DE_ENTREGA.md`](docs/INFORME_DE_ENTREGA.md) — auditoría, correcciones y pruebas ejecutadas.
- `docs/capturas/` — capturas tomadas por las pruebas automáticas en navegador.
