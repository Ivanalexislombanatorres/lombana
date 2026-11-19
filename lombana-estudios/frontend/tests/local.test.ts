// Pruebas del motor local (versión dentro de Claude) con una base en memoria.
import { describe, expect, it } from 'vitest'
import { LocalApi } from '../src/local/api'
import { evaluate, FormulaError, fmt } from '../src/local/formula'
import { MemoryBackend, Store } from '../src/local/store'

const fakeSample = async (input: string) => ({ text: input.includes('OK') ? 'OK' : 'Recomendación: reabastecer Arroz.' })
async function setup() {
  const backend = new MemoryBackend()
  const api = new LocalApi(new Store(backend), async () => fakeSample)
  await api.init()
  const call = (m: string, p: string, b?: unknown, t: string | null = null) => api.handle(m, p, b, t) as Promise<any>
  const fail = async (m: string, p: string, b?: unknown, t: string | null = null) => {
    try { await api.handle(m, p, b, t); return null } catch (e: any) { return { status: e.status, msg: e.message } }
  }
  return { api, backend, call, fail }
}
const mk = (call: any, name = 'Barbería Pro', sector = 'barberia') =>
  call('POST', '/api/erps', { name, sector, company: { name, currency: 'COP' }, admin_user: 'admin', admin_password: 'Admin-12345' })
const login = async (call: any, slug: string, u = 'admin', p = 'Admin-12345') => (await call('POST', `/api/rt/${slug}/login`, { username: u, password: p })).token

describe('fórmulas', () => {
  it('precisión y funciones', () => {
    expect(fmt(evaluate('0.1 + 0.2', {}))).toBe('0.3')
    expect(fmt(evaluate('IMPUESTO(100000, 19)', {}))).toBe('19000')
    expect(fmt(evaluate('REDONDEAR(10 / 3, 2)', {}))).toBe('3.33')
    expect(fmt(evaluate('SI(total > 1000, DESCUENTO(total, 5), total)', { total: 2000 }))).toBe('1900')
    expect(fmt(evaluate('SI(total > 1000, 1 / 0, total)', { total: 10 }))).toBe('10')
    expect(fmt(evaluate('COMISION(ventas, 8)', { ventas: '1500000' }))).toBe('120000')
  })
  it.each(["__import__('os')", "open('x')", 'a.b', '[1,2]', "'texto'", 'x[0]', 'eval(1)', 'lambda: 1', '1 if 1 else 2', '2 ** 1000', '1 / 0'])('bloquea %s', expr => {
    expect(() => evaluate(expr, { a: 1, x: 1 })).toThrow(FormulaError)
  })
})

