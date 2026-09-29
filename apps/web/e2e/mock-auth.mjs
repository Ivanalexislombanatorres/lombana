// Servidor de pruebas que imita Supabase Auth (GoTrue) lo suficiente para e2e:
// registro, inicio de sesión, refresco, usuario actual, cierre de sesión y JWKS.
// Firma los tokens con ES256 y publica la clave pública, así la app verifica la
// firma igual que en producción (getClaims). SOLO para pruebas locales.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const PORT = Number(process.env.MOCK_AUTH_PORT ?? 54399);
const ISSUER = `http://127.0.0.1:${PORT}/auth/v1`;
const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
const kid = 'e2e-key';
const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };

const users = new Map(); // email -> { id, email, password, user_metadata }
const refresh = new Map(); // refresh token -> email

async function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const access = await new SignJWT({
    email: u.email,
    role: 'authenticated',
    aal: 'aal1',
    session_id: randomUUID(),
    user_metadata: u.user_metadata,
    app_metadata: { provider: 'email' },
  })
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
    .setSubject(u.id)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
  const rt = randomUUID();
  refresh.set(rt, u.email);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: rt,
    user: publicUser(u),
  };
}

function publicUser(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: new Date().toISOString(), user_metadata: u.user_metadata,
    app_metadata: { provider: 'email', providers: ['email'] }, identities: [],
    created_at: new Date().toISOString(),
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    if (path === '/auth/v1/.well-known/jwks.json') return send(res, 200, { keys: [jwk] });
    if (path === '/auth/v1/signup' && req.method === 'POST') {
      const b = await body(req);
      if (users.has(b.email)) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      const u = { id: randomUUID(), email: b.email, password: b.password, user_metadata: b.data ?? {} };
      users.set(b.email, u);
      return send(res, 200, await session(u));
    }
    if (path === '/auth/v1/token' && req.method === 'POST') {
      const b = await body(req);
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = users.get(b.email);
        if (!u || u.password !== b.password) {
          return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        return send(res, 200, await session(u));
      }
      if (grant === 'refresh_token') {
        const email = refresh.get(b.refresh_token);
        if (!email) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        refresh.delete(b.refresh_token);
        return send(res, 200, await session(users.get(email)));
      }
    }
    if (path === '/auth/v1/user' && req.method === 'GET') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}');
      const u = [...users.values()].find((x) => x.id === payload.sub);
      return u ? send(res, 200, publicUser(u)) : send(res, 401, { msg: 'invalid token' });
    }
    if (path === '/auth/v1/logout') return send(res, 204);
    // Simulador de Google Gemini (generateContent) para las pruebas de CLAU.
    if (req.method === 'POST' && /^\/v1beta\/models\/[^/]+:generateContent$/.test(path)) {
      if (req.headers['x-goog-api-key'] !== 'gemini-e2e') return send(res, 403, { error: { message: 'bad key' } });
      const b = await body(req);
      const prompt = b.contents?.[0]?.parts?.[0]?.text ?? '';
      if (prompt.includes('LIMITE')) return send(res, 429, { error: { message: 'quota' } });
      const plan = {
        resumen: 'Lanzar el servicio en una zona piloto y validar la demanda antes de crecer.',
        publico: 'Restaurantes pequeños del barrio',
        pasos: [
          { titulo: 'Entrevistar a 10 restaurantes de la zona', descripcion: 'Validar si pagarían por el servicio', motor: 'search' },
          { titulo: 'Definir la zona piloto y las tarifas', descripcion: 'Con base en las entrevistas', motor: 'data' },
          { titulo: 'Verificar requisitos legales para domicilios', descripcion: 'Consultar la normativa local', motor: 'tools' },
        ],
        riesgos: ['La disposición a pagar no está validada'],
      };
      return send(res, 200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 180 },
      });
    }
    return send(res, 404, { msg: `mock: ruta no implementada ${req.method} ${path}` });
  } catch (err) {
    return send(res, 500, { msg: String(err) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`mock-auth escuchando en ${PORT}`));
