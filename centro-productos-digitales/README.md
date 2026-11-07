# Centro de Productos Digitales · Lombana Studio — Guía paso a paso

Un solo lugar para guardar, versionar y encontrar **todo** lo que produces: ERPs, dashboards, páginas web, software, asistentes IA, ebooks, catálogos, prompts, plantillas, macros, diseños, videos y documentos.

## 1. Lo que ya quedó creado en Supabase
**Proyecto:** `ERP-CENTRO-ALMACENAMIENTO` · URL `https://lzgakoyqczjhpqzlfsxc.supabase.co`

| Tabla | Para qué sirve |
|---|---|
| `tipos_producto` | Los 14 tipos (puedes agregar más) |
| `productos` | Ficha de cada producto: código, tipo, empresa, área, cliente, estado, versión, URL publicada, repositorio, plataforma de venta, precio, etiquetas |
| `producto_archivos` | Cada archivo subido con versión (v1, v2…), categoría y marca de VIGENTE |
| `producto_enlaces` | Enlaces de cada producto: Vercel, GitHub, Supabase, Hotmart, Drive, demo… |
| `registro` | Historial de subidas, descargas, cambios y borrados |
| `usuarios_autorizados` | Quién puede entrar (tu correo ya está como **admin**) |

**Almacenamiento privado:** `productos-digitales` (máx. 50 MB por archivo).
**Seguridad:** sin estar en `usuarios_autorizados` nadie ve ni descarga nada.

> Quedaron de la primera versión las tablas `erps`, `erp_archivos`, `bitacora` y el almacenamiento `erp-archivos`. Están vacíos y ya no se usan; puedes borrarlos cuando quieras desde Supabase (Table Editor / Storage).

## 2. Tipos de producto
| Código | Tipo |
|---|---|
| ERP | 📊 ERP / Excel |
| DASHBOARD | 📈 Dashboard |
| WEB | 🌐 Página web |
| APP | 💻 Aplicación / Software |
| IA | 🤖 Asistente IA / Plataforma |
| EBOOK | 📘 Ebook / Infoproducto |
| CATALOGO | 🗂️ Catálogo / Presentación |
| PROMPT | 🧠 Prompt maestro |
| PLANTILLA | 🧩 Plantilla |
| MACRO | ⚙️ Macro / VBA / Script |
| DISENO | 🎨 Diseño / Marca |
| VIDEO | 🎬 Video / Curso |
| DOC | 📄 Documento / Manual |
| OTRO | 📦 Otro |

**Estados:** Idea → En desarrollo → Activo → En venta → Entregado → Pausado → Archivado
**Categorías de archivo:** Entregable · Código fuente · Documentación · Prompt · Imagen / Diseño · Backup · Otro

## 3. Ruta de carpetas (automática)
```
productos-digitales/
 ├─ ERP/
 │   ├─ BAV-OWD-CC/
 │   │   ├─ Entregable/      1731000000_ERP_BAVARIA_OWD.xlsx
 │   │   ├─ Prompt/          1731000500_PROMPT_MAESTRO.txt
 │   │   └─ Documentacion/
 │   ├─ OWD-TOWER/  ADH-EVAL/  ARCH-LL/  DOB-SGIL/  SMART-PER/
 ├─ DASHBOARD/   BAV-DASH/  RECH-LL/  HTL-VOL/
 ├─ MACRO/       MICRO-ERP/
 ├─ WEB/         CENTRO-PD/  TORRE-EJEC/
 ├─ APP/         IQ-TRADING/
 ├─ IA/          LOMBANA-AI/
 ├─ EBOOK/       EB-ASADORES/
 ├─ CATALOGO/    NOVA-CAT/
 └─ PROMPT/ PLANTILLA/ DISENO/ VIDEO/ DOC/ OTRO/   (se llenan al crear productos)
```
La carpeta se arma sola: **TIPO / CÓDIGO / CATEGORÍA / fecha_archivo**.

## 4. Productos ya registrados (16)
- **ERP:** Bavaria OWD Control Center · OWD Control Tower · Adherencia Evaluaciones · Centro de Control Documental · Dobletes y Extendidas San Gil · Smart ERP Personal GeoVictoria
- **Dashboard:** Control Gerencial de Clientes · Torre de Control HTL · Dashboard Presidencial de Rechazos
- **Macro / VBA:** Lombana Studio Micro ERP
- **Página web:** Centro de Productos Digitales · Torre de Control Ejecutiva
- **Software:** IQ Trading Assistant
- **IA:** LOMBANA AI GLOBAL · CLAU AI
- **Ebook:** Guía Definitiva de Asadores (Hotmart, En venta)
- **Catálogo:** NOVA MARKET

