import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgClientConfig } from './index.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const NAME_RE = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

export interface Migration {
  id: string;
  up: string;
  down: string;
  checksum: string;
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const byId = new Map<string, Partial<Migration>>();
  for (const file of files) {
    const match = NAME_RE.exec(file);
    if (!match) throw new Error(`Nombre de migración inválido: ${file}`);
    const id = `${match[1]}_${match[2]}`;
    const sql = await readFile(join(dir, file), 'utf8');
    const entry = byId.get(id) ?? { id };
    if (match[3] === 'up') entry.up = sql;
    else entry.down = sql;
    byId.set(id, entry);
  }
  const migrations: Migration[] = [];
  for (const entry of byId.values()) {
    if (!entry.up || !entry.down) {
      throw new Error(`La migración ${entry.id} necesita archivo up y down`);
    }
    migrations.push({
      id: entry.id!,
      up: entry.up,
      down: entry.down,
      checksum: createHash('sha256').update(entry.up).digest('hex'),
    });
  }
  return migrations.sort((a, b) => a.id.localeCompare(b.id));
}

async function ensureTable(client: pg.PoolClient | pg.Client): Promise<void> {
  await client.query(`
    create table if not exists public.schema_migrations (
      id         text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`);
}

async function applied(client: pg.PoolClient | pg.Client): Promise<Map<string, string>> {
  await ensureTable(client);
  const { rows } = await client.query<{ id: string; checksum: string }>(
    'select id, checksum from public.schema_migrations order by id',
  );
  return new Map(rows.map((r) => [r.id, r.checksum]));
}

export interface MigrateOptions {
  connectionString: string;
  appPassword?: string | undefined;
  log?: (msg: string) => void;
}

/** Aplica todas las migraciones pendientes, cada una en su propia transacción. */
export async function migrateUp(opts: MigrateOptions): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const client = new pg.Client(pgClientConfig(opts.connectionString));
  await client.connect();
  try {
    // Evita dos migraciones simultáneas (p. ej. dos despliegues a la vez).
    await client.query('select pg_advisory_lock(7710001)');
    const done = await applied(client);
    const all = await loadMigrations();
    for (const [id, checksum] of done) {
      const m = all.find((x) => x.id === id);
      if (!m) throw new Error(`Migración aplicada ${id} no existe en el repositorio`);
      if (m.checksum !== checksum) {
        throw new Error(`La migración ${id} fue modificada después de aplicarse. Crea una nueva en su lugar.`);
      }
    }
    const ran: string[] = [];
    for (const m of all) {
      if (done.has(m.id)) continue;
      await client.query('begin');
      try {
        await client.query(m.up);
        await client.query('insert into public.schema_migrations (id, checksum) values ($1, $2)', [m.id, m.checksum]);
        await client.query('commit');
        ran.push(m.id);
        log(`↑ ${m.id}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Falló la migración ${m.id}: ${(err as Error).message}`);
      }
    }
    if (opts.appPassword) {
      await client.query(`alter role lombana_app with login password ${client.escapeLiteral(opts.appPassword)}`);
    }
    return ran;
  } finally {
    await client.query('select pg_advisory_unlock(7710001)').catch(() => {});
    await client.end();
  }
}

/** Revierte las últimas `steps` migraciones (todas si steps = Infinity). */
export async function migrateDown(opts: MigrateOptions & { steps: number }): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const client = new pg.Client(pgClientConfig(opts.connectionString));
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(7710001)');
    const done = await applied(client);
    const all = await loadMigrations();
    const toRevert = all.filter((m) => done.has(m.id)).reverse().slice(0, opts.steps);
    const reverted: string[] = [];
    for (const m of toRevert) {
      await client.query('begin');
      try {
        await client.query(m.down);
        await client.query('delete from public.schema_migrations where id = $1', [m.id]);
        await client.query('commit');
        reverted.push(m.id);
        log(`↓ ${m.id}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Falló el rollback de ${m.id}: ${(err as Error).message}`);
      }
    }
    return reverted;
  } finally {
    await client.query('select pg_advisory_unlock(7710001)').catch(() => {});
    await client.end();
  }
}

export async function migrationStatus(connectionString: string): Promise<{ id: string; applied: boolean }[]> {
  const client = new pg.Client(pgClientConfig(connectionString));
  await client.connect();
  try {
    const done = await applied(client);
    return (await loadMigrations()).map((m) => ({ id: m.id, applied: done.has(m.id) }));
  } finally {
    await client.end();
  }
}
