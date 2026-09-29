-- 0002_identity — usuarios, organizaciones, roles, permisos, membresías y planes.

-- Catálogo de roles ---------------------------------------------------------
-- scope 'org'      = rol dentro de una organización (ORG_OWNER, ORG_ADMIN, ORG_MEMBER)
-- scope 'platform' = rol de cuenta en la plataforma (USER, CREATOR, PARTNER, BUSINESS, ADMIN, SUPER_ADMIN)
create table public.roles (
  code        text primary key check (code ~ '^[A-Z][A-Z_]*$'),
  scope       text not null check (scope in ('org', 'platform')),
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  unique (code, scope)
);

create table public.permissions (
  code        text primary key check (code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  description text not null,
  created_at  timestamptz not null default now()
);

create table public.role_permissions (
  role_code       text not null references public.roles (code) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  primary key (role_code, permission_code)
);

-- Planes --------------------------------------------------------------------
-- Los límites en NULL significan "sin definir": la aplicación debe negarse a
-- operar sin límite. Definirlos es criterio de lanzamiento.
create table public.plans (
  code                     text primary key check (code ~ '^[A-Z]+$'),
  name                     text not null,
  status                   text not null default 'planned' check (status in ('active', 'planned', 'retired')),
  monthly_ai_credits       integer check (monthly_ai_credits >= 0),
  max_published_products   integer check (max_published_products >= 0),
  max_downloads_per_month  integer check (max_downloads_per_month >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create trigger plans_touch before update on public.plans
  for each row execute function app.touch_updated_at();

-- Usuarios ------------------------------------------------------------------
create table public.users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 320),
  email_normalized text generated always as (lower(btrim(email))) stored,
  display_name     text check (length(display_name) <= 120),
  auth_provider    text not null,
  auth_subject     text not null,
  mfa_enabled      boolean not null default false,
  status           text not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (auth_provider, auth_subject)
);
create unique index users_email_normalized_uq on public.users (email_normalized) where deleted_at is null;
create trigger users_touch before update on public.users
  for each row execute function app.touch_updated_at();

create table public.platform_role_assignments (
  user_id    uuid not null references public.users (id) on delete cascade,
  role_code  text not null,
  role_scope text generated always as ('platform') stored,
  granted_by uuid references public.users (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_code),
  foreign key (role_code, role_scope) references public.roles (code, scope)
);

-- Organizaciones ------------------------------------------------------------
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 120),
  slug       text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$'),
  kind       text not null default 'personal' check (kind in ('personal', 'team', 'business')),
  plan_code  text not null default 'FREE' references public.plans (code),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  role_code  text not null,
  role_scope text generated always as ('org') stored,
  status     text not null default 'active' check (status in ('invited', 'active', 'removed')),
  invited_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (role_code, role_scope) references public.roles (code, scope)
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';
create trigger memberships_touch before update on public.memberships
  for each row execute function app.touch_updated_at();

-- Auditoría (append-only) ------------------------------------------------------
-- Sin claves foráneas a propósito: el registro sobrevive aunque se borre la
-- organización o el usuario. QUIÉN · QUÉ · CUÁNDO · DÓNDE · RECURSO · ACCIÓN · RESULTADO.
create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid,
  actor_user_id uuid,
  actor_type    text not null check (actor_type in ('user', 'admin', 'system', 'agent', 'public')),
  action        text not null check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  target_type   text,
  target_id     uuid,
  result        text not null check (result in ('success', 'failure', 'denied')),
  ip            inet,
  user_agent    text check (length(user_agent) <= 512),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index audit_logs_org_time_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_actor_time_idx on public.audit_logs (actor_user_id, created_at desc);
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function app.forbid_mutation();

-- Una organización nunca se queda sin propietario activo.
-- SECURITY DEFINER para contar todas las membresías, no solo las visibles para el actor.
create or replace function app.protect_last_owner() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid := old.org_id;
  v_remaining integer;
