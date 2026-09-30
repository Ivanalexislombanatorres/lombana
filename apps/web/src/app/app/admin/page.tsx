import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMinor } from '@/lib/products/catalog';
import { geminiConfigured } from '@/server/ai/gemini';
import { inOrg, requireAccount } from '@/server/session';
import { MinPriceForm, RoleForm, UserStatusForm } from './admin-forms';

export const metadata: Metadata = { title: 'Administración' };

const SECTIONS = [
  { key: 'resumen', label: 'Resumen', perm: 'admin.users' },
  { key: 'usuarios', label: 'Usuarios', perm: 'admin.users' },
  { key: 'permisos', label: 'Roles y permisos', perm: 'admin.users' },
  { key: 'auditoria', label: 'Auditoría', perm: 'admin.audit' },
  { key: 'configuracion', label: 'Configuración', perm: 'admin.users' },
] as const;

const METRIC_LABEL: Record<string, string> = {
  users_active: 'Usuarios activos',
  users_suspended: 'Usuarios suspendidos',
  organizations: 'Espacios de trabajo',
  projects: 'Proyectos',
  products_draft: 'Productos en borrador',
  products_in_review: 'Productos en revisión',
  products_published: 'Productos publicados',
  contributions_pending: 'Aportes por moderar',
  contributions_published: 'Aportes publicados',
  ai_calls_24h: 'Consultas a IA (24 h)',
  ai_errors_24h: 'Errores de IA (24 h)',
};

const ROLE_LABEL: Record<string, string> = {
  ORG_OWNER: 'Propietario de espacio',
  ORG_ADMIN: 'Administrador de espacio',
  ORG_MEMBER: 'Miembro de espacio',
  ADMIN: 'Administrador de plataforma',
  SUPER_ADMIN: 'Superadministrador',
};

