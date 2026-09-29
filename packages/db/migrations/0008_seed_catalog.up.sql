-- 0008_seed_catalog — datos de referencia de la plataforma.
-- Solo catálogos y configuración. No se siembran usuarios, productos, ventas ni métricas.

insert into public.roles (code, scope, name, description) values
  ('ORG_OWNER',   'org',      'Propietario',   'Control total de la organización'),
  ('ORG_ADMIN',   'org',      'Administrador', 'Gestiona miembros, productos y datos de la organización'),
  ('ORG_MEMBER',  'org',      'Miembro',       'Trabaja en proyectos y usa herramientas'),
  ('USER',        'platform', 'Usuario',       'Cuenta estándar'),
  ('CREATOR',     'platform', 'Creador',       'Publica productos (activo en V2)'),
  ('PARTNER',     'platform', 'Afiliado',      'Promociona productos (activo en V2)'),
  ('BUSINESS',    'platform', 'Empresa',       'Módulos empresariales (activo en V3)'),
  ('ADMIN',       'platform', 'Administrador de plataforma', 'Moderación, soporte y auditoría'),
  ('SUPER_ADMIN', 'platform', 'Superadministrador',          'Configuración de plataforma');

insert into public.permissions (code, description) values
  ('org.manage',        'Editar datos y plan de la organización'),
  ('member.manage',     'Invitar, cambiar rol y retirar miembros'),
  ('product.write',     'Crear y editar productos, versiones, archivos y precios'),
  ('lead.read',         'Ver leads y consentimientos'),
  ('lead.export',       'Exportar leads con consentimiento comercial'),
  ('download.read',     'Ver descargas y sus eventos'),
  ('audit.read',        'Ver el registro de auditoría de la organización'),
  ('analytics.read',    'Ver eventos de analítica'),
  ('ai.use',            'Usar CLAU y herramientas con IA'),
  ('ai.usage_read',     'Ver consumo y costos de IA'),
  ('news.contribute',   'Enviar aportes al periódico'),
  ('admin.users',       'Plataforma: gestionar usuarios'),
  ('admin.moderate',    'Plataforma: moderar productos y aportes'),
  ('admin.audit',       'Plataforma: ver auditoría global'),
  ('admin.settings',    'Plataforma: configurar precios mínimos, planes y proveedores');

insert into public.role_permissions (role_code, permission_code)
select 'ORG_OWNER', code from public.permissions where code not like 'admin.%';

insert into public.role_permissions (role_code, permission_code)
select 'ORG_ADMIN', code from public.permissions
 where code not like 'admin.%' and code <> 'org.manage';

insert into public.role_permissions (role_code, permission_code) values
  ('ORG_MEMBER', 'ai.use'),
  ('ORG_MEMBER', 'news.contribute'),
  ('ADMIN', 'admin.users'),
  ('ADMIN', 'admin.moderate'),
  ('ADMIN', 'admin.audit'),
  ('SUPER_ADMIN', 'admin.users'),
  ('SUPER_ADMIN', 'admin.moderate'),
  ('SUPER_ADMIN', 'admin.audit'),
  ('SUPER_ADMIN', 'admin.settings');

-- Límites en NULL = sin definir (criterio de lanzamiento: definirlos).
insert into public.plans (code, name, status) values
  ('FREE',       'Free',       'active'),
  ('PRO',        'Pro',        'planned'),
  ('BUSINESS',   'Business',   'planned'),
  ('ENTERPRISE', 'Enterprise', 'planned');

-- Precio mínimo pedido por el propietario del producto: US$5 (500 centavos).
insert into public.price_rules (currency, min_amount_minor) values ('USD', 500);

