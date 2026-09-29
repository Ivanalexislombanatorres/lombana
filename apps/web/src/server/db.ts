import 'server-only';
import { createPool, type Db } from '@lombana/db';
import { serverEnv } from './env';

// Un solo pool por proceso. En desarrollo, Next recarga módulos: se guarda en globalThis.
// En serverless (Vercel) cada instancia abre pocas conexiones; el pooler de Supabase
// en modo transacción (puerto 6543) reparte las conexiones reales.
const globalForDb = globalThis as unknown as { lombanaDb?: Db };

export function db(): Db {
  if (!globalForDb.lombanaDb) {
    globalForDb.lombanaDb = createPool(serverEnv().DATABASE_URL, 3);
  }
  return globalForDb.lombanaDb;
}
