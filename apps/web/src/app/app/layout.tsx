import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/ui';
import { signOut } from '@/server/actions/auth';
import { switchOrg } from '@/server/actions/projects';
import { requireAccount } from '@/server/session';
import { NavLink } from './nav-link';
import styles from './shell.module.css';

export const metadata: Metadata = { title: { default: 'Inicio', template: '%s · LOMBANA AI' } };
export const dynamic = 'force-dynamic';

// Menú: solo módulos que existen. Los demás se agregan cuando pasan sus pruebas.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const initial = (account.displayName ?? account.email).trim().charAt(0).toUpperCase();

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/app" className={styles.brandLink}>
          <Brand />
        </Link>
        <nav className={styles.nav} aria-label="Principal">
          <NavLink href="/app" exact>
            <span aria-hidden>◎</span> Inicio
          </NavLink>
          <NavLink href="/app/proyectos">
            <span aria-hidden>▦</span> Proyectos
          </NavLink>
          <NavLink href="/app/productos">
            <span aria-hidden>◈</span> Productos
          </NavLink>
          <NavLink href="/app/herramientas">
            <span aria-hidden>✦</span> Herramientas
          </NavLink>
          <NavLink href="/app/cuenta">
            <span aria-hidden>◉</span> Mi Lombana
          </NavLink>
        </nav>
        <div className={styles.sideFoot}>
          <span className="badge badge-ai">CLAU AI · en desarrollo</span>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          {account.orgs.length > 1 ? (
            <form action={switchOrg} className="row">
              <label htmlFor="orgId" className="sr-only">
                Organización activa
              </label>
              <select id="orgId" name="orgId" defaultValue={account.org.id} className={`select select-sm ${styles.orgSelect}`}>
                {account.orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" type="submit">
                Cambiar
              </button>
            </form>
          ) : (
            <span className={styles.orgName}>{account.org.name}</span>
          )}
          <div className="row">
            <span className={styles.avatar} title={account.email} aria-hidden>
              {initial}
            </span>
            <span className={`dim ${styles.email}`}>{account.email}</span>
            <form action={signOut}>
              <button className="btn btn-ghost btn-sm" type="submit">
                Salir
              </button>
            </form>
          </div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
