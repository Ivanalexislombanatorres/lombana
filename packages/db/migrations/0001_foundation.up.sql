-- 0001_foundation — extensiones, esquema app, rol de aplicación y utilidades comunes.
--
-- Modelo de seguridad:
--   * La aplicación se conecta como lombana_app (sin BYPASSRLS, sin ser dueño de tablas).
--   * En cada transacción la aplicación fija el contexto con app.set_context(user_id, org_id).
--   * Las políticas RLS leen ese contexto. Si el código olvida filtrar por organización,
--     la base de datos igual devuelve cero filas de otras organizaciones.

create extension if not exists pgcrypto;
create extension if not exists vector;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'lombana_app') then
    create role lombana_app login nobypassrls nosuperuser nocreatedb nocreaterole;
  end if;
  -- Rol sin login que marca a los actores privilegiados (moderación, administración).
  -- Las funciones SECURITY DEFINER corren como su dueño, que pertenece a este rol.
  -- Las guardas de negocio se aplican a TODO actor que no pertenezca a él.
  if not exists (select 1 from pg_roles where rolname = 'lombana_privileged') then
    create role lombana_privileged nologin;
  end if;
end
$$;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to lombana_app;
grant usage on schema public to lombana_app;

-- ¿El actor actual es privilegiado? (superusuario o miembro de lombana_privileged)
create or replace function app.is_privileged() returns boolean
language sql stable
set search_path = pg_catalog
as $$
  select pg_has_role(current_user, 'lombana_privileged', 'MEMBER')
$$;

-- Contexto de la petición -------------------------------------------------

create or replace function app.current_user_id() returns uuid
language sql stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.current_org_id() returns uuid
language sql stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- Fija el contexto solo para la transacción en curso (is_local = true).
create or replace function app.set_context(p_user_id uuid, p_org_id uuid) returns void
language sql volatile
set search_path = pg_catalog
as $$
  select set_config('app.user_id', coalesce(p_user_id::text, ''), true),
         set_config('app.org_id', coalesce(p_org_id::text, ''), true);
$$;

-- Utilidades de triggers ---------------------------------------------------

create or replace function app.touch_updated_at() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Tablas de eventos: solo se insertan filas. Ni UPDATE ni DELETE.
create or replace function app.forbid_mutation() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'La tabla % es append-only: % no está permitido', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end
$$;

revoke all on all functions in schema app from public;
grant execute on function app.current_user_id(), app.current_org_id(),
  app.set_context(uuid, uuid), app.is_privileged() to lombana_app;
