-- 0003_projects_content — utilidad de RLS por organización, proyectos, archivos y documentos.

-- Aplica el patrón estándar de aislamiento a una tabla con columna org_id.
--   p_mode: 'crud'   → SELECT/INSERT/UPDATE/DELETE en la organización activa
--           'soft'   → SELECT/INSERT/UPDATE; sin DELETE (se borra con deleted_at).
--                      Para tablas padre: un DELETE físico arrastraría historial append-only.
--           'append' → SELECT/INSERT (tablas de eventos append-only)
--           'read'   → solo SELECT (escrituras solo vía funciones SECURITY DEFINER)
--   p_read_perm / p_write_perm: permiso adicional exigido (NULL = basta ser miembro)
create or replace function app.apply_tenant_rls(
  p_table regclass,
  p_mode text default 'crud',
  p_read_perm text default null,
  p_write_perm text default null
) returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_read  text := 'app.in_org(org_id)';
  v_write text := 'app.in_org(org_id)';
begin
  if p_mode not in ('crud', 'soft', 'append', 'read') then
    raise exception 'Modo RLS desconocido: %', p_mode;
  end if;
  if p_read_perm is not null then
    v_read := v_read || format(' and app.has_permission(org_id, %L)', p_read_perm);
  end if;
  if p_write_perm is not null then
    v_write := v_write || format(' and app.has_permission(org_id, %L)', p_write_perm);
  end if;

  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format('create policy tenant_select on %s for select to lombana_app using (%s)', p_table, v_read);
  execute format('grant select on %s to lombana_app', p_table);

  if p_mode in ('crud', 'soft', 'append') then
    execute format('create policy tenant_insert on %s for insert to lombana_app with check (%s)', p_table, v_write);
    execute format('grant insert on %s to lombana_app', p_table);
  end if;
  if p_mode in ('crud', 'soft') then
    execute format('create policy tenant_update on %s for update to lombana_app using (%s) with check (%s)',
                   p_table, v_write, v_write);
    execute format('grant update on %s to lombana_app', p_table);
  end if;
  if p_mode = 'crud' then
    execute format('create policy tenant_delete on %s for delete to lombana_app using (%s)', p_table, v_write);
    execute format('grant delete on %s to lombana_app', p_table);
  end if;
end
$$;
revoke all on function app.apply_tenant_rls(regclass, text, text, text) from public;

-- Archivos ------------------------------------------------------------------
-- Metadatos del objeto guardado en storage privado. El binario nunca vive en la base.
create table public.files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  storage_key   text not null unique,
  original_name text not null check (length(original_name) between 1 and 255),
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes >= 0),
  sha256        bytea check (octet_length(sha256) = 32),
  scan_status   text not null default 'pending' check (scan_status in ('pending', 'clean', 'infected', 'error')),
  uploaded_by   uuid references public.users (id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (id, org_id)
);
create index files_org_idx on public.files (org_id, created_at desc) where deleted_at is null;

-- Proyectos -----------------------------------------------------------------
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  owner_id   uuid not null references public.users (id),
  name       text not null check (length(btrim(name)) between 1 and 160),
  objective  text,
  status     text not null default 'IDEA' check (status in (
               'IDEA', 'INVESTIGACION', 'VALIDACION', 'DISENO', 'DESARROLLO',
               'REVISION', 'PUBLICACION', 'ACTIVO', 'PAUSADO', 'FINALIZADO')),
  -- Resultado del Intent Engine: objetivo, problema, audiencia, contexto, recursos, restricciones.
  intent     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, org_id)
);
create index projects_org_idx on public.projects (org_id, updated_at desc) where deleted_at is null;
create trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();

-- Tareas del plan. Toda tabla hija usa FK compuesta (id, org_id): una fila nunca
-- puede apuntar a un padre de otra organización.
create table public.project_tasks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  project_id        uuid not null,
  position          integer not null check (position >= 0),
  title             text not null check (length(btrim(title)) between 1 and 200),
  description       text,
  engine            text check (engine in ('ai', 'search', 'data', 'product', 'tools', 'download', 'payment', 'automation', 'integration', 'analytics')),
  status            text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'skipped', 'unavailable')),
  -- 'unavailable' = el paso depende de un módulo que aún no existe; se muestra, no se simula.
  available_in      text not null default 'V1' check (available_in ~ '^V[0-9]+(\.[0-9]+)?$'),
  requires_approval boolean not null default false,
  approved_by       uuid references public.users (id),
  approved_at       timestamptz,
  done_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  unique (project_id, position),
  check ((approved_by is null) = (approved_at is null)),
  check (status <> 'done' or done_at is not null)
);
create trigger project_tasks_touch before update on public.project_tasks
  for each row execute function app.touch_updated_at();

create table public.project_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  project_id    uuid not null,
  actor_user_id uuid references public.users (id),
  kind          text not null check (kind ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)*$'),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index project_events_idx on public.project_events (project_id, created_at desc);
create trigger project_events_append_only before update on public.project_events
  for each row execute function app.forbid_mutation();
-- DELETE directo prohibido; el borrado en cascada del proyecto sí se permite.
create or replace function app.forbid_direct_delete() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;  -- viene de un ON DELETE CASCADE
  end if;
  raise exception 'La tabla % es append-only: DELETE no está permitido', tg_table_name
    using errcode = 'restrict_violation';
end
$$;
create trigger project_events_no_delete before delete on public.project_events
  for each row execute function app.forbid_direct_delete();

create table public.project_decisions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  project_id  uuid not null,
  title       text not null check (length(btrim(title)) between 1 and 200),
  decision    text not null,
  rationale   text,
  decided_by  uuid not null references public.users (id),
  decided_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade
);
create index project_decisions_idx on public.project_decisions (project_id, decided_at desc);

