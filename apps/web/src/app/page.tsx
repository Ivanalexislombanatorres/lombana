import Link from 'next/link';
import { Brand, INTENTS } from '@/components/ui';
import styles from './landing.module.css';

// Estado real de V1. Se actualiza a medida que cada módulo pasa sus pruebas.
const ROADMAP: { name: string; status: 'ready' | 'dev' | 'planned'; note: string }[] = [
  { name: 'Cuentas y organizaciones', status: 'ready', note: 'Registro, inicio de sesión y espacio personal' },
  { name: 'Mis Proyectos', status: 'ready', note: 'Objetivo, pasos, estado y progreso real' },
  { name: 'CLAU AI', status: 'dev', note: 'Interpreta tu objetivo y propone el plan' },
  { name: 'Herramientas', status: 'dev', note: 'Ebooks, plantillas Excel, análisis de documentos' },
  { name: 'Product Lab', status: 'planned', note: 'De la idea al producto publicado' },
  { name: 'Descargas y leads', status: 'planned', note: 'Productos gratuitos con captura de correo' },
];

const LABEL = { ready: 'Disponible', dev: 'En desarrollo', planned: 'Planeado' } as const;
const BADGE = { ready: 'badge-ready', dev: 'badge-dev', planned: 'badge-planned' } as const;

export default function Landing() {
  return (
    <div className={styles.page}>
      <header className={`container row between ${styles.nav}`}>
        <Brand />
        <nav className="row">
          <Link href="/login" className="btn btn-ghost btn-sm">
            Entrar
          </Link>
          <Link href="/login?modo=registro" className="btn btn-primary btn-sm">
            Crear cuenta
          </Link>
        </nav>
      </header>

      <main>
        <section className={`container ${styles.hero}`}>
          <p className="eyebrow">Ecosistema digital · Crea · Vende · Automatiza · Crece</p>
          <h1 className={`h1 ${styles.title}`}>¿Qué necesitas lograr hoy?</h1>
          <p className={`muted ${styles.lead}`}>
            Describe tu problema, idea u objetivo. LOMBANA lo convierte en un proyecto con pasos claros y te
            acompaña hasta el resultado.
          </p>

          <form action="/app" method="get" className={`panel ${styles.ask}`}>
            <label htmlFor="objetivo" className="sr-only">
              Describe tu objetivo
            </label>
            <textarea
              id="objetivo"
              name="objetivo"
              className={styles.askInput}
              placeholder="Describe tu problema, idea u objetivo…"
              rows={2}
              maxLength={2000}
              required
            />
            <div className={`row between wrap ${styles.askBar}`}>
              <div className="chips">
                {INTENTS.map((i) => (
                  <Link key={i.key} className="chip" href={`/app?intencion=${i.key}&objetivo=${encodeURIComponent(i.example)}`}>
                    {i.label}
                  </Link>
                ))}
              </div>
              <button className="btn btn-primary" type="submit">
                Empezar
              </button>
            </div>
          </form>
          <p className={`dim ${styles.fine}`}>Necesitas una cuenta gratuita para guardar tus proyectos.</p>
        </section>

        <section className={`container ${styles.status}`} aria-labelledby="estado">
          <div className="row between wrap">
            <h2 id="estado" className="h2">
              Estado de la plataforma
            </h2>
            <span className="dim">V1 en construcción · solo mostramos lo que funciona de verdad</span>
          </div>
          <ul className={styles.grid}>
            {ROADMAP.map((m) => (
              <li key={m.name} className="card pad">
                <div className="row between">
                  <span className="h3">{m.name}</span>
                  <span className={`badge ${BADGE[m.status]}`}>{LABEL[m.status]}</span>
                </div>
                <p className="muted" style={{ margin: '8px 0 0' }}>
                  {m.note}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className={`container row between wrap ${styles.footer}`}>
        <span className="dim">© {new Date().getFullYear()} LOMBANA AI · Convertir ideas en resultados reales.</span>
        <span className="dim">
          <span className="gold">●</span> Ecosistema digital global
        </span>
      </footer>
    </div>
  );
}
