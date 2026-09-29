import 'server-only';

/**
 * Clasifica un error de conexión a la base en una categoría pública, sin mensajes,
 * hosts, usuarios ni claves: sirve para diagnosticar el despliegue sin exponer nada.
 */
export function classifyDbError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code ?? '';
  const msg = (e?.message ?? '').toLowerCase();
  if (code === '28P01' || msg.includes('password authentication failed')) return 'auth_failed';
  if (msg.includes('tenant or user not found')) return 'pooler_tenant_not_found';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_failed';
  if (code === 'ETIMEDOUT' || msg.includes('timeout')) return 'timeout';
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) return 'tls_failed';
  if (code === '42501') return 'permission_denied';
  if (code === '42P01') return 'schema_missing';
  return 'other';
}
