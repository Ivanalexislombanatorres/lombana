// Regresiones de la revisión de seguridad independiente (2026-09-28).
// Cada prueba reproduce un hallazgo verificado y confirma que ya no es explotable.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closePools, createOrgAs, createUser, PG, pgError } from './helpers.js';

let owner: string, orgAdmin: string, member: string, outsider: string;
let org: string, otherOrg: string;

beforeAll(async () => {
  owner = await createUser('duena');
  orgAdmin = await createUser('admin');
  member = await createUser('miembro');
  outsider = await createUser('externo');
  org = await createOrgAs(owner, 'org-sec');
  otherOrg = await createOrgAs(outsider, 'org-externa');
  await admin.query(
    `insert into public.memberships (org_id, user_id, role_code) values ($1, $2, 'ORG_ADMIN'), ($1, $3, 'ORG_MEMBER')`,
    [org, orgAdmin, member]);
});

afterAll(closePools);

describe('H1 · escalada de privilegios en membresías', () => {
  it('un ORG_ADMIN no puede hacerse propietario', async () => {
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.memberships set role_code = 'ORG_OWNER' where org_id = $1 and user_id = $2`, [org, orgAdmin]))))
      .toBe(PG.RLS);
  });

  it('un ORG_ADMIN no puede degradar a la propietaria', async () => {
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.memberships set role_code = 'ORG_MEMBER' where org_id = $1 and user_id = $2`, [org, owner]))))
      .toBe(PG.RLS);
  });

  it('un ORG_ADMIN no puede insertar un propietario ni una membresía ya activa', async () => {
    const u = await createUser('segunda-cuenta');
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `insert into public.memberships (org_id, user_id, role_code, status) values ($1, $2, 'ORG_OWNER', 'invited')`, [org, u]))))
      .toBe(PG.RLS);
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `insert into public.memberships (org_id, user_id, role_code, status) values ($1, $2, 'ORG_MEMBER', 'active')`, [org, u]))))
      .toBe(PG.RLS);
  });

  it('un ORG_ADMIN sí puede invitar miembros (queda como invitación, firmada por él)', async () => {
    const u = await createUser('invitado');
    const row = await as(orgAdmin, org, async (tx) => (await tx.query(
      `insert into public.memberships (org_id, user_id, role_code, status) values ($1, $2, 'ORG_MEMBER', 'invited')
       returning status, invited_by`, [org, u])).rows[0]);
    expect(row).toEqual({ status: 'invited', invited_by: orgAdmin });
  });

  it('nadie cambia su propio rol, ni siquiera la propietaria', async () => {
    const other = await createUser('co-duena');
    await admin.query(`insert into public.memberships (org_id, user_id, role_code) values ($1, $2, 'ORG_OWNER')`, [org, other]);
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `update public.memberships set role_code = 'ORG_ADMIN' where org_id = $1 and user_id = $2`, [org, owner]))))
      .toBe(PG.RLS);
  });
});

describe('H2 · exposición de datos de cuenta', () => {
  it('invitar a un externo no revela sus datos', async () => {
    await as(owner, org, (tx) => tx.query(
      `insert into public.memberships (org_id, user_id, role_code, status) values ($1, $2, 'ORG_MEMBER', 'invited')`,
      [org, outsider]));
    const rows = await as(owner, org, async (tx) =>
      (await tx.query('select id from public.users where id = $1', [outsider])).rows);
    expect(rows).toEqual([]);
  });

  it('un compañero no puede leer proveedor, sujeto, MFA ni último acceso', async () => {
    for (const col of ['auth_subject', 'auth_provider', 'mfa_enabled', 'last_login_at']) {
      expect(await pgError(as(member, org, (tx) => tx.query(`select ${col} from public.users`)))).toBe(PG.RLS);
    }
    const ok = await as(member, org, async (tx) => (await tx.query('select id, display_name from public.users')).rows);
    const ids = ok.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([owner, orgAdmin, member]));
    expect(ids).not.toContain(outsider); // invitado pendiente: invisible
  });
});

