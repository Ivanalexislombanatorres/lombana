import pg from 'pg';

// Entrada de ejecución (web y worker). El migrador vive en '@lombana/db/migrator'
// para que la aplicación nunca empaquete el acceso a archivos de migración.

/** Contexto de una petición autenticada. orgId = organización activa. */
export interface TenantContext {
  userId: string;
  orgId: string | null;
}

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, max = 10): Db {
  return new pg.Pool({ connectionString, max, application_name: 'lombana' });
}

/**
 * Ejecuta `fn` dentro de una transacción con el contexto de usuario y organización fijado.
 * Es la ÚNICA forma prevista de acceder a datos de negocio: las políticas RLS leen este
 * contexto, y sin él la base devuelve cero filas.
 */
export async function withTenant<T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('select app.set_context($1::uuid, $2::uuid)', [ctx.userId, ctx.orgId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Transacción sin usuario (endpoints públicos). Solo ve datos públicos. */
export async function withAnonymous<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('select app.set_context(null, null)');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