const fmt = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const account = await requireAccount();
  const perms = account.platformPermissions;
  const visible = SECTIONS.filter((s) => perms.includes(s.perm));
  if (visible.length === 0) notFound();
  const params = await searchParams;
  const section = visible.find((s) => s.key === params.seccion) ?? visible[0]!;
  const canSettings = perms.includes('admin.settings');
  const aiOn = await geminiConfigured();

  const data = await inOrg(async (tx) => {
    switch (section.key) {
      case 'resumen':
        return { metrics: (await tx.query<{ metric: string; value: string }>('select * from app.admin_overview()')).rows };
      case 'usuarios':
        return {
          users: (
            await tx.query<{
              id: string; email: string; display_name: string | null; status: string; created_at: Date;
              last_login_at: Date | null; roles: string[]; projects: string;
            }>('select * from app.admin_list_users($1, 100)', [params.q ?? null])
          ).rows,
        };
      case 'permisos':
        return {
          matrix: (
            await tx.query<{ role_code: string; scope: string; perms: string[] }>(
              `select r.code as role_code, r.scope,
                      coalesce(array_agg(rp.permission_code order by rp.permission_code)
                               filter (where rp.permission_code is not null), '{}') as perms
                 from public.roles r left join public.role_permissions rp on rp.role_code = r.code
                where r.code in ('ORG_OWNER','ORG_ADMIN','ORG_MEMBER','ADMIN','SUPER_ADMIN')
                group by r.code, r.scope order by r.scope, r.code`,
            )
          ).rows,
          descriptions: (await tx.query<{ code: string; description: string }>('select code, description from public.permissions order by code')).rows,
        };
      case 'auditoria':
        return {
          audit: (
            await tx.query<{
              created_at: Date; actor_email: string | null; actor_type: string; action: string;
              target_type: string | null; result: string; metadata: Record<string, unknown>;
            }>('select * from app.admin_audit(150)')
          ).rows,
        };
      case 'configuracion': {
        const min = await tx.query<{ min: string | null }>("select app.min_price_for('USD', null, null) as min");
        const settings = await tx.query<{ key: string; value: unknown; description: string }>(
          'select key, value, description from public.settings order by key',
        );
        return { min: min.rows[0]?.min ?? null, settings: settings.rows };
      }
    }
  });

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 1100 }}>
      <div>
        <p className="eyebrow">Gobierno de la plataforma</p>
        <h1 className="h2" style={{ fontSize: 28 }}>
          Administración
        </h1>
      </div>
      <nav className="row wrap" style={{ gap: 8 }} aria-label="Secciones de administración">
        {visible.map((s) => (
          <Link
            key={s.key}
            href={`/app/admin?seccion=${s.key}`}
            className={`btn btn-sm ${s.key === section.key ? 'btn-primary' : ''}`}
            aria-current={s.key === section.key ? 'page' : undefined}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {'metrics' in data && data.metrics && (
        <ul
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}
        >
          {data.metrics.map((m) => (
            <li key={m.metric} className="card pad stack" style={{ gap: 4 }}>
              <span className="dim" style={{ fontSize: 13 }}>
                {METRIC_LABEL[m.metric] ?? m.metric}
              </span>
              <span className="h2" data-testid={`metric-${m.metric}`}>
                {m.value}
              </span>
            </li>
          ))}
        </ul>
      )}

      {'users' in data && data.users && (
        <section className="stack" style={{ gap: 12 }}>
          <form className="row wrap" style={{ gap: 8 }} action="/app/admin">
            <input type="hidden" name="seccion" value="usuarios" />
            <label className="sr-only" htmlFor="q">
              Buscar usuario
            </label>
            <input id="q" name="q" className="input" placeholder="Buscar por correo o nombre" defaultValue={params.q ?? ''} style={{ maxWidth: 360 }} />
            <button className="btn btn-sm" type="submit">
              Buscar
            </button>
          </form>
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
            {data.users.map((u) => (
              <li key={u.id} className="card pad stack" style={{ gap: 8 }} data-testid="admin-user">
                <div className="row between wrap">
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{u.display_name ?? '—'}</strong>
                    <span className="dim" style={{ fontSize: 13 }}>
                      {u.email}
                    </span>
                  </div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className={`badge ${u.status === 'active' ? 'badge-ready' : ''}`}>
                      {u.status === 'active' ? 'Activa' : 'Suspendida'}
                    </span>
                    {u.roles.map((r) => (
                      <span key={r} className="badge badge-ai">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="dim" style={{ fontSize: 12.5 }}>
                  Alta {fmt.format(u.created_at)} · Último acceso {u.last_login_at ? fmt.format(u.last_login_at) : '—'} · {u.projects} proyectos
                </span>
                {u.id === account.userId ? (
                  <span className="dim" style={{ fontSize: 12.5 }}>
                    Es tu cuenta: no puedes suspenderla ni cambiar tus propios roles.
                  </span>
                ) : (
                  <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
                    <UserStatusForm userId={u.id} status={u.status} />
                    {canSettings && <RoleForm userId={u.id} roles={u.roles} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {data.users.length === 0 && <p className="muted">No hay usuarios que coincidan.</p>}
        </section>
      )}

      {'matrix' in data && data.matrix && (
        <section className="stack" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            Los roles de <strong>espacio</strong> aplican dentro de cada espacio de trabajo; los de <strong>plataforma</strong>{' '}
            gobiernan LOMBANA completa. Estos permisos los hace cumplir la base de datos.
          </p>
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
            {data.matrix.map((r) => (
              <li key={r.role_code} className="card pad stack" style={{ gap: 6 }}>
                <div className="row between wrap">
                  <strong>{ROLE_LABEL[r.role_code] ?? r.role_code}</strong>
                  <span className="badge">{r.scope === 'org' ? 'Espacio' : 'Plataforma'}</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                  {r.perms.map((p) => (
                    <li key={p}>
                      <code>{p}</code> — {data.descriptions.find((d) => d.code === p)?.description ?? ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {'audit' in data && data.audit && (
        <section className="panel pad" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr className="dim" style={{ textAlign: 'left' }}>
                <th style={{ padding: 6 }}>Fecha</th>
                <th style={{ padding: 6 }}>Quién</th>
                <th style={{ padding: 6 }}>Acción</th>
                <th style={{ padding: 6 }}>Recurso</th>
                <th style={{ padding: 6 }}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((a, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{fmt.format(a.created_at)}</td>
                  <td style={{ padding: 6 }}>
                    {a.actor_email ?? '—'} <span className="dim">({a.actor_type})</span>
                  </td>
                  <td style={{ padding: 6 }}>
                    <code>{a.action}</code>
                  </td>
                  <td style={{ padding: 6 }}>{a.target_type ?? '—'}</td>
                  <td style={{ padding: 6 }}>{a.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {'settings' in data && data.settings && (
        <section className="stack" style={{ gap: 16 }}>
          <div className="panel pad stack" style={{ gap: 10 }}>
            <h2 className="h3">Precio mínimo</h2>
            <p className="muted" style={{ margin: 0 }}>
              Vigente: {data.min === null ? 'sin configurar' : formatMinor(data.min)}. Aplica a productos de pago al publicar.
            </p>
            {canSettings ? (
              <MinPriceForm current={data.min === null ? '5.00' : (Number(data.min) / 100).toFixed(2)} />
            ) : (
              <p className="dim" style={{ margin: 0 }}>
                Cambiarlo requiere el rol SUPER_ADMIN.
              </p>
            )}
          </div>
          <div className="panel pad stack" style={{ gap: 10 }}>
            <h2 className="h3">Estado de integraciones</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                IA de CLAU (Google Gemini): <strong>{aiOn ? 'activa' : 'sin clave'}</strong>
                {!aiOn && ' — agrega GEMINI_API_KEY en Vercel o en Supabase Vault.'}
              </li>
              <li>
                Pagos: <strong>deshabilitados</strong> — requieren elegir y contratar una pasarela.
              </li>
              <li>
                Correo de descargas: <strong>sin proveedor</strong> — requiere elegir uno.
              </li>
            </ul>
          </div>
          <div className="panel pad stack" style={{ gap: 8 }}>
            <h2 className="h3">Parámetros de la plataforma</h2>
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8, fontSize: 13.5 }}>
              {data.settings.map((s) => (
                <li key={s.key}>
                  <code>{s.key}</code> = <code>{JSON.stringify(s.value)}</code>
                  <div className="dim">{s.description}</div>
                </li>
              ))}
            </ul>
            <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>
              Los parámetros de pagos y descargas se habilitan desde aquí cuando existan sus proveedores.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