begin
  if old.role_code <> 'ORG_OWNER' or old.status <> 'active' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role_code = 'ORG_OWNER' and new.status = 'active' then
    return new;
  end if;
  -- Si la organización entera se está borrando (cascade), no bloquear.
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return coalesce(new, old);
  end if;
  select count(*) into v_remaining
    from public.memberships m
   where m.org_id = v_org and m.role_code = 'ORG_OWNER' and m.status = 'active' and m.id <> old.id;
  if v_remaining = 0 then
    raise exception 'La organización % debe conservar al menos un propietario activo', v_org
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end
$$;
create trigger memberships_last_owner
  before update or delete on public.memberships
  for each row execute function app.protect_last_owner();

-- Reglas de membresía para actores no privilegiados:
--   * nadie cambia su propio rol;
--   * solo un ORG_OWNER crea, cambia o retira membresías de propietario;
--   * una membresía nueva nace como invitación; activarla es la aceptación del
--     invitado (función de Auth), no una decisión de quien invita.
-- La guarda corre con los permisos de quien llama (no SECURITY DEFINER), para que
-- app.is_privileged() distinga a la app de las funciones administrativas.
create or replace function app.is_org_owner(p_org uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = app.current_user_id()
                    and m.role_code = 'ORG_OWNER' and m.status = 'active')
$$;

create or replace function app.guard_membership_change() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := app.current_user_id();
  v_actor_is_owner boolean;
begin
  if app.is_privileged() then
    return coalesce(new, old);
  end if;
  v_actor_is_owner := app.is_org_owner(coalesce(new.org_id, old.org_id));

  if tg_op = 'INSERT' then
    if new.status <> 'invited' then
      raise exception 'Las membresías nuevas se crean como invitación' using errcode = 'insufficient_privilege';
    end if;
    if new.role_code = 'ORG_OWNER' and not v_actor_is_owner then
      raise exception 'Solo un propietario puede invitar propietarios' using errcode = 'insufficient_privilege';
    end if;
    new.invited_by := v_actor;
    return new;
  end if;

  if (old.role_code = 'ORG_OWNER' or (tg_op = 'UPDATE' and new.role_code = 'ORG_OWNER')) and not v_actor_is_owner then
    raise exception 'Solo un propietario puede modificar membresías de propietario' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if old.user_id = v_actor and new.role_code is distinct from old.role_code then
      raise exception 'Nadie puede cambiar su propio rol' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'active' and old.status <> 'active' then
      raise exception 'Solo el invitado puede aceptar una invitación' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  return old;
end
$$;
create trigger memberships_guard
  before insert or update or delete on public.memberships
  for each row execute function app.guard_membership_change();

-- Funciones de autorización (SECURITY DEFINER: leen membresías sin pasar por RLS,
-- así las políticas no se llaman a sí mismas). Solo devuelven booleanos.
create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.memberships m
     where m.org_id = p_org
       and m.user_id = app.current_user_id()
       and m.status = 'active'
  )
$$;

-- Fila visible solo en la organización activa del contexto y si el usuario es miembro.
create or replace function app.in_org(p_org uuid) returns boolean
language sql stable
set search_path = pg_catalog, public
as $$
  select p_org is not null and p_org = app.current_org_id() and app.is_member(p_org)
$$;

create or replace function app.has_permission(p_org uuid, p_permission text) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select p_org = app.current_org_id() and exists (
    select 1
      from public.memberships m
      join public.role_permissions rp on rp.role_code = m.role_code
     where m.org_id = p_org
       and m.user_id = app.current_user_id()
       and m.status = 'active'
       and rp.permission_code = p_permission
  )
$$;

-- ¿Comparte el usuario indicado alguna organización con el usuario actual?
create or replace function app.shares_org_with(p_user uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.memberships a
      join public.memberships b on b.org_id = a.org_id
     where a.user_id = app.current_user_id() and a.status = 'active'
       and b.user_id = p_user and b.status = 'active'
       and a.org_id = app.current_org_id()
  )
