import pg from 'pg';

/**
 * Configuración de conexión a partir de una URL de Postgres.
 *
 * Hosting administrado (Supabase): la conexión va SIEMPRE cifrada.
 *   - Con DATABASE_CA_CERT (PEM del certificado raíz del proveedor) se verifica el
 *     certificado del servidor: es la configuración recomendada para producción.
 *   - Sin él, se cifra sin verificar la cadena. Protege contra lectura pasiva, no contra
 *     un intermediario activo. Deuda técnica registrada en docs/estado.md.
 * Si la URL ya trae `sslmode`, se respeta tal cual.
 */
export function pgClientConfig(connectionString: string): pg.ClientConfig {
  const url = new URL(connectionString);
  const managed = /\.supabase\.(co|com)$/i.test(url.hostname);
  if (!managed || url.searchParams.has('sslmode')) {
    return { connectionString };
  }
  const ca = process.env.DATABASE_CA_CERT?.trim();
  return {
    connectionString,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  };
}

// Entrada de ejecución (web y worker). El migrador vive en '@lombana/db/migrator'
// para que la aplicación nunca empaquete el acceso a archivos de migración.

/** Contexto de una petición autenticada. orgId = organización activa. */
export interface TenantContext {
  userId: string;
  orgId: string | null;
}

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

/**
 * Pool de conexiones. Compatible con poolers en modo transacción (Supabase :6543):
 * el contexto se fija con set_config(..., is_local = true), que vive solo dentro
 * de la transacción, y nunca se usan sentencias preparadas con nombre.
 */
export function createPool(connectionString: string, max = 10): Db {
  return new pg.Pool({ ...pgClientConfig(connectionString), max, application_name: 'lombana' });
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
