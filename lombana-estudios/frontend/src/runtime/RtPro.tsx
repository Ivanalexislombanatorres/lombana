// Pantallas pro del ERP: Caja y gastos, Compras, Automatizaciones, campana de alertas y Asistente IA.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Lock, Plus, Send, Sparkles, Trash2, Unlock, X, Zap } from 'lucide-react'
import { dt, money, num } from '../lib/api'
import { useLoad } from '../components/ui'
import { useRt } from './RuntimeApp'
import type { Product } from './RtCatalog'
import { Pill, RtError, RtField, RtHeader, RtModal, RtTable } from './rtui'

type Sess = { id: number; status: string; opening_amount: string; opened_by: string; opened_at: string; closed_by: string | null; closed_at: string | null
  counted_amount: string | null; expected_amount: string | null; difference: string | null; ventas_efectivo?: string; gastos_efectivo?: string; compras_efectivo?: string; esperado?: string; num_ventas?: number }
type Exp = { id: number; concept: string; category: string; amount: string; method: string; status: string; created_by: string; created_at: string }
export type AlertT = { rule?: string; level: 'alta' | 'media' | 'info'; title: string; detail: string; link?: string }

const toneOf = (l: string) => (l === 'alta' ? 'red' : l === 'media' ? 'amber' : 'green') as 'red' | 'amber' | 'green'