describe('fábrica', () => {
  it('crea ERP con espacio propio, publica y aísla datos', async () => {
    const { call, fail, backend } = await setup()
    const a = await mk(call, 'Barbería Uno'), b = await mk(call, 'Barbería Dos')
    expect([a.db_name, b.db_name]).toEqual(['erp_barberia_001', 'erp_barberia_002'])
    expect(a.status).toBe('activo')
    const ta = await login(call, a.slug), tb = await login(call, b.slug)
    await call('POST', `/api/rt/${a.slug}/customers`, { name: 'Solo en A' }, ta)
    expect(await call('GET', `/api/rt/${b.slug}/customers`, undefined, tb)).toEqual([])
    expect((await fail('GET', `/api/rt/${b.slug}/customers`, undefined, ta))!.status).toBe(403)
    expect((await fail('GET', `/api/rt/${a.slug}/customers`))!.status).toBe(401)
    expect([...backend.data.keys()].some(k => k.startsWith(`t/${a.id}/customers/`))).toBe(true)
    expect([...backend.data.keys()].some(k => k.startsWith(`t/${b.id}/customers/`))).toBe(false)
    // contraseñas nunca en texto plano
    expect(JSON.stringify([...backend.data.values()])).not.toContain('Admin-12345')
  })
  it('validaciones del constructor', async () => {
    const { call, fail } = await setup()
    const base = { name: 'Tienda X', sector: 'tienda', company: { name: 'Tienda X' }, admin_password: 'Admin-12345' }
    expect((await fail('POST', '/api/erps', { ...base, modules: ['contabilidad'] }))!.msg).toContain('aún no está disponible')
    expect((await fail('POST', '/api/erps', { ...base, modules: ['ventas'] }))!.msg).toContain('requiere activar')
    expect((await fail('POST', '/api/erps', { ...base, admin_password: '123' }))!.status).toBe(422)
    expect(await call('GET', '/api/erps')).toEqual([])
  })
  it('versiones, marca, licencias y respaldos', async () => {
    const { call, fail } = await setup()
    const e = await mk(call)
    const brand = { ...e.branding, software_name: 'Barber Gold', primary: '#c9a227' }
    const r = await call('PUT', `/api/erps/${e.id}/branding`, { branding: brand, publish: true })
    expect(r.branding.primary).toBe('#C9A227')
    expect((await call('GET', `/api/rt/${e.slug}/public`)).branding.software_name).toBe('Barber Gold')
    expect((await fail('PUT', `/api/erps/${e.id}/branding`, { branding: { ...brand, logo: 'data:image/svg+xml;base64,PHN2Zz4=' } }))!.status).toBe(422)
    expect((await call('POST', `/api/erps/${e.id}/versions/1/restore`)).current_version).toBe(3)
    const c = await call('POST', '/api/clients', { name: 'El Rey' })
    const plans = await call('GET', '/api/plans')
    expect(plans.map((p: any) => p.code)).toEqual(['basico', 'profesional', 'empresarial'])
    const l = await call('POST', '/api/licenses', { client_id: c.id, plan_id: plans[1].id, billing_cycle: 'anual', start_date: '2026-01-31' })
    expect([l.amount, l.renewal_date]).toEqual(['708.0000', '2027-01-31'])
    const l2 = await call('POST', '/api/licenses', { client_id: c.id, plan_id: plans[0].id, start_date: '2026-01-31' })
    expect(l2.renewal_date).toBe('2026-02-28')
    expect((await call('GET', '/api/dashboard')).ingresos_recurrentes_mes).toBe('88.00')
    expect((await fail('DELETE', `/api/clients/${c.id}`))!.status).toBe(409)
    const t = await login(call, e.slug)
    await call('POST', `/api/rt/${e.slug}/customers`, { name: 'Antes' }, t)
    const bk = (await call('POST', `/api/erps/${e.id}/backups`)).file
    await call('POST', `/api/rt/${e.slug}/customers`, { name: 'Después' }, t)
    await call('POST', `/api/erps/${e.id}/restore`, { file: bk })
    expect((await call('GET', `/api/rt/${e.slug}/customers`, undefined, t)).map((x: any) => x.name)).toEqual(['Antes'])
    expect((await call('POST', `/api/rt/${e.slug}/customers`, { name: 'Nuevo' }, t)).id).toBe(2)
  })
})

