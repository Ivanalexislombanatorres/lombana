import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PROJECT_STATUS_LABEL } from '@/components/ui';
import { setProjectStatus, toggleTask } from '@/server/actions/projects';
import { inOrg } from '@/server/session';
import { AddTaskForm } from './add-task-form';
import { ClauRequest } from './clau-panel';
import { applyClauPlan } from '@/server/actions/clau';
import { geminiConfigured } from '@/server/ai/gemini';
import type { ClauPlan } from '@/lib/clau/plan';
import styles from '../projects.module.css';

export const metadata: Metadata = { title: 'Proyecto' };

const EVENT_LABEL: Record<string, string> = {
  'project.created': 'Proyecto creado',
  'project.status_changed': 'Estado actualizado',
  'task.created': 'Paso agregado',
  'task.done': 'Paso completado',
  'task.reopened': 'Paso reabierto',
  'clau.plan_proposed': 'CLAU propuso un plan',
  'clau.plan_applied': 'Plan de CLAU agregado',
};

const ENGINE_LABEL: Record<string, string> = {
  ai: 'IA', search: 'Búsqueda', data: 'Datos', product: 'Producto', tools: 'Herramientas', download: 'Descargas',
  payment: 'Pagos', automation: 'Automatización', integration: 'Integración', analytics: 'Analítica',
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const data = await inOrg(async (tx) => {
    const p = await tx.query<{ id: string; name: string; objective: string | null; status: string; created_at: Date }>(
      'select id, name, objective, status, created_at from public.projects where id = $1 and deleted_at is null',
      [id],
    );
    if (!p.rows[0]) return null;
    const progress = await tx.query<{ progress_pct: number; done_count: string; available_count: string }>(
      'select progress_pct, done_count, available_count from public.project_progress where project_id = $1',
      [id],
    );
    const tasks = await tx.query<{ id: string; title: string; status: string; available_in: string }>(
      'select id, title, status, available_in from public.project_tasks where project_id = $1 order by position',
      [id],
    );
    const events = await tx.query<{ kind: string; payload: Record<string, unknown>; created_at: Date }>(
      'select kind, payload, created_at from public.project_events where project_id = $1 order by created_at desc limit 12',
      [id],
    );
    const proposal = await tx.query<{ id: string; payload: { plan: ClauPlan; modelo?: string }; applied: boolean }>(
      `select e.id, e.payload,
              exists (select 1 from public.project_events a
                       where a.project_id = e.project_id and a.kind = 'clau.plan_applied'
                         and a.payload->>'propuesta' = e.id::text) as applied
         from public.project_events e
        where e.project_id = $1 and e.kind = 'clau.plan_proposed'
        order by e.created_at desc limit 1`,
      [id],
    );
    return {
      project: p.rows[0],
      progress: progress.rows[0]!,
      tasks: tasks.rows,
      events: events.rows,
      proposal: proposal.rows[0] ?? null,
    };
  });
  if (!data) notFound();
  const { project, progress, tasks, events, proposal } = data;
  const clauReady = geminiConfigured();

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 10 }}>
        <Link href="/app/proyectos" className="dim" style={{ fontSize: 13.5 }}>
          ← Proyectos
        </Link>
        <div className="row between wrap">
          <h1 className="h2" style={{ fontSize: 28 }}>
            {project.name}
          </h1>
          <form action={setProjectStatus} className="row">
            <input type="hidden" name="projectId" value={project.id} />
            <label htmlFor="status" className="sr-only">
              Estado del proyecto
            </label>
            <select id="status" name="status" defaultValue={project.status} className="select select-sm" style={{ width: 'auto' }}>
              {Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button className="btn btn-sm" type="submit">
              Guardar estado
            </button>
          </form>
        </div>
        {project.objective && (
          <p className="muted" style={{ margin: 0, maxWidth: 820 }}>
            <span className="dim">Objetivo · </span>
            {project.objective}
          </p>
        )}
      </div>

      <section className="panel pad stack" style={{ gap: 12 }} aria-labelledby="clau">
        <div className="row between wrap">
          <h2 id="clau" className="h3">
            <span className="badge badge-ai">CLAU AI</span> Plan sugerido
          </h2>
        </div>
        {!clauReady ? (
          <p className="muted" style={{ margin: 0 }}>
            CLAU se activa cuando se configure la clave de IA de la plataforma. Mientras tanto, define tus pasos abajo.
          </p>
        ) : (
          <ClauRequest projectId={project.id} hasProposal={Boolean(proposal)} />
        )}
        {proposal && (
          <div className="stack" style={{ gap: 10 }} data-testid="clau-proposal">
            <p style={{ margin: 0 }}>{proposal.payload.plan.resumen}</p>
            {proposal.payload.plan.publico && (
              <p className="dim" style={{ margin: 0, fontSize: 13.5 }}>
                Público: {proposal.payload.plan.publico}
              </p>
            )}
            <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
              {proposal.payload.plan.pasos.map((p, i) => (
                <li key={i}>
                  <strong>{p.titulo}</strong>{' '}
                  <span className="badge" style={{ fontSize: 11 }}>
                    {ENGINE_LABEL[p.motor] ?? p.motor}
                  </span>
                  {p.descripcion && (
                    <div className="dim" style={{ fontSize: 13.5 }}>
                      {p.descripcion}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {proposal.payload.plan.riesgos.length > 0 && (
              <div className="notice notice-warn">
                <strong>Supuestos por validar:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {proposal.payload.plan.riesgos.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="dim" style={{ margin: 0, fontSize: 12.5 }}>
              Generado por IA{proposal.payload.modelo ? ` (${proposal.payload.modelo})` : ''}. Revísalo antes de usarlo.
            </p>
            {proposal.applied ? (
              <span className="badge badge-ready">Pasos agregados al proyecto</span>
            ) : (
              <form action={applyClauPlan}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="proposalId" value={proposal.id} />
                <button className="btn btn-sm" type="submit">
                  Agregar estos {proposal.payload.plan.pasos.length} pasos al proyecto
                </button>
              </form>
            )}
          </div>
        )}
      </section>

      <div className={styles.layout}>
        <section className="panel pad stack">
          <div className="row between">
            <h2 className="h2">Pasos</h2>
            <span className="dim">
              {progress.progress_pct}% · {progress.done_count}/{progress.available_count}
            </span>
          </div>
          <div className="progress">
            <span style={{ width: `${progress.progress_pct}%` }} />
          </div>

          {tasks.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Define los pasos para lograr tu objetivo. Cuando CLAU esté activo, te propondrá un plan que podrás
              aprobar o editar.
            </p>
          ) : (
            <ul className={styles.tasks}>
              {tasks.map((t) => {
                const done = t.status === 'done';
                const unavailable = t.status === 'unavailable';
                return (
                  <li key={t.id} className={styles.task}>
                    {unavailable ? (
                      <span className="badge badge-planned">{t.available_in}</span>
                    ) : (
                      <form action={toggleTask}>
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="projectId" value={project.id} />
                        <button
                          type="submit"
                          className={styles.check}
                          aria-pressed={done}
                          aria-label={done ? `Reabrir: ${t.title}` : `Completar: ${t.title}`}
                        >
                          {done ? '✓' : ''}
                        </button>
                      </form>
                    )}
                    <span className={`${styles.taskTitle} ${done ? styles.done : ''} ${unavailable ? styles.unavailable : ''}`}>
                      {t.title}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <AddTaskForm projectId={project.id} />
        </section>

        <aside className="panel pad stack">
          <h2 className="h2">Historial</h2>
          <ul className={styles.events}>
            {events.map((e, i) => (
              <li key={i}>
                <span>
                  {EVENT_LABEL[e.kind] ?? e.kind}
                  {typeof e.payload?.titulo === 'string' ? `: ${e.payload.titulo}` : ''}
                  {typeof e.payload?.estado === 'string'
                    ? `: ${PROJECT_STATUS_LABEL[e.payload.estado] ?? e.payload.estado}`
                    : ''}
                </span>
                <span className="dim" style={{ fontSize: 12 }}>
                  {new Date(e.created_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
