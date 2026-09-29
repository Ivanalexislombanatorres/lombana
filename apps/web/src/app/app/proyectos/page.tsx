import type { Metadata } from 'next';
import Link from 'next/link';
import { PROJECT_STATUS_LABEL } from '@/components/ui';
import { inOrg } from '@/server/session';
import styles from './projects.module.css';

export const metadata: Metadata = { title: 'Proyectos' };

interface Row {
  id: string;
  name: string;
  objective: string | null;
  status: string;
  created_at: Date;
  progress_pct: number;
  done_count: string;
  available_count: string;
}

export default async function ProjectsPage() {
  const projects = await inOrg(async (tx) =>
    (
      await tx.query<Row>(
        `select p.id, p.name, p.objective, p.status, p.created_at, pp.progress_pct, pp.done_count, pp.available_count
           from public.projects p
           join public.project_progress pp on pp.project_id = p.id
          where p.deleted_at is null
          order by p.updated_at desc`,
      )
    ).rows,
  );

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Mis proyectos</p>
          <h1 className="h2" style={{ fontSize: 28 }}>
            Proyectos
          </h1>
        </div>
        <Link href="/app" className="btn btn-primary">
          Nuevo proyecto
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="panel pad-lg stack">
          <p className="h3">Aún no tienes proyectos</p>
          <p className="muted" style={{ margin: 0 }}>
            Ve a Inicio, escribe lo que necesitas lograr y se creará tu primer proyecto.
          </p>
        </div>
      ) : (
        <ul className={styles.grid}>
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/app/proyectos/${p.id}`} className={`card pad ${styles.card}`}>
                <div className="row between">
                  <span className="badge">{PROJECT_STATUS_LABEL[p.status] ?? p.status}</span>
                  <span className="dim" style={{ fontSize: 12.5 }}>
                    {new Date(p.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <span className="h3">{p.name}</span>
                {p.objective && <p className={`muted ${styles.objective}`}>{p.objective}</p>}
                <div className="progress">
                  <span style={{ width: `${p.progress_pct}%` }} />
                </div>
                <span className="dim" style={{ fontSize: 12.5 }}>
                  {p.progress_pct}% · {p.done_count}/{p.available_count} pasos
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