// ---------------------------------------------------------------- Caja y gastos
export function Cash() {
  const { api, can, me } = useRt()
  const cur = me.company.currency
  const cash = useLoad(() => api.get<{ open: Sess | null; sessions: Sess[] }>('/cash'), [api])
  const exps = useLoad(() => api.get<Exp[]>('/expenses'), [api])
  const [err, setErr] = useState<string | null>(null)
  const [openM, setOpenM] = useState(false)
  const [closeM, setCloseM] = useState(false)
  const [expM, setExpM] = useState(false)
  const [base, setBase] = useState('0')
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [ex, setEx] = useState({ concept: '', category: 'General', amount: '', method: 'efectivo' })
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); cash.reload(); exps.reload() } catch (e) { setErr((e as Error).message) } }
  const o = cash.data?.open
  return (
    <div className="space-y-5">
      <RtHeader title={me.modules.find(m => m.key === 'caja')?.label ?? 'Caja y gastos'} subtitle="Apertura, cierre con arqueo y gastos del negocio"
        actions={<>
          {can('caja:crear') && <button className="rt-btn-ghost flex items-center gap-1" onClick={() => setExpM(true)}><Plus className="h-4 w-4" />Registrar gasto</button>}
          {!o && can('caja:crear') && <button className="rt-btn flex items-center gap-1" onClick={() => setOpenM(true)}><Unlock className="h-4 w-4" />Abrir caja</button>}
          {o && can('caja:editar') && <button className="rt-btn flex items-center gap-1" onClick={() => { setCounted(''); setCloseM(true) }}><Lock className="h-4 w-4" />Cerrar caja</button>}
        </>} />
      <RtError error={err ?? cash.error} />
      {o ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="cash-open">
          {[['Base inicial', o.opening_amount], ['Ventas en efectivo', o.ventas_efectivo], ['Gastos en efectivo', o.gastos_efectivo], ['Compras en efectivo', o.compras_efectivo], ['Debe haber en caja', o.esperado]]
            .map(([l, v], i) => <div key={l} className="rt-card p-4"><div className="rt-muted text-xs">{l}</div><div className="text-xl font-bold" style={i === 4 ? { color: 'var(--b-primary)' } : undefined}>{money(v, cur)}</div></div>)}
          <p className="rt-muted col-span-full text-xs">Abierta por {o.opened_by} · {dt(o.opened_at)} · {o.num_ventas} venta(s) en efectivo</p>
        </div>
      ) : <div className="rt-card p-5 text-sm"><b>La caja está cerrada.</b> <span className="rt-muted">Ábrela con la base de efectivo para registrar ventas y gastos en efectivo.</span></div>}

      <div className="grid gap-5 xl:grid-cols-2">
        <div><h2 className="mb-2 font-semibold">Gastos recientes</h2>
          <RtTable head={['Fecha', 'Concepto', 'Categoría', 'Método', 'Valor', '']} empty={!exps.data?.length}>
            {exps.data?.slice(0, 50).map(x => <tr key={x.id} className={x.status === 'anulado' ? 'opacity-50 line-through' : ''}><td className="px-3 py-2 text-xs">{dt(x.created_at)}</td><td className="px-3">{x.concept}</td><td className="px-3">{x.category}</td><td className="px-3">{x.method}</td><td className="px-3 font-semibold">{money(x.amount, cur)}</td>
              <td className="px-3 text-right">{can('caja:eliminar') && x.status !== 'anulado' && <button aria-label="Anular gasto" className="p-1 text-red-600" onClick={() => act(() => api.post(`/expenses/${x.id}/void`))}><Trash2 className="h-4 w-4" /></button>}</td></tr>)}
          </RtTable></div>
        <div><h2 className="mb-2 font-semibold">Historial de cierres</h2>
          <RtTable head={['Apertura', 'Cierre', 'Esperado', 'Contado', 'Diferencia']} empty={!cash.data?.sessions.filter(s => s.status === 'cerrada').length}>
            {cash.data?.sessions.filter(s => s.status === 'cerrada').map(s => {
              const d = Number(s.difference)
              return <tr key={s.id}><td className="px-3 py-2 text-xs">{dt(s.opened_at)}<br /><span className="rt-muted">{s.opened_by}</span></td><td className="px-3 text-xs">{dt(s.closed_at)}</td>
                <td className="px-3">{money(s.expected_amount, cur)}</td><td className="px-3">{money(s.counted_amount, cur)}</td>
                <td className="px-3"><Pill tone={d === 0 ? 'green' : d < 0 ? 'red' : 'amber'}>{d === 0 ? 'Cuadrada' : `${d > 0 ? '+' : ''}${money(d, cur)}`}</Pill></td></tr>
            })}
          </RtTable></div>
      </div>

      <RtModal open={openM} title="Abrir caja" onClose={() => setOpenM(false)}>
        <RtField label="Base inicial en efectivo"><input className="rt-inp" type="number" min={0} value={base} onChange={e => setBase(e.target.value)} /></RtField>
        <div className="mt-4 flex justify-end"><button className="rt-btn" onClick={() => act(async () => { await api.post('/cash/open', { opening_amount: base || '0' }); setOpenM(false) })}>Abrir caja</button></div>
      </RtModal>
      <RtModal open={closeM} title="Cerrar caja (arqueo)" onClose={() => setCloseM(false)}>
        {o && <p className="mb-3 text-sm">Según el sistema debe haber <b>{money(o.esperado, cur)}</b>. Cuenta el efectivo y escribe cuánto hay realmente.</p>}
        <RtField label="Dinero contado"><input className="rt-inp" type="number" min={0} value={counted} onChange={e => setCounted(e.target.value)} /></RtField>
        {o && counted !== '' && <p className="mt-2 text-sm">Diferencia: <b className={Number(counted) - Number(o.esperado) < 0 ? 'text-red-600' : ''}>{money(Number(counted) - Number(o.esperado), cur)}</b></p>}
        <div className="mt-3"><RtField label="Notas"><input className="rt-inp" value={notes} onChange={e => setNotes(e.target.value)} /></RtField></div>
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={counted === ''} onClick={() => act(async () => { await api.post('/cash/close', { counted_amount: counted, notes }); setCloseM(false) })}>Cerrar caja</button></div>
      </RtModal>
      <RtModal open={expM} title="Registrar gasto" onClose={() => setExpM(false)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <RtField label="Concepto"><input className="rt-inp" value={ex.concept} onChange={e => setEx({ ...ex, concept: e.target.value })} placeholder="Arriendo, servicios, domicilio…" /></RtField>
          <RtField label="Categoría"><select className="rt-inp" value={ex.category} onChange={e => setEx({ ...ex, category: e.target.value })}>{['General', 'Arriendo', 'Servicios públicos', 'Nómina', 'Insumos', 'Transporte', 'Publicidad', 'Mantenimiento', 'Impuestos', 'Otros'].map(c => <option key={c}>{c}</option>)}</select></RtField>
          <RtField label="Valor"><input className="rt-inp" type="number" min={0} value={ex.amount} onChange={e => setEx({ ...ex, amount: e.target.value })} /></RtField>
          <RtField label="Método de pago"><select className="rt-inp" value={ex.method} onChange={e => setEx({ ...ex, method: e.target.value })}><option value="efectivo">Efectivo (sale de la caja)</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></RtField>
        </div>
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={!ex.concept || !ex.amount} onClick={() => act(async () => { await api.post('/expenses', ex); setExpM(false); setEx({ concept: '', category: 'General', amount: '', method: 'efectivo' }) })}>Guardar gasto</button></div>
      </RtModal>
    </div>
  )
}

