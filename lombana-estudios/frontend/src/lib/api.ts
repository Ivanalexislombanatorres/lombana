// Cliente HTTP. La fábrica y cada ERP usan tokens separados: un token nunca sirve en otro ámbito.
import type { LocalApi } from '../local/api'

// Versión dentro de Claude (artifact): las rutas /api se atienden en el navegador con la base del artifact.
export const IS_ARTIFACT = import.meta.env.VITE_TARGET === 'artifact'
let local: LocalApi | null = null
export const setLocalApi = (l: LocalApi) => { local = l }
let navigateFn: (p: string) => void = p => { location.href = p }
export const setNavigate = (fn: (p: string) => void) => { navigateFn = fn }
type Downloader = ((f: { filename: string; data: string }) => Promise<unknown>) | null
let downloader: () => Promise<Downloader> = async () => null
export const setDownloader = (fn: () => Promise<Downloader>) => { downloader = fn }

const mem = new Map<string, string>()
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? mem.get(k) ?? null } catch { return mem.get(k) ?? null } },
  set: (k: string, v: string | null) => {
    if (v === null) mem.delete(k); else mem.set(k, v)
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* sin almacenamiento local */ }
  },
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const FACTORY_KEY = 'lombana_factory_token'
const rtKey = (slug: string) => `lombana_rt_${slug}`

export const tokens = {
  factory: () => (IS_ARTIFACT ? 'propietario' : ls.get(FACTORY_KEY)),
  setFactory: (t: string | null) => ls.set(FACTORY_KEY, t),
  rt: (slug: string) => ls.get(rtKey(slug)),
  setRt: (slug: string, t: string | null) => ls.set(rtKey(slug), t),
}

async function request<T>(path: string, opts: RequestInit & { token?: string | null; onUnauthorized?: () => void } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) }
  if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  if (local) {
    try {
      const body = opts.body ? JSON.parse(String(opts.body)) : undefined
      return (await local.handle(opts.method ?? 'GET', path, body, opts.token ?? null)) as T
    } catch (e) {
      const st = (e as { status?: number }).status
      if (st === 401 && opts.onUnauthorized) opts.onUnauthorized()
      throw new ApiError(st ?? 500, (e as Error).message || 'Error inesperado')
    }
  }
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

const toFactoryLogin = () => { if (IS_ARTIFACT) return; tokens.setFactory(null); if (!location.pathname.startsWith('/login')) navigateFn('/login') }

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
  const out = () => { tokens.setRt(slug, null); navigateFn(`/erp/${slug}/login`) }
  const o = { token: tokens.rt(slug), onUnauthorized: out }
  return {
    get: <T>(p: string) => request<T>(base + p, { ...o, token: tokens.rt(slug) }),
    post: <T>(p: string, body?: unknown) => request<T>(base + p, { ...o, token: tokens.rt(slug), method: 'POST', body: JSON.stringify(body ?? {}) }),
    put: <T>(p: string, body: unknown) => request<T>(base + p, { ...o, token: tokens.rt(slug), method: 'PUT', body: JSON.stringify(body) }),
    del: <T>(p: string) => request<T>(base + p, { ...o, token: tokens.rt(slug), method: 'DELETE' }),
    download: async (p: string, filename: string) => {
      if (local) {
        const r = await request<{ __csv: string }>(base + p, { ...o, token: tokens.rt(slug) })
        const d = await downloader()
        if (!d) throw new ApiError(0, 'Esta vista no permite descargar archivos')
        await d({ filename, data: r.__csv })
        return
      }
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
