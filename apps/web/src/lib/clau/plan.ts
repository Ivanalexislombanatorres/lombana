// Plan propuesto por CLAU: formato, validación y saneamiento (puro, con pruebas).
import { z } from 'zod';

export const ENGINES = [
  'ai', 'search', 'data', 'product', 'tools', 'download', 'payment', 'automation', 'integration', 'analytics',
] as const;

export const planSchema = z.object({
  resumen: z.string().trim().min(10).max(600),
  publico: z.string().trim().max(300).optional().default(''),
  pasos: z
    .array(
      z.object({
        titulo: z.string().trim().min(3).max(200),
        descripcion: z.string().trim().max(600).optional().default(''),
        motor: z.enum(ENGINES).catch('tools'),
      }),
    )
    .min(3)
    .max(10),
  riesgos: z.array(z.string().trim().min(3).max(300)).max(5).optional().default([]),
});
export type ClauPlan = z.infer<typeof planSchema>;

/** Esquema JSON que se envía al modelo para que responda con esta forma. */
export const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    resumen: { type: 'string', description: 'Qué se va a lograr, en 1-3 frases' },
    publico: { type: 'string', description: 'A quién va dirigido' },
    pasos: {
      type: 'array',
      minItems: 3,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          descripcion: { type: 'string' },
          motor: { type: 'string', enum: [...ENGINES] },
        },
        required: ['titulo', 'descripcion', 'motor'],
      },
    },
    riesgos: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
  required: ['resumen', 'pasos'],
} as const;

export const PLAN_SYSTEM_PROMPT = [
  'Eres CLAU, el asistente de LOMBANA AI GLOBAL. Respondes SIEMPRE en español neutro.',
  'Recibes el objetivo de un emprendedor y devuelves un plan de trabajo concreto, de 3 a 10 pasos, en orden.',
  'Cada paso es una acción verificable (empieza con un verbo). No inventes cifras, precios, clientes, testimonios ni resultados.',
  'Si algo requiere una licencia, permiso legal, pago o proveedor externo, dilo como un paso de verificación, sin asumir que ya existe.',
  'En "riesgos" menciona supuestos que el usuario debe validar. Responde solo con el JSON pedido.',
].join('\n');

/** Extrae y valida el plan del texto devuelto por el modelo (tolera ```json ... ```). */
export function parsePlan(text: string): { plan: ClauPlan } | { error: string } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return { error: 'La respuesta de la IA no tiene el formato esperado.' };
  }
  const parsed = planSchema.safeParse(data);
  if (!parsed.success) return { error: 'La respuesta de la IA no cumple el formato del plan.' };
  // Sin duplicados por título.
  const seen = new Set<string>();
  const pasos = parsed.data.pasos.filter((p) => {
    const k = p.titulo.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { plan: { ...parsed.data, pasos } };
}
