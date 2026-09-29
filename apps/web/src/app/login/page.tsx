import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/ui';
import { authConfig, safeNext } from '@/lib/auth/config';
import { getAccount } from '@/server/session';
import { AuthForm } from './auth-form';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Entrar' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const configured = authConfig() !== null;
  if (configured && (await getAccount().catch(() => null))) redirect(next);

  const mode = params.modo === 'registro' ? 'signup' : 'signin';

  return (
    <main className={styles.page}>
      <div className={styles.side}>
        <Link href="/">
          <Brand size="lg" />
        </Link>
        <div className="stack">
          <h1 className="h1" style={{ fontSize: 'clamp(28px, 3.4vw, 40px)' }}>
            Convertir ideas en resultados reales.
          </h1>
          <p className="muted">
            Tu espacio para pasar de un objetivo a un proyecto con pasos claros, medir el avance y, muy pronto,
            trabajar con CLAU AI.
          </p>
        </div>
        <p className="dim" style={{ fontSize: 13 }}>
          Tus datos quedan aislados en tu propio espacio. Nadie más puede verlos.
        </p>
      </div>

      <div className={styles.formWrap}>
        <div className={`panel pad-lg ${styles.card}`}>
          <div className={styles.tabs} role="tablist">
            <Link
              role="tab"
              aria-selected={mode === 'signin'}
              className={styles.tab}
              href={`/login?next=${encodeURIComponent(next)}`}
            >
              Entrar
            </Link>
            <Link
              role="tab"
              aria-selected={mode === 'signup'}
              className={styles.tab}
              href={`/login?modo=registro&next=${encodeURIComponent(next)}`}
            >
              Crear cuenta
            </Link>
          </div>

          {params.error === 'cuenta' && (
            <p className="notice notice-error">
              Esta cuenta no está activa. Escribe a soporte si crees que es un error.
            </p>
          )}

          {params.error === 'enlace' && (
            <p className="notice notice-error">El enlace no es válido o ya expiró. Inicia sesión o solicita uno nuevo.</p>
          )}

          {configured ? (
            <AuthForm mode={mode} next={next} />
          ) : (
            <p className="notice notice-warn">
              El inicio de sesión aún no está conectado en este entorno. Estará disponible en cuanto se configure el
              proveedor de identidad.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