insert into public.settings (key, value, description) values
  ('payments.enabled', 'false',
   'Pagos deshabilitados hasta validar proveedor, país, KYC e impuestos. Mientras sea false solo se publican productos gratuitos.'),
  ('product.creation_fee', 'null',
   'Tarifa por crear un producto. PENDIENTE DE DECISIÓN: no confirmado si los US$5 son precio mínimo o tarifa de creación.'),
  ('download.token_ttl_minutes', '1440',
   'Validez del enlace de descarga enviado por email. Valor inicial, ajustable.'),
  ('download.token_max_uses', '3',
   'Canjes permitidos por enlace. Mayor que 1 porque algunos filtros de correo abren los enlaces automáticamente.'),
  ('news.ingestion.enabled', 'false',
   'Ingesta de noticias apagada hasta aprobar términos de uso de cada fuente.');

-- Catálogo de herramientas. Nada está READY: todo parte de PLANNED y avanza con QA.
insert into public.tools (key, name, category, subcategory, description, functionality, requirements, limits_text, status, available_in, sort_order) values
  ('ebook-builder', 'Ebook Builder', 'ia', 'documentos',
   'Crea un ebook desde un tema, público y objetivo.',
   'Estructura, capítulos, edición, versiones y exporte a PDF/DOCX.',
   'Proveedor de IA de texto configurado.', 'Extensión máxima por plan (sin definir).', 'PLANNED', 'V1', 10),
  ('template-builder', 'Template Builder', 'negocio', 'productividad',
   'Crea plantillas Excel a partir de una necesidad.',
   'Campos, fórmulas, indicadores e instrucciones en un .xlsx.',
   'Proveedor de IA de texto configurado.', null, 'PLANNED', 'V1', 20),
  ('doc-analyzer', 'Analizador de documentos y datos', 'ia', 'datos',
   'Resume y analiza PDF, Excel y CSV subidos por el usuario.',
   'Resumen, tablas e indicadores, separando dato, análisis e hipótesis.',
   'Proveedor de IA de texto configurado; almacenamiento de archivos.', 'Tamaño máximo de archivo por plan (sin definir).', 'PLANNED', 'V1', 30),
  ('content-generator', 'Generador de contenido', 'negocio', 'marketing',
   'Textos de marketing, descripciones y emails editables.',
   'Borradores marcados como generados por IA; sin testimonios ni cifras inventadas.',
   'Proveedor de IA de texto configurado.', null, 'PLANNED', 'V1', 40),
  ('brand-builder', 'Brand Builder básico', 'negocio', 'marketing',
   'Nombres, propuesta de valor y tono de marca.',
   'Propuestas con aviso de verificar marca registrada, dominio y redes.',
   'Proveedor de IA de texto configurado.', null, 'PLANNED', 'V1', 50),
  ('trend-ebook', 'Ebook gratis por tendencia', 'ia', 'investigacion',
   'Genera un ebook gratuito sobre un tema en tendencia para captar leads.',
   'Detecta el tema, genera el ebook y lo publica gratis con captura de correo.',
   'Fuente de datos de tendencias con API oficial (REQUIERE VALIDACIÓN) y proveedor de IA.', null, 'BLOCKED', 'V1', 60),
  ('image-generator', 'Generador de imágenes', 'ia', 'imagenes',
   'Imágenes a partir de texto.', 'Sin proveedor elegido.', 'Proveedor de imágenes.', null, 'PLANNED', 'V2', 200),
  ('video-generator', 'Generador de video', 'ia', 'video',
   'Video a partir de texto.', 'Sin proveedor elegido.', 'Proveedor de video.', null, 'PLANNED', 'V3', 210),
  ('voice-tools', 'Voz y audio', 'ia', 'voz',
   'Transcripción y síntesis de voz.', 'Sin proveedor elegido.', 'Proveedor de voz.', null, 'PLANNED', 'V3', 220),
  ('code-generator', 'Generador de código', 'ia', 'codigo',
   'Código a partir de una especificación.', 'Sin definir.', 'Proveedor con capacidad de código.', null, 'PLANNED', 'V3', 230),
  ('crm-lite', 'CRM ligero', 'negocio', 'crm',
   'Contactos, oportunidades y seguimiento.', 'Sin definir.', null, null, 'PLANNED', 'V3', 300);
