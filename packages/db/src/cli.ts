import { migrateDown, migrateUp, migrationStatus } from './migrator.js';

const admin = process.env.DATABASE_ADMIN_URL;
if (!admin) {
  console.error('Falta DATABASE_ADMIN_URL (ver .env.example)');
  process.exit(1);
}
const appPassword = process.env.LOMBANA_APP_DB_PASSWORD;
const log = (m: string) => console.log(m);
const [command = 'up', arg] = process.argv.slice(2);

try {
  switch (command) {
    case 'up': {
      const ran = await migrateUp({ connectionString: admin, appPassword, log });
      console.log(ran.length ? `${ran.length} migración(es) aplicada(s)` : 'Sin migraciones pendientes');
      break;
    }
    case 'down': {
      const steps = arg === 'all' ? Number.POSITIVE_INFINITY : Number(arg ?? 1);
      if (!Number.isFinite(steps) && arg !== 'all') throw new Error('Uso: down [n|all]');
      await migrateDown({ connectionString: admin, steps, log });
      break;
    }
    case 'reset': {
      if (process.env.APP_ENV === 'production') throw new Error('reset está prohibido en producción');
      await migrateDown({ connectionString: admin, steps: Number.POSITIVE_INFINITY, log });
      await migrateUp({ connectionString: admin, appPassword, log });
      break;
    }
    case 'status': {
      for (const m of await migrationStatus(admin)) console.log(`${m.applied ? '✓' : '·'} ${m.id}`);
      break;
    }
    default:
      throw new Error(`Comando desconocido: ${command}`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