create table public.project_files (
  org_id     uuid not null,
  project_id uuid not null,
  file_id    uuid not null,
  added_by   uuid references public.users (id),
  created_at timestamptz not null default now(),
  primary key (project_id, file_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id) on delete cascade
);

-- Progreso = pasos hechos / pasos disponibles. Los pasos 'unavailable' se cuentan
-- aparte para no inflar el porcentaje con pasos que no se pueden hacer.
create view public.project_progress with (security_invoker = true) as
select p.id as project_id,
       p.org_id,
       count(t.id) filter (where t.status in ('done', 'skipped'))                         as done_count,
       count(t.id) filter (where t.status <> 'unavailable')                              as available_count,
       count(t.id) filter (where t.status = 'unavailable')                               as unavailable_count,
       case when count(t.id) filter (where t.status <> 'unavailable') = 0 then 0
            else round(100.0 * count(t.id) filter (where t.status in ('done', 'skipped'))
                       / count(t.id) filter (where t.status <> 'unavailable'))::int
       end                                                                                as progress_pct
  from public.projects p
  left join public.project_tasks t on t.project_id = p.id
 where p.deleted_at is null
 group by p.id, p.org_id;

-- Documentos generados o editados (ebook, plantilla, análisis, especificación…) --
create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  project_id      uuid,
  kind            text not null check (kind in ('ebook', 'template', 'analysis', 'content', 'brand', 'spec', 'plan', 'landing', 'news_article', 'other')),
  title           text not null check (length(btrim(title)) between 1 and 200),
  status          text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  ai_generated    boolean not null default false,
  current_version integer not null default 0 check (current_version >= 0),
  created_by      uuid references public.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete set null (project_id)
);
create index documents_org_idx on public.documents (org_id, updated_at desc) where deleted_at is null;
create trigger documents_touch before update on public.documents
  for each row execute function app.touch_updated_at();

create table public.document_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  document_id uuid not null,
  version     integer not null check (version >= 1),
  content     jsonb not null,
  origin      text not null check (origin in ('user', 'ai', 'import')),
  created_by  uuid references public.users (id),
  created_at  timestamptz not null default now(),
  unique (document_id, version),
  foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade
);
create trigger document_versions_immutable before update on public.document_versions
  for each row execute function app.forbid_mutation();
create trigger document_versions_no_delete before delete on public.document_versions
  for each row execute function app.forbid_direct_delete();

-- Fuentes citadas. Distingue fuente oficial de secundaria (regla de fuentes).
create table public.sources (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  document_id uuid,
  url         text not null check (url ~* '^https?://'),
  title       text,
  publisher   text,
  source_kind text not null default 'secondary' check (source_kind in ('official', 'secondary', 'user_provided')),
  accessed_at timestamptz not null default now(),
  notes       text,
  created_at  timestamptz not null default now(),
  foreign key (document_id, org_id) references public.documents (id, org_id) on delete cascade
);
create index sources_document_idx on public.sources (document_id);

-- Firmas: quien aprueba un paso o registra una decisión es siempre el usuario actual.
-- Aprobar exige ser dueño del proyecto o tener project.approve.
create or replace function app.guard_signatures() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
begin
  if app.is_privileged() then
    return new;
  end if;
  if tg_table_name = 'project_tasks' then
    if new.approved_by is distinct from (case when tg_op = 'UPDATE' then old.approved_by end) then
      if new.approved_by is not null and new.approved_by <> app.current_user_id() then
        raise exception 'Solo puedes aprobar en tu propio nombre' using errcode = 'insufficient_privilege';
      end if;
      select p.owner_id into v_owner from public.projects p where p.id = new.project_id;
      if new.approved_by is not null and v_owner <> app.current_user_id()
         and not app.has_permission(new.org_id, 'project.approve') then
        raise exception 'No tienes permiso para aprobar pasos de este proyecto' using errcode = 'insufficient_privilege';
      end if;
    end if;
  elsif tg_table_name = 'project_decisions' then
    if new.decided_by <> app.current_user_id() then
      raise exception 'Las decisiones se registran en nombre propio' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;
create trigger project_tasks_signatures before insert or update on public.project_tasks
  for each row execute function app.guard_signatures();
create trigger project_decisions_signatures before insert or update on public.project_decisions
  for each row execute function app.guard_signatures();

-- RLS -----------------------------------------------------------------------
select app.apply_tenant_rls('public.files', 'read');
-- Archivos: la app registra la subida y puede renombrar o marcar como borrado.
-- Escaneo, hash y clave de almacenamiento los fija el worker (función privilegiada).
create policy tenant_insert on public.files for insert to lombana_app
  with check (app.in_org(org_id) and uploaded_by = app.current_user_id() and scan_status = 'pending');
create policy tenant_update on public.files for update to lombana_app
  using (app.in_org(org_id)) with check (app.in_org(org_id));
grant insert (org_id, storage_key, original_name, mime_type, size_bytes, uploaded_by),
      update (original_name, deleted_at) on public.files to lombana_app;

select app.apply_tenant_rls('public.projects', 'soft');
select app.apply_tenant_rls('public.project_tasks');
select app.apply_tenant_rls('public.project_events', 'append');
select app.apply_tenant_rls('public.project_decisions');
select app.apply_tenant_rls('public.project_files');
select app.apply_tenant_rls('public.documents', 'soft');
select app.apply_tenant_rls('public.document_versions', 'append');
select app.apply_tenant_rls('public.sources');
grant select on public.project_progress to lombana_app;

-- Postgres concede EXECUTE a PUBLIC en cada función nueva; se retira explícitamente.
revoke execute on all functions in schema app from public;
