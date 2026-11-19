import { useMemo, useState } from 'react'
import { Plus, Printer, Trash2 } from 'lucide-react'
import { IS_ARTIFACT, dt, money, num } from '../lib/api'
import { useLoad } from '../components/ui'
import { useRt } from './RuntimeApp'
import type { Product } from './RtCatalog'
import { Pill, RtError, RtField, RtHeader, RtModal, RtTable } from './rtui'

type Sale = { id: number; number: string; customer: string; subtotal: string; discount: string; tax: string; total: string; status: string; created_by: string; created_at: string; payment_method?: string
  items?: { product: string; qty: string; unit_price: string; tax_rate: string; line_total: string }[] }
type Line = { product_id: number; qty: string; unit_price: string }

export default function Sales() {
  const { api, can, me } = useRt()
  const cur = me.company.currency
  const sales = useLoad(() => api.get<Sale[]>('/sales'), [api])
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<Sale | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const show = async (id: number) => { try { setDetail(await api.get<Sale>(`/sales/${id}`)) } catch (e) { setErr((e as Error).message) } }
  return (
    <div>
      <RtHeader title={me.modules.find(m => m.key === 'ventas')?.label ?? 'Ventas'}
        actions={can('ventas:crear') && <button className="rt-btn flex items-center gap-1" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Nueva venta</button>} />
      <RtError error={err ?? sales.error} />
      <RtTable head={['Número', 'Fecha', 'Cliente', 'Subtotal', 'Descuento', 'Impuesto', 'Total', 'Estado', '']} empty={!sales.data?.length}>
        {sales.data?.map(s => (
          <tr key={s.id} className="cursor-pointer hover:opacity-80" onClick={() => show(s.id)}>
            <td className="px-3 py-2 font-mono text-xs">{s.number}</td><td className="px-3">{dt(s.created_at)}</td><td className="px-3">{s.customer}</td>
            <td className="px-3">{money(s.subtotal, cur)}</td><td className="px-3">{money(s.discount, cur)}</td><td className="px-3">{money(s.tax, cur)}</td>
            <td className="px-3 font-bold">{money(s.total, cur)}</td><td className="px-3"><Pill tone={s.status === 'confirmada' ? 'green' : 'red'}>{s.status}</Pill></td>
            <td className="px-3 text-right"><Printer className="inline h-4 w-4 opacity-60" /></td>
          </tr>
        ))}
      </RtTable>
      {open && <NewSale onClose={() => setOpen(false)} onDone={id => { setOpen(false); sales.reload(); show(id) }} />}
      <RtModal open={!!detail} title={`Venta ${detail?.number ?? ''}`} onClose={() => setDetail(null)} wide>
        {detail && <Invoice s={detail} />}
        <RtError error={err} />
        <div className="mt-4 flex justify-between">
          {can('ventas:eliminar') && detail?.status === 'confirmada' ? <button className="rt-btn-ghost text-red-600" onClick={async () => {
            if (!confirm('¿Anular esta venta? Se devolverán las existencias al inventario.')) return
            try { setDetail(await api.post<Sale>(`/sales/${detail.id}/void`)); sales.reload() } catch (e) { setErr((e as Error).message) }
          }}>Anular venta</button> : <span />}
          {IS_ARTIFACT ? <span className="rt-muted text-xs">La impresión no está disponible dentro de Claude</span>
            : <button className="rt-btn flex items-center gap-1" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir</button>}
        </div>
      </RtModal>
    </div>
  )
}

function Invoice({ s }: { s: Sale }) {
  const { me } = useRt()
  const b = me.branding, cur = me.company.currency
  const t = b.invoice_template
  return (
    <div className="print-area rounded-lg bg-white p-6 text-slate-900" style={{ fontFamily: `"${b.font}", system-ui` }}>
      <div className="mb-4 flex items-start justify-between" style={t === 'moderna' ? { borderBottom: `4px solid ${b.primary}`, paddingBottom: 12 } : t === 'clasica' ? { border: '1px solid #ccc', padding: 12 } : {}}>
        <div className="flex items-center gap-3">
          {b.logo && <img src={b.logo} alt="" className="h-14 w-14 object-contain" />}
          <div><div className="text-lg font-bold">{b.company_name || me.company.name}</div><div className="text-xs text-slate-500">{b.contact_address} {b.contact_phone} {b.contact_email}</div></div>
        </div>
        <div className="text-right"><div className="text-xs uppercase text-slate-500">Comprobante de venta</div><div className="text-xl font-bold" style={{ color: t === 'minimal' ? undefined : b.primary }}>{s.number}</div><div className="text-xs">{dt(s.created_at)}</div>
          {s.status === 'anulada' && <div className="mt-1 font-bold text-red-600">ANULADA</div>}</div>
      </div>
      <p className="mb-3 text-sm"><b>Cliente:</b> {s.customer}{s.payment_method ? <> · <b>Pago:</b> {s.payment_method}</> : null}</p>
      <table className="mb-4 w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="py-1">Producto</th><th>Cant.</th><th>Precio</th><th>IVA %</th><th className="text-right">Total</th></tr></thead>
        <tbody>{s.items?.map((i, k) => <tr key={k} className="border-b border-slate-100"><td className="py-1">{i.product}</td><td>{num(i.qty)}</td><td>{money(i.unit_price, cur)}</td><td>{num(i.tax_rate)}</td><td className="text-right">{money(i.line_total, cur)}</td></tr>)}</tbody>
      </table>
      <div className="ml-auto w-64 space-y-1 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(s.subtotal, cur)}</span></div>
        <div className="flex justify-between"><span>Descuento</span><span>− {money(s.discount, cur)}</span></div>
        <div className="flex justify-between"><span>Impuestos</span><span>{money(s.tax, cur)}</span></div>
        <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span>{money(s.total, cur)}</span></div>
      </div>
      {b.document_footer && <p className="mt-6 border-t pt-2 text-center text-xs text-slate-500">{b.document_footer}</p>}
      <p className="mt-2 text-center text-[10px] text-slate-400">Documento interno. No reemplaza la factura electrónica exigida por la autoridad tributaria.</p>
    </div>
  )
}

