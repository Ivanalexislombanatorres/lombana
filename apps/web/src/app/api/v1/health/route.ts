import { withAnonymous } from '@lombana/db';
import { db } from '@/server/db';
import { serverEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

// GET /api/v1/health — estado real del servicio. No expone datos sensibles ni detalles de error.
export async function GET() {
  const started = Date.now();
  try {
    serverEnv();
  } catch (err) {
    console.error('[health] configuración inválida:', (err as Error).message);
    return Response.json({ status: 'misconfigured', latencyMs: Date.now() - started }, { status: 503 });
  }
  try {
    const result = await withAnonymous(db(), async (tx) => {
      const tools = await tx.query<{ n: number }>('select count(*)::int as n from public.tools');
      return { toolsInCatalog: tools.rows[0]?.n ?? 0 };
    });
    return Response.json({
      status: 'ok',
      database: 'reachable',
      toolsInCatalog: result.toolsInCatalog,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[health] base de datos no disponible:', (err as Error).message);
    return Response.json(
      { status: 'degraded', database: 'unreachable', latencyMs: Date.now() - started },
      { status: 503 },
    );
  }
}
