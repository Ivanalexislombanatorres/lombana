-- 0011_accounts — alta de cuentas desde el proveedor de identidad.
--
-- El servidor web verifica la sesión con el proveedor (Supabase Auth: firma del JWT)
-- y llama a app.ensure_account con la identidad ya verificada. Es el mismo supuesto
-- de confianza que app.set_context: el servidor de aplicación es quien autentica.
--
-- En el primer ingreso se crean, en una sola transacción: el usuario, su organización
-- personal y su membresía de propietario. En ingresos siguientes se actualiza el correo
-- (si el proveedor lo cambió) y la fecha de último acceso.

create or replace function app.ensure_account(
  p_provider     text,
  p_subject      text,
  p_email        text,
  p_display_name text default null
) returns table (user_id uuid, personal_org_id uuid, is_new boolean)
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_user   uuid;
  v_status text;
  v_deleted timestamptz;
  v_org    uuid;
  v_new    boolean := false;
  v_slug   text;
  v_name   text;
begin
  if coalesce(btrim(p_provider), '') = '' or coalesce(btrim(p_subject), '') = '' then
    raise exception 'Identidad incompleta' using errcode = 'invalid_parameter_value';
  end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo inválido' using errcode = 'invalid_parameter_value';
  end if;

  -- Serializa los ingresos simultáneos de una misma identidad (p. ej. el callback y
  -- la primera página cargando a la vez): evita errores de duplicado y dos espacios personales.
  perform pg_advisory_xact_lock(hashtextextended('account:' || p_provider || ':' || p_subject, 0));

  select u.id, u.status, u.deleted_at into v_user, v_status, v_deleted
    from public.users u
   where u.auth_provider = p_provider and u.auth_subject = p_subject;

  if v_user is not null then
    -- Una cuenta suspendida o eliminada (baja lógica) nunca se reactiva por iniciar sesión.
    if v_status <> 'active' or v_deleted is not null then
      raise exception 'Cuenta no activa' using errcode = 'insufficient_privilege';
    end if;
    update public.users u
       set email = p_email,
           last_login_at = now(),
           display_name = coalesce(u.display_name, nullif(btrim(p_display_name), ''))
     where u.id = v_user;
  else
    -- Mismo correo con otra identidad: no se vinculan cuentas automáticamente.
    if exists (select 1 from public.users u
                where u.email_normalized = lower(btrim(p_email)) and u.deleted_at is null) then
      raise exception 'El correo ya está asociado a otra cuenta' using errcode = 'unique_violation';
    end if;
    v_name := coalesce(nullif(btrim(p_display_name), ''), split_part(p_email, '@', 1));
    insert into public.users (email, display_name, auth_provider, auth_subject, last_login_at)
    values (p_email, left(v_name, 120), p_provider, p_subject, now())
    returning id into v_user;
    v_new := true;
  end if;

  -- Organización personal: la más antigua en la que el usuario es propietario.
  select m.org_id into v_org
    from public.memberships m
    join public.organizations o on o.id = m.org_id
   where m.user_id = v_user and m.status = 'active' and m.role_code = 'ORG_OWNER'
     and o.kind = 'personal' and o.deleted_at is null
   order by o.created_at
   limit 1;

  if v_org is null then
    v_slug := 'u-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    insert into public.organizations (name, slug, kind, created_by)
    values (left('Espacio de ' || coalesce(nullif(btrim(p_display_name), ''), split_part(p_email, '@', 1)), 120),
            v_slug, 'personal', v_user)
    returning id into v_org;
    insert into public.memberships (org_id, user_id, role_code, status)
    values (v_org, v_user, 'ORG_OWNER', 'active');
    insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result)
    values (v_org, v_user, 'system', 'organization.create', 'organization', v_org, 'success');
  end if;

  insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result, metadata)
  values (v_org, v_user, 'system', case when v_new then 'account.create' else 'account.login' end,
          'user', v_user, 'success', jsonb_build_object('provider', p_provider));

  return query select v_user, v_org, v_new;
end
$$;

-- Resolución barata en cada petición (sin escrituras): identidad verificada → usuario activo.
create or replace function app.resolve_account(p_provider text, p_subject text)
returns uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select u.id from public.users u
   where u.auth_provider = p_provider and u.auth_subject = p_subject
     and u.status = 'active' and u.deleted_at is null
$$;

revoke execute on all functions in schema app from public;
grant execute on function app.ensure_account(text, text, text, text), app.resolve_account(text, text) to lombana_app;
