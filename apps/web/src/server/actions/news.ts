'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NEWS_TOPICS, parseReferenceUrls, type NewsTopic } from '@/lib/news/input';
import { inOrg } from '@/server/session';

export interface ContributionFormState {
  error?: string;
  saved?: boolean;
  values?: Record<string, string>;
}

const fields = z.object({
  title: z.string().trim().min(8, 'El título debe tener al menos 8 caracteres').max(200),
  body: z.string().trim().min(80, 'El aporte debe tener al menos 80 caracteres').max(20000, 'El aporte es demasiado largo'),
  topic: z.enum(Object.keys(NEWS_TOPICS) as [NewsTopic, ...NewsTopic[]], { message: 'Elige un tema' }),
  references: z.string().max(3000).optional(),
  intent: z.enum(['draft', 'submit']),
});

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['title', 'body', 'topic', 'references']) {
    const v = form.get(k);
    if (typeof v === 'string') out[k] = v.slice(0, 20000);
  }
  return out;
}

/** Crear un aporte (borrador o enviado a moderación). La publicación la decide moderación. */
export async function createContribution(
  _prev: ContributionFormState,
  form: FormData,
): Promise<ContributionFormState> {
  const parsed = fields.safeParse({
    title: form.get('title'),
    body: form.get('body'),
    topic: form.get('topic'),
    references: form.get('references') || undefined,
    intent: form.get('intent'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos', values: echo(form) };
  const refs = parseReferenceUrls(parsed.data.references ?? '');
  if ('error' in refs) return { error: refs.error, values: echo(form) };

  const result = await inOrg(async (tx, account) => {
    const perm = await tx.query<{ ok: boolean }>("select app.has_permission($1, 'news.contribute') as ok", [account.org.id]);
    if (!perm.rows[0]?.ok) return { error: 'Tu rol en este espacio no permite enviar aportes.' };
    const status = parsed.data.intent === 'submit' ? 'submitted' : 'draft';
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.news_contributions (org_id, author_id, title, body, reference_urls, topics, status)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [account.org.id, account.userId, parsed.data.title, parsed.data.body, refs.urls, [parsed.data.topic], status],
    );
    await tx.query(
      `insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result)
       values ($1, $2, 'user', $3, 'news_contribution', $4, 'success')`,
      [account.org.id, account.userId, status === 'submitted' ? 'news.contribution_submit' : 'news.contribution_create', rows[0]!.id],
    );
    return { ok: true as const };
  });
  if ('error' in result) return { error: result.error, values: echo(form) };
  revalidatePath('/app/noticias');
  return { saved: true };
}

const transitions: Record<string, { from: string[]; to: string }> = {
  submit: { from: ['draft', 'withdrawn'], to: 'submitted' },
  withdraw: { from: ['draft', 'submitted'], to: 'withdrawn' },
};

export async function changeContributionStatus(form: FormData): Promise<void> {
  const id = z.string().uuid().safeParse(form.get('contributionId'));
  const t = transitions[String(form.get('transition'))];
  if (!id.success || !t) return;
  await inOrg(async (tx, account) => {
    const c = await tx.query<{ status: string }>(
      'select status from public.news_contributions where id = $1 for update',
      [id.data],
    );
    if (!c.rows[0] || !t.from.includes(c.rows[0].status)) return;
    await tx.query('update public.news_contributions set status = $2 where id = $1', [id.data, t.to]);
    await tx.query(
      `insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result, metadata)
       values ($1, $2, 'user', 'news.contribution_status', 'news_contribution', $3, 'success', $4)`,
      [account.org.id, account.userId, id.data, JSON.stringify({ desde: c.rows[0].status, hacia: t.to })],
    );
  });
  revalidatePath('/app/noticias');
}
