import { D, type Dec } from './formula'

export class HttpError extends Error {
  status: number
  constructor(status: number, msg: string) { super(msg); this.status = status }
}
// declarada como función para que TypeScript entienda que corta el flujo (never)
export function E(status: number, msg: string): never { throw new HttpError(status, msg) }

export type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const nowIso = () => new Date().toISOString()
export const M4 = (x: Dec | string | number) => new D(x).toFixed(4)
export const num = (v: unknown, field: string, { min = 0 as number | null, max = null as number | null } = {}): Dec => {
  let d: Dec
  try { d = new D(String(v ?? '')); if (!d.isFinite()) throw 0 } catch { return E(422, `${field}: número inválido`) }
  if (min !== null && d.lt(min)) E(422, `${field}: debe ser mayor o igual a ${min}`)
  if (max !== null && d.gt(max)) E(422, `${field}: debe ser menor o igual a ${max}`)
  return d
}
export const text = (v: unknown, field: string, min: number, max: number, optional = false): string | null => {
  if (v === null || v === undefined || v === '') { if (optional) return null; return E(422, `${field}: es obligatorio`) }
  const s = String(v)
  if (s.length < min) E(422, `${field}: debe tener al menos ${min} caracteres`)
  if (s.length > max) E(422, `${field}: máximo ${max} caracteres`)
  return s
}
export const slugify = (t: string) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'erp'
export const localDay = (iso: string, tz: string) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) }
  catch { return iso.slice(0, 10) }
}