describe('H3 · un producto publicado queda congelado', () => {
  let product: string;

  beforeAll(async () => {
    product = (await admin.query(
      `insert into public.products (org_id, slug, title, product_type) values ($1, $2, 'Original', 'ebook') returning id`,
      [org, `h3-${randomUUID().slice(0, 8)}`])).rows[0].id;
    const v1 = (await admin.query(
      `insert into public.product_versions (org_id, product_id, version) values ($1, $2, 1) returning id`,
      [org, product])).rows[0].id;
    await admin.query(`insert into public.product_prices (org_id, product_id, amount_minor, currency) values ($1, $2, 0, 'USD')`,
      [org, product]);
    await admin.query(`update public.products set current_version_id = $1, status = 'published', published_at = now() where id = $2`,
      [v1, product]);
  });

  it('no se cambia título ni versión de un producto publicado', async () => {
    const v2 = await as(orgAdmin, org, async (tx) => (await tx.query(
      `insert into public.product_versions (org_id, product_id, version) values ($1, $2, 2) returning id`, [org, product])).rows[0].id);
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.products set title = 'Otra cosa' where id = $1`, [product])))).toBe(PG.RLS);
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.products set current_version_id = $1 where id = $2`, [v2, product])))).toBe(PG.RLS);
  });

  it('no se cambia el precio de un producto publicado', async () => {
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `insert into public.product_prices (org_id, product_id, amount_minor, currency) values ($1, $2, 1, 'USD')`,
      [org, product])))).toBe(PG.RLS);
  });

  it('sí se puede pausar, y volver a borrador para editarlo', async () => {
    await as(orgAdmin, org, (tx) => tx.query(`update public.products set status = 'paused' where id = $1`, [product]));
    await as(orgAdmin, org, (tx) => tx.query(`update public.products set status = 'draft' where id = $1`, [product]));
    await as(orgAdmin, org, (tx) => tx.query(`update public.products set title = 'Editado' where id = $1`, [product]));
  });
});

describe('H4 · el historial no se borra borrando al padre', () => {
  it('la app no puede borrar proyectos, documentos ni productos (solo borrado lógico)', async () => {
    const p = await as(member, org, async (tx) => (await tx.query(
      `insert into public.projects (org_id, owner_id, name) values ($1, $2, 'x') returning id`, [org, member])).rows[0].id);
    for (const t of ['projects', 'documents', 'products']) {
      expect(await pgError(as(owner, org, (tx) => tx.query(`delete from public.${t} where org_id = $1`, [org])))).toBe(PG.RLS);
    }
    await as(member, org, (tx) => tx.query('update public.projects set deleted_at = now() where id = $1', [p]));
  });

  it('un producto con descargas no se puede borrar físicamente ni siquiera por administración', async () => {
    const prod = (await admin.query(
      `insert into public.products (org_id, slug, title, product_type) values ($1, $2, 'D', 'ebook') returning id`,
      [org, `h4-${randomUUID().slice(0, 8)}`])).rows[0].id;
    const ver = (await admin.query(
      `insert into public.product_versions (org_id, product_id, version) values ($1, $2, 1) returning id`, [org, prod])).rows[0].id;
    const lead = (await admin.query(
      `insert into public.leads (org_id, email) values ($1, $2) returning id`, [org, `l-${randomUUID().slice(0, 6)}@example.com`])).rows[0].id;
    await admin.query(
      `insert into public.downloads (org_id, product_id, product_version_id, lead_id, email, consent_status)
       values ($1, $2, $3, $4, 'x@example.com', 'download_only')`, [org, prod, ver, lead]);
    expect(await pgError(admin.query('delete from public.products where id = $1', [prod]))).toBe(PG.FK);
  });
});

describe('H5 · archivos', () => {
  it('un miembro no puede marcar un archivo como limpio ni cambiar su clave o hash', async () => {
    const f = (await admin.query(
      `insert into public.files (org_id, storage_key, original_name, mime_type, size_bytes, scan_status)
       values ($1, $2, 'a.pdf', 'application/pdf', 10, 'infected') returning id`, [org, `k-${randomUUID()}`])).rows[0].id;
    for (const set of [`scan_status = 'clean'`, `storage_key = 'otra'`, `size_bytes = 1`]) {
      expect(await pgError(as(member, org, (tx) => tx.query(`update public.files set ${set} where id = $1`, [f])))).toBe(PG.RLS);
    }
    await as(member, org, (tx) => tx.query(`update public.files set original_name = 'b.pdf' where id = $1`, [f]));
  });

  it('una subida nueva nace pendiente de escaneo y firmada por quien sube', async () => {
    expect(await pgError(as(member, org, (tx) => tx.query(
      `insert into public.files (org_id, storage_key, original_name, mime_type, size_bytes, uploaded_by)
       values ($1, $2, 'c.pdf', 'application/pdf', 1, $3)`, [org, `k-${randomUUID()}`, owner])))).toBe(PG.RLS);
  });
});

