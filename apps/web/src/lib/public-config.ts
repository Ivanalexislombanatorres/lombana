// Configuración PÚBLICA del despliegue de producción en Vercel.
//
// Estos valores no son secretos: la URL del proyecto de Supabase y la clave
// *publishable* viajan de todos modos al navegador (por eso llevan NEXT_PUBLIC_),
// y la dirección del sitio es pública. Se fijan aquí para que el despliegue solo
// dependa de UNA variable secreta en Vercel: DATABASE_URL.
//
// Solo se usan en Vercel (VERCEL=1) y solo si la variable de entorno no existe:
// una variable definida en Vercel siempre tiene prioridad. En desarrollo y en las
// pruebas no aplican.
export const PRODUCTION_PUBLIC_CONFIG = {
  supabaseUrl: 'https://fazdgwkofhluapbmrjor.supabase.co',
  supabasePublishableKey: 'sb_publishable_kPXDfdiHCPfIh-qCvrRR6w_lDI5jdFD',
  siteUrl: 'https://lombana.vercel.app',
} as const;

export function onVercelProduction(): boolean {
  return process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
}

/** Valor de entorno con respaldo público solo en producción de Vercel. */
export function publicValue(envValue: string | undefined, fallback: string): string | undefined {
  const v = envValue?.trim();
  if (v) return v;
  return onVercelProduction() ? fallback : undefined;
}
