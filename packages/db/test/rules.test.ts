import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closePools, createOrgAs, createUser, PG, pgError } from './helpers.js';

let owner: string, org: string, project: string;

beforeAll(async () => {
  owner = await createUser('eva');
  org = await createOrgAs(owner, 'org-reglas');
  project = await as(owner, org, async (tx) =>
    (await tx.query(`insert into public.projects (org_id, owner_id, name) values ($1, $2, 'P') returning id`,
      [org, owner])).rows[0].id);
});

afterAll(closePools);

describe('tablas append-only', () => {
  it('los eventos de proyecto no se editan ni se borran', async () => {
    const id = await as(owner, org, async (tx) =>
      (await tx.query(`insert into public.project_events (org_id, project_id, kind) values ($1, $2, 'task.created') returning id`,
        [org, project])).rows[0].id);
    expect(await pgError(as(owner, org, (tx) => tx.query(`update public.project_events set kind = 'x.y' where id = $1`, [id]))))
      .toBe(PG.RLS); // la app no tiene privilegio UPDATE
    expect(await pgError(admin.query(`update public.project_events set kind = 'x.y' where id = $1`, [id])))
      .toBe(PG.RESTRICT); // y el trigger lo impide incluso a un superusuario
    expect(await pgError(as(owner, org, (tx) => tx.query(`delete from public.project_events where id = $1`, [id]))))
      .toBe(PG.RLS); // la app ni siquiera tiene privilegio DELETE
    expect(await pgError(admin.query(`delete from public.project_events where id = $1`, [id])))
      .toBe(PG.RESTRICT); // ni un superusuario borra un evento suelto
  });

  it('la auditoría es inmutable incluso para superusuario', async () => {
    const { rows } = await admin.query(
      `select id from public.audit_logs where org_id = $1 and action = 'organization.create'`, [org]);
    expect(rows).toHaveLength(1);
    expect(await pgError(admin.query(`update public.audit_logs set result = 'failure' where id = $1`, [rows[0].id])))
      .toBe(PG.RESTRICT);
  });

  it('borrar un proyecto (solo administración) arrastra sus eventos: única vía de borrado', async () => {
    const p = await as(owner, org, async (tx) => {
      const id = (await tx.query(`insert into public.projects (org_id, owner_id, name) values ($1, $2, 'temporal') returning id`,
        [org, owner])).rows[0].id;
      await tx.query(`insert into public.project_events (org_id, project_id, kind) values ($1, $2, 'project.created')`, [org, id]);
      return id;
    });
    await admin.query('delete from public.projects where id = $1', [p]);
    const { rows } = await admin.query('select count(*)::int as n from public.project_events where project_id = $1', [p]);
    expect(rows[0].n).toBe(0);
  });
});

describe('progreso de proyecto', () => {
  it('cuenta pasos hechos sobre pasos disponibles y separa los no disponibles', async () => {
    await as(owner, org, async (tx) => {
      const ins = `insert into public.project_tasks (org_id, project_id, position, title, status, done_at, available_in)
                   values ($1, $2, $3, $4, $5, $6, $7)`;
      await tx.query(ins, [org, project, 0, 'Investigar', 'done', new Date(), 'V1']);
      await tx.query(ins, [org, project, 1, 'Crear', 'done', new Date(), 'V1']);
      await tx.query(ins, [org, project, 2, 'Publicar', 'pending', null, 'V1']);
      await tx.query(ins, [org, project, 3, 'Vender', 'unavailable', null, 'V2']);
    });
    const row = await as(owner, org, async (tx) =>
      (await tx.query('select * from public.project_progress where project_id = $1', [project])).rows[0]);
    expect(row).toMatchObject({ done_count: '2', available_count: '3', unavailable_count: '1', progress_pct: 67 });
  });

  it('un paso "done" exige fecha de finalización', async () => {
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `insert into public.project_tasks (org_id, project_id, position, title, status) values ($1, $2, 9, 'x', 'done')`,
      [org, project])))).toBe(PG.CHECK);
  });
});