describe('H6 · auditoría y firmas falsas', () => {
  it('la app no escribe eventos "system" ni a nombre de otro usuario', async () => {
    expect(await pgError(as(member, org, (tx) => tx.query(
      `insert into public.audit_logs (org_id, actor_type, action, result) values ($1, 'system', 'member.promote', 'success')`, [org]))))
      .toBe(PG.RLS);
    expect(await pgError(as(member, org, (tx) => tx.query(
      `insert into public.audit_logs (org_id, actor_user_id, actor_type, action, result) values ($1, $2, 'user', 'x.y', 'success')`,
      [org, owner])))).toBe(PG.RLS);
    expect(await pgError(as(null as unknown as string, null, (tx) => tx.query(
      `insert into public.audit_logs (actor_type, action, result) values ('system', 'admin.settings_change', 'success')`))))
      .toBe(PG.RLS);
  });

  it('nadie aprueba un paso a nombre de otro, ni sin permiso', async () => {
    const [proj, task] = await as(owner, org, async (tx) => {
      const p = (await tx.query(`insert into public.projects (org_id, owner_id, name) values ($1, $2, 'aprob') returning id`,
        [org, owner])).rows[0].id;
      const t = (await tx.query(`insert into public.project_tasks (org_id, project_id, position, title, requires_approval)
        values ($1, $2, 0, 'paso', true) returning id`, [org, p])).rows[0].id;
      return [p, t];
    });
    expect(await pgError(as(member, org, (tx) => tx.query(
      `update public.project_tasks set approved_by = $1, approved_at = now() where id = $2`, [owner, task])))).toBe(PG.RLS);
    expect(await pgError(as(member, org, (tx) => tx.query(
      `update public.project_tasks set approved_by = $1, approved_at = now() where id = $2`, [member, task])))).toBe(PG.RLS);
    await as(owner, org, (tx) => tx.query(
      `update public.project_tasks set approved_by = $1, approved_at = now() where id = $2`, [owner, task]));
    expect(await pgError(as(member, org, (tx) => tx.query(
      `insert into public.project_decisions (org_id, project_id, title, decision, decided_by) values ($1, $2, 'd', 'd', $3)`,
      [org, proj, owner])))).toBe(PG.RLS);
  });
});

describe('Bajos · aportes y notificaciones', () => {
  it('el autor no puede inventar notas de moderación ni fechas', async () => {
    expect(await pgError(as(member, org, (tx) => tx.query(
      `insert into public.news_contributions (org_id, author_id, title, body, moderation_note) values ($1, $2, 't', 'b', 'Aprobado')`,
      [org, member])))).toBe(PG.RLS);
  });

  it('no se envían notificaciones a quien no es miembro activo', async () => {
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `insert into public.notifications (org_id, user_id, kind) values ($1, $2, 'aviso.x')`, [org, outsider])))).toBe(PG.RLS);
    await as(owner, org, (tx) => tx.query(
      `insert into public.notifications (org_id, user_id, kind) values ($1, $2, 'aviso.x')`, [org, member]));
  });
});

