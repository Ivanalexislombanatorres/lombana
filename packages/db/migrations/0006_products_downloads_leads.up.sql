-- 0006_products_downloads_leads — productos, precios, regla de precio mínimo,
-- descargas con token, leads y consentimientos.
--
-- Reglas de negocio que impone la base de datos (no solo la aplicación):
--   * Un producto se publica solo si: es gratuito (precio 0), o su precio cumple el
--     mínimo configurado para su moneda/país/categoría, o tiene excepción aprobada.
--   * Un producto pago no se publica mientras los pagos no estén habilitados.
--   * La aplicación no puede publicar: solo envía a revisión. Publicar es moderación.
--   * Una descarga paga nunca queda sin estado de pago; una gratuita no lo necesita.

-- Configuración de plataforma ------------------------------------------------------
create table public.settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value       jsonb not null,
  description text not null,
  updated_by  uuid references public.users (id),
  updated_at  timestamptz not null default now()
);
create trigger settings_touch before update on public.settings
  for each row execute function app.touch_updated_at();

-- Precio mínimo configurable por moneda, país y categoría (NULL = cualquiera).
create table public.price_rules (
  id               uuid primary key default gen_random_uuid(),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  country_code     char(2) check (country_code ~ '^[A-Z]{2}$'),
  category         text,
  min_amount_minor bigint not null check (min_amount_minor > 0),
  active           boolean not null default true,
  created_by       uuid references public.users (id),
  created_at       timestamptz not null default now()
);
create unique index price_rules_scope_uq on public.price_rules
  (currency, coalesce(country_code, '--'), coalesce(category, '--')) where active;

-- Productos -------------------------------------------------------------------
create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  project_id         uuid,
  slug               text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,78}[a-z0-9])?$'),
  title              text not null check (length(btrim(title)) between 1 and 200),
  description        text,
  category           text not null default 'otros',
  product_type       text not null check (product_type in (
                       'ebook', 'template', 'pack', 'prompts', 'checklist', 'course_material', 'spec', 'service', 'other')),
  origin             text not null default 'user' check (origin in ('user', 'trend_generated')),
  status             text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'paused', 'archived')),
  country_code       char(2) check (country_code ~ '^[A-Z]{2}$'),
  current_version_id uuid,
  published_at       timestamptz,
  created_by         uuid references public.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete set null (project_id),
  check (status <> 'published' or (published_at is not null and current_version_id is not null))
);
create index products_org_idx on public.products (org_id, updated_at desc) where deleted_at is null;
create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();

create table public.product_versions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  product_id uuid not null,
  version    integer not null check (version >= 1),
  notes      text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (product_id, version),
  unique (id, org_id),
  unique (id, product_id),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);
create trigger product_versions_immutable before update on public.product_versions
  for each row execute function app.forbid_mutation();
create trigger product_versions_no_delete before delete on public.product_versions
  for each row execute function app.forbid_direct_delete();

alter table public.products
  add constraint products_current_version_fk
  foreign key (current_version_id, id) references public.product_versions (id, product_id);

create table public.product_files (
  org_id             uuid not null,
  product_version_id uuid not null,
  file_id            uuid not null,
  role               text not null default 'deliverable' check (role in ('deliverable', 'cover', 'preview')),
  created_at         timestamptz not null default now(),
  primary key (product_version_id, file_id),
  foreign key (product_version_id, org_id) references public.product_versions (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id)
);

create table public.product_prices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  product_id   uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  valid_from   timestamptz not null default now(),
  valid_to     timestamptz,
  created_by   uuid references public.users (id),
  created_at   timestamptz not null default now(),
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade,
  check (valid_to is null or valid_to > valid_from)
);
create index product_prices_current_idx on public.product_prices (product_id, valid_from desc);

-- Excepciones a la regla de precio mínimo, autorizadas por administración.
create table public.price_rule_exceptions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  product_id  uuid not null,
  reason      text not null check (length(btrim(reason)) >= 10),
  approved_by uuid not null references public.users (id),
  approved_at timestamptz not null default now(),
  revoked_at  timestamptz,
  foreign key (product_id, org_id) references public.products (id, org_id) on delete cascade
);