describe('runtime', () => {
  it('ventas, inventario, reportes y permisos', async () => {
    const { call, fail } = await setup()
    const e = await mk(call, 'Tienda Max', 'tienda'), s = e.slug, u = `/api/rt/${s}`
    const t = await login(call, s)
    await call('POST', `${u}/cash/open`, { opening_amount: '100000' }, t)
    const cu = await call('POST', `${u}/customers`, { name: 'Juan' }, t)
    const p = await call('POST', `${u}/products`, { sku: 'A1', name: 'Gaseosa', price: '2500', cost: '1500', tax_rate: '19', initial_stock: '10', min_stock: '3' }, t)
    const sv = await call('POST', `${u}/products`, { sku: 'S1', name: 'Domicilio', kind: 'servicio', price: '3000' }, t)
    expect([p.stock, p.margin_pct]).toEqual(['10.0000', '40.00'])
    const v = await call('POST', `${u}/sales`, { customer_id: cu.id, discount_pct: '10', items: [{ product_id: p.id, qty: '4' }, { product_id: sv.id, qty: '1' }] }, t)
    expect([v.subtotal, v.discount, v.tax, v.total, v.number]).toEqual(['13000.0000', '1300.0000', '1710.0000', '13410.0000', 'V-000001'])
    expect((await fail('POST', `${u}/sales`, { items: [{ product_id: p.id, qty: '7' }] }, t))!.msg).toContain('insuficiente')
    expect((await call('GET', `${u}/products`, undefined, t)).find((x: any) => x.sku === 'A1').stock).toBe('6.0000')
    expect((await fail('DELETE', `${u}/products/${p.id}`, undefined, t))!.status).toBe(409)
    await call('POST', `${u}/sales/${v.id}/void`, undefined, t)
    expect((await call('GET', `${u}/products`, undefined, t)).find((x: any) => x.sku === 'A1').stock).toBe('10.0000')
    expect((await call('POST', `${u}/inventory/movements`, { product_id: p.id, kind: 'ajuste', qty: '5' }, t)).stock).toBe('5.0000')
    await call('POST', `${u}/sales`, { items: [{ product_id: p.id, qty: '3' }] }, t)
    const d = await call('GET', `${u}/dashboard`, undefined, t)
    expect(d.ventas_mes).toBe('8925.00'); expect(d.stock_bajo[0].name).toBe('Gaseosa')
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
    const rep = await call('GET', `${u}/reports/sales?start=${today}&end=${today}`, undefined, t)
    expect([rep.summary.ventas, rep.summary.anuladas]).toEqual([1, 1])
    expect((await call('GET', `${u}/reports/sales?start=${today}&end=${today}&fmt=csv`, undefined, t)).__csv).toContain('V-000002')
    // roles
    const roles = (await call('GET', `${u}/roles`, undefined, t)).roles
    const vend = roles.find((r: any) => r.name === 'Vendedor')
    await call('POST', `${u}/users`, { username: 'vende', name: 'Vendedor', role_id: vend.id, password: 'Vende-1234' }, t)
    const tv = await login(call, s, 'vende', 'Vende-1234')
    expect((await fail('POST', `${u}/products`, { sku: 'C', name: 'Leche', price: '1' }, tv))!.status).toBe(403)
    expect((await fail('POST', `${u}/sales`, { items: [{ product_id: p.id, qty: '1', unit_price: '1' }] }, tv))!.status).toBe(403)
    const admin = (await call('GET', `${u}/users`, undefined, t)).find((x: any) => x.username === 'admin')
    expect((await fail('PUT', `${u}/users/${admin.id}`, { username: 'admin', name: 'Admin', role_id: vend.id }, t))!.status).toBe(409)
    const vid = (await call('GET', `${u}/users`, undefined, t)).find((x: any) => x.username === 'vende').id
    await call('PUT', `${u}/users/${vid}`, { username: 'vende', name: 'Vendedor', role_id: vend.id, is_active: false }, t)
    expect((await fail('GET', `${u}/products`, undefined, tv))!.status).toBe(401)
    for (let i = 0; i < 5; i++) await fail('POST', `${u}/login`, { username: 'admin', password: 'mala' })
    expect((await fail('POST', `${u}/login`, { username: 'admin', password: 'Admin-12345' }))!.status).toBe(429)
  })
  it('registros personalizados con campo calculado y relaciones', async () => {
    const { call, fail } = await setup()
    const e = await mk(call), u = `/api/rt/${e.slug}`, t = await login(call, e.slug)
    const c = await call('POST', `${u}/customers`, { name: 'Carlos' }, t)
    const ok = { cliente: c.id, barbero: 'Andrés', fecha: '2026-11-20', hora: '10:30', servicio: 'Corte', valor: '30000', comision_pct: '40', estado: 'Agendada' }
    expect((await call('POST', `${u}/records/citas`, ok, t)).comision).toBe('12000.00')
    const msg = (await fail('POST', `${u}/records/citas`, { ...ok, servicio: 'Masaje', cliente: 999, comision_pct: '150', fecha: 'ayer' }, t))!.msg
    expect(msg).toContain('opción no válida'); expect(msg).toContain('inexistente'); expect(msg).toContain('≤ 100')
    const lst = await call('GET', `${u}/records/citas`, undefined, t)
    expect(lst.labels.cliente[String(c.id)]).toBe('Carlos')
  })
  it('agentes de IA con Claude integrado, solo lectura', async () => {
    const { call, fail } = await setup()
    expect((await fail('POST', '/api/ai/chat', { prompt: 'hola' }))!.status).toBe(409)
    const p = await call('POST', '/api/ai/providers', { code: 'claude' })
    expect((await call('POST', `/api/ai/providers/${p.id}/test`)).status).toBe('conectado')
    await call('PUT', `/api/ai/providers/${p.id}`, { enabled: true })
    const e = await mk(call, 'Tienda IA', 'tienda'), t = await login(call, e.slug)
    await call('POST', `/api/rt/${e.slug}/products`, { sku: 'Z', name: 'Arroz', price: '4000', initial_stock: '1', min_stock: '5' }, t)
    const out = await call('POST', '/api/ai/agents/cfo/run', { erp_id: e.id, question: '¿Cómo va?' })
    expect(out.text).toContain('Arroz'); expect(out.context.inventario.stock_bajo[0].producto).toBe('Arroz')
    expect((await call('POST', '/api/ai/agents/constructor/run', { erp_id: e.id, question: 'Sugiere campos' })).text).toBeTruthy()
    expect((await call('GET', '/api/ai/requests')).length).toBe(2)
  })
})

