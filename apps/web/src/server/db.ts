import 'server-only';
import { createPool, type Db } from '@lombana/db';
import { serverEnv } from './env';

// Un solo pool por proceso. En desarrollo, Next recarga módulos: se guarda en globalThis.
const globalForDb = globalThis as unknown as { lombanaDb?: Db };

export function db(): Db {
  if (!globalForDb.lombanaDb) {
    globalForDb.lombanaDb = createPool(serverEnv().DATABASE_URL);
  }
  return globalForDb.lombanaDb;
}
