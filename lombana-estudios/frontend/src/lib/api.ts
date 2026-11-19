// Cliente HTTP. La fábrica y cada ERP usan tokens separados: un token nunca sirve en otro ámbito.
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const FACTORY_KEY = 'lombana_factory_token'
const rtKey = (slug: string) => `lombana_rt_${slug}`

export const tokens = {
  factory: () => localStorage.getItem(FACTORY_KEY),
  setFactory: (t: string | null) => (t ? localStorage.setItem(FACTORY_KEY, t) : localStorage.removeItem(FACTORY_KEY)),
  rt: (slug: string) => localStorage.getItem(rtKey(slug)),
  setRt: (slug: string, t: string | null) => (t ? localStorage.setItem(rtKey(slug), t) : localStorage.removeItem(rtKey(slug))),
}

async function request<T>(path: string, opts: RequestInit & { token?: string | null; onUnauthorized?: () => void } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) }
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  let res: Response
  try {
    res = await fetch(path, { ...opts, headers })
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor local. ¿Está iniciado LOMBANA ESTUDIOS?')
  }
  if (res.status === 401 && opts.onUnauthorized) opts.onUnauthorized()
  const ct = res.headers.get('content-type') || ''
  const data = ct.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) {
    const msg = typeof data === 'object' && data && 'detail' in data ? String((data as { detail: unknown }).detail) : `Error ${res.status}`
    throw new ApiError(res.status, msg)
  }
  return data as T
}

const toFactoryLogin = () => { tokens.setFactory(null); if (!location.pathname.startsWith('/login')) location.href = '/login' }

export const api = {
  get: <T>(p: string) => request<T>(p, { token: tokens.factory(), onUnauthorized: toFactoryLogin }),
  post: <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}), token: tokens.factory(), onUnauthorized: toFactoryLogin }),
  put: <T>(p: string, body: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body), token: tokens.factory(), onUnauthorized: toFactoryLogin }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body), token: tokens.factory(), onUnauthorized: toFactoryLogin }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE', token: tokens.factory(), onUnauthorized: toFactoryLogin }),
  public: <T>(p: string, body?: unknown) => request<T>(p, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
}

export function rtApi(slug: string) {
  const base = `/api/rt/${slug}`
  const out = () => { tokens.setRt(slug, null); location.href = `/erp/${slug}/login` }
  const o = { token: tokens.rt(slug), onUnauthorized: out }
  return {
    get: <T>(p: string) => request<T>(base + p, { ...o, token: tokens.rt(slug) }),
    post: <T>(p: string, body?: unknown) => request<T>(base + p, { ...o, token: tokens.rt(slug), method: 'POST', body: JSON.stringify(body ?? {}) }),
    put: <T>(p: string, body: unknown) => request<T>(base + p, { ...o, token: tokens.rt(slug), method: 'PUT', body: JSON.stringify(body) }),
    del: <T>(p: string) => request<T>(base + p, { ...o, token: tokens.rt(slug), method: 'DELETE' }),
    download: async (p: string, filename: string) => {
      const res = await fetch(base + p, { headers: { Authorization: `Bearer ${tokens.rt(slug)}` } })
      if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
    },
  }
}

export const money = (v: string | number | null | undefined, currency = 'COP') => {
  const n = Number(v ?? 0)
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: currency === 'COP' ? 0 : 2 }).format(n)
  } catch { return n.toLocaleString('es-CO') }
}
export const num = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })
export const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
export const relTime = (iso: string) => {
  const d = new Date(iso), now = new Date()
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  const t = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  return days === 0 ? `Hoy, ${t}` : days === 1 ? `Ayer, ${t}` : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}
