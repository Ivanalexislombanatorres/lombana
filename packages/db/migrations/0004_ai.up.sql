-- 0004_ai — proveedores, modelos, costos de referencia, conversaciones, consumo y créditos.
--
-- No se siembra ningún proveedor ni modelo: aún no hay uno elegido (REQUIERE CREDENCIAL).
-- El Router lee estas tablas; añadir o retirar un proveedor = filas + adaptador, sin tocar CLAU.

create table public.ai_providers (
  code       text primary key check (code ~ '^[a-z][a-z0-9_-]*$'),
  name       text not null,
  status     text not null default 'disabled' check (status in ('active', 'degraded', 'disabled')),
  docs_url   text check (docs_url ~* '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_providers_touch before update on public.ai_providers
  for each row execute function app.touch_updated_at();

create table public.ai_models (
  id             uuid primary key default gen_random_uuid(),
  provider_code  text not null references public.ai_providers (code),
  model_key      text not null,
  capabilities   text[] not null check (
                   cardinality(capabilities) > 0 and
                   capabilities <@ array['text', 'reasoning', 'code', 'vision', 'image', 'video',
                                         'audio', 'voice', 'embeddings', 'search', 'agents']::text[]),
  context_window integer check (context_window > 0),
  status         text not null default 'disabled' check (status in ('active', 'degraded', 'disabled')),
  priority       integer not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (provider_code, model_key)
);
create trigger ai_models_touch before update on public.ai_models
  for each row execute function app.touch_updated_at();

-- Precios de referencia. source_url es obligatorio: ningún precio sin su documentación oficial.
create table public.ai_costs (
  id             uuid primary key default gen_random_uuid(),
  model_id       uuid not null references public.ai_models (id) on delete cascade,
  unit           text not null check (unit in ('input_token', 'output_token', 'request', 'image', 'audio_second', 'video_second')),
  price_per_unit numeric(20, 12) not null check (price_per_unit >= 0),
  currency       char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz not null,
  effective_to   timestamptz,
  source_url     text not null check (source_url ~* '^https://'),
  verified_at    timestamptz not null,
  created_at     timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);
create index ai_costs_lookup_idx on public.ai_costs (model_id, unit, effective_from desc);

-- Conversaciones con CLAU ------------------------------------------------------
create table public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references public.users (id),
  project_id uuid,
  title      text check (length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete set null (project_id)
);
create index ai_conversations_user_idx on public.ai_conversations (org_id, user_id, updated_at desc);
create trigger ai_conversations_touch before update on public.ai_conversations
  for each row execute function app.touch_updated_at();

-- Registro de consumo (append-only). Una fila por llamada al proveedor, exitosa o no.
create table public.ai_usage (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  user_id        uuid references public.users (id),
  provider_code  text not null,
  model_key      text not null,
  task           text not null check (task ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)*$'),
  modality       text not null check (modality in ('text', 'analysis', 'embeddings', 'image', 'video', 'audio', 'code', 'agents')),
  tool_key       text,
  project_id     uuid,
  request_id     text not null,
  input_tokens   integer check (input_tokens >= 0),
  output_tokens  integer check (output_tokens >= 0),
  other_units    jsonb not null default '{}'::jsonb,
  estimated_cost numeric(20, 8) check (estimated_cost >= 0),
  cost_currency  char(3) check (cost_currency ~ '^[A-Z]{3}$'),
  credits        integer not null default 0 check (credits >= 0),
  status         text not null check (status in ('success', 'error', 'rejected_quota', 'rejected_policy')),
  error_code     text,
  latency_ms     integer check (latency_ms >= 0),
  created_at     timestamptz not null default now(),
  unique (id, org_id),
  check ((estimated_cost is null) = (cost_currency is null))
);
create index ai_usage_org_time_idx on public.ai_usage (org_id, created_at desc);
create index ai_usage_request_idx on public.ai_usage (request_id);
create trigger ai_usage_append_only before update on public.ai_usage
  for each row execute function app.forbid_mutation();
create trigger ai_usage_no_delete before delete on public.ai_usage
  for each row execute function app.forbid_direct_delete();

create table public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  conversation_id uuid not null,
  role            text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content         jsonb not null,
  ai_usage_id     uuid,
  created_at      timestamptz not null default now(),
  foreign key (conversation_id, org_id) references public.ai_conversations (id, org_id) on delete cascade,
  foreign key (ai_usage_id, org_id) references public.ai_usage (id, org_id)
);
create index ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);
create trigger ai_messages_append_only before update on public.ai_messages
  for each row execute function app.forbid_mutation();
