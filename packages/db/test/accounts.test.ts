import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { admin, app, as, closePools, PG, pgError } from './helpers.js';

afterAll(closePools);

const ensure = (subject: string, email: string, name?: string) =>
  app.query('select * from app.ensure_account($1, $2, $3, $4)', ['supabase', subject, email, name ?? null])
    .then((r) => r.rows[0] as { user_id: string; personal_org_id: string; is_new: boolean });

describe('alta de cuentas', () => {
  it('el primer ingreso crea usuario, organización personal y membresía de propietario', async () => {
    const sub = randomUUID();
    const a = await ensure(sub, `nuevo-${sub.slice(0, 6)}@example.com`, 'Nueva Persona');
    expect(a.is_new).toBe(true);
    const org = await as(a.user_id, a.personal_org_id, async (tx) =>
      (await tx.query('select name, kind from public.organizations')).rows);
    expect(org).toEqual([{ name: 'Espacio de Nueva Persona', kind: 'personal' }]);
    const role = await admin.query('select role_code from public.memberships where user_id = $1', [a.user_id]);
    expect(role.rows).toEqual([{ role_code: 'ORG_OWNER' }]);
  });

  it('ingresos siguientes reutilizan la misma cuenta y organización', async () => {
    const sub = randomUUID();
    const first = await ensure(sub, `repite-${sub.slice(0, 6)}@example.com`);
    const second = await ensure(sub, `repite-${sub.slice(0, 6)}@example.com`);
    expect(second).toEqual({ ...first, is_new: false });
  });

  it('el correo se actualiza si el proveedor lo cambia', async () => {
    const sub = randomUUID();
    const a = await ensure(sub, `antes-${sub.slice(0, 6)}@example.com`);
    await ensure(sub, `despues-${sub.slice(0, 6)}@example.com`);
    const { rows } = await admin.query('select email from public.users where id = $1', [a.user_id]);
    expect(rows[0].email).toBe(`despues-${sub.slice(0, 6)}@example.com`);
  });

  it('no vincula automáticamente otra identidad con el mismo correo', async () => {
    const email = `dup-${randomUUID().slice(0, 6)}@example.com`;
    await ensure(randomUUID(), email);
    expect(await pgError(ensure(randomUUID(), email.toUpperCase()))).toBe(PG.UNIQUE);
  });

  it('una cuenta suspendida no puede entrar', async () => {
    const sub = randomUUID();
    const a = await ensure(sub, `susp-${sub.slice(0, 6)}@example.com`);
    await admin.query(`update public.users set status = 'suspended' where id = $1`, [a.user_id]);
    expect(await pgError(ensure(sub, `susp-${sub.slice(0, 6)}@example.com`))).toBe(PG.RLS);
  });

  it('una cuenta dada de baja (baja lógica) no se reactiva al iniciar sesión', async () => {
    for (const status of ['active', 'deleted']) {
      const sub = randomUUID();
      const email = `baja-${sub.slice(0, 6)}@example.com`;
      const a = await ensure(sub, email);
      await admin.query(`update public.users set status = $2, deleted_at = now() where id = $1`, [a.user_id, status]);
      expect(await pgError(ensure(sub, email))).toBe(PG.RLS);
      const r = await app.query('select app.resolve_account($1, $2) as id', ['supabase', sub]);
      expect(r.rows[0].id).toBeNull();
      const { rows } = await admin.query('select status, deleted_at is not null as deleted from public.users where id = $1', [
        a.user_id,
      ]);
      expect(rows[0]).toEqual({ status, deleted: true });
    }
  });

  it('ingresos simultáneos de la misma identidad crean una sola cuenta y un solo espacio', async () => {
    const sub = randomUUID();
    const email = `par-${sub.slice(0, 6)}@example.com`;
    // A abre su transacción y crea la cuenta sin confirmar; B entra mientras tanto.
    const a = await app.connect();
    const b = await app.connect();
    const q = 'select * from app.ensure_account($1, $2, $3, $4)';
    const args = ['supabase', sub, email, null];
    let results;
    try {
      await a.query('begin');
      const first = (await a.query(q, args)).rows[0];
      const pending = b.query(q, args);
      await new Promise((r) => setTimeout(r, 150));
      await a.query('commit');
      const second = (await pending).rows[0];
      results = [first, second] as { user_id: string; personal_org_id: string; is_new: boolean }[];
    } finally {
      a.release();
      b.release();
    }
    expect(new Set(results.map((r) => r.user_id)).size).toBe(1);
    expect(new Set(results.map((r) => r.personal_org_id)).size).toBe(1);
    expect(results.filter((r) => r.is_new)).toHaveLength(1);
    const { rows } = await admin.query(
      `select count(*)::int as n from public.memberships where user_id = $1`, [results[0]!.user_id]);
    expect(rows[0].n).toBe(1);
  });

  it('rechaza identidades incompletas o correos inválidos', async () => {
    expect(await pgError(ensure('', 'x@example.com'))).toBe('22023');
    expect(await pgError(ensure(randomUUID(), 'no-es-correo'))).toBe('22023');
  });

  it('deja auditoría de creación y de ingreso', async () => {
    const sub = randomUUID();
    const a = await ensure(sub, `aud-${sub.slice(0, 6)}@example.com`);
    await ensure(sub, `aud-${sub.slice(0, 6)}@example.com`);
    const { rows } = await admin.query(
      `select action from public.audit_logs where actor_user_id = $1 and action like 'account.%' order by created_at`,
      [a.user_id]);
    expect(rows.map((r) => r.action)).toEqual(['account.create', 'account.login']);
  });
});
