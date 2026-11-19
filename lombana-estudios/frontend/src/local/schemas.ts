// Validación de configuración y marca (port de backend/app/erp_generator/schemas.py y catalog.py).
import { FormulaError, validate as validateFormula } from './formula'

export class ValidationError extends Error {}
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/
const HEX_RE = /^#[0-9a-fA-F]{6}$/
export const FONTS = ['Inter', 'Poppins', 'Montserrat', 'Roboto', 'Lato', 'Playfair Display', 'Source Sans 3', 'system-ui']
const MAX_IMAGE_BYTES = 400_000

type M = { key: string; name: string; icon: string; operational: boolean; core?: boolean; depends?: string[] }
export const MODULES: M[] = [
  { key: 'dashboard', name: 'Dashboard', icon: 'gauge', operational: true, core: true },
  { key: 'clientes', name: 'Clientes / CRM', icon: 'users', operational: true },
  { key: 'proveedores', name: 'Proveedores', icon: 'truck', operational: true },
  { key: 'productos', name: 'Productos y servicios', icon: 'package', operational: true },
  { key: 'ventas', name: 'Ventas', icon: 'receipt', operational: true, depends: ['productos', 'clientes'] },
  { key: 'inventario', name: 'Inventario', icon: 'boxes', operational: true, depends: ['productos'] },
  { key: 'registros', name: 'Registros personalizados', icon: 'table', operational: true },
  { key: 'reportes', name: 'Reportes', icon: 'chart', operational: true },
  { key: 'usuarios', name: 'Usuarios y roles', icon: 'shield', operational: true, core: true },
  { key: 'auditoria', name: 'Auditoría', icon: 'history', operational: true, core: true },
  { key: 'caja', name: 'Caja y gastos', icon: 'wallet', operational: true },
  { key: 'compras', name: 'Compras', icon: 'cart', operational: true, depends: ['productos', 'proveedores'] },
  { key: 'automatizaciones', name: 'Automatizaciones y alertas', icon: 'zap', operational: true },
  { key: 'asistente', name: 'Asistente IA', icon: 'sparkles', operational: true },
  ...([['bancos', 'Bancos', 'bank'], ['contabilidad', 'Contabilidad', 'book'],
    ['cxc', 'Cuentas por cobrar', 'arrow-down'], ['cxp', 'Cuentas por pagar', 'arrow-up'], ['presupuestos', 'Presupuestos', 'target'],
    ['nomina', 'Nómina', 'id'], ['rrhh', 'Recursos humanos', 'user-check'], ['activos', 'Activos fijos', 'building'],
    ['facturacion_electronica', 'Facturación electrónica', 'file']] as const)
    .map(([key, name, icon]) => ({ key, name, icon, operational: false })),
]
/** Módulos pro que se activan por defecto en los ERP nuevos creados dentro de Claude. */
export const PRO_DEFAULTS = (tplModules: string[]) => [
  ...(tplModules.includes('ventas') ? ['caja'] : []), ...(tplModules.includes('proveedores') ? ['compras'] : []), 'automatizaciones', 'asistente']
export const allPermissions = (mods: string[]) => mods.flatMap(m => ['ver', 'crear', 'editar', 'eliminar'].map(a => `${m}:${a}`))

const sectorFiles = import.meta.glob('../../../templates/sectores/*.json', { eager: true, import: 'default' }) as Record<string, Sector>
export type Sector = { code: string; name: string; short?: string; order?: number; icon: string; description: string; operation_type: string
  modules: string[]; labels: Record<string, string>; entities: unknown[]; kpis: string[]; branding: Record<string, string> }
export const SECTORS: Sector[] = Object.values(sectorFiles).sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
export const sector = (code: string) => SECTORS.find(s => s.code === code)