create trigger ai_messages_no_delete before delete on public.ai_messages
  for each row execute function app.forbid_direct_delete();

-- Créditos: libro mayor append-only. Saldo = suma de movimientos.
create table public.ai_credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  delta       integer not null check (delta <> 0),
  reason      text not null check (reason in ('plan_grant', 'usage', 'adjustment', 'refund', 'purchase')),
  ai_usage_id uuid,
  created_by  uuid references public.users (id),
  note        text,
  created_at  timestamptz not null default now(),
  foreign key (ai_usage_id, org_id) references public.ai_usage (id, org_id),
  check (reason <> 'usage' or (delta < 0 and ai_usage_id is not null))
);
create index ai_credit_ledger_org_idx on public.ai_credit_ledger (org_id, created_at desc);
create trigger ai_credit_ledger_append_only before update on public.ai_credit_ledger
  for each row execute function app.forbid_mutation();
create trigger ai_credit_ledger_no_delete before delete on public.ai_credit_ledger
  for each row execute function app.forbid_direct_delete();

create view public.ai_credit_balances with (security_invoker = true) as
select org_id, coalesce(sum(delta), 0)::bigint as balance
  from public.ai_credit_ledger
 group by org_id;

-- RLS -----------------------------------------------------------------------
grant select on public.ai_providers, public.ai_models, public.ai_costs to lombana_app;

select app.apply_tenant_rls('public.ai_conversations');
-- Solo el autor ve y edita sus conversaciones, aunque otros sean de la misma organización.
drop policy tenant_select on public.ai_conversations;
drop policy tenant_update on public.ai_conversations;
drop policy tenant_delete on public.ai_conversations;
drop policy tenant_insert on public.ai_conversations;
create policy conv_select on public.ai_conversations for select to lombana_app
  using (app.in_org(org_id) and user_id = app.current_user_id());
create policy conv_insert on public.ai_conversations for insert to lombana_app
  with check (app.in_org(org_id) and user_id = app.current_user_id());
create policy conv_update on public.ai_conversations for update to lombana_app
  using (app.in_org(org_id) and user_id = app.current_user_id())
  with check (app.in_org(org_id) and user_id = app.current_user_id());
create policy conv_delete on public.ai_conversations for delete to lombana_app
  using (app.in_org(org_id) and user_id = app.current_user_id());

select app.apply_tenant_rls('public.ai_messages', 'append');
drop policy tenant_select on public.ai_messages;
drop policy tenant_insert on public.ai_messages;
create policy msg_select on public.ai_messages for select to lombana_app
  using (app.in_org(org_id) and exists (
    select 1 from public.ai_conversations c
     where c.id = conversation_id and c.user_id = app.current_user_id()));
create policy msg_insert on public.ai_messages for insert to lombana_app
  with check (app.in_org(org_id) and exists (
    select 1 from public.ai_conversations c
     where c.id = conversation_id and c.user_id = app.current_user_id()));

-- El consumo lo ve quien tenga permiso de facturación/IA; lo inserta el Router.
select app.apply_tenant_rls('public.ai_usage', 'append', 'ai.usage_read');
drop policy tenant_insert on public.ai_usage;
create policy tenant_insert on public.ai_usage for insert to lombana_app
  with check (app.in_org(org_id) and (user_id is null or user_id = app.current_user_id()));

-- La aplicación solo puede descontar créditos por uso. Asignar créditos (plan,
-- ajuste, compra) queda para funciones administrativas.
select app.apply_tenant_rls('public.ai_credit_ledger', 'append');
drop policy tenant_insert on public.ai_credit_ledger;
create policy ledger_insert_usage on public.ai_credit_ledger for insert to lombana_app
  with check (app.in_org(org_id) and reason = 'usage' and delta < 0 and ai_usage_id is not null);
grant select on public.ai_credit_balances to lombana_app;