## 5. Publicar en Vercel
El código vive en el repositorio `Ivanalexislombanatorres/lombana`, carpeta **`centro-productos-digitales/`** (aparte de LOMBANA AI, que está en `apps/web`).

**Una sola vez:**
1. vercel.com → **Add New → Project** → importar `lombana`.
2. **Project Name:** `centro-productos-digitales`.
3. **Root Directory:** clic en *Edit* → elegir `centro-productos-digitales`.
4. **Framework Preset:** `Other` (sin comando de build) → **Deploy**.

Desde ahí, cada cambio en esta carpeta se publica solo. `vercel.json` incluye una regla (`ignoreCommand`) para que este proyecto solo se vuelva a publicar cuando cambia esta carpeta.

Páginas: `/` (Centro) · `/laboratorio` · `/presidencia`

## 6. Conectar el login (obligatorio)
Supabase → **Authentication → URL Configuration**
- **Site URL:** tu dirección de Vercel
- **Redirect URLs:** `https://TU-DIRECCION.vercel.app/**`

## 7. Primer ingreso
1. Abre la página → escribe **ivanalexislombanatorres@gmail.com** + contraseña → **Crear cuenta**.
2. Confirma el correo de Supabase → vuelve y **Ingresar**.
3. (Recomendado) Supabase → **Authentication → Sign In / Providers → Email** → desactiva **Allow new users to sign up**.

## 8. Dar acceso a otra persona
Supabase → **SQL Editor**:
```sql
insert into usuarios_autorizados (email, nombre, rol)
values ('correo@empresa.com', 'Nombre', 'lector');   -- admin | editor | lector
```

## 9. Agregar un tipo de producto nuevo
```sql
insert into tipos_producto (codigo, nombre, icono, color, orden)
values ('CURSO', 'Curso online', '🎓', '#7b1fa2', 14);
```

## 10. Cómo se usa
- **Menú izquierdo:** filtra por tipo con el contador de cada uno.
- **Tarjetas / Tabla:** cambia la vista; busca por nombre, código, empresa o etiqueta.
- **Clic en un producto:**
  - **Archivos:** elige la categoría, arrastra el archivo → queda como nueva versión VIGENTE de esa categoría. Descarga segura (enlace de 2 min). "Hacer vigente" para volver a una versión anterior.
  - **Enlaces:** guarda Vercel, GitHub, Hotmart, Drive, demo…
  - **Ficha:** todos los datos del producto y su carpeta.
- **+ Nuevo producto:** registra cualquier producto digital.

## 11. ⚗️ El Laboratorio (`/laboratorio`)
Donde se construyen los productos antes de llegar al Centro. Se entra desde el menú del Centro (**Ir a → Laboratorio**) con la misma sesión.

| Sección | Qué hace |
|---|---|
| 🧪 **Tablero de desarrollo** | Tus proyectos en columnas: Idea → Diseño → Construcción → Pruebas → Lanzamiento → Publicado. Mueve con ◀ ▶. Cada tarjeta muestra prioridad y % de avance de tareas |
| 💡 **Banco de ideas** | Anota ideas con impacto (1-5) y esfuerzo (1-5). Se ordenan solas por puntaje y se clasifican: ⚡ Ganancia rápida, 🏔 Proyecto grande, 🧩 Relleno, ⏸ Revisar. Botón **Convertir en proyecto** |
| 🔬 **Experimentos** | Hipótesis → cómo se prueba → resultado → conclusión. Estados: Planeado, En curso, Exitoso, Fallido |
| 🧠 **Biblioteca de prompts** | Tus prompts maestros por categoría, con buscador y botón **Copiar** |
| 🖥️ **Probador HTML** | Escribe o pega código a la izquierda y lo ves en vivo a la derecha (escritorio, tablet o celular). Guarda versiones (v1, v2…) con **Ctrl+S**, abre archivos .html, descarga, y **Enviar al Centro** lo guarda como entregable de un producto |

