'use server';

import { z } from 'zod';
import { inOrg } from '@/server/session';

export interface ModerationState {
  error?: string;
  done?: string;
}

const input = z.object({
  kind: z.enum(['contribution', 'product']),
  id: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'publish', 'return']),
  note: z.string().trim().max(1000).optional(),
});

// Mensajes de la base (en español, sin datos sensibles) que se pueden mostrar tal cual.
const KNOWN = [
  'Rechazar exige una nota para el autor',
  'Devolver exige una nota para el creador',
  'El aporte no está pendiente de moderación',
  'El producto no está en revisión',
  'Nadie modera su propio aporte',
  'Nadie aprueba su propio producto',
  'El producto no tiene un archivo entregable escaneado como limpio',
  'Los pagos no están habilitados: solo se pueden publicar productos gratuitos',
  'Se requiere permiso de moderación de plataforma',
];

export async function moderate(_prev: ModerationState, form: FormData): Promise<ModerationState> {
  const parsed = input.safeParse({
    kind: form.get('kind'),
    id: form.get('id'),
    decision: form.get('decision'),
    note: form.get('note') || undefined,
  });
  if (!parsed.success) return { error: 'Solicitud inválida' };
  const { kind, id, decision, note } = parsed.data;
  const valid = kind === 'contribution' ? ['approved', 'rejected'] : ['publish', 'return'];
  if (!valid.includes(decision)) return { error: 'Decisión inválida' };

  try {
    await inOrg((tx) =>
      kind === 'contribution'
        ? tx.query('select app.moderate_contribution($1, $2, $3)', [id, decision, note ?? null])
        : tx.query('select app.review_product($1, $2, $3)', [id, decision, note ?? null]),
    );
  } catch (err) {
    const msg = (err as Error).message ?? '';
    return { error: KNOWN.find((k) => msg.startsWith(k)) ?? 'No se pudo registrar la decisión.' };
  }
  // Sin revalidatePath: recargaría la cola y el elemento desaparecería sin mostrar su confirmación.
  // /noticias y la cola son dinámicas: la próxima visita ya refleja la decisión.
  const label: Record<string, string> = {
    approved: 'Aporte publicado.',
    rejected: 'Aporte rechazado con nota para el autor.',
    publish: 'Producto publicado.',
    return: 'Producto devuelto a borrador con nota.',
  };
  return { done: label[decision] };
}
