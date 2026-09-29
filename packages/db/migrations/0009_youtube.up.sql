-- 0009_youtube — videos estructurados para YouTube y publicación en el canal del usuario.
--
-- HECHOS (documentación oficial de YouTube Data API v3, videos.insert, consultada 2026-09-28):
--   * Subir exige OAuth del dueño del canal (scope youtube.upload u otro equivalente).
--   * Las subidas tienen su propia cuota: 100 llamadas por día.
--   * Proyectos de API sin verificar creados después del 28-jul-2020 suben videos
--     restringidos a "privado" hasta pasar una auditoría de Google.
-- Por eso: mientras el proyecto de Lombana no esté auditado, la base solo acepta
-- subidas en privado (setting youtube.api_project_audited).
--
-- Generar el video en sí (render) no está en V1: el usuario sube su archivo de video.
-- Lombana estructura el guion, capítulos, título, descripción, etiquetas y miniatura.

-- Integraciones (conexiones OAuth por organización) -------------------------------
create table public.integrations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  provider              text not null check (provider in ('youtube')),
  status                text not null default 'pending_authorization' check (status in (
                          'pending_authorization', 'connected', 'error', 'revoked')),
  external_account_id   text,
  external_account_name text,
  scopes                text[] not null default '{}',
  connected_by          uuid references public.users (id),
  connected_at          timestamptz,
  last_success_at       timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, provider, external_account_id),
  -- "Conectado" solo si hay cuenta externa identificada y fecha de conexión real.
  check (status <> 'connected' or (external_account_id is not null and connected_at is not null))
);
create trigger integrations_touch before update on public.integrations
  for each row execute function app.touch_updated_at();

-- Tokens OAuth cifrados por la aplicación (cifrado de sobre con clave del gestor de secretos).
-- La aplicación no tiene NINGÚN acceso: solo el worker privilegiado los usa.
create table public.integration_secrets (
  integration_id uuid primary key,
  org_id         uuid not null,
  ciphertext     bytea not null,
  key_id         text not null,
  created_at     timestamptz not null default now(),
  rotated_at     timestamptz,
  foreign key (integration_id, org_id) references public.integrations (id, org_id) on delete cascade
);

