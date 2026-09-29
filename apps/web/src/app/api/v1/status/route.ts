import { withAnonymous } from '@lombana/db';
import { authConfig, siteUrl } from '@/lib/auth/config';
import { db } from '@/server/db';
import { classifyDbError } from '@/server/diagnostics';
import { serverEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

// GET /api/v1/status — diagnóstico del despliegue. Siempre responde 200 (a diferencia de
// /health, que usa el código HTTP para los monitores). Solo informa QUÉ está configurado
// y una categoría de error; nunca valores, hosts, usuarios ni mensajes internos.
export async function GET() {
  const config = {
    database: false,
    auth: authConfig() !== null,
    siteUrl: siteUrl() !== null,
  };
  let envIssues: string[] = [];
  try {
    serverEnv();
    config.database = true;
  } catch (err) {
    // Solo los NOMBRES de las variables con problema (p. ej. "DATABASE_URL").
    envIssues = [...new Set(((err as Error).message.match(/[A-Z_]{3,}(?=:)/g) ?? []))];
  }

  let database: string = 'not_configured';
  if (config.database) {
    try {
      await withAnonymous(db(), (tx) => tx.query('select 1 from public.tools limit 1'));
      database = 'reachable';
    } catch (err) {
      database = classifyDbError(err);
      console.error('[status] base de datos:', database);
    }
  }

  return Response.json(
    {
      config,
      envIssues,
      database,
      // Versión desplegada (commit), para saber si una revisión ve el último despliegue.
      deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