// ---------------------------------------------------------------- Compras
type Pur = { id: number; number: string; supplier: string; invoice_ref: string | null; payment: string; paid: boolean; total: string; status: string; created_at: string; created_by: string
  items?: { product: string; qty: string; unit_cost: string; line_total: string }[] }
export function Purchases() {
  const { api, can, me } = useRt()
  const cur = me.company.currency
  const list = useLoad(() => api.get<Pur[]>('/purchases'), [api])
  const sups = useLoad(() => api.get<{ id: number; name: string }[]>('/suppliers'), [api])
  const prods = useLoad(() => api.get<Product[]>('/products'), [api])
  const [open, setOpen] = useState(false)
  const [det, setDet] = useState<Pur | null>(null)
  const [f, setF] = useState({ supplier_id: '', invoice_ref: '', payment: 'transferencia' })
  const [lines, setLines] = useState<{ product_id: number; qty: string; unit_cost: string }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const items = prods.data?.filter(p => p.kind === 'producto') ?? []
  const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0)
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); list.reload(); prods.reload() } catch (e) { setErr((e as Error).message) } }
  return (
    <div>
      <RtHeader title={me.modules.find(m => m.key === 'compras')?.label ?? 'Compras'} subtitle="Compras a proveedores: suben el inventario y actualizan el costo promedio"
        actions={can('compras:crear') && <button className="rt-btn flex items-center gap-1" disabled={!sups.data?.length || !items.length}
          onClick={() => { setF({ supplier_id: String(sups.data![0].id), invoice_ref: '', payment: 'transferencia' }); setLines([]); setOpen(true) }}><Plus className="h-4 w-4" />Nueva compra</button>} />
      {(!sups.data?.length || !items.length) && <p className="rt-muted mb-3 text-sm">Para comprar necesitas al menos un proveedor y un producto con inventario.</p>}
      <RtError error={err ?? list.error} />
      <RtTable head={['Número', 'Fecha', 'Proveedor', 'Factura', 'Pago', 'Total', 'Estado']} empty={!list.data?.length}>
        {list.data?.map(p => <tr key={p.id} className="cursor-pointer hover:opacity-80" onClick={async () => setDet(await api.get<Pur>(`/purchases/${p.id}`))}>
          <td className="px-3 py-2 font-mono text-xs">{p.number}</td><td className="px-3">{dt(p.created_at)}</td><td className="px-3">{p.supplier}</td><td className="px-3">{p.invoice_ref ?? '—'}</td>
          <td className="px-3">{p.payment === 'credito' ? <Pill tone={p.paid ? 'green' : 'amber'}>{p.paid ? 'crédito pagado' : 'crédito por pagar'}</Pill> : p.payment}</td>
          <td className="px-3 font-semibold">{money(p.total, cur)}</td><td className="px-3"><Pill tone={p.status === 'recibida' ? 'green' : 'red'}>{p.status}</Pill></td></tr>)}
      </RtTable>
      <RtModal open={open} title="Nueva compra" onClose={() => setOpen(false)} wide>
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <RtField label="Proveedor"><select className="rt-inp" value={f.supplier_id} onChange={e => setF({ ...f, supplier_id: e.target.value })}>{sups.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></RtField>
          <RtField label="Factura del proveedor"><input className="rt-inp" value={f.invoice_ref} onChange={e => setF({ ...f, invoice_ref: e.target.value })} /></RtField>
          <RtField label="Pago"><select className="rt-inp" value={f.payment} onChange={e => setF({ ...f, payment: e.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo (de la caja)</option><option value="credito">Crédito (por pagar)</option></select></RtField>
        </div>
        <RtField label="Agregar producto"><select aria-label="Agregar producto a la compra" className="rt-inp" value="" onChange={e => { const p = items.find(x => x.id === Number(e.target.value)); if (p) setLines([...lines, { product_id: p.id, qty: '1', unit_cost: String(Number(p.cost)) }]) }}>
          <option value="">Elegir…</option>{items.map(p => <option key={p.id} value={p.id}>{p.name} (hay {num(p.stock)}, costo {money(p.cost, cur)})</option>)}</select></RtField>
        <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs"><th>Producto</th><th className="w-28">Cantidad</th><th className="w-36">Costo unitario</th><th className="text-right">Total</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={i}><td className="py-1">{items.find(p => p.id === l.product_id)?.name}</td>
            <td><input aria-label="Cantidad comprada" className="rt-inp py-1" type="number" min={0} value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></td>
            <td><input aria-label="Costo unitario" className="rt-inp py-1" type="number" min={0} value={l.unit_cost} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, unit_cost: e.target.value } : x))} /></td>
            <td className="text-right">{money(Number(l.qty) * Number(l.unit_cost), cur)}</td><td className="text-right"><button aria-label="Quitar" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-red-600" /></button></td></tr>)}</tbody></table>
        <p className="mt-3 text-right text-lg font-bold">Total: {money(total, cur)}</p>
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={!lines.length} onClick={() => act(async () => { await api.post('/purchases', { ...f, supplier_id: Number(f.supplier_id), items: lines }); setOpen(false) })}>Registrar compra</button></div>
      </RtModal>
      <RtModal open={!!det} title={`Compra ${det?.number ?? ''}`} onClose={() => setDet(null)} wide>
        {det && <><p className="mb-2 text-sm">{det.supplier} · {dt(det.created_at)} · {det.payment}{det.invoice_ref ? ` · Factura ${det.invoice_ref}` : ''}</p>
          <table className="w-full text-sm"><tbody>{det.items?.map((i, k) => <tr key={k} className="border-b"><td className="py-1">{i.product}</td><td>{num(i.qty)}</td><td>{money(i.unit_cost, cur)}</td><td className="text-right">{money(i.line_total, cur)}</td></tr>)}</tbody></table>
          <p className="mt-2 text-right font-bold">Total {money(det.total, cur)}</p>
          <div className="mt-4 flex justify-between">
            {det.status === 'recibida' && can('compras:eliminar') ? <button className="rt-btn-ghost text-red-600" onClick={() => act(async () => { setDet(await api.post<Pur>(`/purchases/${det.id}/void`)) })}>Anular compra</button> : <span />}
            {det.payment === 'credito' && !det.paid && det.status === 'recibida' && can('compras:editar') && <button className="rt-btn" onClick={() => act(async () => { await api.post(`/purchases/${det.id}/pay`); setDet(null) })}>Marcar como pagada</button>}
          </div></>}
      </RtModal>
    </div>
  )
}

