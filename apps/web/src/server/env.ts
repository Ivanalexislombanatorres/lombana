import 'server-only';
import { z } from 'zod';

// Variables de entorno del servidor, validadas al arrancar. Nada de esto llega al navegador.
const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => new URL(u).username === 'lombana_app', {
      message: 'DATABASE_URL debe usar el rol lombana_app (el que respeta RLS)',
    }),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Configuración inválida: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
