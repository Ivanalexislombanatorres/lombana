// API local de LOMBANA ESTUDIOS: implementa en el navegador las mismas rutas /api/... del servidor FastAPI,
// guardando todo en la base de datos del artifact. Cada ERP vive en su propio espacio de colecciones t/<id>/...
import { D, FormulaError, catalog, evaluate, fmt, validate, type Dec } from './formula'
import { DEFAULT_BRANDING, FONTS, MODULES, SECTORS, ValidationError, allPermissions, sector, validateBranding, validateConfig } from './schemas'
import { hashPassword, randomToken, readToken, signToken, verifyPassword } from './crypto'
import { Store, type Doc } from './store'

export class HttpError extends Error {
  status: number
  constructor(status: number, msg: string) { super(msg); this.status = status }
}
// declarada como función para que TypeScript entienda que corta el flujo (never)
function E(status: number, msg: string): never { throw new HttpError(status, msg) }

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const nowIso = () => new Date().toISOString()
const M4 = (x: Dec | string | number) => new D(x).toFixed(4)
const num = (v: unknown, field: string, { min = 0 as number | null, max = null as number | null } = {}): Dec => {
  let d: Dec
  try { d = new D(String(v ?? '')); if (!d.isFinite()) throw 0 } catch { return E(422, `${field}: número inválido`) }
  if (min !== null && d.lt(min)) E(422, `${field}: debe ser mayor o igual a ${min}`)
  if (max !== null && d.gt(max)) E(422, `${field}: debe ser menor o igual a ${max}`)
  return d
}
const text = (v: unknown, field: string, min: number, max: number, optional = false): string | null => {
  if (v === null || v === undefined || v === '') { if (optional) return null; return E(422, `${field}: es obligatorio`) }
  const s = String(v)
  if (s.length < min) E(422, `${field}: debe tener al menos ${min} caracteres`)
  if (s.length > max) E(422, `${field}: máximo ${max} caracteres`)
  return s
}
const slugify = (t: string) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'erp'
const localDay = (iso: string, tz: string) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) }
  catch { return iso.slice(0, 10) }
}
const SCHEMA_REV = 'artifact_v1'
const TENANT_COLS = ['roles', 'users', 'customers', 'suppliers', 'products', 'sales', 'movements', 'records', 'settings']
const DEFAULT_ROLES: Record<string, string[]> = {
  Administrador: ['*'],
  Vendedor: ['dashboard:ver', 'clientes:ver', 'clientes:crear', 'clientes:editar', 'productos:ver', 'ventas:ver', 'ventas:crear', 'registros:ver', 'registros:crear', 'registros:editar'],
  Consulta: ['*:ver'],
}

export type Sampler = ((input: string, opts?: Any) => Promise<{ text: string }>) | null

export class LocalApi {
  private secret = ''
  private fails = new Map<string, number[]>()
  store: Store
  private sampler: () => Promise<Sampler>
  private ownerName: string
  constructor(store: Store, sampler: () => Promise<Sampler>, ownerName = 'Propietario') { this.store = store; this.sampler = sampler; this.ownerName = ownerName }

  async init() {
    await Promise.all(['meta', 'clients', 'plans', 'erps', 'erp_versions', 'brand_templates', 'licenses', 'installations', 'formulas',
      'ai_providers', 'ai_routes', 'factory_backups'].map(c => this.store.load(c)))
    let s = this.store.get<Any>('meta', 'secret')
    if (!s) { s = { value: randomToken(48) }; await this.store.put('meta', 'secret', s) }
    this.secret = s.value
    if (!this.store.all('plans').length) {
      for (const [i, [code, name, price, users, mb, mods]] of ([['basico', 'Básico', '29', 3, 500, 6], ['profesional', 'Profesional', '59', 10, 2000, 12], ['empresarial', 'Empresarial', '119', 50, 10000, 30]] as const).entries())
        await this.store.put('plans', i + 1, { id: i + 1, code, name, price_monthly: M4(price), currency: 'USD', max_users: users, max_storage_mb: mb, max_modules: mods })
    }
  }

  // ---------------------------------------------------------------- utilidades
  private async audit(actor: string, action: string, entity: string, entityId: unknown = null, detail: Any = {}, tenant?: number) {
    const col = tenant ? `t/${tenant}/meta` : 'meta'
    await this.store.load(col)
    const doc = this.store.get<Any>(col, 'audit') ?? { items: [] }
    const items = [{ id: (doc.items[0]?.id ?? 0) + 1, actor, action, entity, entity_id: entityId === null ? null : String(entityId), detail, created_at: nowIso() }, ...doc.items].slice(0, 300)
    await this.store.put(col, 'audit', { items })
  }
  private async install(erpId: number | null, action: string, detail: string) {
    const id = this.store.nextId('installations')
    await this.store.put('installations', id, { id, erp_id: erpId, action, detail, created_at: nowIso() })
  }
  private async tenant(erpId: number) { await Promise.all([...TENANT_COLS, 'meta', 'backups'].map(c => this.store.load(`t/${erpId}/${c}`))) }
  private T = (erpId: number, c: string) => `t/${erpId}/${c}`

  private erpOut(e: Any, full = false) {
    const client = e.client_id ? this.store.get<Any>('clients', e.client_id) : null
    const out: Any = { id: e.id, slug: e.slug, name: e.name, sector: e.sector, status: e.status, db_name: e.db_name, db_engine: 'artifact',
      client_id: e.client_id, client_name: client?.name ?? null, current_version: e.current_version, published_version: e.published_version,
      software_name: e.branding.software_name, primary: e.branding.primary, modules: e.config.modules.filter((m: Any) => m.enabled).map((m: Any) => m.key),
      created_at: e.created_at, updated_at: e.updated_at }
    if (full) { out.config = e.config; out.branding = e.branding }
    return out
  }
  private getErp(id: unknown) { return this.store.get<Any>('erps', String(id)) ?? E(404, 'ERP no encontrado') }
  private versions(erpId: number) { return this.store.all<Any>('erp_versions').filter(v => v.erp_id === erpId).sort((a, b) => a.version - b.version) }
  private wrap<T>(fn: () => T): T {
    try { return fn() } catch (e) { if (e instanceof ValidationError || e instanceof FormulaError) E(422, e.message); throw e }
  }

  // ---------------------------------------------------------------- ERP generator
  private configFromSector(code: string, company: Any, modules?: string[] | null) {
    const tpl = sector(code)!
    const chosen = modules ?? tpl.modules
    const keys = [...new Set([...MODULES.filter(m => m.core).map(m => m.key), ...chosen])]
    const names = Object.fromEntries(MODULES.map(m => [m.key, m.name]))
    return { company: { sector: code, operation_type: tpl.operation_type ?? 'mixta', ...company },
      modules: keys.map((k, i) => ({ key: k, enabled: true, label: tpl.labels[k] ?? names[k] ?? k, order: i })), entities: tpl.entities, kpis: tpl.kpis }
  }

