-- 0005_tools_search_news — catálogo de herramientas, ejecuciones, índice de búsqueda y LOMBANA NEWS.

-- Herramientas (catálogo de plataforma) ---------------------------------------
create table public.tools (
  key           text primary key check (key ~ '^[a-z][a-z0-9_-]*$'),
  name          text not null,
  category      text not null check (category in ('ia', 'negocio')),
  subcategory   text not null,
  description   text not null,
  functionality text not null,
  requirements  text,
  limits_text   text,
  -- Costo en créditos por ejecución. NULL = aún sin definir (no ejecutable).
  credit_cost   integer check (credit_cost >= 0),
  -- Nota del proveedor que la respalda. NULL mientras no haya proveedor elegido.
  provider_note text,
  status        text not null default 'PLANNED' check (status in (
                  'PLANNED', 'IN_DEVELOPMENT', 'TESTING', 'READY', 'BLOCKED', 'DEPRECATED')),
  available_in  text not null check (available_in ~ '^V[0-9]+(\.[0-9]+)?$'),
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Una herramienta READY debe tener costo definido.
  check (status <> 'READY' or credit_cost is not null)
);
create trigger tools_touch before update on public.tools
  for each row execute function app.touch_updated_at();

create table public.tool_runs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  tool_key           text not null references public.tools (key),
  user_id            uuid not null references public.users (id),
  project_id         uuid,
  status             text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input              jsonb not null default '{}'::jsonb,
  output_document_id uuid,
  error_code         text,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete set null (project_id),
  foreign key (output_document_id, org_id) references public.documents (id, org_id) on delete set null (output_document_id),
  check (status not in ('succeeded', 'failed', 'cancelled') or finished_at is not null)
);
create index tool_runs_org_idx on public.tool_runs (org_id, created_at desc);

-- Índice de búsqueda ------------------------------------------------------------
-- org_id NULL = catálogo curado de plataforma (visible para todos, cargado por admins,
-- siempre con fuente y fecha de verificación). org_id definido = contenido privado.
create table public.search_documents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid references public.organizations (id) on delete cascade,
  source_type        text not null check (source_type in ('tool', 'project', 'document', 'product', 'curated_resource', 'news_item')),
  source_id          uuid,
  source_key         text,
  title              text not null,
  body               text not null default '',
  url                text check (url ~* '^https?://'),
  tsv                tsvector generated always as (
                       setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
                       setweight(to_tsvector('spanish', coalesce(body, '')), 'B')) stored,
  -- Dimensión sin fijar hasta elegir proveedor de embeddings (REQUIERE CREDENCIAL).
  -- El índice vectorial se crea en la migración que fije el modelo.
  embedding          vector,
  embedding_model    text,
  curated_source_url text check (curated_source_url ~* '^https?://'),
  curated_checked_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((embedding is null) = (embedding_model is null)),
  check (source_type <> 'curated_resource' or (org_id is null and curated_source_url is not null and curated_checked_at is not null)),
  check (source_id is not null or source_key is not null)
);
create index search_documents_tsv_idx on public.search_documents using gin (tsv);
create index search_documents_org_idx on public.search_documents (org_id);
create unique index search_documents_source_uq on public.search_documents
  (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), source_type, coalesce(source_id::text, source_key));
create trigger search_documents_touch before update on public.search_documents
  for each row execute function app.touch_updated_at();

-- LOMBANA NEWS ------------------------------------------------------------------
-- Fuentes de noticias. Solo se ingiere de fuentes cuyos términos de uso se revisaron.
create table public.news_sources (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  homepage_url    text not null check (homepage_url ~* '^https://'),
  feed_url        text check (feed_url ~* '^https?://'),
  terms_url       text check (terms_url ~* '^https?://'),
  terms_status    text not null default 'pending_review' check (terms_status in ('pending_review', 'approved', 'rejected')),
  source_kind     text not null default 'secondary' check (source_kind in ('official', 'secondary')),
  language        text not null default 'es' check (language ~ '^[a-z]{2}$'),
  country_code    char(2) check (country_code ~ '^[A-Z]{2}$'),
  status          text not null default 'paused' check (status in ('active', 'paused')),
  last_fetched_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (homepage_url),
  check (status <> 'active' or terms_status = 'approved')
);
create trigger news_sources_touch before update on public.news_sources
  for each row execute function app.touch_updated_at();

-- Noticias: titular, enlace al original y resumen PROPIO. Nunca el artículo completo.
create table public.news_items (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.news_sources (id),
  original_url   text not null unique check (original_url ~* '^https?://'),
  headline       text not null check (length(headline) <= 300),
  published_at   timestamptz,
  fetched_at     timestamptz not null default now(),
  summary        text check (length(summary) <= 1200),
  summary_origin text check (summary_origin in ('ai', 'editor')),
  summary_status text not null default 'none' check (summary_status in ('none', 'draft', 'approved')),
  topics         text[] not null default '{}',
  language       text not null default 'es' check (language ~ '^[a-z]{2}$'),
  status         text not null default 'visible' check (status in ('visible', 'hidden')),
  created_at     timestamptz not null default now(),
  check ((summary is null) = (summary_origin is null)),
  check (summary_status = 'none' or summary is not null)
);
create index news_items_published_idx on public.news_items (published_at desc) where status = 'visible';