describe('YouTube', () => {
  let video: string, integration: string;

  beforeAll(async () => {
    integration = (await admin.query(
      `insert into public.integrations (org_id, provider, status, external_account_id, external_account_name, connected_by, connected_at)
       values ($1, 'youtube', 'connected', 'canal-prueba', 'Canal de prueba', $2, now()) returning id`, [org, owner])).rows[0].id;
    const file = (await admin.query(
      `insert into public.files (org_id, storage_key, original_name, mime_type, size_bytes, scan_status)
       values ($1, $2, 'v.mp4', 'video/mp4', 1000, 'clean') returning id`, [org, `v-${randomUUID()}`])).rows[0].id;
    video = await as(owner, org, async (tx) => (await tx.query(
      `insert into public.video_projects (org_id, working_title, yt_title, made_for_kids, video_file_id)
       values ($1, 'Video', 'Título', false, $2) returning id`, [org, file])).rows[0].id);
  });

  const enqueue = (privacy: string) => as(owner, org, (tx) => tx.query(
    `insert into public.video_uploads (org_id, video_project_id, integration_id, requested_privacy, requested_by)
     values ($1, $2, $3, $4, $5)`, [org, video, integration, privacy, owner]));

  it('"conectado" exige una cuenta externa real', async () => {
    expect(await pgError(admin.query(
      `insert into public.integrations (org_id, provider, status) values ($1, 'youtube', 'connected')`, [org]))).toBe(PG.CHECK);
  });

  it('un video sin aprobación humana no se sube', async () => {
    expect(await pgError(enqueue('private'))).toBe(PG.CHECK);
  });

  it('aprobado exige título, declaración "para niños", archivo y aprobador', async () => {
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved' where id = $1`, [video])))).toBe(PG.RLS);
    // La restricción de tabla también lo exige para actores privilegiados.
    expect(await pgError(admin.query(
      `update public.video_projects set status = 'approved' where id = $1`, [video]))).toBe(PG.CHECK);
    await as(owner, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved', approved_by = $1, approved_at = now() where id = $2`, [owner, video]));
  });

  it('sin auditoría de Google solo se permiten subidas privadas', async () => {
    expect(await pgError(enqueue('public'))).toBe(PG.CHECK);
    await enqueue('private');
  });

  it('un miembro sin video.publish no puede encolar subidas', async () => {
    expect(await pgError(as(member, org, (tx) => tx.query(
      `insert into public.video_uploads (org_id, video_project_id, integration_id, requested_privacy, requested_by)
       values ($1, $2, $3, 'private', $4)`, [org, video, integration, member])))).toBe(PG.RLS);
  });

  it('otra organización no ve integraciones ni videos ajenos', async () => {
    const rows = await as(outsider, otherOrg, async (tx) => ({
      i: (await tx.query('select id from public.integrations')).rows,
      v: (await tx.query('select id from public.video_projects')).rows,
    }));
    expect(rows).toEqual({ i: [], v: [] });
  });
});

// Segunda ronda de revisión (2026-09-28).
describe('N1 · canal lateral contra la vista pública de noticias', () => {
  it('la vista pública es security_barrier', async () => {
    const { rows } = await admin.query(
      `select reloptions from pg_class where relname = 'news_published_contributions'`);
    expect(rows[0].reloptions).toContain('security_barrier=true');
  });

  it('la app no puede crear objetos temporales (funciones pg_temp)', async () => {
    expect(await pgError(as(member, org, (tx) => tx.query('create temp table t_x (a int)')))).toBe(PG.RLS);
  });

  it('un borrador ajeno no aparece en la vista pública', async () => {
    await admin.query(
      `insert into public.news_contributions (org_id, author_id, title, body, status)
       values ($1, $2, 'BORRADOR SECRETO', 'no-numérico', 'draft')`, [otherOrg, outsider]);
    const rows = await as(member, org, async (tx) =>
      (await tx.query(`select id from public.news_published_contributions where title = 'BORRADOR SECRETO'`)).rows);
    expect(rows).toEqual([]);
  });
});

describe('N2/N3 · precios de productos publicados', () => {
  async function draftWithPrices(prices: [number, string][]): Promise<string> {
    const id = (await admin.query(
      `insert into public.products (org_id, slug, title, product_type) values ($1, $2, 'P', 'ebook') returning id`,
      [org, `n-${randomUUID().slice(0, 8)}`])).rows[0].id;
    const v = (await admin.query(
      `insert into public.product_versions (org_id, product_id, version) values ($1, $2, 1) returning id`, [org, id])).rows[0].id;
    await admin.query('update public.products set current_version_id = $1 where id = $2', [v, id]);
    for (const [amount, from] of prices) {
      await admin.query(
        `insert into public.product_prices (org_id, product_id, amount_minor, currency, valid_from)
         values ($1, $2, $3, 'USD', now() + $4::interval)`, [org, id, amount, from]);
    }
    return id;
  }

  it('no se puede mover un precio desde un producto publicado hacia un borrador', async () => {
    const pub = await draftWithPrices([[0, '0 seconds']]);
    await admin.query(`update public.products set status = 'published', published_at = now() where id = $1`, [pub]);
    const draft = await draftWithPrices([]);
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.product_prices set product_id = $1 where product_id = $2`, [draft, pub])))).toBe(PG.RLS);
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `delete from public.product_prices where product_id = $1`, [pub])))).toBe(PG.RLS);
  });

  it('un precio programado a futuro por debajo del mínimo impide publicar', async () => {
    const p = await draftWithPrices([[0, '-1 minute'], [100, '1 hour']]);
    expect(await pgError(admin.query(
      `update public.products set status = 'published', published_at = now() where id = $1`, [p]))).toBe(PG.CHECK);
  });

  it('en revisión no se cambia el título que el moderador está revisando', async () => {
    const p = await draftWithPrices([[0, '-1 minute']]);
    await as(orgAdmin, org, (tx) => tx.query(`update public.products set status = 'in_review' where id = $1`, [p]));
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.products set title = 'Cambiado en revisión' where id = $1`, [p])))).toBe(PG.RLS);
  });
});

