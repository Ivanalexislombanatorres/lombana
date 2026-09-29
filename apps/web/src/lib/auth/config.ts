import { PRODUCTION_PUBLIC_CONFIG, publicValue } from '../public-config';

// Configuración pública del proveedor de identidad (Supabase Auth).
// Ambos valores son públicos por diseño: la clave publicable solo permite iniciar
// sesión; LOMBANA no expone la Data API de Supabase.
export interface AuthConfig {
  url: string;
  publishableKey: string;
}

export function authConfig(): AuthConfig | null {
  const url = publicValue(process.env.NEXT_PUBLIC_SUPABASE_URL, PRODUCTION_PUBLIC_CONFIG.supabaseUrl);
  const publishableKey = publicValue(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    PRODUCTION_PUBLIC_CONFIG.supabasePublishableKey,
  );
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/**
 * URL pública del sitio para los enlaces de los correos (confirmación de cuenta).
 * Nunca se toma de la cabecera Host de la petición: un atacante podría falsificarla
 * y hacer que el enlace del correo apunte a su dominio.
 */
export function siteUrl(): string | null {
  const raw = publicValue(process.env.SITE_URL, PRODUCTION_PUBLIC_CONFIG.siteUrl);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

const INTERNAL = 'http://lombana.invalid';

/**
 * Destino interno seguro tras iniciar sesión (evita redirecciones abiertas).
 * Se resuelve con el mismo analizador de URL que usan navegadores y servidores,
 * que ignora tabuladores y saltos de línea: "/\t/evil.com" sería "//evil.com".
 * Solo se acepta si el resultado sigue en el mismo origen, y se devuelve normalizado.
 */
export function safeNext(next: string | null | undefined): string {
  const fallback = '/app';
  if (!next || !next.startsWith('/')) return fallback;
  // Caracteres de control o barras invertidas: nunca legítimos en una ruta interna.
  if (/[\u0000-\u001F\u007F\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, INTERNAL);
    if (url.origin !== INTERNAL) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Opciones de las cookies de sesión: nunca accesibles desde JavaScript del navegador. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
