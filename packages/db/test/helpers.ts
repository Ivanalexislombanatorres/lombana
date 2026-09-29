import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPool, withTenant, type Tx } from '../src/index.js';
import { adminUrl, appUrl } from './env.js';

export const admin = new pg.Pool({ connectionString: adminUrl(), max: 4 });
export const app = createPool(appUrl(), 4);

export async function closePools(): Promise<void> {
  await Promise.all([admin.end(), app.end()]);
}

/** Crea un usuario directamente (el alta real vendrá del paso de Auth). */
export async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into public.users (id, email, display_name, auth_provider, auth_subject)
     values ($1::uuid, $2, $3, 'test', $4)`,
    [id, `${label}-${id.slice(0, 8)}@example.com`, label, id],
  );
  return id;
}

/** Crea una organización por la vía oficial: app.create_organization como ese usuario. */
export async function createOrgAs(userId: string, label: string): Promise<string> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  return withTenant(app, { userId, orgId: null }, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      'select app.create_organization($1, $2, $3) as id',
      [label, slug, 'team'],
    );
    return rows[0]!.id;
  });
}

export function as<T>(userId: string, orgId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(app, { userId, orgId }, fn);
}

/** Espera un error de Postgres; devuelve su código SQLSTATE. */
export async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
  throw new Error('Se esperaba un error de base de datos y la operación tuvo éxito');
}

export const PG = {
  RLS: '42501', // insufficient_privilege (también "new row violates row-level security policy")
  CHECK: '23514',
  FK: '23503',
  UNIQUE: '23505',
  RESTRICT: '23001',
} as const;
