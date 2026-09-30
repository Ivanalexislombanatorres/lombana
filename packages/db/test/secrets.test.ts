import { afterAll, describe, expect, it } from 'vitest';
import { app, closePools, pgError, PG } from './helpers.js';

afterAll(closePools);

describe('secretos de plataforma', () => {
  it('solo se leen nombres de la lista blanca', async () => {
    expect(await pgError(app.query(`select app.platform_secret('database_password')`))).toBe(PG.RLS);
  });
  it('sin Vault (entorno local) devuelve NULL, sin error', async () => {
    const { rows } = await app.query(`select app.platform_secret('gemini_api_key') as s`);
    expect(rows[0].s).toBeNull();
  });
});