const fail = (m: string): never => { throw new ValidationError(m) }
const str = (v: unknown, field: string, min: number, max: number, def?: string): string => {
  if (v === undefined || v === null) { if (def !== undefined) return def; fail(`${field}: es obligatorio`) }
  if (typeof v !== 'string') fail(`${field}: debe ser texto`)
  const s = v as string
  if (s.length < min) fail(`${field}: debe tener al menos ${min} caracteres`)
  if (s.length > max) fail(`${field}: máximo ${max} caracteres`)
  return s
}
const key = (v: unknown, field: string) => { const s = str(v, field, 1, 40); if (!KEY_RE.test(s)) fail(`${field}: clave inválida: usa minúsculas, números y guion bajo, empezando por letra`); return s }
const oneOf = <T extends string>(v: unknown, field: string, opts: readonly T[], def: T): T => {
  if (v === undefined || v === null) return def
  if (!opts.includes(v as T)) fail(`${field}: valor no permitido`)
  return v as T
}

export function validateConfig(raw: unknown) {
  const c = (raw ?? {}) as Record<string, unknown>
  const co = (c.company ?? fail('company: es obligatorio')) as Record<string, unknown>
  const company = {
    name: str(co.name, 'company.name', 2, 160), sector: str(co.sector, 'company.sector', 2, 40),
    activity: str(co.activity, 'company.activity', 0, 200, ''), size: oneOf(co.size, 'company.size', ['micro', 'pequeña', 'mediana', 'grande'] as const, 'micro'),
    country: str(co.country, 'company.country', 0, 60, 'Colombia'), currency: str(co.currency, 'company.currency', 3, 3, 'COP'),
    language: oneOf(co.language, 'company.language', ['es', 'en', 'pt'] as const, 'es'), timezone: str(co.timezone, 'company.timezone', 1, 60, 'America/Bogota'),
    operation_type: oneOf(co.operation_type, 'company.operation_type', ['productos', 'servicios', 'mixta'] as const, 'mixta'),
  }
  if (!/^[A-Z]{3}$/.test(company.currency)) fail('company.currency: usa un código de 3 letras (COP, USD…)')
  const known = Object.fromEntries(MODULES.map(m => [m.key, m]))
  const modules = ((c.modules ?? []) as Record<string, unknown>[]).map(m => ({
    key: str(m.key, 'module.key', 1, 40), enabled: m.enabled !== false, label: str(m.label, 'module.label', 1, 60), order: Number(m.order ?? 0),
  }))
  const seen = new Set<string>()
  for (const m of modules) {
    if (!known[m.key]) fail(`Módulo desconocido: ${m.key}`)
    if (seen.has(m.key)) fail(`Módulo repetido: ${m.key}`)
    seen.add(m.key)
    if (m.enabled && !known[m.key].operational) fail(`El módulo '${known[m.key].name}' aún no está disponible en el runtime`)
  }
  const enabled = new Set(modules.filter(m => m.enabled).map(m => m.key))
  for (const m of modules) if (m.enabled) for (const d of known[m.key].depends ?? []) if (!enabled.has(d)) fail(`El módulo '${m.label}' requiere activar '${known[d].name}'`)

  const ents = (c.entities ?? []) as Record<string, unknown>[]
  if (ents.length > 30) fail('Máximo 30 entidades')
  const entities = ents.map(e => {
    const ek = key(e.key, 'entity.key')
    const fields = ((e.fields ?? []) as Record<string, unknown>[]).map(f => {
      const fk = key(f.key, `${ek}.campo`)
      const type = oneOf(f.type, `${ek}.${fk}.tipo`, ['text', 'number', 'money', 'date', 'select', 'checkbox', 'relation', 'calculated'] as const, 'text')
      const options = (Array.isArray(f.options) ? f.options : []).map(String)
      if (options.length > 50) fail(`${fk}: máximo 50 opciones`)
      const out = { key: fk, label: str(f.label, `${ek}.${fk}.etiqueta`, 1, 60), type, required: !!f.required, options,
        relation: (f.relation as string) || null, formula: (f.formula as string) || null,
        min: f.min === null || f.min === undefined || f.min === '' ? null : Number(f.min),
        max: f.max === null || f.max === undefined || f.max === '' ? null : Number(f.max),
        max_length: f.max_length ? Number(f.max_length) : null }
      if (type === 'select' && !options.length) fail(`El campo '${fk}' es una lista y necesita opciones`)
      if (type === 'relation' && !out.relation) fail(`El campo '${fk}' es relación y necesita indicar la entidad`)
      if (type === 'calculated' && !out.formula) fail(`El campo '${fk}' es calculado y necesita una fórmula`)
      return out
    })
    if (!fields.length) fail(`La entidad '${ek}' necesita al menos un campo`)
    if (fields.length > 40) fail(`La entidad '${ek}' tiene demasiados campos`)
    if (new Set(fields.map(f => f.key)).size !== fields.length) fail(`Campos duplicados en la entidad '${ek}'`)
    const numeric = fields.filter(f => f.type === 'number' || f.type === 'money').map(f => f.key)
    for (const f of fields) if (f.type === 'calculated') {
      try { validateFormula(f.formula!, numeric) } catch (er) { if (er instanceof FormulaError) fail(`Fórmula del campo '${f.key}': ${er.message}`); throw er }
    }
    return { key: ek, label: str(e.label, `${ek}.etiqueta`, 1, 60), fields }
  })
  const ekeys = entities.map(e => e.key)
  if (new Set(ekeys).size !== ekeys.length) fail('Hay entidades con la misma clave')
  const validRel = new Set(['customers', 'products', 'suppliers', ...ekeys])
  for (const e of entities) for (const f of e.fields) if (f.type === 'relation' && !validRel.has(f.relation!)) fail(`Relación inválida en ${e.key}.${f.key}: ${f.relation}`)
  return { company, modules, entities, kpis: ((c.kpis ?? []) as unknown[]).map(String) }
}

