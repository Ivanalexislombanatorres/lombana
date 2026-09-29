import type { Metadata } from 'next';
import { signOut } from '@/server/actions/auth';
import { requireAccount } from '@/server/session';

export const metadata: Metadata = { title: 'Mi Lombana' };

const ROLE: Record<string, string> = { ORG_OWNER: 'Propietario', ORG_ADMIN: 'Administrador', ORG_MEMBER: 'Miembro' };
const KIND: Record<string, string> = { personal: 'Personal', team: 'Equipo', business: 'Empresa' };

export default async function AccountPage() {
  const account = await requireAccount();

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 820 }}>
      <div>
        <p className="eyebrow">Mi Lombana</p>
        <h1 className="h2" style={{ fontSize: 28 }}>
          Tu cuenta
        </h1>
      </div>

      <section className="panel pad stack">
        <h2 className="h3">Perfil</h2>
        <dl style={{ margin: 0, display: 'grid', gap: 10 }}>
          <div className="row between">
            <dt className="dim">Nombre</dt>
            <dd style={{ margin: 0 }}>{account.displayName ?? '—'}</dd>
          </div>
          <div className="row between">
            <dt className="dim">Correo</dt>
            <dd style={{ margin: 0 }}>{account.email}</dd>
          </div>
        </dl>
      </section>

      <section className="panel pad stack">
        <h2 className="h3">Organizaciones</h2>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {account.orgs.map((o) => (
            <li key={o.id} className="card pad row between wrap">
              <span>
                {o.name} {o.id === account.org.id && <span className="badge badge-ready">Activa</span>}
              </span>
              <span className="dim">
                {KIND[o.kind] ?? o.kind} · {ROLE[o.role] ?? o.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel pad stack">
        <h2 className="h3">Próximamente en Mi Lombana</h2>
        <p className="muted" style={{ margin: 0 }}>
          Créditos de IA, productos, descargas, leads, integraciones y facturación aparecerán aquí a medida que cada
          módulo se active.
        </p>
      </section>

      <form action={signOut}>
        <button className="btn" type="submit">
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
