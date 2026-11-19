// Contraseñas con PBKDF2-SHA256 (WebCrypto) y sesiones firmadas con HMAC.
const enc = new TextEncoder()
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const ITER = 120_000

export function randomToken(bytes = 32) { return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[+/=]/g, '') }

async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256))
}

export async function hashPassword(password: string) {
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITER}$${b64(salt)}$${await pbkdf2(password, salt, ITER)}`
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, iter, salt, hash] = stored.split('$')
  if (alg !== 'pbkdf2') return false
  const h = await pbkdf2(password, unb64(salt), Number(iter))
  let diff = h.length ^ hash.length
  for (let i = 0; i < Math.min(h.length, hash.length); i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(msg))).replace(/[+/=]/g, '')
}

export async function signToken(secret: string, payload: Record<string, unknown>) {
  const body = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
  return `${body}.${await hmac(secret, body)}`
}

export async function readToken(secret: string, token: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig || (await hmac(secret, body)) !== sig) return null
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(body))))
    if (typeof p.exp === 'number' && Date.now() > p.exp) return null
    return p
  } catch { return null }
}