describe('N4/N5 · aprobación y subida de videos', () => {
  let clean: string, infected: string, integration: string;

  beforeAll(async () => {
    const mk = async (status: string) => (await admin.query(
      `insert into public.files (org_id, storage_key, original_name, mime_type, size_bytes, scan_status)
       values ($1, $2, 'v.mp4', 'video/mp4', 1, $3) returning id`, [org, `n4-${randomUUID()}`, status])).rows[0].id;
    clean = await mk('clean');
    infected = await mk('infected');
    integration = (await admin.query(
      `insert into public.integrations (org_id, provider, status, external_account_id, connected_by, connected_at)
       values ($1, 'youtube', 'connected', $2, $3, now()) returning id`, [org, `c-${randomUUID().slice(0, 6)}`, owner])).rows[0].id;
  });

  const newVideo = (who: string, file: string) => as(who, org, async (tx) => (await tx.query(
    `insert into public.video_projects (org_id, working_title, yt_title, made_for_kids, video_file_id)
     values ($1, 'V', 'T', false, $2) returning id`, [org, file])).rows[0].id);

  it('un miembro no aprueba a nombre de la dueña ni sin permiso', async () => {
    expect(await pgError(as(member, org, (tx) => tx.query(
      `insert into public.video_projects (org_id, working_title, yt_title, made_for_kids, video_file_id, status, approved_by, approved_at)
       values ($1, 'V', 'T', false, $2, 'approved', $3, now())`, [org, clean, owner])))).toBe(PG.RLS);
    const v = await newVideo(member, clean);
    expect(await pgError(as(member, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved', approved_by = $1, approved_at = now() where id = $2`, [member, v]))))
      .toBe(PG.RLS);
  });

  it('no se aprueba un video con archivo infectado', async () => {
    const v = await newVideo(owner, infected);
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved', approved_by = $1, approved_at = now() where id = $2`, [owner, v]))))
      .toBe(PG.CHECK);
  });

  it('un video aprobado no se edita; volver a borrador retira la aprobación', async () => {
    const v = await newVideo(owner, clean);
    await as(owner, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved', approved_by = $1, approved_at = now() where id = $2`, [owner, v]));
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.video_projects set yt_title = 'cambiado' where id = $1`, [v])))).toBe(PG.RLS);
    const row = await as(owner, org, async (tx) => (await tx.query(
      `update public.video_projects set status = 'draft' where id = $1 returning approved_by`, [v])).rows[0]);
    expect(row.approved_by).toBeNull();
  });

  it('la app no escribe resultados de subida ni fechas', async () => {
    const v = await newVideo(owner, clean);
    await as(owner, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved', approved_by = $1, approved_at = now() where id = $2`, [owner, v]));
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `insert into public.video_uploads (org_id, video_project_id, integration_id, requested_privacy, requested_by, youtube_video_id)
       values ($1, $2, $3, 'private', $4, 'FAKEID')`, [org, v, integration, owner])))).toBe(PG.RLS);
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `update public.video_projects set status = 'uploaded' where id = $1`, [v])))).toBe(PG.RLS);
  });
});

describe('V-F1 · un video fallido no vuelve a aprobado sin aprobación nueva', () => {
  it('no se edita un video fallido ni se re-aprueba con la firma anterior', async () => {
    const f = (await admin.query(
      `insert into public.files (org_id, storage_key, original_name, mime_type, size_bytes, scan_status)
       values ($1, $2, 'v.mp4', 'video/mp4', 1, 'clean') returning id`, [org, `vf-${randomUUID()}`])).rows[0].id;
    const v = (await admin.query(
      `insert into public.video_projects (org_id, working_title, yt_title, made_for_kids, video_file_id, status, approved_by, approved_at)
       values ($1, 'V', 'T', false, $2, 'failed', $3, now()) returning id`, [org, f, orgAdmin])).rows[0].id;
    expect(await pgError(as(member, org, (tx) => tx.query(
      `update public.video_projects set yt_title = 'SIN REVISAR' where id = $1`, [v])))).toBe(PG.RLS);
    expect(await pgError(as(member, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved' where id = $1`, [v])))).toBe(PG.RLS);
    expect(await pgError(as(orgAdmin, org, (tx) => tx.query(
      `update public.video_projects set status = 'approved' where id = $1`, [v])))).toBe(PG.RLS);
  });
});
