-- 0012_admin_moderation — moderación de plataforma (aportes al periódico y productos).
--
-- La aplicación se conecta como lombana_app y no puede publicar nada por sí misma.
-- Estas funciones SECURITY DEFINER son la única vía de moderación y exigen que el
-- usuario del contexto tenga el rol de plataforma ADMIN o SUPER_ADMIN con el permiso
-- admin.moderate. Nadie modera lo suyo. Cada decisión queda en auditoría como 'admin'.

-- ¿El usuario del contexto tiene un permiso de plataforma?
create or replace function app.has_platform_permission(p_permission text) returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.platform_role_assignments pra
      join public.role_permissions rp on rp.role_code = pra.role_code
      join public.users u on u.id = pra.user_id
     where pra.user_id = app.current_user_id()
       and rp.permission_code = p_permission
       and u.status = 'active' and u.deleted_at is null
  )
$$;

create or replace function app.require_moderator() returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := app.current_user_id();
begin
  if v_user is null or not app.has_platform_permission('admin.moderate') then
    raise exception 'Se requiere permiso de moderación de plataforma' using errcode = 'insufficient_privilege';
  end if;
  return v_user;
end
$$;

-- Cola de moderación (solo lectura, columnas necesarias para decidir).
create or replace function app.moderation_queue()
returns table (
  kind         text,
  id           uuid,
  title        text,
  body         text,
  detail       jsonb,
  author_email text,
  submitted_at timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  perform app.require_moderator();
  return query
    select 'contribution'::text, c.id, c.title, c.body,
           jsonb_build_object('topics', c.topics, 'reference_urls', c.reference_urls),
           u.email, c.updated_at
      from public.news_contributions c
      join public.users u on u.id = c.author_id
     where c.status = 'submitted'
    union all
    select 'product'::text, p.id, p.title, coalesce(p.description, ''),
           jsonb_build_object(
             'product_type', p.product_type, 'category', p.category,
             'amount_minor', (select cp.amount_minor from app.current_price(p.id) cp),
             'currency', (select cp.currency from app.current_price(p.id) cp),
             'deliverables', (select count(*) from public.product_files pf
                               where pf.product_version_id = p.current_version_id and pf.role = 'deliverable')),
           u.email, p.updated_at
      from public.products p
      left join public.users u on u.id = p.created_by
     where p.status = 'in_review' and p.deleted_at is null
     order by 7;
end
$$;

-- Aportes: aprobar (publica) o rechazar con nota.
create or replace function app.moderate_contribution(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_mod uuid := app.require_moderator();
  c public.news_contributions%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decisión inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Rechazar exige una nota para el autor' using errcode = 'invalid_parameter_value';
  end if;
  select * into c from public.news_contributions where id = p_id for update;
  if not found or c.status <> 'submitted' then
    raise exception 'El aporte no está pendiente de moderación' using errcode = 'check_violation';
  end if;
  if c.author_id = v_mod then
    raise exception 'Nadie modera su propio aporte' using errcode = 'insufficient_privilege';
  end if;
  update public.news_contributions
     set status = p_decision,
         moderated_by = v_mod,
         moderated_at = now(),
         moderation_note = nullif(btrim(p_note), ''),
         published_at = case when p_decision = 'approved' then now() end
   where id = p_id;
  insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result, metadata)
  values (c.org_id, v_mod, 'admin', 'news.contribution_moderate', 'news_contribution', p_id, 'success',
          jsonb_build_object('decision', p_decision));
end
$$;

-- Productos: publicar (si cumple TODAS las reglas) o devolver a borrador con nota.
-- Publicar exige al menos un archivo entregable escaneado como limpio: sin archivo
-- no hay nada que descargar, y eso no se simula.
create or replace function app.review_product(p_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_mod uuid := app.require_moderator();
  p public.products%rowtype;
begin
  if p_decision not in ('publish', 'return') then
    raise exception 'Decisión inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_decision = 'return' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Devolver exige una nota para el creador' using errcode = 'invalid_parameter_value';
  end if;
  select * into p from public.products where id = p_id and deleted_at is null for update;
  if not found or p.status <> 'in_review' then
    raise exception 'El producto no está en revisión' using errcode = 'check_violation';
  end if;
  if p.created_by = v_mod then
    raise exception 'Nadie aprueba su propio producto' using errcode = 'insufficient_privilege';
  end if;
  if p_decision = 'publish' then
    if not exists (select 1 from public.product_files pf join public.files f on f.id = pf.file_id
                    where pf.product_version_id = p.current_version_id and pf.role = 'deliverable'
                      and f.scan_status = 'clean' and f.deleted_at is null) then
      raise exception 'El producto no tiene un archivo entregable escaneado como limpio' using errcode = 'check_violation';
    end if;
    -- El trigger products_publication_rules valida precio, mínimo y pagos habilitados.
    update public.products set status = 'published', published_at = now() where id = p_id;
  else
    update public.products set status = 'draft' where id = p_id;
  end if;
  insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result, metadata)
  values (p.org_id, v_mod, 'admin', 'product.review', 'product', p_id, 'success',
          jsonb_build_object('decision', p_decision, 'note', nullif(btrim(p_note), '')));
end
$$;

-- Nota de revisión visible para el creador (la última decisión de moderación).
create or replace function app.product_review_note(p_id uuid) returns text
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select a.metadata->>'note'
    from public.audit_logs a
   where a.target_type = 'product' and a.target_id = p_id and a.action = 'product.review'
     and exists (select 1 from public.products p where p.id = p_id and app.in_org(p.org_id))
   order by a.created_at desc
   limit 1
$$;

revoke execute on all functions in schema app from public;
grant execute on function app.has_platform_permission(text), app.moderation_queue(),
  app.moderate_contribution(uuid, text, text), app.review_product(uuid, text, text),
  app.product_review_note(uuid) to lombana_app;