describe('membresías', () => {
  it('la organización no puede quedarse sin propietario', async () => {
    // Retirarse siendo la única dueña: lo impide la regla del último propietario.
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `delete from public.memberships where org_id = $1 and user_id = $2`, [org, owner])))).toBe(PG.CHECK);
    // Ni siquiera administración puede degradar al último propietario.
    expect(await pgError(admin.query(
      `update public.memberships set role_code = 'ORG_MEMBER' where org_id = $1 and user_id = $2`, [org, owner])))
      .toBe(PG.CHECK);
  });

  it('un rol de plataforma no se puede usar como rol de organización', async () => {
    const u = await createUser('fede');
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `insert into public.memberships (org_id, user_id, role_code, status) values ($1, $2, 'SUPER_ADMIN', 'invited')`, [org, u]))))
      .toBe(PG.FK);
  });
});

describe('productos: publicación y precio mínimo', () => {
  async function productWithPrice(amountMinor: number, currency = 'USD'): Promise<{ id: string; version: string }> {
    return as(owner, org, async (tx) => {
      const id = (await tx.query(
        `insert into public.products (org_id, slug, title, product_type) values ($1, $2, 'Ebook', 'ebook') returning id`,
        [org, `p-${randomUUID().slice(0, 8)}`])).rows[0].id;
      const version = (await tx.query(
        `insert into public.product_versions (org_id, product_id, version) values ($1, $2, 1) returning id`,
        [org, id])).rows[0].id;
      await tx.query(`update public.products set current_version_id = $1 where id = $2`, [version, id]);
      await tx.query(`insert into public.product_prices (org_id, product_id, amount_minor, currency) values ($1, $2, $3, $4)`,
        [org, id, amountMinor, currency]);
      return { id, version };
    });
  }
  const publish = (id: string) =>
    admin.query(`update public.products set status = 'published', published_at = now() where id = $1`, [id]);

  it('la aplicación no puede publicar; solo enviar a revisión', async () => {
    const p = await productWithPrice(0);
    await as(owner, org, (tx) => tx.query(`update public.products set status = 'in_review' where id = $1`, [p.id]));
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `update public.products set status = 'published', published_at = now() where id = $1`, [p.id])))).toBe(PG.RLS);
  });

  it('un producto gratuito se publica tras revisión', async () => {
    const p = await productWithPrice(0);
    await publish(p.id);
    const { rows } = await admin.query('select status from public.products where id = $1', [p.id]);
    expect(rows[0].status).toBe('published');
  });

  it('un producto pago no se publica mientras los pagos estén deshabilitados', async () => {
    const p = await productWithPrice(900);
    expect(await pgError(publish(p.id))).toBe(PG.CHECK);
  });

  describe('con pagos habilitados', () => {
    beforeAll(() => admin.query(`update public.settings set value = 'true' where key = 'payments.enabled'`));
    afterAll(() => admin.query(`update public.settings set value = 'false' where key = 'payments.enabled'`));

    it('US$4.99 queda bloqueado por el mínimo de US$5', async () => {
      const p = await productWithPrice(499);
      expect(await pgError(publish(p.id))).toBe(PG.CHECK);
    });

    it('US$5 se permite', async () => {
      const p = await productWithPrice(500);
      await publish(p.id);
    });

    it('una moneda sin regla configurada se bloquea (no se asume conversión)', async () => {
      const p = await productWithPrice(50_000, 'COP');
      expect(await pgError(publish(p.id))).toBe(PG.CHECK);
    });

    it('una excepción administrativa permite publicar por debajo del mínimo', async () => {
      const p = await productWithPrice(100);
      await admin.query(
        `insert into public.price_rule_exceptions (org_id, product_id, reason, approved_by)
         values ($1, $2, 'Producto de lanzamiento aprobado por dirección', $3)`, [org, p.id, owner]);
      await publish(p.id);
    });
  });
});

