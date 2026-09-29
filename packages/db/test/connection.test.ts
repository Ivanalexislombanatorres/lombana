import { afterEach, describe, expect, it } from 'vitest';
import { pgClientConfig } from '../src/index.js';

const ORIGINAL_CA = process.env.DATABASE_CA_CERT;
afterEach(() => {
  if (ORIGINAL_CA === undefined) delete process.env.DATABASE_CA_CERT;
  else process.env.DATABASE_CA_CERT = ORIGINAL_CA;
});

describe('configuración de conexión', () => {
  it('local: sin SSL forzado', () => {
    expect(pgClientConfig('postgres://u:p@localhost/db').ssl).toBeUndefined();
  });

  it('Supabase: siempre cifrado; verifica el certificado cuando hay CA', () => {
    delete process.env.DATABASE_CA_CERT;
    const url = 'postgres://lombana_app.abc:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    expect(pgClientConfig(url).ssl).toEqual({ rejectUnauthorized: false });
    process.env.DATABASE_CA_CERT = '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----';
    expect(pgClientConfig(url).ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it('respeta sslmode explícito en la URL', () => {
    const url = 'postgres://u:p@db.abc.supabase.co:5432/postgres?sslmode=verify-full';
    expect(pgClientConfig(url).ssl).toBeUndefined();
  });
});
