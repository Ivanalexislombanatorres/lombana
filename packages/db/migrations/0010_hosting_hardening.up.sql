-- 0010_hosting_hardening — requisitos del rol de migración y cierre de roles de terceros.
--
-- 1) El rol que ejecuta las migraciones es dueño de las tablas. Las funciones
--    SECURITY DEFINER corren como ese dueño y escriben en tablas con FORCE RLS,
--    así que necesita BYPASSRLS (o ser superusuario). Si no lo tiene, se detiene
--    aquí con un mensaje claro en lugar de fallar más tarde en producción.
-- 2) Ese rol debe pertenecer a lombana_privileged para que las guardas de negocio
--    reconozcan a las funciones administrativas (en local el superusuario ya lo es).
-- 3) En Supabase existen los roles anon, authenticated y service_role, que reciben
--    privilegios por defecto sobre el esquema public. LOMBANA no usa la Data API:
--    se retiran todos sus privilegios sobre nuestras tablas, vistas y funciones.

do $$
declare
  r record;
begin
  select rolsuper, rolbypassrls into r from pg_roles where rolname = current_user;
  if not (r.rolsuper or r.rolbypassrls) then
    raise exception 'El rol de migración % necesita BYPASSRLS o ser superusuario', current_user
      using hint = 'Ejecuta las migraciones con el rol dueño del proyecto (en Supabase: postgres).';
  end if;
  if not r.rolsuper and not pg_has_role(current_user, 'lombana_privileged', 'MEMBER') then
    execute format('grant lombana_privileged to %I', current_user);
  end if;
end
$$;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on all tables in schema public from %I', v_role);
      execute format('revoke all on all sequences in schema public from %I', v_role);
      execute format('revoke all on all functions in schema public from %I', v_role);
      execute format('revoke all on all functions in schema app from %I', v_role);
      execute format('revoke usage on schema app from %I', v_role);
      -- Tablas futuras creadas por este rol tampoco se conceden a esos roles.
      execute format('alter default privileges in schema public revoke all on tables from %I', v_role);
      execute format('alter default privileges in schema public revoke all on sequences from %I', v_role);
      execute format('alter default privileges in schema public revoke all on functions from %I', v_role);
    end if;
  end loop;
end
$$;
