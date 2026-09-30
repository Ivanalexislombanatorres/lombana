import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetGeminiKeyCache, geminiGenerateJson } from './gemini';

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(async () => {
  await __resetGeminiKeyCache();
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
});

describe('geminiGenerateJson', () => {
  it('sin clave no llama a nadie', async () => {
    const f = reply(200, {});
    const r = await geminiGenerateJson({ system: 's', prompt: 'p' }, f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });

  it('envía la clave por cabecera (no en la URL) y lee texto y tokens', async () => {
    process.env.GEMINI_API_KEY = 'clave-secreta';
    process.env.GEMINI_MODEL = 'modelo-x';
    const f = reply(200, {
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
    });
    const r = await geminiGenerateJson({ system: 's', prompt: 'p' }, f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: true, text: '{"a":1}', model: 'modelo-x', inputTokens: 12, outputTokens: 34 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/modelo-x:generateContent');
    expect(url).not.toContain('clave-secreta');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('clave-secreta');
  });

  it.each([
    [401, 'auth'], [403, 'auth'], [429, 'quota'], [404, 'model_not_found'], [400, 'bad_request'], [500, 'provider_error'],
  ])('HTTP %i → %s', async (status, code) => {
    process.env.GEMINI_API_KEY = 'k';
    const r = await geminiGenerateJson({ system: 's', prompt: 'p' }, reply(status, {}) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code });
  });

  it('respuesta vacía se reporta como tal', async () => {
    process.env.GEMINI_API_KEY = 'k';
    const r = await geminiGenerateJson({ system: 's', prompt: 'p' }, reply(200, { candidates: [] }) as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: 'empty' });
  });
});
