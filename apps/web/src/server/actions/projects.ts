'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getAccount, inOrg, ORG_COOKIE } from '@/server/session';

export interface FormState {
  error?: string;
}

const PROJECT_STATUSES = [
  'IDEA', 'INVESTIGACION', 'VALIDACION', 'DISENO', 'DESARROLLO',
  'REVISION', 'PUBLICACION', 'ACTIVO', 'PAUSADO', 'FINALIZADO',
] as const;

const uuid = z.string().uuid();

const newProject = z.object({
  objective: z.string().trim().min(8, 'Describe tu objetivo con un poco más de detalle').max(2000),
  name: z.string().trim().max(160).optional(),
  intent: z.enum(['crear', 'automatizar', 'vender', 'analizar', 'aprender', 'encontrar', 'resolver']).optional(),
});

function nameFrom(objective: string): string {
  const clean = objective.replace(/\s+/g, ' ').trim();
  return clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}…`;
}

export async function createProject(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = newProject.safeParse({
    objective: form.get('objective'),
    name: form.get('name') || undefined,
    intent: form.get('intent') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  const { objective, intent } = parsed.data;
  const name = parsed.data.name || nameFrom(objective);

  const id = await inOrg(async (tx, account) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.projects (org_id, owner_id, name, objective, intent)
       values ($1, $2, $3, $4, $5) returning id`,
      [account.org.id, account.userId, name, objective, JSON.stringify({ objetivo: objective, intencion: intent ?? null })],
    );
    const projectId = rows[0]!.id;
    await tx.query(
      `insert into public.project_events (org_id, project_id, actor_user_id, kind, payload)
       values ($1, $2, $3, 'project.created', $4)`,
      [account.org.id, projectId, account.userId, JSON.stringify({ origen: 'inicio' })],
    );
    await tx.query(
      `insert into public.analytics_events (org_id, user_id, name, properties) values ($1, $2, 'project.created', $3)`,
      [account.org.id, account.userId, JSON.stringify({ intencion: intent ?? null })],
    );
    return projectId;
  });
  revalidatePath('/app');
  redirect(`/app/proyectos/${id}`);
}

const newTask = z.object({
  projectId: uuid,
  title: z.string().trim().min(2, 'Escribe el paso').max(200),
});

export async function addTask(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = newTask.safeParse({ projectId: form.get('projectId'), title: form.get('title') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos' };
  const { projectId, title } = parsed.data;
  const ok = await inOrg(async (tx, account) => {
    const p = await tx.query('select 1 from public.projects where id = $1 and deleted_at is null', [projectId]);
    if (p.rowCount === 0) return false;
    await tx.query(
      `insert into public.project_tasks (org_id, project_id, position, title)
       values ($1, $2, coalesce((select max(position) + 1 from public.project_tasks where project_id = $2), 0), $3)`,
      [account.org.id, projectId, title],
    );
    await tx.query(
      `insert into public.project_events (org_id, project_id, actor_user_id, kind, payload)
       values ($1, $2, $3, 'task.created', $4)`,
      [account.org.id, projectId, account.userId, JSON.stringify({ titulo: title })],
    );
    return true;
  });
  if (!ok) return { error: 'Proyecto no encontrado' };
  revalidatePath(`/app/proyectos/${projectId}`);
  return {};
}

export async function toggleTask(form: FormData): Promise<void> {
  const taskId = uuid.parse(form.get('taskId'));
  const projectId = uuid.parse(form.get('projectId'));
  await inOrg(async (tx, account) => {
    const { rows } = await tx.query<{ status: string }>(
      `update public.project_tasks
          set status = case when status = 'done' then 'pending' else 'done' end,
              done_at = case when status = 'done' then null else now() end
        where id = $1 and project_id = $2 and status in ('pending', 'in_progress', 'done')
        returning status`,
      [taskId, projectId],
    );
    if (rows[0]) {
      await tx.query(
        `insert into public.project_events (org_id, project_id, actor_user_id, kind, payload)
         values ($1, $2, $3, $4, $5)`,
        [account.org.id, projectId, account.userId, rows[0].status === 'done' ? 'task.done' : 'task.reopened',
          JSON.stringify({ taskId })],
      );
    }
  });
  revalidatePath(`/app/proyectos/${projectId}`);
  revalidatePath('/app');
}

export async function setProjectStatus(form: FormData): Promise<void> {
  const projectId = uuid.parse(form.get('projectId'));
  const status = z.enum(PROJECT_STATUSES).parse(form.get('status'));
  await inOrg(async (tx, account) => {
    const r = await tx.query('update public.projects set status = $1 where id = $2 and deleted_at is null', [
      status,
      projectId,
    ]);
    if (r.rowCount) {
      await tx.query(
        `insert into public.project_events (org_id, project_id, actor_user_id, kind, payload)
         values ($1, $2, $3, 'project.status_changed', $4)`,
        [account.org.id, projectId, account.userId, JSON.stringify({ estado: status })],
      );
    }
  });
  revalidatePath(`/app/proyectos/${projectId}`);
  revalidatePath('/app');
}

export async function switchOrg(form: FormData): Promise<void> {
  const orgId = uuid.parse(form.get('orgId'));
  const account = await getAccount();
  if (!account || !account.orgs.some((o) => o.id === orgId)) redirect('/app');
  const store = await cookies();
  store.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  });
  redirect('/app');
}
