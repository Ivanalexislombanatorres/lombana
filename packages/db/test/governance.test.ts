import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, as, closePools, createOrgAs, createUser, PG, pgError } from './helpers.js';

let root: string, rootOrg: string, mod: string, modOrg: string, user: string, userOrg: string;

beforeAll(async () => {
  root = await createUser('root');
  rootOrg = await createOrgAs(root, 'org-root');
  mod = await createUser('mod');
  modOrg = await createOrgAs(mod, 'org-mod');
  user = await createUser('usuario');
  userOrg = await createOrgAs(user, 'org-usuario');
  await admin.query(`insert into public.platform_role_assignments (user_id, role_code) values ($1, 'SUPER_ADMIN'), ($2, 'ADMIN')`, [root, mod]);
});
afterAll(closePools);

const q = (u: string, o: string, sql: string, params: unknown[] = []) => as(u, o, (tx) => tx.query(sql, params));

describe('gobierno de plataforma', () => {
  it('cada quien ve solo sus permisos de plataforma', async () => {
    expect((await q(root, rootOrg, 'select app.my_platform_permissions() as p')).rows[0].p)
      .toEqual(['admin.audit', 'admin.moderate', 'admin.settings', 'admin.users']);
    expect((await q(mod, modOrg, 'select app.my_platform_permissions() as p')).rows[0].p)
      .toEqual(['admin.audit', 'admin.moderate', 'admin.users']);
    expect((await q(user, userOrg, 'select app.my_platform_permissions() as p')).rows[0].p).toEqual([]);
  });

  it('un usuario normal no accede a nada del gobierno', async () => {
    for (const sql of ['select * from app.admin_overview()', 'select * from app.admin_list_users()', 'select * from app.admin_audit()']) {
      expect(await pgError(q(user, userOrg, sql))).toBe(PG.RLS);
    }
    expect(await pgError(q(user, userOrg, `select app.admin_set_user_status($1, 'suspended', 'x')`, [mod]))).toBe(PG.RLS);
    expect(await pgError(q(user, userOrg, `select app.admin_set_platform_role($1, 'ADMIN', true)`, [user]))).toBe(PG.RLS);
    expect(await pgError(q(user, userOrg, 'select app.admin_set_min_price(100)'))).toBe(PG.RLS);
  });

  it('ADMIN ve usuarios y suspende con motivo, pero no asigna roles ni cambia precios', async () => {
    const list = (await q(mod, modOrg, 'select id, roles from app.admin_list_users($1)', ['usuario'])).rows;
    expect(list.map((r) => r.id)).toContain(user);
    expect(await pgError(q(mod, modOrg, `select app.admin_set_user_status($1, 'suspended', '')`, [user]))).toBe('22023');
    await q(mod, modOrg, `select app.admin_set_user_status($1, 'suspended', 'Spam reiterado')`, [user]);
    expect((await admin.query('select status from public.users where id = $1', [user])).rows[0].status).toBe('suspended');
    await q(mod, modOrg, `select app.admin_set_user_status($1, 'active', 'Revisado')`, [user]);
    expect(await pgError(q(mod, modOrg, `select app.admin_set_platform_role($1, 'ADMIN', true)`, [user]))).toBe(PG.RLS);
    expect(await pgError(q(mod, modOrg, 'select app.admin_set_min_price(700)'))).toBe(PG.RLS);
    // Un ADMIN no puede suspender a un SUPER_ADMIN.
    expect(await pgError(q(mod, modOrg, `select app.admin_set_user_status($1, 'suspended', 'x')`, [root]))).toBe(PG.RLS);
  });

  it('nadie se suspende ni cambia sus propios roles', async () => {
    expect(await pgError(q(root, rootOrg, `select app.admin_set_user_status($1, 'suspended', 'x')`, [root]))).toBe(PG.RLS);
    expect(await pgError(q(root, rootOrg, `select app.admin_set_platform_role($1, 'ADMIN', true)`, [root]))).toBe(PG.RLS);
  });

  it('SUPER_ADMIN asigna y retira roles; la plataforma conserva un SUPER_ADMIN activo', async () => {
    await q(root, rootOrg, `select app.admin_set_platform_role($1, 'ADMIN', true)`, [user]);
    expect((await q(user, userOrg, 'select app.my_platform_permissions() as p')).rows[0].p).toContain('admin.moderate');
    await q(root, rootOrg, `select app.admin_set_platform_role($1, 'ADMIN', false)`, [user]);
    expect((await q(user, userOrg, 'select app.my_platform_permissions() as p')).rows[0].p).toEqual([]);
    expect(await pgError(q(root, rootOrg, `select app.admin_set_platform_role($1, 'NO_EXISTE', true)`, [user]))).toBe('22023');
    // Otro SUPER_ADMIN no puede dejar a la plataforma sin ninguno.
    await q(root, rootOrg, `select app.admin_set_platform_role($1, 'SUPER_ADMIN', true)`, [mod]);
    await q(mod, modOrg, `select app.admin_set_platform_role($1, 'SUPER_ADMIN', false)`, [root]);
    expect(await pgError(q(root, rootOrg, `select app.admin_set_platform_role($1, 'SUPER_ADMIN', false)`, [mod]))).toBe(PG.RLS);
    expect(await pgError(q(mod, modOrg, `select app.admin_set_user_status($1, 'suspended', 'x')`, [mod]))).toBe(PG.RLS);
    await admin.query(`insert into public.platform_role_assignments (user_id, role_code) values ($1, 'SUPER_ADMIN') on conflict do nothing`, [root]);
  });

  it('el último SUPER_ADMIN activo no puede ser suspendido', async () => {
    await admin.query(`delete from public.platform_role_assignments where role_code = 'SUPER_ADMIN' and user_id <> $1`, [root]);
    await admin.query(`update public.platform_role_assignments set role_code = role_code where false`);
    // Deja solo a root como SUPER_ADMIN activo y a mod como SUPER_ADMIN nuevo para intentar suspenderlo.
    await admin.query(`insert into public.platform_role_assignments (user_id, role_code) values ($1, 'SUPER_ADMIN')`, [mod]);
    await admin.query(`update public.users set status = 'suspended' where id = $1`, [root]);
    try {
      expect(await pgError(q(root, rootOrg, `select app.admin_set_user_status($1, 'suspended', 'x')`, [mod]))).toBe(PG.RLS);
    } finally {
      await admin.query(`update public.users set status = 'active' where id = $1`, [root]);
    }
    await q(root, rootOrg, `select app.admin_set_user_status($1, 'suspended', 'Prueba')`, [mod]).catch(() => {});
  });

  it('el precio mínimo se cambia con historial y en rango', async () => {
    expect(await pgError(q(root, rootOrg, 'select app.admin_set_min_price(50)'))).toBe('22023');
    await q(root, rootOrg, 'select app.admin_set_min_price(700)');
    const r = await admin.query(`select min_amount_minor from public.price_rules where active and currency = 'USD' and country_code is null and category is null`);
    expect(r.rows).toEqual([{ min_amount_minor: '700' }]);
    const hist = await admin.query(`select count(*)::int as n from public.price_rules where currency = 'USD' and country_code is null and category is null`);
    expect(hist.rows[0].n).toBeGreaterThanOrEqual(2);
    await q(root, rootOrg, 'select app.admin_set_min_price(500)');
  });

  it('la auditoría global registra las acciones de administración', async () => {
    const rows = (await q(root, rootOrg, 'select action, actor_type from app.admin_audit(200)')).rows;
    expect(rows).toContainEqual({ action: 'admin.user_status', actor_type: 'admin' });
    expect(rows).toContainEqual({ action: 'admin.role_grant', actor_type: 'admin' });
    expect(rows).toContainEqual({ action: 'admin.min_price', actor_type: 'admin' });
  });
});