$$;

-- Crear organización + membresía de propietario de forma atómica.
-- Es la única vía para crear organizaciones desde la aplicación.
create or replace function app.create_organization(p_name text, p_slug text, p_kind text default 'personal')
returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := app.current_user_id();
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'Se requiere un usuario autenticado en el contexto'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.users u where u.id = v_user and u.status = 'active' and u.deleted_at is null) then
    raise exception 'Usuario inexistente o inactivo' using errcode = 'insufficient_privilege';
  end if;

  insert into public.organizations (name, slug, kind, created_by)
  values (p_name, p_slug, p_kind, v_user)
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role_code, status)
  values (v_org, v_user, 'ORG_OWNER', 'active');

  insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result)
  values (v_org, v_user, 'user', 'organization.create', 'organization', v_org, 'success');

  return v_org;
end
$$;

-- RLS -----------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.users force row level security;
create policy users_select on public.users for select to lombana_app
  using (id = app.current_user_id() or app.shares_org_with(id));
create policy users_update_self on public.users for update to lombana_app
  using (id = app.current_user_id())
  with check (id = app.current_user_id());

alter table public.platform_role_assignments enable row level security;
alter table public.platform_role_assignments force row level security;
create policy pra_select_self on public.platform_role_assignments for select to lombana_app
  using (user_id = app.current_user_id());

alter table public.organizations enable row level security;
alter table public.organizations force row level security;
-- Se listan todas las organizaciones del usuario (para cambiar de contexto).
create policy orgs_select on public.organizations for select to lombana_app
  using (app.is_member(id));
create policy orgs_update on public.organizations for update to lombana_app
  using (app.has_permission(id, 'org.manage'))
  with check (app.has_permission(id, 'org.manage'));

alter table public.memberships enable row level security;
alter table public.memberships force row level security;
create policy memberships_select on public.memberships for select to lombana_app
  using (user_id = app.current_user_id() or app.in_org(org_id));
create policy memberships_insert on public.memberships for insert to lombana_app
  with check (app.has_permission(org_id, 'member.manage'));
create policy memberships_update on public.memberships for update to lombana_app
  using (app.has_permission(org_id, 'member.manage'))
  with check (app.has_permission(org_id, 'member.manage'));
create policy memberships_delete on public.memberships for delete to lombana_app
  using (app.has_permission(org_id, 'member.manage'));

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
create policy audit_select on public.audit_logs for select to lombana_app
  using (app.has_permission(org_id, 'audit.read'));
-- La aplicación solo registra acciones de su propio usuario. Los eventos 'system',
-- 'admin' y 'public' los escriben funciones privilegiadas.
create policy audit_insert on public.audit_logs for insert to lombana_app
  with check (
    actor_type = 'user'
    and actor_user_id = app.current_user_id()
    and (org_id is null or app.in_org(org_id))
  );

-- Privilegios -----------------------------------------------------------------
grant select, insert on public.audit_logs to lombana_app;
grant execute on function app.is_member(uuid), app.in_org(uuid), app.has_permission(uuid, text),
  app.shares_org_with(uuid), app.is_org_owner(uuid), app.create_organization(text, text, text) to lombana_app;
grant select on public.roles, public.permissions, public.role_permissions, public.plans to lombana_app;
-- Datos de cuenta visibles para compañeros de organización. Proveedor de identidad,
-- sujeto, MFA y último acceso quedan fuera (se consultan con funciones propias).
grant select (id, email, display_name, status, created_at), update (display_name) on public.users to lombana_app;
grant select on public.platform_role_assignments to lombana_app;
grant select, update (name, kind) on public.organizations to lombana_app;
grant select, insert, update (role_code, status), delete on public.memberships to lombana_app;

-- Postgres concede EXECUTE a PUBLIC en cada función nueva; se retira explícitamente.
revoke execute on all functions in schema app from public;