  private async createErp(o: { name: string; config: Any; branding: Any; adminUser: string; adminName: string; adminPassword: string; clientId: number | null }) {
    const cfg = this.wrap(() => validateConfig(o.config))
    const brd = this.wrap(() => validateBranding(o.branding))
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(o.adminUser)) E(422, 'Usuario administrador inválido (3-40 letras, números, . _ -)')
    if (o.adminPassword.length < 8) E(422, 'admin_password: La contraseña debe tener al menos 8 caracteres')
    const base = cfg.company.sector.replace(/[^a-z0-9]/g, '').slice(0, 20) || 'erp'
    const names = new Set(this.store.all<Any>('erps').map(e => e.db_name))
    let n = 1
    while (names.has(`erp_${base}_${String(n).padStart(3, '0')}`)) n++
    const dbName = `erp_${base}_${String(n).padStart(3, '0')}`
    const slugs = new Set(this.store.all<Any>('erps').map(e => e.slug))
    let slug = slugify(o.name), k = 2
    while (slugs.has(slug)) slug = `${slugify(o.name)}-${k++}`
    const id = this.store.nextId('erps')
    const ts = nowIso()
    await this.tenant(id)
    // si quedaron restos de un ERP borrado con el mismo id, se limpian
    for (const c of TENANT_COLS) for (const d of this.store.all<Any>(this.T(id, c))) await this.store.del(this.T(id, c), d.id ?? d.key)
    const pw = await hashPassword(o.adminPassword)
    let rid = 1
    for (const [name, perms] of Object.entries(DEFAULT_ROLES)) await this.store.put(this.T(id, 'roles'), rid, { id: rid++, name, permissions: perms })
    await this.store.put(this.T(id, 'users'), 1, { id: 1, username: o.adminUser.toLowerCase(), name: o.adminName, password_hash: pw, role_id: 1, is_active: true, created_at: ts })
    await this.store.put(this.T(id, 'settings'), 'config', { key: 'config', value: cfg })
    await this.store.put(this.T(id, 'settings'), 'branding', { key: 'branding', value: brd })
    await this.store.put(this.T(id, 'meta'), 'audit', { items: [] })
    const erp = { id, slug, name: o.name, sector: cfg.company.sector, client_id: o.clientId, status: 'borrador', db_name: dbName, config: cfg, branding: brd,
      current_version: 1, published_version: null, created_at: ts, updated_at: ts }
    await this.store.put('erp_versions', `${id}-1`, { erp_id: id, version: 1, config: cfg, branding: brd, note: 'Versión inicial', created_by: this.ownerName, created_at: ts })
    await this.store.put('erps', id, erp)
    await this.audit('sistema', 'crear_erp', 'erp', null, { db: dbName }, id)
    await this.install(id, 'creado', `Espacio ${dbName} creado en la base del artifact`)
    return erp
  }

  private async saveVersion(e: Any, config: Any | null, branding: Any | null, note: string) {
    const cfg = this.wrap(() => validateConfig(config ?? e.config))
    const brd = this.wrap(() => validateBranding(branding ?? e.branding))
    e.current_version += 1
    e.config = cfg; e.branding = brd; e.updated_at = nowIso()
    await this.store.put('erp_versions', `${e.id}-${e.current_version}`, { erp_id: e.id, version: e.current_version, config: cfg, branding: brd, note, created_by: this.ownerName, created_at: nowIso() })
    await this.store.put('erps', e.id, e)
  }

  private async publish(e: Any, version?: number | null) {
    const v = version || e.current_version
    const ver = this.versions(e.id).find(x => x.version === v) ?? E(422, 'Versión inexistente')
    this.wrap(() => { validateConfig(ver.config); validateBranding(ver.branding) })
    await this.tenant(e.id)
    await this.store.put(this.T(e.id, 'settings'), 'config', { key: 'config', value: ver.config })
    await this.store.put(this.T(e.id, 'settings'), 'branding', { key: 'branding', value: ver.branding })
    await this.audit(this.ownerName, 'publicar', 'erp', null, { version: v }, e.id)
    e.published_version = v
    if (e.status === 'borrador') e.status = 'activo'
    e.updated_at = nowIso()
    await this.store.put('erps', e.id, e)
    await this.install(e.id, 'publicado', `Versión ${v} publicada`)
  }

  // ---------------------------------------------------------------- respaldos
  private async snapshot(erpId: number) {
    await this.tenant(erpId)
    const tables: Any = {}
    for (const c of TENANT_COLS) tables[c] = this.store.all(this.T(erpId, c))
    return { db_name: this.getErp(erpId).db_name, kind: 'tenant', revision: SCHEMA_REV, created_at: nowIso(), tables }
  }
  private async backup(erpId: number) {
    const payload = JSON.stringify(await this.snapshot(erpId))
    if (new TextEncoder().encode(payload).length > 240_000) E(422, 'Este ERP tiene demasiados datos para un respaldo dentro del artifact (máx. 250 KB). Usa la versión de servidor para respaldos grandes.')
    const name = `${this.getErp(erpId).db_name}_${new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '')}_${randomToken(3)}.json`
    await this.store.put(this.T(erpId, 'backups'), name.replace(/[^A-Za-z0-9_.-]/g, ''), { file: name, size: payload.length, created_at: nowIso(), payload })
    return name
  }
  private async restore(erpId: number, file: string) {
    await this.tenant(erpId)
    const b = this.store.all<Any>(this.T(erpId, 'backups')).find(x => x.file === file) ?? E(422, 'No se pudo restaurar: archivo de respaldo inexistente')
    const payload = JSON.parse(b.payload)
    if (payload.db_name !== this.getErp(erpId).db_name) E(422, 'No se pudo restaurar: el respaldo no pertenece a esta base de datos')
    if (payload.revision !== SCHEMA_REV) E(422, 'No se pudo restaurar: la versión de esquema no coincide')
    const safety = await this.backup(erpId)
    const counts: Any = {}
    for (const c of TENANT_COLS) {
      const col = this.T(erpId, c)
      const rows: Any[] = payload.tables[c] ?? []
      const keep = new Set(rows.map(r => String(r.id ?? r.key)))
      for (const d of this.store.all<Any>(col)) if (!keep.has(String(d.id ?? d.key))) await this.store.del(col, d.id ?? d.key)
      for (const r of rows) await this.store.put(col, r.id ?? r.key, r)
      counts[c] = rows.length
    }
    return { restored: counts, safety_backup: safety }
  }

  // ---------------------------------------------------------------- sesiones del runtime
  private erpBySlug(slug: string, check = true) {
    const e = this.store.all<Any>('erps').find(x => x.slug === slug) ?? E(404, 'ERP no encontrado')
    if (check) {
      if (!e.published_version) E(409, 'Este ERP aún no ha sido publicado')
      if (e.status === 'suspendido' || e.status === 'archivado') E(423, `Este ERP está ${e.status}. Contacta al proveedor del software.`)
    }
    return e
  }
  private async ctx(slug: string, token: string | null) {
    const e = this.erpBySlug(slug)
    const p = await readToken(this.secret, token)
    if (!p) E(401, 'Sesión requerida')
    if (p!.scope !== `erp:${slug}`) E(403, 'La sesión no pertenece a este ERP')
    await this.tenant(e.id)
    const user = this.store.get<Any>(this.T(e.id, 'users'), String(p!.sub))
    if (!user || !user.is_active) E(401, 'Usuario inactivo')
    const role = this.store.get<Any>(this.T(e.id, 'roles'), user.role_id)
    const config = this.store.get<Any>(this.T(e.id, 'settings'), 'config')?.value ?? {}
    const branding = this.store.get<Any>(this.T(e.id, 'settings'), 'branding')?.value ?? {}
    const enabled = new Set<string>((config.modules ?? []).filter((m: Any) => m.enabled).map((m: Any) => m.key))
    const perms: string[] = role?.permissions ?? []
    const can = (perm: string) => {
      const [mod, act] = perm.split(':')
      return enabled.has(mod) && (perms.includes('*') || perms.includes(perm) || perms.includes(`*:${act}`) || perms.includes(`${mod}:*`))
    }
    const tz = config.company?.timezone || 'UTC'
    return { e, user, role, config, branding, can, perms, tz,
      require: (perm: string) => { if (!can(perm)) E(403, `No tienes permiso: ${perm}`) },
      log: (action: string, entity: string, id: unknown = null, detail: Any = {}) => this.audit(user.username, action, entity, id, detail, e.id),
      col: (c: string) => this.T(e.id, c) }
  }
  private limiter(key: string) {
    const now = Date.now()
    const arr = (this.fails.get(key) ?? []).filter(t => now - t < 300_000)
    this.fails.set(key, arr)
    if (arr.length >= 5) E(429, 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo.')
    return { fail: () => arr.push(now), ok: () => this.fails.delete(key) }
  }

  // ---------------------------------------------------------------- IA (Claude integrado)
  private aiDoc() { return this.store.get<Any>('meta', 'ai_requests') ?? { items: [] } }
  private async runChat(task: string, instructions: string, prompt: string) {
    const prov = this.store.all<Any>('ai_providers').find(p => p.enabled) ?? E(409, 'No hay un proveedor de IA activo para esta tarea. Configúralo en AI Gateway.')
    const month = new Date().toISOString().slice(0, 7)
    const used = this.aiDoc().items.filter((r: Any) => r.created_at.startsWith(month)).length
    if (used >= prov.monthly_limit_requests) E(429, `Se alcanzó el límite mensual de solicitudes de ${prov.name}`)
    const sample = await this.sampler()
    if (!sample) E(502, 'Claude no está disponible en esta vista del artifact')
    const t0 = performance.now()
    const log = async (ok: boolean, error: string | null, chars = 0) => {
      const d = this.aiDoc()
      d.items = [{ id: (d.items[0]?.id ?? 0) + 1, provider: prov.name, model: 'Claude (integrado)', task, ok, latency_ms: Math.round(performance.now() - t0),
        tokens_in: Math.round(prompt.length / 4), tokens_out: Math.round(chars / 4), error, created_at: nowIso() }, ...d.items].slice(0, 200)
      await this.store.put('meta', 'ai_requests', d)
    }
    try {
      const r = await sample!(`${instructions}\n\n${prompt}`, { cache: false })
      await log(true, null, r.text.length)
      return { provider: prov.name, model: 'Claude (integrado)', text: r.text, tokens_in: Math.round(prompt.length / 4), tokens_out: Math.round(r.text.length / 4), latency_ms: Math.round(performance.now() - t0) }
    } catch (e) {
      const msg = (e as Any)?.code === 'not_granted' ? 'No diste permiso para consultar a Claude desde esta página' : (e as Any)?.message ?? 'Error de IA'
      await log(false, msg)
      return E(502, `${prov.name}: ${msg}`)
    }
  }
  private providerOut(p: Any) {
    const month = new Date().toISOString().slice(0, 7)
    const items = this.aiDoc().items.filter((r: Any) => r.created_at.startsWith(month))
    return { ...p, has_key: false, key_hint: null, requests_this_month: items.length,
      tokens_in_month: items.reduce((s: number, r: Any) => s + r.tokens_in, 0), tokens_out_month: items.reduce((s: number, r: Any) => s + r.tokens_out, 0) }
  }
  private agentContext(code: string, erpId: number) {
    const t = (c: string) => this.store.all<Any>(this.T(erpId, c))
    const since = Date.now() - 90 * 86400_000
    const sales = t('sales').filter(s => s.status === 'confirmada' && Date.parse(s.created_at) >= since)
    const pname = Object.fromEntries(t('products').map(p => [p.id, p.name]))
    const cname = Object.fromEntries(t('customers').map(c => [c.id, c.name]))
    const sum = (a: Dec[]) => a.reduce((s, x) => s.plus(x), new D(0))
    const TOOLS: Record<string, () => Any> = {
      resumen_ventas: () => {
        const byMonth: Record<string, Dec> = {}, byProd: Record<string, Dec> = {}
        for (const s of sales) { const m = s.created_at.slice(0, 7); byMonth[m] = (byMonth[m] ?? new D(0)).plus(s.total); for (const it of s.items) byProd[pname[it.product_id] ?? '?'] = (byProd[pname[it.product_id] ?? '?'] ?? new D(0)).plus(it.line_total) }
        return { ventas_90_dias: sales.length, total_90_dias: sum(sales.map(s => new D(s.total))).toFixed(), por_mes: Object.fromEntries(Object.entries(byMonth).map(([k, v]) => [k, v.toFixed()])),
          top_productos: Object.fromEntries(Object.entries(byProd).sort((a, b) => b[1].cmp(a[1])).slice(0, 10).map(([k, v]) => [k, v.toFixed()])) }
      },
      inventario: () => { const ps = t('products').filter(p => p.kind === 'producto'); return { productos: ps.length,
        stock_bajo: ps.filter(p => new D(p.stock).lte(p.min_stock)).slice(0, 30).map(p => ({ producto: p.name, stock: p.stock, minimo: p.min_stock })),
        valor_inventario_costo: sum(ps.map(p => new D(p.stock).times(p.cost))).toFixed() } },
      clientes: () => { const by: Record<string, Dec> = {}; for (const s of t('sales')) if (s.status === 'confirmada' && s.customer_id) by[cname[s.customer_id] ?? '?'] = (by[cname[s.customer_id] ?? '?'] ?? new D(0)).plus(s.total)
        return { clientes: t('customers').length, mejores_clientes: Object.fromEntries(Object.entries(by).sort((a, b) => b[1].cmp(a[1])).slice(0, 10).map(([k, v]) => [k, v.toFixed()])) } },
      registros: () => { const c: Record<string, number> = {}; for (const r of t('records')) c[r.entity] = (c[r.entity] ?? 0) + 1
        return { entidades: c, empresa: this.store.get<Any>(this.T(erpId, 'settings'), 'config')?.value?.company ?? {} } },
    }
    const [name, objective, tools] = AGENTS[code]
    return { instructions: `${BASE_RULES}\nRol: ${name}. Objetivo: ${objective}`, context: Object.fromEntries(tools.map(x => [x, TOOLS[x]()])) }
  }

  // ---------------------------------------------------------------- enrutador
  async handle(method: string, url: string, body: Any, token: string | null): Promise<unknown> {
    const [path, qs] = url.split('?')
    const q = Object.fromEntries(new URLSearchParams(qs ?? ''))
    const m = (re: RegExp) => path.match(re)
    let r: RegExpMatchArray | null
    const b = body ?? {}
    const owner = this.ownerName

    if ((r = m(/^\/api\/rt\/([a-z0-9-]+)(\/.*)?$/))) return this.runtime(method, r[1], r[2] ?? '', q, b, token)

    // --- fábrica (el artifact es privado del propietario: no hay login de fábrica)
    if (path === '/api/health') return { status: 'ok', db_engine: 'artifact', factory_revision: SCHEMA_REV, factory_head: SCHEMA_REV, tenant_head: SCHEMA_REV }
    if (path === '/api/auth/setup-status') return { needs_setup: false, requires_code: false }
    if (path === '/api/auth/me') return { name: owner, email: 'Propietario del artifact' }
    if (path === '/api/catalog/modules') return MODULES
    if (path === '/api/catalog/sectors') return SECTORS
    if (path === '/api/catalog/fonts') return FONTS

    if (path === '/api/dashboard') {
      const erps = this.store.all<Any>('erps'), lics = this.store.all<Any>('licenses'), active = lics.filter(l => l.status === 'activa')
      const today = new Date(), in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
      const months: string[] = []
      for (let i = 5; i >= 0; i--) { const d = new Date(today.getFullYear(), today.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
      const monthly = (l: Any) => (l.billing_cycle === 'anual' ? new D(l.amount).div(12) : new D(l.amount))
      return {
        erps_total: erps.length, erps_activos: erps.filter(e => e.status === 'activo').length, clientes: this.store.all('clients').length, plantillas: SECTORS.length,
        proveedores_ia_activos: this.store.all<Any>('ai_providers').filter(p => p.enabled).length, licencias_activas: active.length,
        pagos_al_dia: active.filter(l => l.payment_status === 'al_dia').length, renovaciones_30_dias: active.filter(l => l.renewal_date <= in30).length,
        ingresos_recurrentes_mes: active.reduce((s, l) => s.plus(monthly(l)), new D(0)).toFixed(2),
        por_sector: SECTORS.map(s => ({ code: s.code, name: s.name, short: s.short ?? s.name, icon: s.icon, count: erps.filter(e => e.sector === s.code).length })),
        creados_por_mes: months.map(mm => ({ mes: mm, cantidad: erps.filter(e => e.created_at.slice(0, 7) === mm).length })),
        recientes: [...erps].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6).map(e => this.erpOut(e)),
      }
    }

    // --- ERPs
    if (path === '/api/erps' && method === 'GET') return [...this.store.all<Any>('erps')].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(e => this.erpOut(e))
    if (path === '/api/erps' && method === 'POST') {
      text(b.name, 'name', 2, 160)
      if (!sector(b.sector)) E(422, 'Sector desconocido')
      if (b.client_id != null && !this.store.get('clients', b.client_id)) E(422, 'Cliente inexistente')
      const config = b.config ?? this.configFromSector(b.sector, b.company ?? {}, b.modules)
      config.company = { ...(config.company ?? {}), sector: b.sector }
      const tpl = sector(b.sector)!
      const branding = b.branding ?? { ...DEFAULT_BRANDING, ...tpl.branding, software_name: b.name, company_name: b.company?.name ?? '' }
      const erp = await this.createErp({ name: b.name, config, branding, adminUser: b.admin_user ?? 'admin', adminName: b.admin_name ?? 'Administrador',
        adminPassword: b.admin_password ?? '', clientId: b.client_id ?? null })
      if (b.publish !== false) await this.publish(erp)
      await this.audit(owner, 'crear_erp', 'erp', erp.id, { db: erp.db_name })
      return this.erpOut(erp, true)
    }
    if ((r = m(/^\/api\/erps\/(\d+)$/))) return this.erpOut(this.getErp(r[1]), true)
    if ((r = m(/^\/api\/erps\/(\d+)\/config$/))) { const e = this.getErp(r[1]); await this.saveVersion(e, b.config, null, b.note ?? 'Cambio de configuración'); await this.audit(owner, 'editar_config', 'erp', e.id, { version: e.current_version }); return this.erpOut(e, true) }
    if ((r = m(/^\/api\/erps\/(\d+)\/branding$/))) {
      const e = this.getErp(r[1]); await this.saveVersion(e, null, b.branding, b.note ?? 'Cambio de marca')
      if (b.publish) await this.publish(e)
      await this.audit(owner, 'editar_marca', 'erp', e.id, { version: e.current_version }); return this.erpOut(e, true)
    }
    if ((r = m(/^\/api\/erps\/(\d+)\/publish$/))) { const e = this.getErp(r[1]); await this.publish(e, b.version); await this.audit(owner, 'publicar', 'erp', e.id, { version: e.published_version }); return this.erpOut(e, true) }
    if ((r = m(/^\/api\/erps\/(\d+)\/versions$/))) { const e = this.getErp(r[1]); return this.versions(e.id).reverse().map(v => ({ version: v.version, note: v.note, created_by: v.created_by, created_at: v.created_at, published: v.version === e.published_version })) }
    if ((r = m(/^\/api\/erps\/(\d+)\/versions\/(\d+)\/restore$/))) {
      const e = this.getErp(r[1]); const v = this.versions(e.id).find(x => x.version === Number(r![2])) ?? E(422, 'Versión inexistente')
      await this.saveVersion(e, v.config, v.branding, `Restaurada desde v${v.version}`); await this.audit(owner, 'restaurar_version', 'erp', e.id, { desde: v.version }); return this.erpOut(e, true)
    }
    if ((r = m(/^\/api\/erps\/(\d+)\/duplicate$/))) {
      const src = this.getErp(r[1]); text(b.name, 'name', 2, 160)
      const erp = await this.createErp({ name: b.name, config: src.config, branding: src.branding, adminUser: b.admin_user ?? 'admin', adminName: 'Administrador', adminPassword: b.admin_password ?? '', clientId: b.client_id ?? null })
      await this.publish(erp); await this.install(erp.id, 'duplicado', `Copia de configuración de ${src.slug} (sin datos)`); await this.audit(owner, 'duplicar_erp', 'erp', erp.id, { origen: src.id })
      return this.erpOut(erp, true)
    }
    if ((r = m(/^\/api\/erps\/(\d+)\/status$/))) {
      const e = this.getErp(r[1])
      if (!['activo', 'suspendido', 'archivado'].includes(b.status)) E(422, 'status: valor no permitido')
      if (b.status === 'activo' && !e.published_version) E(422, 'Publica una versión antes de activar el ERP')
      e.status = b.status; e.updated_at = nowIso(); await this.store.put('erps', e.id, e); await this.audit(owner, 'cambiar_estado', 'erp', e.id, { estado: b.status }); return this.erpOut(e)
    }
    if ((r = m(/^\/api\/erps\/(\d+)\/health$/))) {
      const e = this.getErp(r[1]); await this.tenant(e.id)
      return { ok: true, error: null, revision: SCHEMA_REV, head: SCHEMA_REV, pending_migrations: false,
        counts: Object.fromEntries(TENANT_COLS.filter(c => c !== 'settings').map(c => [c, this.store.all(this.T(e.id, c)).length])) }
    }
    if ((r = m(/^\/api\/erps\/(\d+)\/migrate$/))) return { revision: SCHEMA_REV }
    if ((r = m(/^\/api\/erps\/(\d+)\/backups$/))) {
      const e = this.getErp(r[1]); await this.tenant(e.id)
      if (method === 'POST') { const f = await this.backup(e.id); await this.install(e.id, 'respaldo', f); await this.audit(owner, 'respaldo', 'erp', e.id, { archivo: f }); return { file: f } }
      return this.store.all<Any>(this.T(e.id, 'backups')).sort((a, c) => c.created_at.localeCompare(a.created_at)).map(x => ({ file: x.file, size: x.size, created_at: x.created_at }))
    }
    if ((r = m(/^\/api\/erps\/(\d+)\/restore$/))) {
      const e = this.getErp(r[1]); const res = await this.restore(e.id, String(b.file ?? ''))
      await this.install(e.id, 'restaurado', `${b.file} (seguridad: ${res.safety_backup})`); await this.audit(owner, 'restaurar', 'erp', e.id, { archivo: b.file }); return res
    }
    if (path === '/api/databases') {
      const out: Any[] = [{ name: 'lombana_factory', kind: 'factory', erp_id: null, erp_name: 'Fábrica central', revision: SCHEMA_REV, head: SCHEMA_REV, backups: this.store.all('factory_backups').length }]
      for (const e of this.store.all<Any>('erps')) { await this.tenant(e.id); out.push({ name: e.db_name, kind: 'tenant', erp_id: e.id, erp_name: e.name, revision: SCHEMA_REV, head: SCHEMA_REV, backups: this.store.all(this.T(e.id, 'backups')).length }) }
      return { engine: 'artifact', databases: out }
    }
    if (path === '/api/databases/factory/backup') {
      const tables: Any = {}
      for (const c of ['clients', 'plans', 'erps', 'erp_versions', 'brand_templates', 'licenses', 'formulas']) tables[c] = this.store.all(c)
      const payload = JSON.stringify({ kind: 'factory', created_at: nowIso(), tables })
      if (new TextEncoder().encode(payload).length > 240_000) E(422, 'La fábrica tiene demasiados datos para un respaldo dentro del artifact (máx. 250 KB)')
      const name = `lombana_factory_${Date.now()}.json`
      await this.store.put('factory_backups', name.replace('.', '_'), { file: name, size: payload.length, created_at: nowIso(), payload })
      await this.audit(owner, 'respaldo', 'factory', null, { archivo: name }); return { file: name }
    }
    if (path === '/api/installations') return [...this.store.all<Any>('installations')].reverse().slice(0, 200)

    // --- clientes, planes, licencias
    if (path === '/api/clients' && method === 'GET') return [...this.store.all<Any>('clients')].sort((a, c) => a.name.localeCompare(c.name)).map(c => ({ ...c, erps: this.store.all<Any>('erps').filter(e => e.client_id === c.id).length }))
    if ((path === '/api/clients' && method === 'POST') || ((r = m(/^\/api\/clients\/(\d+)$/)) && method === 'PUT')) {
      const id = r ? Number(r[1]) : this.store.nextId('clients')
      if (r && !this.store.get('clients', id)) E(404, 'Cliente no encontrado')
      if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) E(422, 'email: correo inválido')
      const c = { id, name: text(b.name, 'name', 2, 160), document: text(b.document, 'document', 0, 40, true), email: b.email || null, phone: text(b.phone, 'phone', 0, 40, true),
        country: text(b.country, 'country', 0, 60, true), notes: text(b.notes, 'notes', 0, 2000, true), created_at: this.store.get<Any>('clients', id)?.created_at ?? nowIso() }
      await this.store.put('clients', id, c); await this.audit(owner, r ? 'editar' : 'crear', 'cliente', id); return { ...c, erps: 0 }
    }
    if ((r = m(/^\/api\/clients\/(\d+)$/)) && method === 'DELETE') {
      if (!this.store.get('clients', r[1])) E(404, 'Cliente no encontrado')
      if (this.store.all<Any>('licenses').some(l => l.client_id === Number(r![1]))) E(409, 'El cliente tiene licencias: suspéndelas en vez de borrar el cliente')
      await this.store.del('clients', r[1]); await this.audit(owner, 'eliminar', 'cliente', r[1]); return { ok: true }
    }
    if (path === '/api/plans' && method === 'GET') return [...this.store.all<Any>('plans')].sort((a, c) => new D(a.price_monthly).cmp(c.price_monthly))
    if ((path === '/api/plans' && method === 'POST') || ((r = m(/^\/api\/plans\/(\d+)$/)) && method === 'PUT')) {
      if (!/^[a-z0-9_-]{2,40}$/.test(b.code ?? '')) E(422, 'code: usa minúsculas, números, - o _ (2-40)')
      const id = r ? Number(r[1]) : this.store.nextId('plans')
      if (this.store.all<Any>('plans').some(p => p.code === b.code && p.id !== id)) E(409, 'Ya existe un plan con ese código')
      const p = { id, code: b.code, name: text(b.name, 'name', 2, 80), price_monthly: M4(num(b.price_monthly, 'price_monthly')), currency: String(b.currency ?? 'USD').toUpperCase(),
        max_users: Number(b.max_users ?? 3), max_storage_mb: Number(b.max_storage_mb ?? 500), max_modules: Number(b.max_modules ?? 8) }
      await this.store.put('plans', id, p); await this.audit(owner, r ? 'editar' : 'crear', 'plan', id); return p
    }
    const licOut = (l: Any) => { const p = this.store.get<Any>('plans', l.plan_id); return { ...l, client_name: this.store.get<Any>('clients', l.client_id)?.name, plan_name: p?.name, erp_name: l.erp_id ? this.store.get<Any>('erps', l.erp_id)?.name ?? null : null, currency: p?.currency ?? 'USD' } }
    const addCycle = (d: string, cycle: string) => {
      const [y, mo, da] = d.split('-').map(Number)
      if (cycle === 'anual') { const last = new Date(Date.UTC(y + 1, mo, 0)).getUTCDate(); return `${y + 1}-${String(mo).padStart(2, '0')}-${String(Math.min(da, last)).padStart(2, '0')}` }
      const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1, last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
      return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(da, last)).padStart(2, '0')}`
    }
    if (path === '/api/licenses' && method === 'GET') return [...this.store.all<Any>('licenses')].sort((a, c) => a.renewal_date.localeCompare(c.renewal_date)).map(licOut)
    if (path === '/api/licenses' && method === 'POST') {
      const plan = this.store.get<Any>('plans', b.plan_id)
      if (!plan || !this.store.get('clients', b.client_id)) E(422, 'Cliente o plan inexistente')
      if (b.erp_id != null && !this.store.get('erps', b.erp_id)) E(422, 'ERP inexistente')
      const cycle = b.billing_cycle === 'anual' ? 'anual' : 'mensual'
      const start = b.start_date ?? localDay(nowIso(), 'America/Bogota')
      const id = this.store.nextId('licenses')
      const l = { id, license_key: 'LE-' + Array.from({ length: 4 }, () => randomToken(4).slice(0, 4).toUpperCase()).join('-'), client_id: Number(b.client_id), plan_id: plan.id, erp_id: b.erp_id ?? null,
        status: 'activa', billing_cycle: cycle, start_date: start, renewal_date: addCycle(start, cycle), payment_status: 'pendiente',
        amount: M4(cycle === 'anual' ? new D(plan.price_monthly).times(12) : plan.price_monthly), created_at: nowIso() }
      await this.store.put('licenses', id, l); await this.audit(owner, 'crear', 'licencia', id); return licOut(l)
    }
    if ((r = m(/^\/api\/licenses\/(\d+)$/))) {
      const l = this.store.get<Any>('licenses', r[1]) ?? E(404, 'Licencia no encontrada')
      if (b.status) { if (!['activa', 'suspendida', 'vencida'].includes(b.status)) E(422, 'status inválido'); l.status = b.status }
      if (b.payment_status) { if (!['pendiente', 'al_dia', 'vencido'].includes(b.payment_status)) E(422, 'payment_status inválido'); l.payment_status = b.payment_status }
      if (b.renew) { l.renewal_date = addCycle(l.renewal_date, l.billing_cycle); l.status = 'activa' }
      await this.store.put('licenses', l.id, l); await this.audit(owner, 'editar', 'licencia', l.id, b); return licOut(l)
    }

    // --- plantillas de marca
    if (path === '/api/brand-templates' && method === 'GET') return [...this.store.all<Any>('brand_templates')].sort((a, c) => a.name.localeCompare(c.name))
    if (path === '/api/brand-templates' && method === 'POST') {
      const name = text(b.name, 'name', 2, 120)!
      if (this.store.all<Any>('brand_templates').some(t => t.name === name)) E(409, 'Ya existe una plantilla con ese nombre')
      const id = this.store.nextId('brand_templates'); const t = { id, name, branding: this.wrap(() => validateBranding(b.branding)), created_at: nowIso() }
      await this.store.put('brand_templates', id, t); await this.audit(owner, 'crear', 'plantilla_marca', id); return t
    }
    if ((r = m(/^\/api\/brand-templates\/(\d+)$/))) { if (!this.store.get('brand_templates', r[1])) E(404, 'Plantilla no encontrada'); await this.store.del('brand_templates', r[1]); return { ok: true } }

    if (path === '/api/audit') return (this.store.get<Any>('meta', 'audit')?.items ?? [])

    // --- fórmulas
    if (path === '/api/formulas/functions') return catalog()
    if (path === '/api/formulas/test') {
      try { const used = validate(b.expression); return { ok: true, variables: used, result: fmt(evaluate(b.expression, b.values ?? {})) } }
      catch (e) { if (e instanceof FormulaError) return { ok: false, error: e.message }; throw e }
    }
    if (path === '/api/formulas' && method === 'GET') {
      const latest = new Map<string, Any>()
      for (const f of this.store.all<Any>('formulas')) if (!latest.has(f.code) || latest.get(f.code)!.version < f.version) latest.set(f.code, f)
      return [...latest.values()].sort((a, c) => a.code.localeCompare(c.code))
    }
    if ((r = m(/^\/api\/formulas\/([a-z0-9_]+)\/versions$/))) return this.store.all<Any>('formulas').filter(f => f.code === r![1]).sort((a, c) => c.version - a.version)
    if (path === '/api/formulas' && method === 'POST') {
      if (!/^[a-z][a-z0-9_]{1,59}$/.test(b.code ?? '')) E(422, 'code: clave inválida')
      text(b.name, 'name', 2, 120)
      const vars: string[] = b.variables ?? []
      this.wrap(() => { validate(b.expression, vars); evaluate(b.expression, Object.fromEntries(vars.map(v => [v, b.sample?.[v] ?? 1]))) })
      const version = Math.max(0, ...this.store.all<Any>('formulas').filter(f => f.code === b.code).map(f => f.version)) + 1
      const id = this.store.nextId('formulas')
      const f = { id, code: b.code, name: b.name, expression: b.expression, variables: vars, module: b.module || null, description: b.description || null, version, created_at: nowIso() }
      await this.store.put('formulas', id, f); await this.audit(owner, 'guardar', 'formula', b.code, { version }); return f
    }

    // --- IA
    if (path === '/api/ai/presets') return [{ code: 'claude', name: 'Claude (integrado en este espacio)', kind: 'claude_integrado', base_url: 'integrado en claude.ai', needs_key: false }]
    if (path === '/api/ai/providers' && method === 'GET') return this.store.all<Any>('ai_providers').map(p => this.providerOut(p))
    if (path === '/api/ai/providers' && method === 'POST') {
      if (b.code !== 'claude') E(422, 'En esta versión dentro de Claude solo está disponible Claude integrado')
      if (this.store.all<Any>('ai_providers').length) E(409, 'Ese proveedor ya está agregado')
      const p = { id: 1, code: 'claude', name: 'Claude (integrado en este espacio)', kind: 'claude_integrado', base_url: 'integrado en claude.ai', default_model: 'Claude (automático)',
        models: ['Claude (automático)'], extra: {}, enabled: false, status: 'sin_probar', last_test_at: null, last_error: null, monthly_limit_requests: 300 }
      await this.store.put('ai_providers', 1, p); await this.audit(owner, 'agregar', 'proveedor_ia', 1); return this.providerOut(p)
    }
    if ((r = m(/^\/api\/ai\/providers\/(\d+)\/test$/))) {
      const p = this.store.get<Any>('ai_providers', r[1]) ?? E(404, 'Proveedor no encontrado')
      p.last_test_at = nowIso()
      try {
        const s = await this.sampler(); if (!s) throw new Error('Claude no está disponible en esta vista')
        await s('Responde únicamente con la palabra OK.', { cache: false, modelTier: 'quick' })
        p.status = 'conectado'; p.last_error = null
      } catch (e) { p.status = 'error'; p.enabled = false; p.last_error = (e as Any)?.code === 'not_granted' ? 'No se dio permiso para consultar a Claude' : String((e as Any)?.message ?? e) }
      await this.store.put('ai_providers', p.id, p); return this.providerOut(p)
    }
    if ((r = m(/^\/api\/ai\/providers\/(\d+)$/))) {
      const p = this.store.get<Any>('ai_providers', r[1]) ?? E(404, 'Proveedor no encontrado')
      if (method === 'DELETE') { await this.store.del('ai_providers', p.id); return { ok: true } }
      if (b.enabled !== undefined && b.enabled !== null) { if (b.enabled && p.status !== 'conectado') E(422, 'Prueba la conexión con éxito antes de activar el proveedor'); p.enabled = !!b.enabled }
      if (b.monthly_limit_requests != null) p.monthly_limit_requests = Number(b.monthly_limit_requests)
      await this.store.put('ai_providers', p.id, p); return this.providerOut(p)
    }
    const TASKS = ['general', 'constructor_erp', ...Object.keys(AGENTS).map(k => `agente_${k}`)]
    if (path === '/api/ai/routes') return TASKS.map(t => ({ task: t, provider_id: this.store.get<Any>('ai_routes', t)?.provider_id ?? null, model: null }))
    if ((r = m(/^\/api\/ai\/routes\/([a-z_]+)$/))) { if (b.provider_id) await this.store.put('ai_routes', r[1], { provider_id: b.provider_id }); else await this.store.del('ai_routes', r[1]); return { ok: true } }
    if (path === '/api/ai/chat') { text(b.prompt, 'prompt', 1, 8000); const out = await this.runChat(b.task ?? 'general', 'Eres el asistente de LOMBANA ESTUDIOS, fábrica de ERP. Responde en español.', b.prompt); await this.audit(owner, 'chat_ia', 'tarea_ia', b.task ?? 'general'); return out }
    if (path === '/api/ai/requests') return this.aiDoc().items
    if (path === '/api/ai/agents') return Object.entries(AGENTS).map(([code, [name, objective, tools]]) => ({ code, name, objective, tools, task: `agente_${code}`, permissions: 'solo lectura', max_tokens: 900 }))
    if ((r = m(/^\/api\/ai\/agents\/([a-z]+)\/run$/))) {
      if (!AGENTS[r[1]]) E(404, 'Agente desconocido')
      const e = this.getErp(b.erp_id); text(b.question, 'question', 3, 2000)
      await this.tenant(e.id)
      const { instructions, context } = this.agentContext(r[1], e.id)
      const out = await this.runChat(`agente_${r[1]}`, instructions, `Datos de la empresa (JSON, solo lectura):\n${JSON.stringify(context)}\n\nPregunta: ${b.question}`)
      await this.audit(`IA:${r[1]} (${owner})`, 'consulta_agente', 'ia', null, { pregunta: String(b.question).slice(0, 300) }, e.id)
      await this.audit(owner, 'ejecutar_agente', 'agente', r[1], { erp: e.id })
      return { ...out, context }
    }
    if (path === '/api/auth/password') E(422, 'En la versión dentro de Claude el acceso lo controla claude.ai (no hay contraseña de fábrica)')
    return E(404, 'Ruta no encontrada')
  }

  // ---------------------------------------------------------------- runtime de cada ERP
  private async runtime(method: string, slug: string, sub: string, q: Any, b: Any, token: string | null): Promise<unknown> {
    let r: RegExpMatchArray | null
    const m = (re: RegExp) => sub.match(re)
    if (sub === '/public') { const e = this.erpBySlug(slug); await this.tenant(e.id); return { slug, name: e.name, branding: this.store.get<Any>(this.T(e.id, 'settings'), 'branding')?.value } }
    if (sub === '/login') {
      const e = this.erpBySlug(slug); await this.tenant(e.id)
      const lim = this.limiter(`${slug}|${String(b.username).toLowerCase()}`)
      const u = this.store.all<Any>(this.T(e.id, 'users')).find(x => x.username === String(b.username ?? '').toLowerCase().trim())
      if (!u || !u.is_active || !(await verifyPassword(String(b.password ?? ''), u.password_hash))) { lim.fail(); E(401, 'Usuario o contraseña incorrectos') }
      lim.ok(); await this.audit(u!.username, 'login', 'usuario', u!.id, {}, e.id)
      return { token: await signToken(this.secret, { sub: u!.id, scope: `erp:${slug}`, exp: Date.now() + 8 * 3600_000 }) }
    }
    const c = await this.ctx(slug, token)
    const all = (col: string) => this.store.all<Any>(c.col(col))
    const get = (col: string, id: unknown) => this.store.get<Any>(c.col(col), String(id))

    if (sub === '/me') {
      const modules = [...(c.config.modules ?? [])].sort((a: Any, x: Any) => a.order - x.order).filter((mm: Any) => mm.enabled && c.can(`${mm.key}:ver`))
      return { user: { id: c.user.id, username: c.user.username, name: c.user.name, role: c.role?.name }, permissions: c.perms, modules,
        entities: c.can('registros:ver') ? c.config.entities ?? [] : [], company: c.config.company ?? {}, branding: c.branding, erp: { name: c.e.name, slug } }
    }
    if (sub === '/dashboard') {
      c.require('dashboard:ver')
      const today = localDay(nowIso(), c.tz), month = today.slice(0, 7)
      const sales = all('sales').filter(s => s.status === 'confirmada').map(s => ({ ...s, day: localDay(s.created_at, c.tz) }) as Any)
      const monthS = sales.filter(s => s.day.startsWith(month)), todayS = sales.filter(s => s.day === today)
      const sum = (a: Any[]) => a.reduce((s, x) => s.plus(x.total), new D(0))
      const days: string[] = []
      const [ty, tm, td] = today.split('-').map(Number)
      for (let i = 13; i >= 0; i--) days.push(new Date(Date.UTC(ty, tm - 1, td - i)).toISOString().slice(0, 10))
      const top: Record<string, Dec> = {}
      const names = Object.fromEntries(all('products').map(p => [p.id, p.name]))
      for (const s of monthS) for (const it of s.items) top[it.product_id] = (top[it.product_id] ?? new D(0)).plus(it.line_total)
      const rec: Record<string, number> = {}
      for (const x of all('records')) rec[x.entity] = (rec[x.entity] ?? 0) + 1
      const tm_ = sum(monthS)
      return {
        ventas_mes: tm_.toFixed(2), ventas_hoy: sum(todayS).toFixed(2), num_ventas_mes: monthS.length,
        ticket_promedio: monthS.length ? tm_.div(monthS.length).toFixed(2) : '0.00', clientes: all('customers').length, productos: all('products').length,
        stock_bajo: all('products').filter(p => p.kind === 'producto' && p.active && new D(p.stock).lte(p.min_stock)).map(p => ({ id: p.id, name: p.name, stock: p.stock, min_stock: p.min_stock })),
        ventas_por_dia: days.map(d => ({ dia: d, total: sum(sales.filter(s => s.day === d)).toFixed(2) })),
        top_productos: Object.entries(top).sort((a, x) => x[1].cmp(a[1])).slice(0, 5).map(([k, v]) => ({ name: names[k] ?? '?', total: v.toFixed(2) })),
        registros: rec, currency: c.config.company?.currency ?? 'COP',
      }
    }

    // clientes y proveedores
    if ((r = m(/^\/(customers|suppliers)(?:\/(\d+))?$/))) {
      const col = r[1], mod = col === 'customers' ? 'clientes' : 'proveedores', label = col === 'customers' ? 'cliente' : 'proveedor', id = r[2]
      if (method === 'GET') { c.require(`${mod}:ver`); const qq = String(q.q ?? '').toLowerCase(); return all(col).filter(p => !qq || p.name.toLowerCase().includes(qq)).sort((a, x) => a.name.localeCompare(x.name)) }
      if (method === 'DELETE') {
        c.require(`${mod}:eliminar`); const p = get(col, id) ?? E(404, `${label} no encontrado`)
        if (col === 'customers' && all('sales').some(s => s.customer_id === p.id)) E(409, `No se puede eliminar: el ${label} tiene movimientos asociados`)
        await this.store.del(c.col(col), p.id); await c.log('eliminar', label, p.id, { name: p.name }); return { ok: true }
      }
      c.require(`${mod}:${method === 'POST' ? 'crear' : 'editar'}`)
      const nid = id ? Number(id) : this.store.nextId(c.col(col))
      if (id && !get(col, id)) E(404, `${label} no encontrado`)
      const p = { id: nid, name: text(b.name, 'name', 2, 160), document: text(b.document, 'document', 0, 40, true), email: text(b.email, 'email', 0, 160, true),
        phone: text(b.phone, 'phone', 0, 40, true), address: text(b.address, 'address', 0, 240, true), created_at: get(col, nid)?.created_at ?? nowIso() }
      await this.store.put(c.col(col), nid, p); await c.log(id ? 'editar' : 'crear', label, nid); return p
    }

    // productos
    const prodOut = (p: Any) => ({ ...p, margin_pct: new D(p.price).isZero() ? '0.00' : new D(p.price).minus(p.cost).div(p.price).times(100).toFixed(2),
      low_stock: p.kind === 'producto' && new D(p.stock).lte(p.min_stock) })
    if ((r = m(/^\/products(?:\/(\d+))?$/))) {
      const id = r[1]
      if (method === 'GET') { c.require('productos:ver'); const qq = String(q.q ?? '').toLowerCase(); return all('products').filter(p => !qq || p.name.toLowerCase().includes(qq) || p.sku.toLowerCase().includes(qq)).sort((a, x) => a.name.localeCompare(x.name)).map(prodOut) }
      if (method === 'DELETE') {
        c.require('productos:eliminar'); const p = get('products', id) ?? E(404, 'Producto no encontrado')
        if (all('sales').some(s => s.items.some((i: Any) => i.product_id === p.id)) || all('movements').some(mv => mv.product_id === p.id)) E(409, 'El producto tiene ventas o movimientos: desactívalo en lugar de eliminarlo')
        await this.store.del(c.col('products'), p.id); await c.log('eliminar', 'producto', p.id, { sku: p.sku }); return { ok: true }
      }
      c.require(`productos:${method === 'POST' ? 'crear' : 'editar'}`)
      const prev = id ? get('products', id) ?? E(404, 'Producto no encontrado') : null
      const sku = text(b.sku, 'sku', 1, 40)!
      const nid = id ? Number(id) : this.store.nextId(c.col('products'))
      if (all('products').some(p => p.sku === sku && p.id !== nid)) E(409, 'Ya existe un producto con ese código (SKU)')
      const kind = b.kind === 'servicio' ? 'servicio' : 'producto'
      const p: Any = { id: nid, sku, name: text(b.name, 'name', 2, 160), kind, price: M4(num(b.price, 'price')), cost: M4(num(b.cost ?? 0, 'cost')),
        tax_rate: M4(num(b.tax_rate ?? 0, 'tax_rate', { min: 0, max: 100 })), min_stock: M4(num(b.min_stock ?? 0, 'min_stock')), active: b.active !== false,
        stock: prev?.stock ?? M4(0) }
      const initial = num(b.initial_stock ?? 0, 'initial_stock')
      await this.store.put(c.col('products'), nid, p)
      if (!prev && initial.gt(0) && kind === 'producto') {
        p.stock = M4(initial); await this.store.put(c.col('products'), nid, p)
        const mid = this.store.nextId(c.col('movements'))
        await this.store.put(c.col('movements'), mid, { id: mid, product_id: nid, kind: 'entrada', qty: M4(initial), reference: 'Inventario inicial', created_by: c.user.username, created_at: nowIso() })
      }
      await c.log(prev ? 'editar' : 'crear', 'producto', nid); return prodOut(p)
    }

    // inventario
    if (sub === '/inventory/movements' && method === 'GET') {
      c.require('inventario:ver'); const names = Object.fromEntries(all('products').map(p => [p.id, p.name]))
      return [...all('movements')].reverse().slice(0, 300).map(mv => ({ ...mv, product: names[mv.product_id] }))
    }
    if (sub === '/inventory/movements' && method === 'POST') {
      c.require('inventario:crear')
      const p = get('products', b.product_id); if (!p || p.kind !== 'producto') E(422, 'Producto inexistente o es un servicio (sin inventario)')
      const kind = String(b.kind); if (!['entrada', 'salida', 'ajuste'].includes(kind)) E(422, 'kind inválido')
      const qty = num(b.qty, 'qty', { min: null })
      const stock = new D(p.stock)
      let delta: Dec
      if (kind !== 'ajuste' && qty.lte(0)) E(422, 'La cantidad debe ser mayor que cero')
      if (kind === 'ajuste' && qty.lt(0)) E(422, 'El ajuste indica la existencia final (no puede ser negativa)')
      if (kind === 'entrada') { delta = qty; p.stock = M4(stock.plus(qty)) }
      else if (kind === 'salida') { if (stock.lt(qty)) E(422, `Existencia insuficiente: hay ${stock.toFixed()}`); delta = qty; p.stock = M4(stock.minus(qty)) }
      else { delta = qty.minus(stock); p.stock = M4(qty) }
      await this.store.put(c.col('products'), p.id, p)
      const mid = this.store.nextId(c.col('movements'))
      await this.store.put(c.col('movements'), mid, { id: mid, product_id: p.id, kind, qty: M4(delta!), reference: b.reference || null, created_by: c.user.username, created_at: nowIso() })
      await c.log('movimiento', 'inventario', mid, { producto: p.sku, tipo: kind, cantidad: delta!.toFixed() }); return { id: mid, stock: p.stock }
    }

    // ventas
    const custName = (id: unknown) => (id ? get('customers', id)?.name ?? '?' : 'Consumidor final')
    const saleOut = (s: Any, full = false) => {
      const o: Any = { ...s, customer: custName(s.customer_id) }
      if (full) { const names = Object.fromEntries(all('products').map(p => [p.id, p.name])); o.items = s.items.map((i: Any) => ({ ...i, product: names[i.product_id] })) } else delete o.items
      return o
    }
    if (sub === '/sales' && method === 'GET') { c.require('ventas:ver'); return [...all('sales')].reverse().slice(0, 300).map(s => saleOut(s)) }
    if ((r = m(/^\/sales\/(\d+)$/))) { c.require('ventas:ver'); return saleOut(get('sales', r[1]) ?? E(404, 'Venta no encontrada'), true) }
    if (sub === '/sales' && method === 'POST') {
      c.require('ventas:crear')
      if (b.customer_id != null && !get('customers', b.customer_id)) E(422, 'Cliente inexistente')
      const items: Any[] = b.items ?? []
      if (!items.length || items.length > 200) E(422, 'items: agrega entre 1 y 200 líneas')
      const discPct = num(b.discount_pct ?? 0, 'discount_pct', { min: 0, max: 100 })
      const needed: Record<string, Dec> = {}
      const lines: [Any, Dec, Dec, Dec][] = []
      for (const it of items) {
        const p = get('products', it.product_id)
        if (!p || !p.active) E(422, `Producto ${it.product_id} inexistente o inactivo`)
        const qty = num(it.qty, 'qty'); if (qty.lte(0)) E(422, 'qty: debe ser mayor que cero')
        let price = new D(p.price)
        if (it.unit_price != null && !new D(it.unit_price).eq(price)) { if (!c.can('ventas:editar')) E(403, 'No tienes permiso para cambiar precios (ventas:editar)'); price = num(it.unit_price, 'unit_price') }
        if (p.kind === 'producto') { needed[p.id] = (needed[p.id] ?? new D(0)).plus(qty); if (new D(p.stock).lt(needed[p.id])) E(422, `Existencia insuficiente de '${p.name}': hay ${new D(p.stock).toFixed()}`) }
        lines.push([p, qty, price, price.times(qty)])
      }
      const factor = new D(1).minus(discPct.div(100))
      let subtotal = new D(0), discount = new D(0), tax = new D(0)
      for (const [p, , , base] of lines) { const dd = base.times(factor); discount = discount.plus(base.minus(dd)); subtotal = subtotal.plus(base); tax = tax.plus(dd.times(p.tax_rate).div(100)) }
      subtotal = subtotal.toDecimalPlaces(2, D.ROUND_HALF_UP); discount = discount.toDecimalPlaces(2, D.ROUND_HALF_UP); tax = tax.toDecimalPlaces(2, D.ROUND_HALF_UP)
      const sid = this.store.nextId(c.col('sales'))
      const sale = { id: sid, number: `V-${String(sid).padStart(6, '0')}`, customer_id: b.customer_id ?? null, subtotal: M4(subtotal), discount: M4(discount), tax: M4(tax),
        total: M4(subtotal.minus(discount).plus(tax)), status: 'confirmada', created_by: c.user.username, created_at: nowIso(),
        items: lines.map(([p, qty, price, base]) => ({ product_id: p.id, qty: M4(qty), unit_price: M4(price), tax_rate: p.tax_rate, line_total: M4(base.toDecimalPlaces(2, D.ROUND_HALF_UP)) })) }
      await this.store.put(c.col('sales'), sid, sale)
      for (const [p, qty] of lines) if (p.kind === 'producto') {
        p.stock = M4(new D(p.stock).minus(qty)); await this.store.put(c.col('products'), p.id, p)
        const mid = this.store.nextId(c.col('movements'))
        await this.store.put(c.col('movements'), mid, { id: mid, product_id: p.id, kind: 'salida', qty: M4(qty), reference: sale.number, created_by: c.user.username, created_at: nowIso() })
      }
      await c.log('crear', 'venta', sid, { numero: sale.number, total: sale.total }); return saleOut(sale, true)
    }
    if ((r = m(/^\/sales\/(\d+)\/void$/))) {
      c.require('ventas:eliminar')
      const s = get('sales', r[1]) ?? E(404, 'Venta no encontrada')
      if (s.status === 'anulada') E(409, 'La venta ya está anulada')
      for (const it of s.items) { const p = get('products', it.product_id); if (p?.kind === 'producto') {
        p.stock = M4(new D(p.stock).plus(it.qty)); await this.store.put(c.col('products'), p.id, p)
        const mid = this.store.nextId(c.col('movements'))
        await this.store.put(c.col('movements'), mid, { id: mid, product_id: p.id, kind: 'entrada', qty: it.qty, reference: `Anulación ${s.number}`, created_by: c.user.username, created_at: nowIso() })
      } }
      s.status = 'anulada'; await this.store.put(c.col('sales'), s.id, s); await c.log('anular', 'venta', s.id, { numero: s.number }); return saleOut(s, true)
    }
    if (sub === '/reports/sales') {
      c.require('reportes:ver')
      const start = String(q.start), end = String(q.end)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start || (Date.parse(end) - Date.parse(start)) > 366 * 86400_000) E(422, 'Rango inválido (máximo 1 año)')
      const rows = all('sales').filter(s => { const d = localDay(s.created_at, c.tz); return d >= start && d <= end })
      const ok = rows.filter(s => s.status === 'confirmada')
      const sm = (k: string) => ok.reduce((a, s) => a.plus(s[k]), new D(0)).toFixed(4)
      if (q.fmt === 'csv') {
        const esc = (v: unknown) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
        const lines = [['Número', 'Fecha', 'Cliente', 'Subtotal', 'Descuento', 'Impuesto', 'Total', 'Estado', 'Usuario'].join(';'),
          ...rows.map(s => [s.number, new Date(s.created_at).toLocaleString('sv-SE', { timeZone: c.tz }).slice(0, 16), custName(s.customer_id), s.subtotal, s.discount, s.tax, s.total, s.status, s.created_by].map(esc).join(';'))]
        await c.log('exportar', 'reporte_ventas', null, { desde: start, hasta: end })
        return { __csv: '﻿' + lines.join('\r\n') }
      }
      return { summary: { ventas: ok.length, anuladas: rows.length - ok.length, subtotal: sm('subtotal'), descuentos: sm('discount'), impuestos: sm('tax'), total: sm('total') }, rows: rows.map(s => saleOut(s)) }
    }

    // registros personalizados
    if ((r = m(/^\/records\/([a-z][a-z0-9_]*)(?:\/(\d+))?$/))) {
      const entKey = r[1], rid = r[2]
      const ent = (c.config.entities ?? []).find((x: Any) => x.key === entKey) ?? E(404, 'Entidad no definida en este ERP')
      const recs = () => all('records').filter(x => x.entity === entKey)
      const relLabel = (rel: string, id: unknown) => {
        if (rel === 'customers' || rel === 'products' || rel === 'suppliers') return get(rel, id)?.name
        const x = get('records', id); if (!x || x.entity !== rel) return undefined
        return Object.values(x.data).find(v => typeof v === 'string') ?? `#${x.id}`
      }
      if (method === 'GET') {
        c.require('registros:ver')
        const rows = recs().reverse().slice(0, 1000)
        const labels: Any = {}
        for (const f of ent.fields) if (f.type === 'relation') { labels[f.key] = {}; for (const x of rows) { const v = x.data[f.key]; if (v) labels[f.key][String(v)] = relLabel(f.relation, v) } }
        return { entity: ent, labels, rows: rows.map(x => ({ id: x.id, ...x.data, _created_at: x.created_at })) }
      }
      if (method === 'DELETE') {
        c.require('registros:eliminar'); const x = get('records', rid); if (!x || x.entity !== entKey) E(404, 'Registro no encontrado')
        const referenced = (c.config.entities ?? []).some((e2: Any) => e2.fields.some((f: Any) => f.type === 'relation' && f.relation === entKey &&
          all('records').some(y => y.entity === e2.key && Number(y.data[f.key]) === Number(rid))))
        if (referenced) E(409, 'Otros registros dependen de este: elimínalos primero')
        await this.store.del(c.col('records'), rid!); await c.log('eliminar', entKey, rid, x!.data); return { ok: true }
      }
      c.require(`registros:${method === 'POST' ? 'crear' : 'editar'}`)
      if (rid) { const x = get('records', rid); if (!x || x.entity !== entKey) E(404, 'Registro no encontrado') }
      const out: Any = {}, errors: string[] = [], numeric: Record<string, Dec> = {}
      for (const f of ent.fields) {
        if (f.type === 'calculated') continue
        const v = b[f.key]
        if (v === null || v === undefined || v === '') { if (f.required) errors.push(`${f.label} es obligatorio`); out[f.key] = null; continue }
        try {
          if (f.type === 'number' || f.type === 'money') {
            const d = new D(String(v)); if (!d.isFinite()) throw 0
            if (f.min != null && d.lt(f.min)) errors.push(`${f.label} debe ser ≥ ${f.min}`)
            if (f.max != null && d.gt(f.max)) errors.push(`${f.label} debe ser ≤ ${f.max}`)
            out[f.key] = d.toFixed(); numeric[f.key] = d
          } else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || isNaN(Date.parse(String(v)))) throw 0; out[f.key] = String(v) }
          else if (f.type === 'checkbox') { if (typeof v !== 'boolean') throw 0; out[f.key] = v }
          else if (f.type === 'select') { if (!f.options.includes(v)) errors.push(`${f.label}: opción no válida`); out[f.key] = v }
          else if (f.type === 'relation') { const id = Number(v); if (!Number.isInteger(id)) throw 0; if (relLabel(f.relation, id) === undefined) errors.push(`${f.label}: registro relacionado inexistente`); out[f.key] = id }
          else { const s = String(v).trim(); if (s.length > (f.max_length || 500)) errors.push(`${f.label}: texto demasiado largo`); out[f.key] = s }
        } catch { errors.push(`${f.label}: valor inválido`) }
      }
      const nums = ent.fields.filter((f: Any) => f.type === 'number' || f.type === 'money').map((f: Any) => f.key)
      for (const f of ent.fields) if (f.type === 'calculated') {
        try { out[f.key] = new D(evaluate(f.formula, Object.fromEntries(nums.map((k: string) => [k, numeric[k] ?? new D(0)]))) as Dec).toFixed(2) }
        catch (e) { errors.push(`${f.label}: ${(e as Error).message}`) }
      }
      if (errors.length) E(422, errors.join('; '))
      const id = rid ? Number(rid) : this.store.nextId(c.col('records'))
      const prev = get('records', id)
      await this.store.put(c.col('records'), id, { id, entity: entKey, data: out, created_by: prev?.created_by ?? c.user.username, created_at: prev?.created_at ?? nowIso(), updated_at: nowIso() })
      await c.log(rid ? 'editar' : 'crear', entKey, id); return { id, ...out }
    }

    // usuarios y roles
    const userOut = (u: Any) => ({ id: u.id, username: u.username, name: u.name, role_id: u.role_id, role: get('roles', u.role_id)?.name, is_active: u.is_active, created_at: u.created_at })
    const isAdminRole = (rid: unknown) => (get('roles', rid)?.permissions ?? []).includes('*')
    if (sub === '/users' && method === 'GET') { c.require('usuarios:ver'); return all('users').sort((a, x) => a.username.localeCompare(x.username)).map(userOut) }
    if ((r = m(/^\/users(?:\/(\d+))?$/))) {
      const id = r[1]
      c.require(`usuarios:${id ? 'editar' : 'crear'}`)
      if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(b.username ?? '')) E(422, 'username: 3-40 letras, números, . _ -')
      text(b.name, 'name', 2, 120)
      if (!get('roles', b.role_id)) E(422, 'Rol inexistente')
      if (b.password && b.password.length < 8) E(422, 'password: mínimo 8 caracteres')
      if (!id) {
        if (!b.password) E(422, 'La contraseña es obligatoria al crear el usuario')
        if (all('users').some(u => u.username === b.username.toLowerCase())) E(409, 'Ese nombre de usuario ya existe')
        const nid = this.store.nextId(c.col('users'))
        const u = { id: nid, username: b.username.toLowerCase(), name: b.name, role_id: Number(b.role_id), is_active: b.is_active !== false, password_hash: await hashPassword(b.password), created_at: nowIso() }
        await this.store.put(c.col('users'), nid, u); await c.log('crear', 'usuario', nid, { username: u.username }); return userOut(u)
      }
      const u = get('users', id) ?? E(404, 'Usuario o rol inexistente')
      const losing = isAdminRole(u.role_id) && (!isAdminRole(b.role_id) || b.is_active === false)
      if (losing && !all('users').some(x => x.id !== u.id && x.is_active && isAdminRole(x.role_id))) E(409, 'Debe quedar al menos un administrador activo')
      u.name = b.name; u.role_id = Number(b.role_id); u.is_active = b.is_active !== false
      if (b.password) u.password_hash = await hashPassword(b.password)
      await this.store.put(c.col('users'), u.id, u); await c.log('editar', 'usuario', u.id, { rol: get('roles', u.role_id)?.name, activo: u.is_active, cambio_clave: !!b.password }); return userOut(u)
    }
    if (sub === '/roles' && method === 'GET') {
      c.require('usuarios:ver')
      return { roles: all('roles'), available: allPermissions((c.config.modules ?? []).filter((mm: Any) => mm.enabled).map((mm: Any) => mm.key)) }
    }
    if ((r = m(/^\/roles(?:\/(\d+))?$/))) {
      const id = r[1]
      c.require(`usuarios:${id ? 'editar' : 'crear'}`)
      const name = text(b.name, 'name', 2, 60)!
      const perms = [...new Set<string>((b.permissions ?? []).map(String))].sort()
      if (all('roles').some(x => x.name === name && String(x.id) !== id)) E(409, 'Ya existe un rol con ese nombre')
      if (id) { const ro = get('roles', id) ?? E(404, 'Rol no encontrado'); if (ro.permissions.includes('*') && !perms.includes('*')) E(409, 'El rol administrador conserva todos los permisos') }
      const rid = id ? Number(id) : this.store.nextId(c.col('roles'))
      const ro = { id: rid, name, permissions: perms }
      await this.store.put(c.col('roles'), rid, ro); await c.log(id ? 'editar' : 'crear', 'rol', rid, { permisos: perms }); return ro
    }
    if (sub === '/audit') { c.require('auditoria:ver'); await this.store.load(c.col('meta')); return this.store.get<Any>(c.col('meta'), 'audit')?.items ?? [] }
    return E(404, 'Ruta no encontrada')
  }
}

