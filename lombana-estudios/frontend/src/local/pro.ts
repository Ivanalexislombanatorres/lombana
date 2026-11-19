// Funciones "pro" del runtime de cada ERP: caja, gastos, compras, utilidad, automatizaciones, alertas y asistente IA.
import { D, type Dec } from './formula'
import type { Store } from './store'
import { E, M4, localDay, nowIso, num, text, type Any } from './util'

export const NOT_HANDLED = Symbol('no')
export type ProCtx = {
  e: Any; user: Any; config: Any; tz: string; store: Store
  can(p: string): boolean; require(p: string): void
  log(action: string, entity: string, id?: unknown, detail?: Any): Promise<void>
  col(c: string): string; all(c: string): Any[]; get(c: string, id: unknown): Any | undefined
  sample: () => Promise<((input: string | { role: string; content: string }[], opts?: Any) => Promise<{ text: string }>) | null>
  aiLog(task: string, ok: boolean, latency: number, chars: number, error: string | null, promptChars: number): Promise<void>
  agentData(): Any
}
const sumBy = (rows: Any[], k: string): Dec => rows.reduce<Dec>((s, r) => s.plus(r[k] ?? 0), new D(0))
const enabled = (c: ProCtx, key: string) => (c.config.modules ?? []).some((m: Any) => m.key === key && m.enabled)
const METHODS = ['efectivo', 'tarjeta', 'transferencia']

// ---------------------------------------------------------------- caja
export function openSession(c: ProCtx) { return c.all('cash_sessions').find(s => s.status === 'abierta') }
function sessionTotals(c: ProCtx, s: Any) {
  const sales = c.all('sales').filter(v => v.cash_session_id === s.id && v.status === 'confirmada')
  const exp = c.all('expenses').filter(x => x.cash_session_id === s.id && x.status !== 'anulado')
  const pur = c.all('purchases').filter(p => p.cash_session_id === s.id && p.status !== 'anulada')
  const ventas = sumBy(sales, 'total'), gastos = sumBy(exp, 'amount'), compras = sumBy(pur, 'total')
  const esperado = new D(s.opening_amount).plus(ventas).minus(gastos).minus(compras)
  return { ventas_efectivo: M4(ventas), num_ventas: sales.length, gastos_efectivo: M4(gastos), compras_efectivo: M4(compras), esperado: M4(esperado) }
}

