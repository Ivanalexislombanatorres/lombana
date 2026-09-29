import { describe, expect, it } from 'vitest';
import { safeNext } from './config';

describe('safeNext: destinos tras iniciar sesión', () => {
  it.each([
    ['/app', '/app'],
    ['/app/proyectos/123', '/app/proyectos/123'],
    ['/app?objetivo=Hola%20mundo&intencion=crear', '/app?objetivo=Hola%20mundo&intencion=crear'],
    ['/app/../app/cuenta', '/app/cuenta'],
  ])('acepta la ruta interna %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    ['vacío', ''],
    ['nulo', null],
    ['absoluta', 'https://evil.com'],
    ['sin barra', 'evil.com'],
    ['protocolo relativo', '//evil.com'],
    ['barra invertida', '/\\evil.com'],
    ['tabulador (se ignora al analizar)', '/\t/evil.com'],
    ['tabulador + barra invertida', '/\t\\evil.com'],
    ['salto de línea', '/\n/evil.com'],
    ['retorno de carro', '/\r/evil.com'],
    ['nulo embebido', '/\u0000/evil.com'],
    ['javascript', 'javascript:alert(1)'],
    ['esquema con barra', '/https://evil.com'],
  ])('rechaza %s', (_name, input) => {
    const out = safeNext(input as string | null);
    // Nunca debe resolver a otro origen.
    expect(new URL(out, 'https://lombana.vercel.app').origin).toBe('https://lombana.vercel.app');
    if (input !== '/https://evil.com') expect(out).toBe('/app');
  });

  it('las variantes codificadas quedan como ruta interna literal', () => {
    for (const v of ['/%2F%2Fevil.com', '/%5Cevil.com', '/%09/evil.com']) {
      expect(new URL(safeNext(v), 'https://lombana.vercel.app').origin).toBe('https://lombana.vercel.app');
    }
  });
});

describe('configuración pública de producción', () => {
  const keys = ['VERCEL', 'VERCEL_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SITE_URL'];
  const saved: Record<string, string | undefined> = {};
  const reset = () => keys.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  keys.forEach((k) => (saved[k] = process.env[k]));

  it('fuera de Vercel no inventa configuración', async () => {
    keys.forEach((k) => delete process.env[k]);
    const { authConfig, siteUrl } = await import('./config');
    expect(authConfig()).toBeNull();
    expect(siteUrl()).toBeNull();
    reset();
  });

  it('en producción de Vercel usa los valores públicos si faltan las variables', async () => {
    keys.forEach((k) => delete process.env[k]);
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'production';
    const { authConfig, siteUrl } = await import('./config');
    expect(authConfig()?.url).toBe('https://fazdgwkofhluapbmrjor.supabase.co');
    expect(authConfig()?.publishableKey).toMatch(/^sb_publishable_/);
    expect(siteUrl()).toBe('https://lombana.vercel.app');
    // Una variable definida siempre gana.
    process.env.SITE_URL = 'https://otro.example.com';
    expect(siteUrl()).toBe('https://otro.example.com');
    reset();
  });

  it('en vistas previas de Vercel tampoco inventa configuración', async () => {
    keys.forEach((k) => delete process.env[k]);
    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    const { authConfig } = await import('./config');
    expect(authConfig()).toBeNull();
    reset();
  });
});
