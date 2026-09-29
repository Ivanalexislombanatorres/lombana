import 'server-only';

// Adaptador de Google Gemini (API REST generateContent). Sin SDK: una sola llamada HTTP.
// Clave: GEMINI_API_KEY (secreta, solo en el servidor). Modelo: GEMINI_MODEL (configurable).

export const PROVIDER_CODE = 'google';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';
const TIMEOUT_MS = 30_000;

export type AiErrorCode = 'not_configured' | 'auth' | 'quota' | 'model_not_found' | 'bad_request' | 'timeout' | 'provider_error' | 'empty';

export interface AiResult {
  ok: true;
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}
export interface AiFailure {
  ok: false;
  code: AiErrorCode;
  model: string;
  latencyMs: number;
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export async function geminiGenerateJson(
  opts: { system: string; prompt: string; maxOutputTokens?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<AiResult | AiFailure> {
  const model = geminiModel();
  const started = Date.now();
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return { ok: false, code: 'not_configured', model, latencyMs: 0 };
  const base = (process.env.GEMINI_API_BASE?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          maxOutputTokens: opts.maxOutputTokens ?? 2048,
        },
      }),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const code: AiErrorCode =
        res.status === 401 || res.status === 403
          ? 'auth'
          : res.status === 429
            ? 'quota'
            : res.status === 404
              ? 'model_not_found'
              : res.status === 400
                ? 'bad_request'
                : 'provider_error';
      return { ok: false, code, model, latencyMs };
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    if (!text) return { ok: false, code: 'empty', model, latencyMs };
    return {
      ok: true,
      text,
      model,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs,
    };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, code: aborted ? 'timeout' : 'provider_error', model, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export const AI_ERROR_MESSAGE: Record<AiErrorCode, string> = {
  not_configured: 'CLAU aún no está activo: falta configurar la clave de IA.',
  auth: 'La clave de IA no es válida o no tiene permisos.',
  quota: 'Se alcanzó el límite de uso de la IA. Intenta más tarde.',
  model_not_found: 'El modelo de IA configurado no existe o no está disponible.',
  bad_request: 'La IA rechazó la solicitud. Intenta reformular el objetivo.',
  timeout: 'La IA tardó demasiado en responder. Intenta de nuevo.',
  provider_error: 'El servicio de IA no respondió correctamente. Intenta de nuevo.',
  empty: 'La IA no devolvió contenido. Intenta de nuevo.',
};
