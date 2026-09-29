import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closePools, createOrgAs, createUser, PG, pgError } from './helpers.js';

let author: string, authorOrg: string, mod: string, modOrg: string, outsider: string, outsiderOrg: string;

async function contribution(status: 'draft' | 'submitted' = 'submitted'): Promise<string> {
  return as(author, authorOrg, async (tx) =>
    (await tx.query(
      `insert into public.news_contributions (org_id, author_id, title, body, status)
       values ($1, $2, $3, $4, $5) returning id`,
      [authorOrg, author, `Aporte ${randomUUID().slice(0, 6)}`, 'x'.repeat(100), status],
    )).rows[0].id);
}

async function productInReview(amountMinor: number): Promise<string> {
  return as(author, authorOrg, async (tx) => {
    const p = (await tx.query(
      `insert into public.products (org_id, slug, title, product_type, created_by)
       values ($1, $2, 'Producto', 'ebook', $3) returning id`,
      [authorOrg, `p-${randomUUID().slice(0, 8)}`, author])).rows[0].id;
    const v = (await tx.query(
      `insert into public.product_versions (org_id, product_id, version) values ($1, $2, 1) returning id`,
      [authorOrg, p])).rows[0].id;
    await tx.query('update public.products set current_version_id = $2 where id = $1', [p, v]);
    await tx.query(`insert into public.product_prices (org_id, product_id, amount_minor, currency) values ($1, $2, $3, 'USD')`,
      [authorOrg, p, amountMinor]);
    await tx.query(`update public.products set status = 'in_review' where id = $1`, [p]);
    return p;
  });
}

async function addCleanDeliverable(productId: string) {
  const f = (await admin.query(
    `insert into public.files (org_id, storage_key, original_name, mime_type, size_bytes, scan_status)
     values ($1, $2, 'e.pdf', 'application/pdf', 10, 'clean') returning id`,
    [authorOrg, `k-${randomUUID()}`])).rows[0].id;
  await admin.query(
    `insert into public.product_files (org_id, product_version_id, file_id)
     select org_id, current_version_id, $2 from public.products where id = $1`, [productId, f]);
}

beforeAll(async () => {
  author = await createUser('autor');
  authorOrg = await createOrgAs(author, 'org-autor');
  mod = await createUser('moderador');
  modOrg = await createOrgAs(mod, 'org-mod');
  outsider = await createUser('curioso');
  outsiderOrg = await createOrgAs(outsider, 'org-curioso');
  await admin.query(`insert into public.platform_role_assignments (user_id, role_code) values ($1, 'ADMIN')`, [mod]);
});

afterAll(closePools);

describe('moderación de plataforma', () => {
  it('sin rol de plataforma no se ve la cola ni se modera', async () => {
    const c = await contribution();
    expect(await pgError(as(outsider, outsiderOrg, (tx) => tx.query('select * from app.moderation_queue()')))).toBe(PG.RLS);
    expect(await pgError(as(author, authorOrg, (tx) =>
      tx.query(`select app.moderate_contribution($1, 'approved')`, [c])))).toBe(PG.RLS);
  });

  it('un moderador aprueba un aporte y queda publicado y auditado', async () => {
    const c = await contribution();
    const queue = await as(mod, modOrg, async (tx) => (await tx.query('select kind, id from app.moderation_queue()')).rows);
    expect(queue).toContainEqual({ kind: 'contribution', id: c });
    await as(mod, modOrg, (tx) => tx.query(`select app.moderate_contribution($1, 'approved')`, [c]));
    const pub = await as(outsider, outsiderOrg, async (tx) =>
      (await tx.query('select id from public.news_published_contributions where id = $1', [c])).rows);
    expect(pub).toHaveLength(1);
    const audit = await admin.query(
      `select actor_type, actor_user_id from public.audit_logs where target_id = $1 and action = 'news.contribution_moderate'`, [c]);
    expect(audit.rows).toEqual([{ actor_type: 'admin', actor_user_id: mod }]);
  });

  it('rechazar exige nota; solo se modera lo pendiente; nadie modera lo suyo', async () => {
    const c = await contribution();
    expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.moderate_contribution($1, 'rejected')`, [c])))).toBe('22023');
    await as(mod, modOrg, (tx) => tx.query(`select app.moderate_contribution($1, 'rejected', 'Faltan fuentes')`, [c]));
    expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.moderate_contribution($1, 'approved')`, [c])))).toBe(PG.CHECK);
    const draft = await contribution('draft');
    expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.moderate_contribution($1, 'approved')`, [draft])))).toBe(PG.CHECK);

    const own = await as(mod, modOrg, async (tx) =>
      (await tx.query(`insert into public.news_contributions (org_id, author_id, title, body, status)
                       values ($1, $2, 'Mío', $3, 'submitted') returning id`, [modOrg, mod, 'y'.repeat(100)])).rows[0].id);
    expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.moderate_contribution($1, 'approved')`, [own])))).toBe(PG.RLS);
  });

  it('un usuario suspendido pierde el permiso de moderar', async () => {
    const c = await contribution();
    await admin.query(`update public.users set status = 'suspended' where id = $1`, [mod]);
    try {
      expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.moderate_contribution($1, 'approved')`, [c])))).toBe(PG.RLS);
    } finally {
      await admin.query(`update public.users set status = 'active' where id = $1`, [mod]);
    }
  });

  it('publicar un producto exige archivo entregable limpio', async () => {
    const p = await productInReview(0);
    expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.review_product($1, 'publish')`, [p])))).toBe(PG.CHECK);
    await addCleanDeliverable(p);
    await as(mod, modOrg, (tx) => tx.query(`select app.review_product($1, 'publish')`, [p]));
    const { rows } = await admin.query('select status, published_at is not null as pub from public.products where id = $1', [p]);
    expect(rows[0]).toEqual({ status: 'published', pub: true });
  });

  it('un producto de pago no se publica mientras los pagos estén deshabilitados', async () => {
    const p = await productInReview(900);
    await addCleanDeliverable(p);
    expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.review_product($1, 'publish')`, [p])))).toBe(PG.CHECK);
  });

  it('devolver a borrador exige nota y el creador la ve', async () => {
    const p = await productInReview(0);
    expect(await pgError(as(mod, modOrg, (tx) => tx.query(`select app.review_product($1, 'return')`, [p])))).toBe('22023');
    await as(mod, modOrg, (tx) => tx.query(`select app.review_product($1, 'return', 'Agrega una portada')`, [p]));
    const note = await as(author, authorOrg, async (tx) =>
      (await tx.query('select app.product_review_note($1) as n', [p])).rows[0].n);
    expect(note).toBe('Agrega una portada');
    // Otra organización no puede leer la nota.
    const other = await as(outsider, outsiderOrg, async (tx) =>
      (await tx.query('select app.product_review_note($1) as n', [p])).rows[0].n);
    expect(other).toBeNull();
    const { rows } = await admin.query('select status from public.products where id = $1', [p]);
    expect(rows[0].status).toBe('draft');
  });
});
