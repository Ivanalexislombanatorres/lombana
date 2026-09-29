import { afterAll, describe, expect, it } from 'vitest';
import { admin, closePools } from './helpers.js';

// Tablas de catálogo de plataforma: sin org_id; la aplicación solo puede leerlas.
const PLATFORM_READ_ONLY = new Set([
  'roles', 'permissions', 'role_permissions', 'plans', 'ai_providers', 'ai_models', 'ai_costs',
  'tools', 'settings', 'price_rules', 'consent_texts', 'news_sources', 'schema_migrations',
]);
// Secretos: RLS activado, cero políticas y cero privilegios para la app.
const NO_APP_ACCESS = ['download_tokens', 'integration_secrets'];
// Proyecciones públicas deliberadas (vistas sin security_invoker que exponen columnas cerradas).
const PUBLIC_PROJECTIONS = new Set(['news_published_contributions']);

afterAll(closePools);

describe('guardas del esquema (atrapan tablas nuevas mal configuradas)', () => {
  it('el rol de la aplicación no puede saltarse RLS ni es dueño de tablas', async () => {
    const { rows } = await admin.query(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'lombana_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    const owned = await admin.query(
      `select count(*)::int as n from pg_tables where tableowner = 'lombana_app'`,
    );
    expect(owned.rows[0].n).toBe(0);
  });

  it('toda tabla con org_id tiene RLS activado, forzado y al menos una política', async () => {
    const { rows } = await admin.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
             (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and exists (select 1 from information_schema.columns col
                      where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'org_id')`);
    expect(rows.length).toBeGreaterThan(25);
    const bad = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity || (r.policies === 0 && !NO_APP_ACCESS.includes(r.relname)));
    expect(bad.map((r) => r.relname)).toEqual([]);
  });

  it('toda tabla sin RLS es un catálogo de plataforma donde la app solo lee', async () => {
    const { rows } = await admin.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    const unexpected = rows.map((r) => r.relname).filter((t: string) => !PLATFORM_READ_ONLY.has(t));
    expect(unexpected).toEqual([]);

    const writes = await admin.query(`
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'lombana_app' and table_schema = 'public'
         and table_name = any($1) and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`,
      [[...PLATFORM_READ_ONLY]]);
    expect(writes.rows).toEqual([]);
  });

  it('las vistas respetan RLS de quien consulta (security_invoker), salvo proyecciones públicas declaradas', async () => {
    const { rows } = await admin.query(`
      select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      if (PUBLIC_PROJECTIONS.has(r.relname)) continue;
      expect(r.reloptions ?? [], r.relname).toContain('security_invoker=true');
    }
  });

  it('ninguna función de app es ejecutable por PUBLIC', async () => {
    const { rows } = await admin.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and has_function_privilege('public', p.oid, 'EXECUTE')`);
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it('las funciones SECURITY DEFINER fijan search_path', async () => {
    const { rows } = await admin.query(`
      select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.prosecdef`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect((r.proconfig ?? []).some((c: string) => c.startsWith('search_path='))).toBe(true);
    }
  });

  it('la app no tiene ningún acceso a tablas de secretos (tokens de descarga, OAuth)', async () => {
    const { rows } = await admin.query(`
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'lombana_app' and table_name = any($1)`, [NO_APP_ACCESS]);
    expect(rows).toEqual([]);
    const cols = await admin.query(`
      select table_name from information_schema.column_privileges
       where grantee = 'lombana_app' and table_name = any($1)`, [NO_APP_ACCESS]);
    expect(cols.rows).toEqual([]);
  });
});