describe('descargas, tokens y consentimientos', () => {
  let product: string, version: string, lead: string;

  beforeAll(async () => {
    product = (await admin.query(
      `insert into public.products (org_id, slug, title, product_type) values ($1, $2, 'Gratis', 'ebook') returning id`,
      [org, `d-${randomUUID().slice(0, 8)}`])).rows[0].id;
    version = (await admin.query(
      `insert into public.product_versions (org_id, product_id, version) values ($1, $2, 1) returning id`,
      [org, product])).rows[0].id;
    lead = (await admin.query(
      `insert into public.leads (org_id, email) values ($1, 'lector@example.com') returning id`, [org])).rows[0].id;
  });

  const insertDownload = (price: number, status: string, currency: string | null) =>
    admin.query(
      `insert into public.downloads (org_id, product_id, product_version_id, lead_id, email, price_minor, payment_status, currency, consent_status)
       values ($1, $2, $3, $4, 'lector@example.com', $5, $6, $7, 'download_only') returning id`,
      [org, product, version, lead, price, status, currency]);

  it('una descarga paga nunca queda sin estado de pago', async () => {
    expect(await pgError(insertDownload(500, 'not_required', 'USD'))).toBe(PG.CHECK);
    expect(await pgError(insertDownload(0, 'paid', null))).toBe(PG.CHECK);
  });

  it('el token solo guarda un hash de 32 bytes y no se reutiliza más allá del máximo', async () => {
    const dl = (await insertDownload(0, 'not_required', null)).rows[0].id;
    expect(await pgError(admin.query(
      `insert into public.download_tokens (org_id, download_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
      [org, dl, Buffer.from('corto')]))).toBe(PG.CHECK);
    const hash = createHash('sha256').update(randomBytes(32)).digest();
    const tok = (await admin.query(
      `insert into public.download_tokens (org_id, download_id, token_hash, expires_at, max_uses)
       values ($1, $2, $3, now() + interval '1 hour', 1) returning id`, [org, dl, hash])).rows[0].id;
    await admin.query('update public.download_tokens set uses = 1 where id = $1', [tok]);
    expect(await pgError(admin.query('update public.download_tokens set uses = 2 where id = $1', [tok]))).toBe(PG.CHECK);
  });

  it('otorgar consentimiento exige el texto legal aceptado; el historial es inmutable', async () => {
    expect(await pgError(admin.query(
      `insert into public.consents (org_id, lead_id, purpose, action) values ($1, $2, 'marketing', 'granted')`,
      [org, lead]))).toBe(PG.CHECK);
    const text = (await admin.query(
      `insert into public.consent_texts (purpose, version, body) values ('marketing', 't-${randomUUID().slice(0, 6)}', 'Acepto…') returning id`,
    )).rows[0].id;
    await admin.query(
      `insert into public.consents (org_id, lead_id, purpose, action, consent_text_id) values ($1, $2, 'marketing', 'granted', $3)`,
      [org, lead, text]);
    await admin.query(
      `insert into public.consents (org_id, lead_id, purpose, action) values ($1, $2, 'marketing', 'revoked')`, [org, lead]);
    const status = await as(owner, org, async (tx) =>
      (await tx.query(`select granted from public.lead_consent_status where lead_id = $1 and purpose = 'marketing'`, [lead])).rows);
    expect(status).toEqual([{ granted: false }]); // vale la última acción: revocado
    expect(await pgError(admin.query(`update public.consents set action = 'granted' where lead_id = $1`, [lead])))
      .toBe(PG.RESTRICT);
  });

  it('el mismo correo no se duplica como lead en una organización (sin distinguir mayúsculas)', async () => {
    expect(await pgError(admin.query(
      `insert into public.leads (org_id, email) values ($1, 'LECTOR@Example.com')`, [org]))).toBe(PG.UNIQUE);
  });

  it('un correo con formato inválido se rechaza', async () => {
    expect(await pgError(admin.query(
      `insert into public.leads (org_id, email) values ($1, 'no es un correo')`, [org]))).toBe(PG.CHECK);
  });
});

describe('créditos de IA', () => {
  it('la app solo puede descontar créditos por consumo registrado, no asignarse créditos', async () => {
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `insert into public.ai_credit_ledger (org_id, delta, reason) values ($1, 1000000, 'plan_grant')`, [org]))))
      .toBe(PG.RLS);
    await as(owner, org, async (tx) => {
      const usage = (await tx.query(
        `insert into public.ai_usage (org_id, user_id, provider_code, model_key, task, modality, request_id, credits, status)
         values ($1, $2, 'proveedor-prueba', 'modelo-prueba', 'clau.chat', 'text', 'req-1', 3, 'success') returning id`,
        [org, owner])).rows[0].id;
      await tx.query(
        `insert into public.ai_credit_ledger (org_id, delta, reason, ai_usage_id) values ($1, -3, 'usage', $2)`, [org, usage]);
    });
    const bal = await as(owner, org, async (tx) =>
      (await tx.query('select balance from public.ai_credit_balances where org_id = $1', [org])).rows[0]);
    expect(bal.balance).toBe('-3');
  });

  it('ningún precio de IA sin URL de documentación oficial', async () => {
    await admin.query(`insert into public.ai_providers (code, name) values ('prov-x', 'Proveedor X') on conflict do nothing`);
    const model = (await admin.query(
      `insert into public.ai_models (provider_code, model_key, capabilities) values ('prov-x', 'm-${randomUUID().slice(0, 6)}', '{text}') returning id`,
    )).rows[0].id;
    expect(await pgError(admin.query(
      `insert into public.ai_costs (model_id, unit, price_per_unit, effective_from, source_url, verified_at)
       values ($1, 'input_token', 0.000001, now(), null, now())`, [model]))).toBe('23502');
  });
});

describe('LOMBANA NEWS', () => {
  it('una fuente no se activa sin términos de uso aprobados', async () => {
    expect(await pgError(admin.query(
      `insert into public.news_sources (name, homepage_url, status) values ('Medio', 'https://medio.example', 'active')`,
    ))).toBe(PG.CHECK);
  });

  it('el autor no puede aprobar su propio aporte', async () => {
    const id = await as(owner, org, async (tx) => (await tx.query(
      `insert into public.news_contributions (org_id, author_id, title, body, status) values ($1, $2, 'Mi aporte', 'Texto', 'submitted') returning id`,
      [org, owner])).rows[0].id);
    expect(await pgError(as(owner, org, (tx) => tx.query(
      `update public.news_contributions set status = 'approved' where id = $1`, [id])))).toBe(PG.RLS);
  });

  it('los aportes aprobados son públicos sin datos del autor; la tabla solo muestra los propios', async () => {
    const other = await createUser('gil');
    const otherOrg = await createOrgAs(other, 'org-lector');
    const mod = await createUser('moderador');
    const approved = (await admin.query(
      `insert into public.news_contributions (org_id, author_id, title, body, status, moderated_by, moderated_at, published_at, moderation_note)
       values ($1, $2, 'Aprobado', 'Texto', 'approved', $3, now(), now(), 'nota interna') returning id`, [org, owner, mod])).rows[0].id;
    const fromTable = await as(other, otherOrg, async (tx) =>
      (await tx.query('select id from public.news_contributions')).rows);
    expect(fromTable).toEqual([]);
    const published = await as(other, otherOrg, async (tx) =>
      (await tx.query('select * from public.news_published_contributions')).rows);
    expect(published.map((r) => r.id)).toContain(approved);
    expect(Object.keys(published[0]!).sort()).toEqual(['body', 'id', 'published_at', 'reference_urls', 'title', 'topics']);
  });
});