-- Precio vigente de un producto (el más reciente sin vencer).
create or replace function app.current_price(p_product uuid)
returns table (amount_minor bigint, currency char(3))
language sql stable
set search_path = pg_catalog, public
as $$
  select pp.amount_minor, pp.currency
    from public.product_prices pp
   where pp.product_id = p_product
     and pp.valid_from <= now()
     and (pp.valid_to is null or pp.valid_to > now())
   order by pp.valid_from desc
   limit 1
$$;

-- Mínimo aplicable: la regla activa más específica (país + categoría > país > categoría > general).
create or replace function app.min_price_for(p_currency char(3), p_country char(2), p_category text)
returns bigint
language sql stable
set search_path = pg_catalog, public
as $$
  select r.min_amount_minor
    from public.price_rules r
   where r.active
     and r.currency = p_currency
     and (r.country_code is null or r.country_code = p_country)
     and (r.category is null or r.category = p_category)
   order by (r.country_code is not null) desc, (r.category is not null) desc
   limit 1
$$;

create or replace function app.check_product_publication() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_amount   bigint;
  v_currency char(3);
  v_min      bigint;
  v_payments boolean;
begin
  if not app.is_privileged() then
    -- La aplicación nunca publica: publicar es una decisión de moderación.
    if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
      raise exception 'Publicar requiere revisión administrativa; envía el producto a revisión'
        using errcode = 'insufficient_privilege';
    end if;
    -- Un producto publicado queda congelado: solo se puede pausar o archivar.
    -- Para cambiarlo, se pasa a borrador y vuelve a revisión.
    if tg_op = 'UPDATE' and old.status = 'published' then
      if new.status not in ('published', 'paused', 'archived', 'draft')
         or new.current_version_id is distinct from old.current_version_id
         or new.title is distinct from old.title
         or new.description is distinct from old.description
         or new.category is distinct from old.category
         or new.country_code is distinct from old.country_code
         or new.product_type is distinct from old.product_type
         or new.slug is distinct from old.slug
         or new.deleted_at is distinct from old.deleted_at then
        raise exception 'Un producto publicado no se edita; pásalo a borrador y envíalo a revisión'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
    -- En revisión o pausado tampoco se edita el contenido: lo que se aprueba es lo que se publica.
    if tg_op = 'UPDATE' and old.status in ('in_review', 'paused') and new.status = old.status
       and (new.current_version_id is distinct from old.current_version_id
            or new.title is distinct from old.title
            or new.description is distinct from old.description
            or new.category is distinct from old.category
            or new.country_code is distinct from old.country_code
            or new.product_type is distinct from old.product_type
            or new.slug is distinct from old.slug) then
      raise exception 'Solo se edita un producto en borrador' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Al publicar se valida CADA precio vigente o futuro, no solo el actual:
  -- un precio programado para después también quedó aprobado en esta revisión.
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    select cp.amount_minor, cp.currency into v_amount, v_currency from app.current_price(new.id) cp;
    if v_amount is null then
      raise exception 'El producto % no tiene precio vigente (use 0 para gratuito)', new.id
        using errcode = 'check_violation';
    end if;
    select coalesce((value #>> '{}')::boolean, false) into v_payments
      from public.settings where key = 'payments.enabled';
    for v_amount, v_currency in
      select pp.amount_minor, pp.currency from public.product_prices pp
       where pp.product_id = new.id and (pp.valid_to is null or pp.valid_to > now()) and pp.amount_minor > 0
    loop
      if not coalesce(v_payments, false) then
        raise exception 'Los pagos no están habilitados: solo se pueden publicar productos gratuitos'
          using errcode = 'check_violation';
      end if;
      v_min := app.min_price_for(v_currency, new.country_code, new.category);
      if v_min is null then
        raise exception 'No hay precio mínimo configurado para %: configure uno antes de publicar', v_currency
          using errcode = 'check_violation';
      end if;
      if v_amount < v_min and not exists (
           select 1 from public.price_rule_exceptions e
            where e.product_id = new.id and e.revoked_at is null) then
        raise exception 'Precio % % por debajo del mínimo % %', v_amount, v_currency, v_min, v_currency
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end
$$;
create trigger products_publication_rules
  before insert or update on public.products
  for each row execute function app.check_product_publication();

-- Precio y archivos solo cambian mientras el producto está en borrador.
-- Así lo que se revisó es exactamente lo que se entrega y se cobra.
create or replace function app.product_is_draft(p_product uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce((select p.status = 'draft' from public.products p
                    where p.id = p_product and p.org_id = app.current_org_id()), false)
$$;

create or replace function app.product_of_version(p_version uuid) returns uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select pv.product_id from public.product_versions pv
   where pv.id = p_version and pv.org_id = app.current_org_id()
$$;

-- Se valida la fila ANTERIOR y la NUEVA: mover un precio o un archivo desde un
-- producto publicado hacia un borrador también modifica el publicado.
create or replace function app.guard_product_children() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if app.is_privileged() then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'product_prices' then
    if tg_op <> 'INSERT' then v_old := old.product_id; end if;
    if tg_op <> 'DELETE' then v_new := new.product_id; end if;
  else
    if tg_op <> 'INSERT' then v_old := app.product_of_version(old.product_version_id); end if;
    if tg_op <> 'DELETE' then v_new := app.product_of_version(new.product_version_id); end if;
  end if;
  if (tg_op <> 'INSERT' and not app.product_is_draft(v_old))
     or (tg_op <> 'DELETE' and not app.product_is_draft(v_new)) then
    raise exception 'Precio y archivos solo se modifican con el producto en borrador'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end
$$;
create trigger product_prices_guard before insert or update or delete on public.product_prices
  for each row execute function app.guard_product_children();
create trigger product_files_guard before insert or update or delete on public.product_files
  for each row execute function app.guard_product_children();

-- Textos legales versionados (política, términos, autorizaciones) --------------------
-- legal_status 'approved' solo tras revisión jurídica (REQUIERE VALIDACIÓN LEGAL).
create table public.consent_texts (
  id           uuid primary key default gen_random_uuid(),
  purpose      text not null check (purpose in ('download', 'marketing', 'privacy_policy', 'terms')),
  version      text not null,
  locale       text not null default 'es' check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  body         text not null,
  legal_status text not null default 'draft' check (legal_status in ('draft', 'approved', 'retired')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (purpose, version, locale)
);

-- Leads -------------------------------------------------------------------------
-- El lead pertenece a la organización del creador. Un creador nunca ve leads de otro.
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  email            text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 320),
  email_normalized text generated always as (lower(btrim(email))) stored,
  name             text check (length(name) <= 120),
  company          text check (length(company) <= 160),
  country_code     char(2) check (country_code ~ '^[A-Z]{2}$'),
  extra            jsonb not null default '{}'::jsonb,
  user_id          uuid references public.users (id) on delete set null,
  status           text not null default 'unverified' check (status in ('unverified', 'verified', 'erased')),
  verified_at      timestamptz,
  first_source     text,
  erased_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, email_normalized),
  check (status <> 'verified' or verified_at is not null),
  check (status <> 'erased' or erased_at is not null)
);
create trigger leads_touch before update on public.leads
  for each row execute function app.touch_updated_at();

-- Consentimientos: un registro por acción (otorgado / revocado). Append-only.
-- Estado vigente = la última acción por lead y propósito.
create table public.consents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  lead_id         uuid not null,
  purpose         text not null check (purpose in ('download', 'marketing')),
  action          text not null check (action in ('granted', 'revoked')),
  consent_text_id uuid references public.consent_texts (id),
  ip              inet,
  user_agent      text check (length(user_agent) <= 512),
  source          text,
  created_at      timestamptz not null default now(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete cascade,
  check (action <> 'granted' or consent_text_id is not null)
);
create index consents_lead_idx on public.consents (lead_id, purpose, created_at desc);
create trigger consents_append_only before update on public.consents
  for each row execute function app.forbid_mutation();
create trigger consents_no_delete before delete on public.consents
  for each row execute function app.forbid_direct_delete();

create view public.lead_consent_status with (security_invoker = true) as
select distinct on (c.lead_id, c.purpose)
       c.org_id, c.lead_id, c.purpose, c.action = 'granted' as granted, c.created_at as since
  from public.consents c
 order by c.lead_id, c.purpose, c.created_at desc, c.id desc;

-- Descargas ------------------------------------------------------------------------
create table public.downloads (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  product_id          uuid not null,
  product_version_id  uuid not null,
  lead_id             uuid not null,
  user_id             uuid references public.users (id) on delete set null,
  email               text not null,
  price_minor         bigint not null default 0 check (price_minor >= 0),
  currency            char(3) check (currency ~ '^[A-Z]{3}$'),
  payment_status      text not null default 'not_required' check (payment_status in (
                        'not_required', 'pending', 'paid', 'failed', 'refunded')),
  source              text,
  affiliate_id        uuid,  -- V2: FK a affiliate_accounts cuando exista la tabla
  campaign_id         uuid,  -- V2
  consent_status      text not null check (consent_status in ('download_only', 'download_and_marketing')),
  download_count      integer not null default 0 check (download_count >= 0),
  first_downloaded_at timestamptz,
  last_downloaded_at  timestamptz,
  created_at          timestamptz not null default now(),
  unique (id, org_id),
  -- RESTRICT: el historial de descargas no se pierde borrando el producto o el lead.
  foreign key (product_id, org_id) references public.products (id, org_id) on delete restrict,
  foreign key (product_version_id, org_id) references public.product_versions (id, org_id),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete restrict,
  check ((price_minor = 0 and payment_status = 'not_required' and currency is null)
      or (price_minor > 0 and payment_status <> 'not_required' and currency is not null))
);
create index downloads_org_product_idx on public.downloads (org_id, product_id, created_at desc);
create index downloads_lead_idx on public.downloads (lead_id);

-- Tokens de un solo uso. Solo se guarda el hash SHA-256 del token, nunca el token.
create table public.download_tokens (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  download_id uuid not null,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  expires_at  timestamptz not null,
  max_uses    integer not null default 1 check (max_uses between 1 and 10),
  uses        integer not null default 0 check (uses >= 0),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  foreign key (download_id, org_id) references public.downloads (id, org_id) on delete cascade,
  check (uses <= max_uses),
  check (expires_at > created_at)
);

create table public.download_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  download_id uuid not null,
  kind        text not null check (kind in (
                'requested', 'email_sent', 'token_redeemed', 'file_served',
                'denied_expired', 'denied_used', 'denied_revoked', 'denied_unpublished',
                'denied_rate_limit', 'denied_payment')),
  ip          inet,
  user_agent  text check (length(user_agent) <= 512),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  foreign key (download_id, org_id) references public.downloads (id, org_id) on delete cascade
);
create index download_events_idx on public.download_events (download_id, created_at);
create trigger download_events_append_only before update on public.download_events
  for each row execute function app.forbid_mutation();