const BASE_RULES = 'Eres un agente de LOMBANA ESTUDIOS. Responde en español, de forma clara y accionable. Usa SOLO los datos entregados; si faltan datos, dilo. ' +
  'Nunca inventes cifras ni transacciones. No puedes modificar datos: si una acción requiere cambios (pagos, nómina, cierres, eliminaciones), recomiéndala para que un humano la apruebe y la ejecute.'
type AgentDef = [string, string, string[]]
const AGENT_LIST: [string, AgentDef][] = [
  ['ceo', ['Agente CEO', 'Análisis general del negocio y prioridades.', ['resumen_ventas', 'inventario', 'clientes', 'registros']]],
  ['cfo', ['Agente CFO', 'Análisis financiero: ingresos, tendencias y márgenes.', ['resumen_ventas', 'inventario']]],
  ['contable', ['Agente contable', 'Apoyo en revisión de registros de ventas e inventario.', ['resumen_ventas', 'inventario']]],
  ['auditor', ['Agente auditor', 'Detección de inconsistencias y riesgos en los datos.', ['resumen_ventas', 'inventario', 'registros']]],
  ['comercial', ['Agente comercial', 'Seguimiento de clientes y oportunidades de venta.', ['resumen_ventas', 'clientes']]],
  ['inventario', ['Agente de inventario', 'Análisis de existencias y reabastecimiento.', ['inventario', 'resumen_ventas']]],
  ['nomina', ['Agente de nómina', 'Apoyo en revisión de novedades de personal (solo lectura).', ['registros']]],
  ['rrhh', ['Agente de recursos humanos', 'Gestión del personal a partir de los registros.', ['registros']]],
  ['operativo', ['Agente operativo', 'Seguimiento de procesos y registros operativos.', ['registros', 'inventario']]],
  ['consultor', ['Agente consultor', 'Recomendaciones empresariales generales.', ['resumen_ventas', 'inventario', 'clientes', 'registros']]],
  ['constructor', ['Agente constructor', 'Sugiere módulos, entidades y campos para el ERP (no los crea).', ['registros']]],
]
// Map sin prototipo: 'constructor' es un agente, no la propiedad de Object
const AGENTS: Record<string, AgentDef> = Object.assign(Object.create(null), Object.fromEntries(AGENT_LIST))
export type { Doc }