// ---------------------------------------------------------------- automatizaciones
type Rule = { id: string; name: string; description: string; enabled: boolean; params: Any }
const DEFAULT_RULES: Rule[] = [
  { id: 'stock_bajo', name: 'Inventario bajo', description: 'Avisa cuando un producto llega a su existencia mínima.', enabled: true, params: {} },
  { id: 'agenda_hoy', name: 'Agenda del día', description: 'Avisa cuántas citas, reservas o registros con fecha de hoy tienes pendientes.', enabled: true, params: {} },
  { id: 'fechas_vencidas', name: 'Pendientes vencidos', description: 'Registros con fecha pasada que siguen agendados o reservados.', enabled: true, params: {} },
  { id: 'caja_abierta', name: 'Caja sin cerrar', description: 'Avisa si la caja quedó abierta desde un día anterior.', enabled: true, params: {} },
  { id: 'compras_credito', name: 'Compras por pagar', description: 'Compras a crédito pendientes de pago a proveedores.', enabled: true, params: {} },
  { id: 'meta_ventas', name: 'Meta de ventas del día', description: 'Muestra el avance frente a tu meta diaria de ventas.', enabled: false, params: { meta_diaria: '500000' } },
]
async function rules(c: ProCtx): Promise<Rule[]> {
  const saved = c.get('settings', 'automations')?.value?.rules as Rule[] | undefined
  return DEFAULT_RULES.map(d => { const s = saved?.find(x => x.id === d.id); return s ? { ...d, enabled: s.enabled, params: { ...d.params, ...s.params } } : d })
}
type Alert = { rule: string; level: 'alta' | 'media' | 'info'; title: string; detail: string; link?: string }
export async function evaluateAlerts(c: ProCtx): Promise<Alert[]> {
  const out: Alert[] = []
  const today = localDay(nowIso(), c.tz)
  const statusDone = ['cancelada', 'atendida', 'terminado', 'terminada', 'check-out', 'no asistió', 'retirado']
  for (const r of await rules(c)) {
    if (!r.enabled) continue
    if (r.id === 'stock_bajo' && enabled(c, 'productos')) {
      const low = c.all('products').filter(p => p.kind === 'producto' && p.active && new D(p.stock).lte(p.min_stock))
      if (low.length) out.push({ rule: r.id, level: 'alta', title: `${low.length} producto(s) con inventario bajo`, detail: low.slice(0, 5).map(p => `${p.name} (${new D(p.stock).toFixed()})`).join(', '), link: 'inventario' })
    }
    if ((r.id === 'agenda_hoy' || r.id === 'fechas_vencidas') && enabled(c, 'registros')) {
      for (const ent of c.config.entities ?? []) {
        const dateF = ent.fields.find((f: Any) => f.type === 'date'); if (!dateF) continue
        const stF = ent.fields.find((f: Any) => f.type === 'select' && f.key === 'estado')
        const recs = c.all('records').filter(x => x.entity === ent.key && x.data[dateF.key] && !(stF && statusDone.includes(String(x.data[stF.key] ?? '').toLowerCase())))
        if (r.id === 'agenda_hoy') { const n = recs.filter(x => x.data[dateF.key] === today).length; if (n) out.push({ rule: r.id, level: 'media', title: `${n} ${ent.label.toLowerCase()} para hoy`, detail: `Revisa ${ent.label} con fecha ${today}.`, link: `registros/${ent.key}` }) }
        else { const n = recs.filter(x => x.data[dateF.key] < today).length; if (n) out.push({ rule: r.id, level: 'media', title: `${n} ${ent.label.toLowerCase()} con fecha vencida sin cerrar`, detail: 'Actualiza su estado (atendida, cancelada…).', link: `registros/${ent.key}` }) }
      }
    }
    if (r.id === 'caja_abierta' && enabled(c, 'caja')) {
      const s = openSession(c)
      if (s && localDay(s.opened_at, c.tz) < today) out.push({ rule: r.id, level: 'alta', title: 'La caja sigue abierta desde un día anterior', detail: `Abierta el ${localDay(s.opened_at, c.tz)} por ${s.opened_by}. Ciérrala con el conteo.`, link: 'caja' })
    }
    if (r.id === 'compras_credito' && enabled(c, 'compras')) {
      const p = c.all('purchases').filter(x => x.status === 'recibida' && x.payment === 'credito' && !x.paid)
      if (p.length) out.push({ rule: r.id, level: 'media', title: `${p.length} compra(s) a crédito por pagar`, detail: `Total ${sumBy(p, 'total').toFixed(0)}`, link: 'compras' })
    }
    if (r.id === 'meta_ventas' && enabled(c, 'ventas')) {
      const meta = new D(r.params.meta_diaria || 0)
      if (meta.gt(0)) {
        const hoy = sumBy(c.all('sales').filter(s => s.status === 'confirmada' && localDay(s.created_at, c.tz) === today), 'total')
        const pct = hoy.div(meta).times(100).toDecimalPlaces(0).toNumber()
        out.push({ rule: r.id, level: pct >= 100 ? 'info' : 'media', title: pct >= 100 ? `¡Meta del día cumplida! (${pct}%)` : `Ventas de hoy al ${pct}% de la meta`, detail: `Vendido ${hoy.toFixed(0)} de ${meta.toFixed(0)}`, link: 'ventas' })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- utilidad del mes
export function profitBlock(c: ProCtx) {
  const month = localDay(nowIso(), c.tz).slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const inMonth = (iso: string, mm: string) => localDay(iso, c.tz).startsWith(mm)
  const sales = c.all('sales').filter(s => s.status === 'confirmada' && inMonth(s.created_at, month))
  const netas = sales.reduce((s, v) => s.plus(v.subtotal).minus(v.discount), new D(0))
  const costo = sales.reduce((s, v) => s.plus((v.items as Any[]).reduce((a: Dec, it: Any) => a.plus(new D(it.unit_cost ?? 0).times(it.qty)), new D(0))), new D(0))
  const gastos = sumBy(c.all('expenses').filter(x => x.status !== 'anulado' && inMonth(x.created_at, month)), 'amount')
  const compras = sumBy(c.all('purchases').filter(p => p.status !== 'anulada' && inMonth(p.created_at, month)), 'total')
  const prev = sumBy(c.all('sales').filter(s => s.status === 'confirmada' && inMonth(s.created_at, prevMonth)), 'total')
  const metodo: Record<string, Dec> = {}
  for (const s of sales) metodo[s.payment_method ?? 'efectivo'] = (metodo[s.payment_method ?? 'efectivo'] ?? new D(0)).plus(s.total)
  const utilidad = netas.minus(costo).minus(gastos)
  return {
    ventas_netas_mes: netas.toFixed(2), costo_ventas_mes: costo.toFixed(2), gastos_mes: gastos.toFixed(2), compras_mes: compras.toFixed(2),
    utilidad_mes: utilidad.toFixed(2), margen_mes: netas.isZero() ? '0' : utilidad.div(netas).times(100).toFixed(1),
    ventas_mes_anterior: prev.toFixed(2), ventas_por_metodo: Object.entries(metodo).map(([k, v]) => ({ metodo: k, total: v.toFixed(2) })),
    caja: enabled(c, 'caja') ? (openSession(c) ? 'abierta' : 'cerrada') : null,
  }
}

// ---------------------------------------------------------------- enrutador pro
export async function handlePro(c: ProCtx, method: string, sub: string, _q: Any, b: Any): Promise<unknown> {
  let r: RegExpMatchArray | null
  const m = (re: RegExp) => sub.match(re)
  const user = c.user.username

  // --- caja
  if (sub === '/cash' && method === 'GET') {
    c.require('caja:ver')
    const s = openSession(c)
    const sessions = [...c.all('cash_sessions')].reverse().slice(0, 30).map(x => ({ ...x, ...(x.status === 'abierta' ? sessionTotals(c, x) : {}) }))
    return { open: s ? { ...s, ...sessionTotals(c, s) } : null, sessions }
  }
  if (sub === '/cash/open') {
    c.require('caja:crear')
    if (openSession(c)) E(409, 'Ya hay una caja abierta')
    const amount = num(b.opening_amount ?? 0, 'Base inicial')
    const id = c.store.nextId(c.col('cash_sessions'))
    const s = { id, status: 'abierta', opening_amount: M4(amount), opened_by: user, opened_at: nowIso(), closed_by: null, closed_at: null, counted_amount: null, expected_amount: null, difference: null, notes: null }
    await c.store.put(c.col('cash_sessions'), id, s); await c.log('abrir', 'caja', id, { base: amount.toFixed() }); return s
  }
  if (sub === '/cash/close') {
    c.require('caja:editar')
    const s = openSession(c) ?? E(409, 'No hay una caja abierta')
    const counted = num(b.counted_amount, 'Dinero contado')
    const t = sessionTotals(c, s)
    Object.assign(s, { status: 'cerrada', closed_by: user, closed_at: nowIso(), counted_amount: M4(counted), expected_amount: t.esperado,
      difference: M4(counted.minus(t.esperado)), notes: text(b.notes, 'Notas', 0, 300, true), ...t })
    await c.store.put(c.col('cash_sessions'), s.id, s); await c.log('cerrar', 'caja', s.id, { esperado: t.esperado, contado: counted.toFixed(), diferencia: s.difference }); return s
  }

  // --- gastos
  if (sub === '/expenses' && method === 'GET') { c.require('caja:ver'); return [...c.all('expenses')].reverse().slice(0, 300) }
  if (sub === '/expenses' && method === 'POST') {
    c.require('caja:crear')
    const amount = num(b.amount, 'Valor'); if (amount.lte(0)) E(422, 'Valor: debe ser mayor que cero')
    const methodP = METHODS.includes(b.method) ? b.method : 'efectivo'
    const s = openSession(c)
    if (methodP === 'efectivo' && !s) E(409, 'Para registrar un gasto en efectivo primero abre la caja')
    const id = c.store.nextId(c.col('expenses'))
    const x = { id, concept: text(b.concept, 'Concepto', 2, 120), category: text(b.category, 'Categoría', 0, 60, true) ?? 'General', amount: M4(amount),
      method: methodP, cash_session_id: methodP === 'efectivo' ? s!.id : null, status: 'activo', notes: text(b.notes, 'Notas', 0, 300, true), created_by: user, created_at: nowIso() }
    await c.store.put(c.col('expenses'), id, x); await c.log('crear', 'gasto', id, { valor: amount.toFixed(), concepto: x.concept }); return x
  }
  if ((r = m(/^\/expenses\/(\d+)\/void$/))) {
    c.require('caja:eliminar')
    const x = c.get('expenses', r[1]) ?? E(404, 'Gasto no encontrado')
    if (x.status === 'anulado') E(409, 'El gasto ya está anulado')
    const sess = x.cash_session_id ? c.get('cash_sessions', x.cash_session_id) : null
    if (sess && sess.status === 'cerrada') E(409, 'No se puede anular: la caja de ese gasto ya se cerró')
    x.status = 'anulado'; await c.store.put(c.col('expenses'), x.id, x); await c.log('anular', 'gasto', x.id); return x
  }

  // --- compras
  const supName = (id: unknown) => c.get('suppliers', id)?.name ?? '—'
  const purOut = (p: Any, full = false) => {
    const o: Any = { ...p, supplier: supName(p.supplier_id) }
    if (full) { const names = Object.fromEntries(c.all('products').map(x => [x.id, x.name])); o.items = p.items.map((i: Any) => ({ ...i, product: names[i.product_id] })) } else delete o.items
    return o
  }
  if (sub === '/purchases' && method === 'GET') { c.require('compras:ver'); return [...c.all('purchases')].reverse().slice(0, 300).map(p => purOut(p)) }
  if ((r = m(/^\/purchases\/(\d+)$/))) { c.require('compras:ver'); return purOut(c.get('purchases', r[1]) ?? E(404, 'Compra no encontrada'), true) }
  if (sub === '/purchases' && method === 'POST') {
    c.require('compras:crear')
    if (!c.get('suppliers', b.supplier_id)) E(422, 'Elige un proveedor')
    const items: Any[] = b.items ?? []
    if (!items.length || items.length > 200) E(422, 'Agrega entre 1 y 200 productos')
    const payment = ['efectivo', 'transferencia', 'credito'].includes(b.payment) ? b.payment : 'transferencia'
    const s = openSession(c)
    if (payment === 'efectivo' && !s) E(409, 'Para pagar en efectivo primero abre la caja')
    const lines: [Any, Dec, Dec][] = items.map(it => {
      const p = c.get('products', it.product_id); if (!p || p.kind !== 'producto') E(422, `Producto ${it.product_id} inexistente o es un servicio`)
      const qty = num(it.qty, 'Cantidad'); if (qty.lte(0)) E(422, 'Cantidad: debe ser mayor que cero')
      return [p!, qty, num(it.unit_cost, 'Costo unitario')]
    })
    const total = lines.reduce((s2, [, qty, cost]) => s2.plus(qty.times(cost)), new D(0)).toDecimalPlaces(2, D.ROUND_HALF_UP)
    const id = c.store.nextId(c.col('purchases'))
    const pur = { id, number: `C-${String(id).padStart(6, '0')}`, supplier_id: Number(b.supplier_id), invoice_ref: text(b.invoice_ref, 'Factura del proveedor', 0, 60, true),
      payment, paid: payment !== 'credito', cash_session_id: payment === 'efectivo' ? s!.id : null, total: M4(total), status: 'recibida',
      items: lines.map(([p, qty, cost]) => ({ product_id: p.id, qty: M4(qty), unit_cost: M4(cost), line_total: M4(qty.times(cost)) })), created_by: user, created_at: nowIso() }
    await c.store.put(c.col('purchases'), id, pur)
    for (const [p, qty, cost] of lines) {
      const stock = new D(p.stock), newStock = stock.plus(qty)
      // costo promedio ponderado
      p.cost = M4(newStock.isZero() ? cost : stock.times(p.cost).plus(qty.times(cost)).div(newStock))
      p.stock = M4(newStock)
      await c.store.put(c.col('products'), p.id, p)
      const mid = c.store.nextId(c.col('movements'))
      await c.store.put(c.col('movements'), mid, { id: mid, product_id: p.id, kind: 'entrada', qty: M4(qty), reference: pur.number, created_by: user, created_at: nowIso() })
    }
    await c.log('crear', 'compra', id, { numero: pur.number, total: pur.total }); return purOut(pur, true)
  }
  if ((r = m(/^\/purchases\/(\d+)\/pay$/))) {
    c.require('compras:editar')
    const p = c.get('purchases', r[1]) ?? E(404, 'Compra no encontrada')
    if (p.paid) E(409, 'La compra ya está pagada')
    p.paid = true; p.paid_at = nowIso(); await c.store.put(c.col('purchases'), p.id, p); await c.log('pagar', 'compra', p.id); return purOut(p)
  }
  if ((r = m(/^\/purchases\/(\d+)\/void$/))) {
    c.require('compras:eliminar')
    const p = c.get('purchases', r[1]) ?? E(404, 'Compra no encontrada')
    if (p.status === 'anulada') E(409, 'La compra ya está anulada')
    for (const it of p.items) { const pr = c.get('products', it.product_id); if (pr && new D(pr.stock).lt(it.qty)) E(409, `No se puede anular: ya se usó parte de "${pr.name}" (hay ${new D(pr.stock).toFixed()})`) }
    for (const it of p.items) {
      const pr = c.get('products', it.product_id)!; pr.stock = M4(new D(pr.stock).minus(it.qty)); await c.store.put(c.col('products'), pr.id, pr)
      const mid = c.store.nextId(c.col('movements'))
      await c.store.put(c.col('movements'), mid, { id: mid, product_id: pr.id, kind: 'salida', qty: it.qty, reference: `Anulación ${p.number}`, created_by: user, created_at: nowIso() })
    }
    p.status = 'anulada'; await c.store.put(c.col('purchases'), p.id, p); await c.log('anular', 'compra', p.id); return purOut(p)
  }

  // --- automatizaciones y alertas
  if (sub === '/alerts') { return enabled(c, 'automatizaciones') ? await evaluateAlerts(c) : [] }
  if (sub === '/automations' && method === 'GET') {
    c.require('automatizaciones:ver')
    return { rules: await rules(c), history: c.get('settings', 'automation_history')?.value ?? [] }
  }
  if ((r = m(/^\/automations\/([a-z_]+)$/)) && method === 'PUT') {
    c.require('automatizaciones:editar')
    const list = await rules(c)
    const rule = list.find(x => x.id === r![1]) ?? E(404, 'Automatización no encontrada')
    if (b.enabled !== undefined) rule.enabled = !!b.enabled
    if (b.params?.meta_diaria !== undefined) rule.params.meta_diaria = num(b.params.meta_diaria, 'Meta diaria').toFixed()
    await c.store.put(c.col('settings'), 'automations', { key: 'automations', value: { rules: list.map(x => ({ id: x.id, enabled: x.enabled, params: x.params })) } })
    await c.log('editar', 'automatizacion', rule.id, { activa: rule.enabled, ...rule.params }); return rule
  }
  if (sub === '/automations/run') {
    c.require('automatizaciones:ver')
    const alerts = await evaluateAlerts(c)
    const hist = c.get('settings', 'automation_history')?.value ?? []
    const entry = { at: nowIso(), by: user, alerts: alerts.length, summary: alerts.map(a => a.title).slice(0, 10) }
    await c.store.put(c.col('settings'), 'automation_history', { key: 'automation_history', value: [entry, ...hist].slice(0, 60) })
    return { alerts, entry }
  }

  // --- asistente IA dentro del ERP
  if (sub === '/assistant') {
    c.require('asistente:ver')
    const msgs: { role: string; content: string }[] = (Array.isArray(b.messages) ? b.messages : []).slice(-12)
      .filter((x: Any) => (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string').map((x: Any) => ({ role: x.role, content: String(x.content).slice(0, 4000) }))
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') E(422, 'Escribe una pregunta')
    const sample = await c.sample(); if (!sample) E(502, 'Claude no está disponible en esta vista')
    const data = { empresa: c.config.company, ...c.agentData(), utilidad_mes: profitBlock(c), caja: openSession(c) ? sessionTotals(c, openSession(c)!) : 'cerrada', alertas: await evaluateAlerts(c) }
    const rulesTxt = `Eres el asistente del ERP de "${c.config.company?.name}". Respondes en español, breve, claro y práctico, con cifras en ${c.config.company?.currency ?? 'COP'}. ` +
      'Usa SOLO estos datos reales de la empresa (JSON). Si un dato no está, dilo. Nunca inventes cifras. No puedes modificar datos: si algo requiere un cambio, explica en qué pantalla del ERP hacerlo.\n\n' +
      `DATOS:\n${JSON.stringify(data)}`
    const convo = [{ role: 'user', content: `${rulesTxt}\n\nPrimera pregunta: ${msgs[0].content}` }, ...msgs.slice(1)]
    const t0 = performance.now()
    try {
      const out = await sample(convo.length === 1 ? convo[0].content : convo, { cache: false })
      await c.aiLog('asistente_erp', true, Math.round(performance.now() - t0), out.text.length, null, rulesTxt.length)
      await c.log('consulta', 'asistente_ia', null, { pregunta: msgs[msgs.length - 1].content.slice(0, 200) })
      return { text: out.text }
    } catch (e) {
      const msg = (e as Any)?.code === 'not_granted' ? 'No diste permiso para consultar a Claude desde esta página' : (e as Any)?.message ?? 'Error de IA'
      await c.aiLog('asistente_erp', false, Math.round(performance.now() - t0), 0, msg, rulesTxt.length)
      return E(502, msg)
    }
  }
  return NOT_HANDLED
}