function NewSale({ onClose, onDone }: { onClose: () => void; onDone: (id: number) => void }) {
  const { api, can, me } = useRt()
  const cur = me.company.currency
  const prods = useLoad(() => api.get<Product[]>('/products'), [api])
  const custs = useLoad(() => api.get<{ id: number; name: string }[]>('/customers'), [api])
  const [customer, setCustomer] = useState('')
  const [disc, setDisc] = useState('0')
  const [pay, setPay] = useState('efectivo')
  const [lines, setLines] = useState<Line[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = prods.data?.filter(p => p.active) ?? []
  const byId = useMemo(() => Object.fromEntries(active.map(p => [p.id, p])), [active])
  const add = (id: number) => { const p = byId[id]; if (p) setLines([...lines, { product_id: id, qty: '1', unit_price: p.price }]) }
  // vista previa (el servidor recalcula con precisión decimal y es la fuente de verdad)
  const preview = lines.reduce((acc, l) => {
    const p = byId[l.product_id]; if (!p) return acc
    const base = Number(l.unit_price) * Number(l.qty), d = base * Number(disc) / 100
    return { sub: acc.sub + base, disc: acc.disc + d, tax: acc.tax + (base - d) * Number(p.tax_rate) / 100 }
  }, { sub: 0, disc: 0, tax: 0 })
  const submit = async () => {
    setErr(null); setBusy(true)
    try {
      const r = await api.post<{ id: number }>('/sales', {
        customer_id: customer ? Number(customer) : null, discount_pct: disc || '0', payment_method: pay,
        items: lines.map(l => ({ product_id: l.product_id, qty: l.qty, ...(l.unit_price !== byId[l.product_id]?.price ? { unit_price: l.unit_price } : {}) })),
      })
      onDone(r.id)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <RtModal open title="Nueva venta" onClose={onClose} wide>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <RtField label="Cliente de la venta"><select className="rt-inp" value={customer} onChange={e => setCustomer(e.target.value)}><option value="">Consumidor final</option>{custs.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></RtField>
        <RtField label="Agregar producto"><select aria-label="Agregar producto" className="rt-inp" value="" onChange={e => add(Number(e.target.value))}>
          <option value="">Elegir…</option>{active.map(p => <option key={p.id} value={p.id}>{p.name} — {money(p.price, cur)}{p.kind === 'producto' ? ` (hay ${num(p.stock)})` : ''}</option>)}</select></RtField>
        <RtField label="Descuento %"><input className="rt-inp" type="number" min={0} max={100} value={disc} onChange={e => setDisc(e.target.value)} /></RtField>
      </div>
      <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Método de pago">
        {[['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['transferencia', 'Transferencia']].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={pay === v} onClick={() => setPay(v)} className={pay === v ? 'rt-btn' : 'rt-btn-ghost'}>{l}</button>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs"><th>Producto</th><th className="w-24">Cantidad</th><th className="w-32">Precio</th><th className="text-right">Total</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}><td className="py-1">{byId[l.product_id]?.name}</td>
            <td><input aria-label="Cantidad" className="rt-inp py-1" type="number" min={0} step="any" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></td>
            <td><input aria-label="Precio" className="rt-inp py-1" type="number" min={0} step="any" disabled={!can('ventas:editar')} value={l.unit_price} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} /></td>
            <td className="text-right">{money(Number(l.qty) * Number(l.unit_price), cur)}</td>
            <td className="text-right"><button aria-label="Quitar línea" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-red-600" /></button></td></tr>
        ))}</tbody>
      </table>
      {lines.length === 0 && <p className="rt-muted py-4 text-center text-sm">Agrega productos o servicios.</p>}
      <div className="ml-auto mt-3 w-64 space-y-1 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(preview.sub, cur)}</span></div>
        <div className="flex justify-between"><span>Descuento</span><span>− {money(preview.disc, cur)}</span></div>
        <div className="flex justify-between"><span>Impuestos</span><span>{money(preview.tax, cur)}</span></div>
        <div className="flex justify-between border-t pt-1 text-base font-bold"><span>Total</span><span data-testid="sale-total">{money(preview.sub - preview.disc + preview.tax, cur)}</span></div>
      </div>
      <RtError error={err} />
      <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={!lines.length || busy} onClick={submit}>{busy ? 'Registrando…' : 'Confirmar venta'}</button></div>
    </RtModal>
  )
}