create trigger download_events_no_delete before delete on public.download_events
  for each row execute function app.forbid_direct_delete();

-- RLS -----------------------------------------------------------------------------
grant select on public.settings, public.price_rules, public.consent_texts to lombana_app;
grant execute on function app.current_price(uuid), app.min_price_for(char, char, text),
  app.product_is_draft(uuid), app.product_of_version(uuid) to lombana_app;

select app.apply_tenant_rls('public.products', 'soft', null, 'product.write');
select app.apply_tenant_rls('public.product_versions', 'append', null, 'product.write');
select app.apply_tenant_rls('public.product_files', 'crud', null, 'product.write');
select app.apply_tenant_rls('public.product_prices', 'crud', null, 'product.write');
-- Una fila hija nunca cambia de padre: sin UPDATE sobre las columnas de enlace.
revoke update on public.product_files, public.product_prices from lombana_app;
grant update (role) on public.product_files to lombana_app;
grant update (amount_minor, currency, valid_from, valid_to) on public.product_prices to lombana_app;
select app.apply_tenant_rls('public.price_rule_exceptions', 'read');

-- Datos de terceros: lectura con permiso explícito; escritura solo vía funciones
-- del Download Engine (SECURITY DEFINER), que se construyen en su paso.
select app.apply_tenant_rls('public.leads', 'read', 'lead.read');
select app.apply_tenant_rls('public.consents', 'read', 'lead.read');
grant select on public.lead_consent_status to lombana_app;
select app.apply_tenant_rls('public.downloads', 'read', 'download.read');
select app.apply_tenant_rls('public.download_events', 'read', 'download.read');

-- Tokens: sin acceso para la aplicación, ni siquiera lectura.
alter table public.download_tokens enable row level security;
alter table public.download_tokens force row level security;

-- Postgres concede EXECUTE a PUBLIC en cada función nueva; se retira explícitamente.
revoke execute on all functions in schema app from public;
