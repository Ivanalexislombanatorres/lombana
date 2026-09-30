-- 0013_admin_governance — gobierno de la plataforma: resumen, usuarios, roles, auditoría y precio mínimo.
--
-- Igual que la moderación: la aplicación (lombana_app) no puede tocar estas tablas por sí misma.
-- Cada función SECURITY DEFINER exige un permiso de plataforma concreto del usuario del contexto:
--   admin.users    → ver usuarios, suspender o reactivar
--   admin.settings → asignar o retirar roles de plataforma; cambiar el precio mínimo
--   admin.audit    → ver la auditoría global
-- Salvaguardas: nadie se suspende a sí mismo, nadie cambia sus propios roles y la plataforma
-- nunca se queda sin un SUPER_ADMIN activo. Todo queda en auditoría como 'admin'.

create or replace function app.require_platform_permission(p_permission text) returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := app.current_user_id();
begin
  if v_user is null or not app.has_platform_permission(p_permission) then
    raise exception 'Se requiere el permiso de plataforma %', p_permission using errcode = 'insufficient_privilege';
  end if;
  return v_user;
end
$$;

-- Permisos de plataforma del usuario actual (para mostrar u ocultar secciones).
create or replace function app.my_platform_permissions() returns text[]
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct rp.permission_code order by rp.permission_code), '{}')
    from public.platform_role_assignments pra
    join public.role_permissions rp on rp.role_code = pra.role_code
    join public.users u on u.id = pra.user_id
   where pra.user_id = app.current_user_id()
     and rp.permission_code like 'admin.%'
     and u.status = 'active' and u.deleted_at is null
$$;

-- Resumen de la plataforma (solo conteos, sin datos personales).
create or replace function app.admin_overview()
returns table (metric text, value bigint)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  perform app.require_platform_permission('admin.users');
  return query
    select 'users_active', count(*) from public.users where status = 'active' and deleted_at is null
    union all select 'users_suspended', count(*) from public.users where status = 'suspended'
    union all select 'organizations', count(*) from public.organizations where deleted_at is null
    union all select 'projects', count(*) from public.projects where deleted_at is null
    union all select 'products_draft', count(*) from public.products where status = 'draft' and deleted_at is null
    union all select 'products_in_review', count(*) from public.products where status = 'in_review' and deleted_at is null
    union all select 'products_published', count(*) from public.products where status = 'published' and deleted_at is null
    union all select 'contributions_pending', count(*) from public.news_contributions where status = 'submitted'
    union all select 'contributions_published', count(*) from public.news_contributions where status = 'approved'
    union all select 'ai_calls_24h', count(*) from public.ai_usage where created_at > now() - interval '1 day'
    union all select 'ai_errors_24h', count(*) from public.ai_usage where created_at > now() - interval '1 day' and status <> 'success';
end
$$;

