import pg from 'pg';
import { migrateDown, migrateUp } from '../src/migrator.js';
import { adminUrl, APP_PASSWORD } from './env.js';

/** Huella del esquema: tablas, columnas, políticas, triggers y funciones. */
async function schemaFingerprint(url: string): Promise<string> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const q = async (sql: string) => (await c.query(sql)).rows.map((r) => Object.values(r).join('|')).join('\n');
    return [
      await q(`select table_name, column_name, data_type, is_nullable, coalesce(column_default,'')
                 from information_schema.columns where table_schema = 'public' order by 1, 2`),
      await q(`select tablename, policyname, cmd, coalesce(qual,''), coalesce(with_check,'')
                 from pg_policies where schemaname = 'public' order by 1, 2`),
      await q(`select event_object_table, trigger_name, event_manipulation
                 from information_schema.triggers where trigger_schema = 'public' order by 1, 2, 3`),
      await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'app' order by 1`),
    ].join('\n---\n');
  } finally {
    await c.end();
  }
}

/** Recrea la base de pruebas vacía. Se niega a tocar bases cuyo nombre no termine en _test. */
async function recreateDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!dbName.endsWith('_test')) {
    throw new Error(`Por seguridad solo se recrean bases *_test (recibido: ${dbName})`);
  }
  target.pathname = '/postgres';
  const c = new pg.Client({ connectionString: target.toString() });
  await c.connect();
  try {
    await c.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [dbName]);
    await c.query(`drop database if exists ${c.escapeIdentifier(dbName)}`);
    await c.query(`create database ${c.escapeIdentifier(dbName)}`);
  } finally {
    await c.end();
  }
}

// Antes de las pruebas, sobre una base vacía: reversibilidad completa.
// up → down(all) → up debe dejar exactamente el mismo esquema.
export default async function setup(): Promise<void> {
  const url = adminUrl();
  await recreateDatabase(url);
  await migrateUp({ connectionString: url, appPassword: APP_PASSWORD });
  const first = await schemaFingerprint(url);
  await migrateDown({ connectionString: url, steps: Number.POSITIVE_INFINITY });
  await migrateUp({ connectionString: url, appPassword: APP_PASSWORD });
  const second = await schemaFingerprint(url);
  if (first !== second) {
    throw new Error('Las migraciones no son reversibles: el esquema cambió tras down/up');
  }
}