-- Aportes de usuarios. Se publican solo tras moderación.
create table public.news_contributions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  author_id       uuid not null references public.users (id),
  title           text not null check (length(btrim(title)) between 1 and 200),
  body            text not null check (length(body) between 1 and 20000),
  reference_urls  text[] not null default '{}',
  topics          text[] not null default '{}',
  status          text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'withdrawn')),
  moderated_by    uuid references public.users (id),
  moderated_at    timestamptz,
  moderation_note text,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status <> 'approved' or (moderated_by is not null and moderated_at is not null and published_at is not null))
);
create index news_contributions_published_idx on public.news_contributions (published_at desc) where status = 'approved';
create trigger news_contributions_touch before update on public.news_contributions
  for each row execute function app.touch_updated_at();

-- El autor no puede aprobarse a sí mismo: los cambios a estados de moderación
-- solo ocurren vía funciones administrativas (SECURITY DEFINER), no desde la app.
create or replace function app.guard_contribution_status() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not app.is_privileged() then
    if new.status in ('approved', 'rejected') or new.moderated_by is not null
       or new.moderated_at is not null or new.published_at is not null then
      if tg_op = 'INSERT' or new.status is distinct from old.status
         or new.moderated_by is distinct from old.moderated_by
         or new.published_at is distinct from old.published_at then
        raise exception 'La moderación de aportes no puede hacerse desde la aplicación'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
    if tg_op = 'UPDATE' and old.status in ('approved', 'rejected') then
      raise exception 'Un aporte moderado no puede editarse; retíralo y crea uno nuevo'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$$;
create trigger news_contributions_guard before insert or update on public.news_contributions
  for each row execute function app.guard_contribution_status();

-- RLS -----------------------------------------------------------------------
grant select on public.tools, public.news_sources to lombana_app;

select app.apply_tenant_rls('public.tool_runs');

alter table public.search_documents enable row level security;
alter table public.search_documents force row level security;
create policy search_select on public.search_documents for select to lombana_app
  using (org_id is null or app.in_org(org_id));
create policy search_insert on public.search_documents for insert to lombana_app
  with check (org_id is not null and app.in_org(org_id));
create policy search_update on public.search_documents for update to lombana_app
  using (org_id is not null and app.in_org(org_id))
  with check (org_id is not null and app.in_org(org_id));
create policy search_delete on public.search_documents for delete to lombana_app
  using (org_id is not null and app.in_org(org_id));
grant select, insert, update, delete on public.search_documents to lombana_app;

-- Noticias visibles: lectura pública. Ingesta solo por funciones de plataforma.
alter table public.news_items enable row level security;
alter table public.news_items force row level security;
create policy news_items_public on public.news_items for select to lombana_app
  using (status = 'visible');
grant select on public.news_items to lombana_app;

alter table public.news_contributions enable row level security;
alter table public.news_contributions force row level security;
-- En la tabla, cada autor ve solo sus aportes (con notas de moderación).
create policy contrib_select on public.news_contributions for select to lombana_app
  using (app.in_org(org_id) and author_id = app.current_user_id());
create policy contrib_insert on public.news_contributions for insert to lombana_app
  with check (app.in_org(org_id) and author_id = app.current_user_id()
              and status in ('draft', 'submitted'));
create policy contrib_update on public.news_contributions for update to lombana_app
  using (app.in_org(org_id) and author_id = app.current_user_id())
  with check (app.in_org(org_id) and author_id = app.current_user_id()
              and status in ('draft', 'submitted', 'withdrawn'));
grant select,
      insert (org_id, author_id, title, body, reference_urls, topics, status),
      update (title, body, reference_urls, topics, status) on public.news_contributions to lombana_app;

-- Proyección pública del periódico: solo aportes aprobados y solo columnas publicables
-- (sin autor, organización ni notas de moderación). Vista SIN security_invoker a
-- propósito: es la única vía pública y expone un conjunto cerrado de columnas.
-- security_barrier: el filtro status = 'approved' se evalúa ANTES que cualquier
-- función o condición que agregue quien consulta (evita filtrar borradores vía
-- funciones con efectos secundarios o errores de conversión).
create view public.news_published_contributions with (security_barrier = true) as
select id, title, body, reference_urls, topics, published_at
  from public.news_contributions
 where status = 'approved';
grant select on public.news_published_contributions to lombana_app;

-- Sin tablas ni funciones temporales para la app: cierra la vía de funciones
-- pg_temp usadas como canal lateral contra vistas. Es defensa en profundidad
-- (la vista ya es security_barrier). En hostings donde el rol de migración no es
-- dueño de la base (p. ej. Supabase) no se puede revocar: se registra y se sigue.
do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
exception when insufficient_privilege then
  raise notice 'Sin permiso para revocar TEMPORARY en la base %: se omite (defensa en profundidad)', current_database();
end
$$;

-- Postgres concede EXECUTE a PUBLIC en cada función nueva; se retira explícitamente.
revoke execute on all functions in schema app from public;