-- Usuarios (con búsqueda por correo o nombre) y sus roles de plataforma.
create or replace function app.admin_list_users(p_search text default null, p_limit int default 50)
returns table (
  id uuid, email text, display_name text, status text, created_at timestamptz,
  last_login_at timestamptz, roles text[], projects bigint
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_q text := nullif(btrim(p_search), '');
begin
  perform app.require_platform_permission('admin.users');
  return query
    select u.id, u.email, u.display_name, u.status, u.created_at, u.last_login_at,
           coalesce((select array_agg(pra.role_code order by pra.role_code)
                       from public.platform_role_assignments pra where pra.user_id = u.id), '{}'),
           (select count(*) from public.projects p where p.owner_id = u.id and p.deleted_at is null)
      from public.users u
     where u.deleted_at is null
       and (v_q is null or u.email_normalized like '%' || lower(v_q) || '%'
            or lower(coalesce(u.display_name, '')) like '%' || lower(v_q) || '%')
     order by u.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end
$$;

-- Suspender o reactivar una cuenta.
create or replace function app.admin_set_user_status(p_user uuid, p_status text, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := app.require_platform_permission('admin.users');
  v_old text;
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'Estado inválido' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Indica el motivo del cambio' using errcode = 'invalid_parameter_value';
  end if;
  if p_user = v_admin then
    raise exception 'Nadie cambia el estado de su propia cuenta' using errcode = 'insufficient_privilege';
  end if;
  select status into v_old from public.users where id = p_user and deleted_at is null for update;
  if not found then
    raise exception 'El usuario no existe' using errcode = 'check_violation';
  end if;
  -- Suspender a un SUPER_ADMIN exige ser SUPER_ADMIN, y nunca deja la plataforma sin uno activo.
  if exists (select 1 from public.platform_role_assignments where user_id = p_user and role_code = 'SUPER_ADMIN') then
    perform app.require_platform_permission('admin.settings');
    if p_status = 'suspended' and not exists (
         select 1 from public.platform_role_assignments pra join public.users u on u.id = pra.user_id
          where pra.role_code = 'SUPER_ADMIN' and pra.user_id <> p_user and u.status = 'active' and u.deleted_at is null) then
      raise exception 'La plataforma debe conservar al menos un SUPER_ADMIN activo' using errcode = 'check_violation';
    end if;
  end if;
  update public.users set status = p_status where id = p_user;
  insert into public.audit_logs (actor_user_id, actor_type, action, target_type, target_id, result, metadata)
  values (v_admin, 'admin', 'admin.user_status', 'user', p_user, 'success',
          jsonb_build_object('desde', v_old, 'hacia', p_status, 'motivo', left(btrim(p_reason), 500)));
end
$$;

-- Asignar o retirar un rol de plataforma.
create or replace function app.admin_set_platform_role(p_user uuid, p_role text, p_grant boolean)
returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := app.require_platform_permission('admin.settings');
begin
  if not exists (select 1 from public.roles where code = p_role and scope = 'platform') then
    raise exception 'Rol de plataforma inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_user = v_admin then
    raise exception 'Nadie cambia sus propios roles' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.users where id = p_user and deleted_at is null) then
    raise exception 'El usuario no existe' using errcode = 'check_violation';
  end if;
  if p_grant then
    insert into public.platform_role_assignments (user_id, role_code, granted_by)
    values (p_user, p_role, v_admin) on conflict do nothing;
  else
    if p_role = 'SUPER_ADMIN' and not exists (
         select 1 from public.platform_role_assignments pra join public.users u on u.id = pra.user_id
          where pra.role_code = 'SUPER_ADMIN' and pra.user_id <> p_user and u.status = 'active' and u.deleted_at is null) then
      raise exception 'La plataforma debe conservar al menos un SUPER_ADMIN activo' using errcode = 'check_violation';
    end if;
    delete from public.platform_role_assignments where user_id = p_user and role_code = p_role;
  end if;
  insert into public.audit_logs (actor_user_id, actor_type, action, target_type, target_id, result, metadata)
  values (v_admin, 'admin', case when p_grant then 'admin.role_grant' else 'admin.role_revoke' end,
          'user', p_user, 'success', jsonb_build_object('rol', p_role));
end
$$;

-- Auditoría global (más reciente primero), con el correo del actor.
create or replace function app.admin_audit(p_limit int default 100)
returns table (created_at timestamptz, actor_email text, actor_type text, action text,
               target_type text, target_id uuid, result text, metadata jsonb)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  perform app.require_platform_permission('admin.audit');
  return query
    select a.created_at, u.email, a.actor_type, a.action, a.target_type, a.target_id, a.result, a.metadata
      from public.audit_logs a
      left join public.users u on u.id = a.actor_user_id
     order by a.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end
$$;

-- Precio mínimo general en USD (en centavos). Se reemplaza la regla activa, conservando el historial.
create or replace function app.admin_set_min_price(p_amount_minor bigint)
returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin uuid := app.require_platform_permission('admin.settings');
  v_old bigint;
begin
  if p_amount_minor is null or p_amount_minor < 100 or p_amount_minor > 10000000 then
    raise exception 'El mínimo debe estar entre US$1 y US$100.000' using errcode = 'invalid_parameter_value';
  end if;
  select min_amount_minor into v_old from public.price_rules
   where active and currency = 'USD' and country_code is null and category is null
   for update;
  update public.price_rules set active = false
   where active and currency = 'USD' and country_code is null and category is null;
  insert into public.price_rules (currency, min_amount_minor, created_by) values ('USD', p_amount_minor, v_admin);
  insert into public.audit_logs (actor_user_id, actor_type, action, target_type, result, metadata)
  values (v_admin, 'admin', 'admin.min_price', 'price_rule', 'success',
          jsonb_build_object('desde', v_old, 'hacia', p_amount_minor));
end
$$;

revoke execute on all functions in schema app from public;
grant execute on function app.my_platform_permissions(), app.admin_overview(), app.admin_list_users(text, int),
  app.admin_set_user_status(uuid, text, text), app.admin_set_platform_role(uuid, text, boolean),
  app.admin_audit(int), app.admin_set_min_price(bigint) to lombana_app;