export const DEFAULT_BRANDING = {
  software_name: 'Mi ERP', company_name: '', slogan: '', logo: null as string | null, favicon: null as string | null, login_image: null as string | null,
  primary: '#2563EB', secondary: '#0F172A', button: '#2563EB', background: '#F8FAFC', surface: '#FFFFFF', text: '#0F172A', font: 'Inter',
  theme: 'claro', welcome_title: 'Bienvenido', welcome_text: '', contact_email: '', contact_phone: '', contact_address: '',
  document_footer: '', invoice_template: 'moderna',
}

export function validateBranding(raw: unknown) {
  const b = { ...DEFAULT_BRANDING, ...((raw ?? {}) as Record<string, unknown>) } as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const lim: Record<string, [number, number]> = { software_name: [1, 60], company_name: [0, 120], slogan: [0, 160], welcome_title: [0, 80], welcome_text: [0, 300],
    contact_email: [0, 160], contact_phone: [0, 40], contact_address: [0, 200], document_footer: [0, 300] }
  for (const [k, [mn, mx]] of Object.entries(lim)) out[k] = str(b[k], k, mn, mx)
  for (const k of ['primary', 'secondary', 'button', 'background', 'surface', 'text']) {
    if (typeof b[k] !== 'string' || !HEX_RE.test(b[k] as string)) fail(`${k}: Color inválido: usa formato #RRGGBB`)
    out[k] = (b[k] as string).toUpperCase()
  }
  if (!FONTS.includes(b.font as string)) fail(`font: Tipografía no soportada. Opciones: ${FONTS.join(', ')}`)
  out.font = b.font
  out.theme = oneOf(b.theme, 'theme', ['claro', 'oscuro'] as const, 'claro')
  out.invoice_template = oneOf(b.invoice_template, 'invoice_template', ['clasica', 'moderna', 'minimal'] as const, 'moderna')
  for (const k of ['logo', 'favicon', 'login_image']) {
    const v = b[k]
    if (v === null || v === undefined || v === '') { out[k] = null; continue }
    if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) fail(`${k}: La imagen debe ser PNG, JPG o WEBP`)
    if ((v as string).length * 3 / 4 > MAX_IMAGE_BYTES) fail(`${k}: La imagen supera 400 KB`)
    out[k] = v
  }
  // Dentro de Claude cada registro de la base admite 256 KB: las tres imágenes juntas deben ser livianas
  const imgChars = ['logo', 'favicon', 'login_image'].reduce((n, k) => n + ((out[k] as string | null)?.length ?? 0), 0)
  if (imgChars > 160_000) fail('Las imágenes de la marca suman más de 120 KB. Usa versiones más livianas (por ejemplo PNG/WEBP de 400 px). En Claude cada registro admite máximo 256 KB.')
  return out
}