-- Proyecto de video --------------------------------------------------------------
create table public.video_projects (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  project_id           uuid,
  working_title        text not null check (length(btrim(working_title)) between 1 and 200),
  objective            text,
  audience             text,
  target_duration_sec  integer check (target_duration_sec between 15 and 43200),
  status               text not null default 'draft' check (status in (
                         'draft', 'script_ready', 'approved', 'queued', 'uploaded', 'failed')),
  -- Guion estructurado: gancho, secciones con marca de tiempo, llamada a la acción.
  script               jsonb not null default '{}'::jsonb,
  -- Capítulos: [{ "start_sec": 0, "title": "Introducción" }, ...]
  chapters             jsonb not null default '[]'::jsonb check (jsonb_typeof(chapters) = 'array'),
  yt_title             text check (length(yt_title) between 1 and 100),
  yt_description       text check (octet_length(yt_description) <= 5000),
  yt_tags              text[] not null default '{}',
  yt_category_id       text,
  -- Declaración obligatoria "hecho para niños": sin valor por defecto, se decide explícitamente.
  made_for_kids        boolean,
  thumbnail_concept    text,
  video_file_id        uuid,
  thumbnail_file_id    uuid,
  ai_generated         boolean not null default false,
  approved_by          uuid references public.users (id),
  approved_at          timestamptz,
  created_by           uuid references public.users (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete set null (project_id),
  foreign key (video_file_id, org_id) references public.files (id, org_id),
  foreign key (thumbnail_file_id, org_id) references public.files (id, org_id),
  check ((approved_by is null) = (approved_at is null)),
  -- Aprobado para publicar = tiene todo lo que YouTube exige y la aprobación humana.
  check (status not in ('approved', 'queued', 'uploaded')
         or (yt_title is not null and made_for_kids is not null and video_file_id is not null and approved_by is not null))
);
create index video_projects_org_idx on public.video_projects (org_id, updated_at desc) where deleted_at is null;
create trigger video_projects_touch before update on public.video_projects
  for each row execute function app.touch_updated_at();

create or replace function app.file_is_clean(p_file uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.files f
                  where f.id = p_file and f.org_id = app.current_org_id()
                    and f.scan_status = 'clean' and f.deleted_at is null)
$$;

-- Reglas del video para actores no privilegiados:
--   * se aprueba en nombre propio, con permiso video.publish y archivo escaneado limpio;
--   * un video aprobado no se edita: volver a borrador borra la aprobación;
--   * los estados queued/uploaded/failed los fija solo el worker.
create or replace function app.guard_video_project() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_content_changed boolean := false;
begin
  if app.is_privileged() then
    return new;
  end if;
  if new.status in ('queued', 'uploaded', 'failed')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'Ese estado lo asigna el proceso de subida' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    v_content_changed := new.yt_title is distinct from old.yt_title
      or new.yt_description is distinct from old.yt_description
      or new.yt_tags is distinct from old.yt_tags
      or new.yt_category_id is distinct from old.yt_category_id
      or new.made_for_kids is distinct from old.made_for_kids
      or new.video_file_id is distinct from old.video_file_id
      or new.thumbnail_file_id is distinct from old.thumbnail_file_id
      or new.script is distinct from old.script
      or new.chapters is distinct from old.chapters;
    if old.status in ('approved', 'queued', 'uploaded', 'failed') and v_content_changed then
      raise exception 'Un video aprobado no se edita; vuelve a borrador y apruébalo de nuevo'
        using errcode = 'insufficient_privilege';
    end if;
    -- Volver a borrador retira la aprobación.
    if new.status in ('draft', 'script_ready') and old.status not in ('draft', 'script_ready') then
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  -- TODA entrada al estado aprobado exige una aprobación fresca, desde borrador,
  -- en nombre propio, con permiso y con el archivo escaneado limpio.
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if tg_op = 'UPDATE' and old.status not in ('draft', 'script_ready') then
      raise exception 'Solo se aprueba desde borrador' using errcode = 'insufficient_privilege';
    end if;
    if new.approved_by is distinct from app.current_user_id()
       or (tg_op = 'UPDATE' and new.approved_at is not distinct from old.approved_at)
       or not app.has_permission(new.org_id, 'video.publish') then
      raise exception 'Solo quien tiene video.publish aprueba, en nombre propio y en este momento'
        using errcode = 'insufficient_privilege';
    end if;
    if not app.file_is_clean(new.video_file_id) then
      raise exception 'El archivo de video no está escaneado como limpio' using errcode = 'check_violation';
    end if;
  elsif new.approved_by is distinct from (case when tg_op = 'UPDATE' then old.approved_by end)
        and new.approved_by is not null then
    raise exception 'La aprobación solo se registra al aprobar' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger video_projects_guard before insert or update on public.video_projects
  for each row execute function app.guard_video_project();

-- Solicitudes de subida. La app solo encola (acción irreversible confirmada por el usuario);
-- el worker privilegiado ejecuta y actualiza el resultado.
create table public.video_uploads (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  video_project_id  uuid not null,
  integration_id    uuid not null,
  status            text not null default 'queued' check (status in ('queued', 'uploading', 'succeeded', 'failed')),
  requested_privacy text not null check (requested_privacy in ('private', 'unlisted', 'public')),
  -- Privacidad que YouTube aplicó realmente (puede forzar 'private').
  effective_privacy text check (effective_privacy in ('private', 'unlisted', 'public')),
  youtube_video_id  text,
  error_code        text,
  error_message     text,
  requested_by      uuid not null references public.users (id),
  requested_at      timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  foreign key (video_project_id, org_id) references public.video_projects (id, org_id) on delete restrict,
  foreign key (integration_id, org_id) references public.integrations (id, org_id) on delete restrict,
  check (status <> 'succeeded' or (youtube_video_id is not null and finished_at is not null)),
  check (status <> 'failed' or finished_at is not null)
);
create index video_uploads_org_idx on public.video_uploads (org_id, requested_at desc);
-- Una sola subida activa por video.
create unique index video_uploads_one_active_uq on public.video_uploads (video_project_id)
  where status in ('queued', 'uploading');

create or replace function app.guard_video_upload() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_audited boolean;
begin
  if app.is_privileged() then
    return new;
  end if;
  if new.requested_by <> app.current_user_id() or new.status <> 'queued'
     or new.youtube_video_id is not null or new.effective_privacy is not null
     or new.error_code is not null or new.error_message is not null
     or new.started_at is not null or new.finished_at is not null then
    raise exception 'La app solo encola subidas en nombre propio; el resultado lo escribe el worker'
      using errcode = 'insufficient_privilege';
  end if;
  new.requested_at := now();
  if not exists (select 1 from public.video_projects v
                  where v.id = new.video_project_id and v.status = 'approved' and v.deleted_at is null
                    and app.file_is_clean(v.video_file_id)) then
    raise exception 'El video debe estar aprobado y su archivo limpio y vigente' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.integrations i
                  where i.id = new.integration_id and i.provider = 'youtube' and i.status = 'connected') then
    raise exception 'No hay un canal de YouTube conectado' using errcode = 'check_violation';
  end if;
  select coalesce((s.value #>> '{}')::boolean, false) into v_audited
    from public.settings s where s.key = 'youtube.api_project_audited';
  if not coalesce(v_audited, false) and new.requested_privacy <> 'private' then
    raise exception 'Hasta que Google audite el proyecto de API, YouTube solo permite subidas privadas'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger video_uploads_guard before insert on public.video_uploads
  for each row execute function app.guard_video_upload();

-- RLS -------------------------------------------------------------------------------
select app.apply_tenant_rls('public.integrations', 'read');
alter table public.integration_secrets enable row level security;
alter table public.integration_secrets force row level security;

select app.apply_tenant_rls('public.video_projects', 'soft');
select app.apply_tenant_rls('public.video_uploads', 'append', null, 'video.publish');
revoke insert on public.video_uploads from lombana_app;
grant insert (org_id, video_project_id, integration_id, requested_privacy, requested_by) on public.video_uploads to lombana_app;
grant execute on function app.file_is_clean(uuid) to lombana_app;

-- Seeds del módulo ---------------------------------------------------------------------
insert into public.permissions (code, description) values
  ('project.approve',    'Aprobar pasos de proyectos ajenos'),
  ('integration.manage', 'Conectar y desconectar cuentas externas (p. ej. YouTube)'),
  ('video.publish',      'Encolar la publicación de videos en canales conectados');
insert into public.role_permissions (role_code, permission_code) values
  ('ORG_OWNER', 'project.approve'), ('ORG_OWNER', 'integration.manage'), ('ORG_OWNER', 'video.publish'),
  ('ORG_ADMIN', 'project.approve'), ('ORG_ADMIN', 'integration.manage'), ('ORG_ADMIN', 'video.publish');

insert into public.settings (key, value, description) values
  ('youtube.api_project_audited', 'false',
   'El proyecto de API de Lombana pasó la auditoría de YouTube. Mientras sea false solo se permiten subidas privadas.');

insert into public.tools (key, name, category, subcategory, description, functionality, requirements, limits_text, status, available_in, sort_order) values
  ('youtube-video-planner', 'Video estructurado para YouTube', 'ia', 'video',
   'Estructura un video de YouTube a partir de un objetivo y una audiencia.',
   'Guion con gancho, secciones y llamada a la acción; capítulos con marcas de tiempo; título, descripción, etiquetas y concepto de miniatura.',
   'Proveedor de IA de texto configurado.', 'No genera el video renderizado: el usuario sube su archivo.', 'PLANNED', 'V1', 70),
  ('youtube-publisher', 'Publicar en YouTube', 'negocio', 'integraciones',
   'Sube el video aprobado al canal de YouTube conectado por el usuario.',
   'OAuth del dueño del canal, cola de subida, estado real y privacidad efectiva aplicada por YouTube.',
   'Proyecto en Google Cloud con YouTube Data API v3, pantalla de consentimiento OAuth verificada y auditoría de YouTube para subidas públicas (REQUIERE CREDENCIAL y REQUIERE APROBACIÓN).',
   'Cuota oficial de subidas: 100 llamadas/día para el proyecto.', 'BLOCKED', 'V1', 80);

-- Postgres concede EXECUTE a PUBLIC en cada función nueva; se retira explícitamente.
revoke execute on all functions in schema app from public;