// ---------------------------------------------------------------- Automatizaciones
type Rule = { id: string; name: string; description: string; enabled: boolean; params: Record<string, string> }
export function Automations() {
  const { api, can } = useRt()
  const d = useLoad(() => api.get<{ rules: Rule[]; history: { at: string; by: string; alerts: number; summary: string[] }[] }>('/automations'), [api])
  const [alerts, setAlerts] = useState<AlertT[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [meta, setMeta] = useState('')
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); d.reload() } catch (e) { setErr((e as Error).message) } }
  return (
    <div className="space-y-5">
      <RtHeader title="Automatizaciones y alertas" subtitle="Reglas que revisan tu negocio y te avisan. Se ejecutan cada vez que abres el ERP y cuando pulsas Ejecutar ahora."
        actions={<button className="rt-btn flex items-center gap-1" onClick={() => act(async () => setAlerts((await api.post<{ alerts: AlertT[] }>('/automations/run')).alerts))}><Zap className="h-4 w-4" />Ejecutar ahora</button>} />
      <RtError error={err ?? d.error} />
      {alerts && <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Resultado</h3>{alerts.length ? <AlertList alerts={alerts} /> : <p className="rt-muted text-sm">Todo en orden: ninguna alerta.</p>}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {d.data?.rules.map(r => (
          <div key={r.id} className="rt-card flex items-start gap-3 p-4" data-testid={`rule-${r.id}`}>
            <Zap className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--b-primary)' }} />
            <div className="flex-1"><div className="font-semibold">{r.name}</div><div className="rt-muted text-sm">{r.description}</div>
              {r.id === 'meta_ventas' && <div className="mt-2 flex gap-2"><input aria-label="Meta diaria" className="rt-inp max-w-40 py-1" type="number" min={0} placeholder={r.params.meta_diaria} value={meta} onChange={e => setMeta(e.target.value)} />
                <button className="rt-btn-ghost" disabled={!meta || !can('automatizaciones:editar')} onClick={() => act(async () => { await api.put(`/automations/${r.id}`, { params: { meta_diaria: meta } }); setMeta('') })}>Guardar meta</button></div>}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={r.enabled} disabled={!can('automatizaciones:editar')} onChange={e => act(() => api.put(`/automations/${r.id}`, { enabled: e.target.checked }))} />{r.enabled ? 'Activa' : 'Inactiva'}</label>
          </div>
        ))}
      </div>
      <div><h2 className="mb-2 font-semibold">Historial de ejecución</h2>
        <RtTable head={['Fecha', 'Usuario', 'Alertas', 'Resumen']} empty={!d.data?.history.length}>
          {d.data?.history.map((h, i) => <tr key={i}><td className="px-3 py-2 text-xs">{dt(h.at)}</td><td className="px-3">{h.by}</td><td className="px-3">{h.alerts}</td><td className="px-3 text-xs">{h.summary.join(' · ')}</td></tr>)}
        </RtTable></div>
    </div>
  )
}

