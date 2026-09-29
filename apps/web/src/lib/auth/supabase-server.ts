import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { authConfig, SESSION_COOKIE_OPTIONS } from './config';

/**
 * Cliente de Supabase Auth para componentes de servidor, acciones y rutas.
 * Devuelve null si el login no está configurado (variables de entorno ausentes).
 */
export async function supabaseServer() {
  const cfg = authConfig();
  if (!cfg) return null;
  const store = await cookies();
  return createServerClient(cfg.url, cfg.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
        } catch {
          // En componentes de servidor no se pueden escribir cookies; el proxy las refresca.
        }
      },
    },
  });
}
