import Link from 'next/link';
import { INTENTS, PROJECT_STATUS_LABEL, type IntentKey } from '@/components/ui';
import { geminiConfigured } from '@/server/ai/gemini';
import { inOrg } from '@/server/session';
import { AskBox } from './ask-box';
import styles from './dashboard.module.css';

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  updated_at: Date;
  progress_pct: number;
  done_count: string;
  available_count: string;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const initialIntent = INTENTS.some((i) => i.key === params.intencion) ? (params.intencion as IntentKey) : null;
  const initialObjective = (params.objetivo ?? '').slice(0, 2000);

  const data = await inOrg(async (tx, account) => {
    const projects = await tx.query<ProjectRow>(
      `select p.id, p.name, p.status, p.updated_at, pp.progress_pct, pp.done_count, pp.available_count
         from public.projects p
         join public.project_progress pp on pp.project_id = p.id
        where p.deleted_at is null
        order by p.updated_at desc
        limit 6`,
    );
    const stats = await tx.query<{ activos: string; total: string; pasos: string }>(
      `select count(*) filter (where status not in ('FINALIZADO', 'PAUSADO')) as activos,
              count(*) as total,
              (select count(*) from public.project_tasks t
                 join public.projects p2 on p2.id = t.project_id and p2.deleted_at is null
                where t.status = 'done') as pasos
         from public.projects where deleted_at is null`,
    );
    return { account, projects: projects.rows, stats: stats.rows[0]! };
  });

  const firstName = (data.account.displayName ?? '').split(' ')[0];

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">{firstName ? `Hola, ${firstName}` : 'Bienvenido'}</p>
        <h1 className="h1">¿Qué necesitas lograr hoy?</h1>
        <AskBox initialObjective={initialObjective} initialIntent={initialIntent} />
        {geminiConfigured() ? (
          <p className="dim" style={{ margin: 0, fontSize: 13.5 }}>
            Tu objetivo se guarda como proyecto. Dentro, pide a <span className="badge badge-ai">CLAU AI</span> que te
            proponga el plan.
          </p>
        ) : (
          <p className="dim" style={{ margin: 0, fontSize: 13.5 }}>
            Por ahora, tu objetivo se guarda como proyecto y tú defines los pasos.{' '}
            <span className="badge badge-ai" style={{ marginLeft: 4 }}>
              Pronto: CLAU propone el plan
            </span>
          </p>
        )}
      </section>

      <section className={styles.grid}>
        <div className="panel pad">
          <div className="row between">
            <h2 className="h2">Mis proyectos</h2>
            <Link href="/app/proyectos" className="btn btn-ghost btn-sm">
              Ver todos
            </Link>
          </div>
          {data.projects.length === 0 ? (
            <div className={styles.empty}>
              <p className="h3">Aún no tienes proyectos</p>
              <p className="muted" style={{ margin: 0 }}>
                Escribe arriba lo que quieres lograr y se convertirá en tu primer proyecto.
              </p>
            </div>
          ) : (
            <ul className={styles.list}>
              {data.projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/proyectos/${p.id}`} className={styles.item}>
                    <div className="row between">
                      <span className={styles.itemName}>{p.name}</span>
                      <span className="dim" style={{ fontSize: 13 }}>
                        {p.progress_pct}%
                      </span>
                    </div>
                    <div className="progress" aria-label={`Progreso ${p.progress_pct}%`}>
                      <span style={{ width: `${p.progress_pct}%` }} />
                    </div>
                    <span className="dim" style={{ fontSize: 12.5 }}>
                      {PROJECT_STATUS_LABEL[p.status] ?? p.status} · {p.done_count}/{p.available_count} pasos
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel pad">
          <h2 className="h2">Actividad</h2>
          <dl className={styles.stats}>
            <div>
              <dt className="dim">Proyectos activos</dt>
              <dd>{data.stats.activos}</dd>
            </div>
            <div>
              <dt className="dim">Proyectos en total</dt>
              <dd>{data.stats.total}</dd>
            </div>
            <div>
              <dt className="dim">Pasos completados</dt>
              <dd>{data.stats.pasos}</dd>
            </div>
          </dl>
          <p className="dim" style={{ fontSize: 13, margin: 0 }}>
            Descargas, leads y consumo de IA aparecerán aquí cuando esos módulos estén activos.
          </p>
        </div>
      </section>
    </div>
  );
}