describe('límites de la base de Claude', () => {
  it('rechaza imágenes de marca demasiado pesadas con mensaje claro', async () => {
    const { call, fail } = await setup()
    const e = await mk(call)
    const big = 'data:image/png;base64,' + 'A'.repeat(200_000)
    expect((await fail('PUT', `/api/erps/${e.id}/branding`, { branding: { ...e.branding, logo: big } }))!.msg).toContain('120 KB')
  })
})

describe('acceso del propietario y datos frescos', () => {
  it('el propietario entra sin contraseña y la caché se relee', async () => {
    const { api, call, backend } = await setup()
    const e = await mk(call)
    const { token } = await call('POST', `/api/rt/${e.slug}/owner-session`)
    const me = await call('GET', `/api/rt/${e.slug}/me`, undefined, token)
    expect(me.user.username).toBe('admin')
    // un cambio hecho por fuera (otra pestaña o el chat) se ve tras invalidar
    for (const k of [...backend.data.keys()]) if (k === `erps/${e.id}`) backend.data.delete(k)
    expect(api.store.invalidate()).toBe(true)
    expect(await call('GET', '/api/erps')).toEqual([])
  })
})

describe('nivel pro: caja, compras, gastos, utilidad, alertas y asistente', () => {
  it('flujo completo de un día de negocio', async () => {
    const { call, fail } = await setup()
    const e = await mk(call, 'Tienda Pro', 'tienda'), u = `/api/rt/${e.slug}`, t = await login(call, e.slug)
    const me = await call('GET', `${u}/me`, undefined, t)
    expect(me.modules.map((m: any) => m.key)).toEqual(expect.arrayContaining(['caja', 'compras', 'automatizaciones', 'asistente']))
    const sup = await call('POST', `${u}/suppliers`, { name: 'Distribuidora Andina' }, t)
    const p = await call('POST', `${u}/products`, { sku: 'AR', name: 'Arroz', price: '5000', cost: '3000', initial_stock: '10', min_stock: '8' }, t)
    // venta en efectivo sin caja: bloqueada; con tarjeta sí
    expect((await fail('POST', `${u}/sales`, { items: [{ product_id: p.id, qty: '1' }] }, t))!.status).toBe(409)
    await call('POST', `${u}/sales`, { payment_method: 'tarjeta', items: [{ product_id: p.id, qty: '1' }] }, t)
    // caja
    await call('POST', `${u}/cash/open`, { opening_amount: '50000' }, t)
    expect((await fail('POST', `${u}/cash/open`, { opening_amount: '1' }, t))!.status).toBe(409)
    await call('POST', `${u}/sales`, { items: [{ product_id: p.id, qty: '2' }] }, t) // 10.000 efectivo
    const g = await call('POST', `${u}/expenses`, { concept: 'Domicilio', amount: '3000', method: 'efectivo' }, t)
    // compra: costo promedio ponderado (7 u a 3000 + 10 u a 3600 => 3352.94)
    const pur = await call('POST', `${u}/purchases`, { supplier_id: sup.id, payment: 'credito', items: [{ product_id: p.id, qty: '10', unit_cost: '3600' }] }, t)
    expect(pur.number).toBe('C-000001')
    const prod = (await call('GET', `${u}/products`, undefined, t))[0]
    expect([prod.stock, prod.cost]).toEqual(['17.0000', '3352.9412'])
    const cash = await call('GET', `${u}/cash`, undefined, t)
    expect([cash.open.ventas_efectivo, cash.open.gastos_efectivo, cash.open.esperado]).toEqual(['10000.0000', '3000.0000', '57000.0000'])
    const closed = await call('POST', `${u}/cash/close`, { counted_amount: '56500' }, t)
    expect([closed.status, closed.difference]).toEqual(['cerrada', '-500.0000'])
    expect((await fail('POST', `${u}/expenses/${g.id}/void`, undefined, t))!.status).toBe(409)
    // utilidad: ventas netas 15.000 - costo 9.000 (3 u x 3000) - gastos 3.000 = 3.000
    const d = await call('GET', `${u}/dashboard`, undefined, t)
    expect([d.ventas_netas_mes, d.costo_ventas_mes, d.gastos_mes, d.utilidad_mes, d.margen_mes]).toEqual(['15000.00', '9000.00', '3000.00', '3000.00', '20.0'])
    expect(d.ventas_por_metodo.length).toBe(2)
    expect(d.alertas.some((a: any) => a.rule === 'compras_credito')).toBe(true)
    await call('POST', `${u}/purchases/${pur.id}/pay`, undefined, t)
    // anular compra: no si ya se vendió parte de lo comprado de más
    await call('POST', `${u}/sales`, { payment_method: 'transferencia', items: [{ product_id: p.id, qty: '10' }] }, t)
    expect((await fail('POST', `${u}/purchases/${pur.id}/void`, undefined, t))!.status).toBe(409)
    // automatizaciones: meta diaria
    await call('PUT', `${u}/automations/meta_ventas`, { enabled: true, params: { meta_diaria: '100000' } }, t)
    const run = await call('POST', `${u}/automations/run`, undefined, t)
    expect(run.alerts.find((a: any) => a.rule === 'meta_ventas').title).toContain('%')
    expect(run.alerts.find((a: any) => a.rule === 'stock_bajo')).toBeTruthy()
    expect((await call('GET', `${u}/automations`, undefined, t)).history.length).toBe(1)
    // asistente IA con datos reales
    const a = await call('POST', `${u}/assistant`, { messages: [{ role: 'user', content: '¿Qué debo reabastecer?' }] }, t)
    expect(a.text).toContain('Arroz')
    // la fábrica ve alertas de licencias
    const c = await call('POST', '/api/clients', { name: 'Cliente X' })
    const plans = await call('GET', '/api/plans')
    const l = await call('POST', '/api/licenses', { client_id: c.id, plan_id: plans[0].id, start_date: '2020-01-01' })
    expect(l.renewal_date).toBe('2020-02-01')
    expect((await call('GET', '/api/alerts')).some((x: any) => x.title.includes('vencida'))).toBe(true)
  })
})
