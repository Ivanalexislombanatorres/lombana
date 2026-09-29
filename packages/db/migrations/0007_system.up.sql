-- 0007_system — notificaciones y eventos de analítica de producto.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  kind       text not null check (kind ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)*$'),
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc) where read_at is null;

-- Eventos de producto (proyecto creado, herramienta usada, entregable exportado…).
-- Sirven para medir el MVP. Sin datos personales en properties.
create table public.analytics_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid references public.organizations (id) on delete cascade,
  user_id      uuid references public.users (id) on delete set null,
  anonymous_id text check (length(anonymous_id) <= 64),
  name         text not null check (name ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  properties   jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index analytics_events_org_time_idx on public.analytics_events (org_id, created_at desc);
create index analytics_events_name_time_idx on public.analytics_events (name, created_at desc);
create trigger analytics_events_append_only before update on public.analytics_events
  for each row execute function app.forbid_mutation();
create trigger analytics_events_no_delete before delete on public.analytics_events
  for each row execute function app.forbid_direct_delete();

-- RLS ------------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
create policy notif_select on public.notifications for select to lombana_app
  using (app.in_org(org_id) and user_id = app.current_user_id());
create policy notif_update on public.notifications for update to lombana_app
  using (app.in_org(org_id) and user_id = app.current_user_id())
  with check (app.in_org(org_id) and user_id = app.current_user_id());
-- Una notificación para otro miembro activo de la misma organización sí se puede crear.
create or replace function app.user_is_member(p_org uuid, p_user uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
                    and p_org = app.current_org_id())
$$;
grant execute on function app.user_is_member(uuid, uuid) to lombana_app;
create policy notif_insert on public.notifications for insert to lombana_app
  with check (app.in_org(org_id) and app.user_is_member(org_id, user_id));
grant select, insert, update (read_at) on public.notifications to lombana_app;

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;
create policy analytics_select on public.analytics_events for select to lombana_app
  using (app.has_permission(org_id, 'analytics.read'));
create policy analytics_insert on public.analytics_events for insert to lombana_app
  with check ((org_id is null or app.in_org(org_id))
              and (user_id is null or user_id = app.current_user_id()));
grant select, insert on public.analytics_events to lombana_app;

-- Postgres concede EXECUTE a PUBLIC en cada función nueva; se retira explícitamente.
revoke execute on all functions in schema app from public;
