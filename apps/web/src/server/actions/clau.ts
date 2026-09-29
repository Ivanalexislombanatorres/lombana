'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parsePlan, PLAN_JSON_SCHEMA, PLAN_SYSTEM_PROMPT, type ClauPlan } from '@/lib/clau/plan';
import { AI_ERROR_MESSAGE, geminiGenerateJson, PROVIDER_CODE, type AiErrorCode } from '@/server/ai/gemini';
import { inOrg } from '@/server/session';

export interface ClauState {
  error?: string;
}

/** Máximo de planes que una persona pide por día (protege la cuota del proveedor de IA). */
const DAILY_LIMIT = 10;
const uuid = z.string().uuid();

export async function requestClauPlan(_prev: ClauState, form: FormData): Promise<ClauState> {
  const projectId = uuid.safeParse(form.get('projectId'));
  if (!projectId.success) return { error: 'Proyecto inválido' };

  // 1) Lectura corta: proyecto y límite diario (sin mantener la transacción durante la llamada a la IA).
  const pre = await inOrg(async (tx, account) => {
    const p = await tx.query<{ name: string; objective: string | null; intent: Record<string, unknown> }>(
      'select name, objective, intent from public.projects where id = $1 and deleted_at is null',
      [projectId.data],
    );
    if (!p.rows[0]) return { error: 'El proyecto no existe' } as const;
    const used = await tx.query<{ n: number }>(
      `select count(*)::int as n from public.project_events
        where actor_user_id = $1 and kind = 'clau.plan_proposed' and created_at > now() - interval '1 day'`,
      [account.userId],
    );
    if ((used.rows[0]?.n ?? 0) >= DAILY_LIMIT) {
      return { error: `Llegaste al límite de ${DAILY_LIMIT} planes por día. Vuelve a intentarlo mañana.` } as const;
    }
    return { project: p.rows[0] } as const;
  });
  if ('error' in pre) return { error: pre.error };

  const objective = (pre.project.objective ?? pre.project.name).slice(0, 2000);
  const intencion = typeof pre.project.intent?.intencion === 'string' ? pre.project.intent.intencion : null;
  const prompt = [
    `Objetivo del usuario: ${objective}`,
    intencion ? `Intención declarada: ${intencion}` : '',
    'Devuelve un JSON con esta forma exacta (JSON Schema):',
    JSON.stringify(PLAN_JSON_SCHEMA),
  ]
    .filter(Boolean)
    .join('\n');

  // 2) Llamada a la IA.
  const ai = await geminiGenerateJson({ system: PLAN_SYSTEM_PROMPT, prompt });
  let plan: ClauPlan | null = null;
  let failure: { code: AiErrorCode | 'invalid_output'; message: string } | null = null;
  if (ai.ok) {
    const parsed = parsePlan(ai.text);
    if ('plan' in parsed) plan = parsed.plan;
    else failure = { code: 'invalid_output', message: parsed.error };
  } else {
    failure = { code: ai.code, message: AI_ERROR_MESSAGE[ai.code] };
  }
  if (!ai.ok && ai.code === 'not_configured') return { error: failure!.message };

  // 3) Registro: consumo de IA (siempre, exitoso o no) y la propuesta como evento del proyecto.
  await inOrg(async (tx, account) => {
    const usage = await tx.query<{ id: string }>(
      `insert into public.ai_usage (org_id, user_id, provider_code, model_key, task, modality, project_id, request_id,
                                    input_tokens, output_tokens, credits, status, error_code, latency_ms)
       values ($1, $2, $3, $4, 'clau.plan', 'text', $5, $6, $7, $8, 0, $9, $10, $11) returning id`,
      [
        account.org.id,
        account.userId,
        PROVIDER_CODE,
        ai.model,
        projectId.data,
        randomUUID(),
        ai.ok ? ai.inputTokens : null,
        ai.ok ? ai.outputTokens : null,
        plan ? 'success' : 'error',
        failure?.code ?? null,
        ai.latencyMs,
      ],
    );
    if (plan) {
      await tx.query(
        `insert into public.project_events (org_id, project_id, actor_user_id, kind, payload)
         values ($1, $2, $3, 'clau.plan_proposed', $4)`,
        [account.org.id, projectId.data, account.userId, JSON.stringify({ plan, ai_usage_id: usage.rows[0]!.id, modelo: ai.model })],
      );
    }
  });
  if (failure) return { error: failure.message };
  revalidatePath(`/app/proyectos/${projectId.data}`);
  return {};
}

/** Agrega los pasos de una propuesta de CLAU al proyecto (una sola vez por propuesta). */
export async function applyClauPlan(form: FormData): Promise<void> {
  const projectId = uuid.safeParse(form.get('projectId'));
  const proposalId = uuid.safeParse(form.get('proposalId'));
  if (!projectId.success || !proposalId.success) return;
  await inOrg(async (tx, account) => {
    const ev = await tx.query<{ payload: { plan?: unknown } }>(
      `select payload from public.project_events
        where id = $1 and project_id = $2 and kind = 'clau.plan_proposed'`,
      [proposalId.data, projectId.data],
    );
    if (!ev.rows[0]) return;
    const applied = await tx.query(
      `select 1 from public.project_events where project_id = $1 and kind = 'clau.plan_applied' and payload->>'propuesta' = $2`,
      [projectId.data, proposalId.data],
    );
    if (applied.rowCount) return;
    const parsed = parsePlan(JSON.stringify(ev.rows[0].payload.plan ?? null));
    if (!('plan' in parsed)) return;
    // Bloquea el proyecto para asignar posiciones sin carreras.
    await tx.query('select 1 from public.projects where id = $1 for update', [projectId.data]);
    for (const paso of parsed.plan.pasos) {
      await tx.query(
        `insert into public.project_tasks (org_id, project_id, position, title, description, engine)
         values ($1, $2, coalesce((select max(position) + 1 from public.project_tasks where project_id = $2), 0), $3, $4, $5)`,
        [account.org.id, projectId.data, paso.titulo, paso.descripcion || null, paso.motor],
      );
    }
    await tx.query(
      `insert into public.project_events (org_id, project_id, actor_user_id, kind, payload)
       values ($1, $2, $3, 'clau.plan_applied', $4)`,
      [account.org.id, projectId.data, account.userId, JSON.stringify({ propuesta: proposalId.data, pasos: parsed.plan.pasos.length })],
    );
  });
  revalidatePath(`/app/proyectos/${projectId.data}`);
}