**Dentro de cada proyecto:** pestañas Resumen, Tareas (clic en el cuadrito: Pendiente → En curso → Hecha), Pruebas (Pendiente / Aprobada / Fallida, con nota) y Páginas HTML.

**🚀 Publicar en el Centro:** desde el proyecto, botón *Publicar en el Centro* (o clic en la etapa *Publicado*). Crea el producto en el Centro y, si el proyecto tiene páginas HTML, guarda la última como archivo entregable. Te avisa si quedan pruebas sin aprobar.

**Ya cargados en el Laboratorio:** LAB-CENTRO (este sistema, con 6 tareas y 5 pruebas de lanzamiento), LAB-IQ (IQ Trading Assistant) y LAB-CLAU (LOMBANA AI · CLAU AI).

**Tablas nuevas en Supabase:** `lab_proyectos`, `lab_tareas`, `lab_pruebas`, `lab_ideas`, `lab_experimentos`, `lab_prompts`, `lab_html` — todas protegidas igual que el Centro.

> El probador ejecuta tu código dentro de un marco aislado: lo que pruebes ahí no puede leer tu sesión ni tus datos.

## 12. ♛ Presidencia (`/presidencia`)
La vista de todo tu portafolio, por nichos. Estructura completa:

```
♛ PRESIDENCIA  (decide: qué avanza, qué está estancado, dónde poner el tiempo)
 ├─ 🧭 Nichos de negocio ── metas, objetivo, estado, propio / terceros
 │    └─ 🗄️ CENTRO: Productos ── versiones, archivos, enlaces
 │          └─ 💰 Ventas · 🧾 Gastos
 ├─ ⚗️ LABORATORIO: proyectos en construcción → se publican como productos
 └─ ⚖️ Decisiones
```

**Nichos iniciales** (puedes editarlos, crear más o cerrarlos):
| Código | Nicho | Tipo | Productos |
|---|---|---|---|
| STUDIO | 💼 Lombana Studio · Software | Propio | Micro ERP, Smart ERP Personal, Centro |
| INFO | 📘 Infoproductos | Propio | Guía de Asadores |
| IA | 🤖 Inteligencia Artificial | Propio | LOMBANA AI · CLAU AI |
| TRADING | 📈 Trading e Inversión | Propio | IQ Trading Assistant |
| COMERCIO | 🛒 Comercio mayorista | Propio | Catálogo NOVA MARKET |
| LOGISTICA | 🚚 Logística y operaciones | **Terceros** | Los 9 ERPs/dashboards de León León / Bavaria + Torre de Control |

Los nichos de **terceros** no se miden por ventas: aparecen en el portafolio pero no cuentan como "pierde dinero".

**Resumen presidencial** (filtro: este mes, mes anterior, 3 meses, año, todo):
- Utilidad, ingresos, gastos, productos en venta, proyectos del laboratorio.
- Gráfico de ingresos de los últimos 12 meses (al pasar el cursor: ingresos, gastos y utilidad del mes).
- Tarjeta por nicho con ingresos, gastos, utilidad, % de meta y semáforo: ▲ Cumple la meta · ■ Rinde bajo la meta · ▼ Pierde dinero · ● Sin movimiento.
- **Alertas automáticas:** proyectos atrasados, decisiones vencidas, productos en venta sin ventas en 30 días o sin precio, nichos que pierden dinero o sin meta, productos sin archivos.
- Ranking de productos que más venden y decisiones pendientes.

**Ventas:** eliges el producto y se llenan solos el precio y el canal de su ficha. **Gastos:** por nicho y categoría (publicidad, software, hosting, IA…). **Decisiones:** qué decidir, contexto, fecha límite y decisión tomada.

> Para que las metas funcionen, entra a 🧭 Nichos y define la **meta de ingresos mensual** de cada nicho propio. Para el semáforo de ventas, pon el **precio** en la ficha de cada producto que esté En venta.

Ya cargué 3 decisiones pendientes: precio de la Guía de Asadores, el futuro de IQ Trading y **qué datos de León León / Bavaria se pueden guardar en el Centro**.

**Tablas nuevas:** `unidades_negocio`, `ventas`, `gastos`, `decisiones` (y el campo `unidad` en productos y proyectos del laboratorio).

## Límites del plan gratis de Supabase
1 GB de archivos · 500 MB de base de datos · si no se usa en 7 días se pausa (entras a supabase.com → **Restore**, no se pierde nada).
