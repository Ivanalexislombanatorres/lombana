revoke all on public.memberships, public.organizations, public.platform_role_assignments,
  public.users, public.plans, public.role_permissions, public.permissions, public.roles,
  public.audit_logs from lombana_app;

-- Primero las tablas (sus políticas dependen de las funciones), luego las funciones.
drop table if exists public.memberships;
drop table if exists public.organizations;
drop table if exists public.platform_role_assignments;
drop table if exists public.users;
drop table if exists public.plans;
drop table if exists public.role_permissions;
drop table if exists public.permissions;
drop table if exists public.roles;
drop table if exists public.audit_logs;

drop function if exists app.create_organization(text, text, text);
drop function if exists app.guard_membership_change();
drop function if exists app.is_org_owner(uuid);
drop function if exists app.shares_org_with(uuid);
drop function if exists app.has_permission(uuid, text);
drop function if exists app.in_org(uuid);
drop function if exists app.is_member(uuid);
drop function if exists app.protect_last_owner();