export function AlertList({ alerts, onPick }: { alerts: AlertT[]; onPick?: () => void }) {
  const { slug } = useRt()
  return <ul className="space-y-2">{alerts.map((a, i) => (
    <li key={i} className="flex items-start gap-2 text-sm"><Pill tone={toneOf(a.level)}>{a.level}</Pill>
      <div className="flex-1"><div className="font-medium">{a.link ? <Link to={`/erp/${slug}/${a.link}`} onClick={onPick} className="hover:underline">{a.title}</Link> : a.title}</div><div className="rt-muted text-xs">{a.detail}</div></div></li>
  ))}</ul>
}

export function AlertsBell() {
  const { api, me } = useRt()
  const [open, setOpen] = useState(false)
  const on = me.modules.some(m => m.key === 'automatizaciones')
  const a = useLoad(() => (on ? api.get<AlertT[]>('/alerts') : Promise.resolve([] as AlertT[])), [api, on])
  if (!on) return null
  const n = a.data?.length ?? 0
  return (
    <div className="relative">
      <button aria-label="Alertas" className="relative rounded-full p-2 hover:bg-black/5" onClick={() => { setOpen(o => !o); if (!open) a.reload() }}>
        <Bell className="h-5 w-5" />{n > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{n}</span>}
      </button>
      {open && <div className="rt-card absolute right-0 z-40 mt-2 w-96 p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between"><b>Alertas</b><button aria-label="Cerrar alertas" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
        {n ? <AlertList alerts={a.data!} onPick={() => setOpen(false)} /> : <p className="rt-muted text-sm">Todo en orden.</p>}
      </div>}
    </div>
  )
}

// ---------------------------------------------------------------- Asistente IA
export function Assistant() {
  const { api, me } = useRt()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])
  if (!me.modules.some(m => m.key === 'asistente')) return null
  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const next = [...msgs, { role: 'user' as const, content: text.trim() }]
    setMsgs(next); setQ(''); setBusy(true); setErr(null)
    try { const r = await api.post<{ text: string }>('/assistant', { messages: next }); setMsgs([...next, { role: 'assistant', content: r.text }]) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const sugg = ['¿Cómo van mis ventas este mes?', '¿Qué productos debo reabastecer?', '¿Cuál es mi utilidad y cómo mejorarla?', '¿Qué tengo pendiente hoy?']
  return (
    <>
      <button aria-label="Asistente IA" onClick={() => setOpen(o => !o)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-white shadow-2xl transition hover:scale-105" style={{ background: 'var(--b-primary)' }}>
        <Sparkles className="h-5 w-5" />Asistente IA
      </button>
      {open && (
        <div className="rt-card fixed bottom-20 right-5 z-40 flex h-[32rem] w-[min(26rem,calc(100vw-2.5rem))] flex-col shadow-2xl" role="dialog" aria-label="Asistente IA">
          <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: '#0001' }}><Sparkles className="h-5 w-5" style={{ color: 'var(--b-primary)' }} /><b className="flex-1">Asistente de {me.company.name}</b>
            <button aria-label="Cerrar asistente" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {!msgs.length && <div><p className="rt-muted mb-2">Pregúntame sobre tu negocio. Respondo con los datos reales de este ERP (solo los leo, no los modifico).</p>
              <div className="flex flex-wrap gap-2">{sugg.map(s => <button key={s} className="rt-btn-ghost text-left text-xs" onClick={() => send(s)}>{s}</button>)}</div></div>}
            {msgs.map((m, i) => <div key={i} className={m.role === 'user' ? 'ml-8 rounded-xl p-2 text-white' : 'mr-4 whitespace-pre-wrap'} style={m.role === 'user' ? { background: 'var(--b-primary)' } : undefined}>{m.content}</div>)}
            {busy && <p className="rt-muted animate-pulse">Pensando…</p>}
            <RtError error={err} />
            <div ref={end} />
          </div>
          <form className="flex gap-2 border-t p-3" style={{ borderColor: '#0001' }} onSubmit={e => { e.preventDefault(); send(q) }}>
            <input aria-label="Pregunta al asistente" className="rt-inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Escribe tu pregunta…" />
            <button aria-label="Enviar" className="rt-btn" disabled={busy || !q.trim()}><Send className="h-4 w-4" /></button>
          </form>
        </div>
      )}
    </>
  )
}
