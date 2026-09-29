import 'server-only';
import { z } from 'zod';

// El rol de la app es lombana_app. En el pooler de Supabase el usuario lleva el
// identificador del proyecto: lombana_app.<referencia>. Cualquier otro rol se rechaza.
const APP_ROLE_USER = /^lombana_app(\.[a-z0-9]+)?$/;

// Variables de entorno del servidor, validadas al arrancar. Nada de esto llega al navegador.
const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => APP_ROLE_USER.test(decodeURIComponent(new URL(u).username)), {
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
