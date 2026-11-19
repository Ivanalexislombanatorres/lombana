import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { dt, money, num } from '../lib/api'
import { useLoad } from '../components/ui'
import { useRt } from './RuntimeApp'
import { Pill, RtError, RtField, RtHeader, RtModal, RtTable } from './rtui'

type Party = { id: number; name: string; document: string | null; email: string | null; phone: string | null; address: string | null }
const EMPTY_P = { name: '', document: '', email: '', phone: '', address: '' }

export function Parties({ kind, module }: { kind: 'customers' | 'suppliers'; module: string }) {
  const { api, can, me } = useRt()
  const [q, setQ] = useState('')
  const list = useLoad(() => api.get<Party[]>(`/${kind}?q=${encodeURIComponent(q)}`), [api, kind, q])
  const [form, setForm] = useState<null | (typeof EMPTY_P & { id?: number })>(null)
  const [err, setErr] = useState<string | null>(null)
  const label = me.modules.find(m => m.key === module)?.label ?? module
  const save = async () => {
    setErr(null)
    const { id, ...b } = form!
    const body = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v === '' ? null : v]))
    try { if (id) await api.put(`/${kind}/${id}`, body); else await api.post(`/${kind}`, body); setForm(null); list.reload() }
    catch (e) { setErr((e as Error).message) }
  }
  const del = async (p: Party) => {
    if (!confirm(`¿Eliminar "${p.name}"?`)) return
    try { await api.del(`/${kind}/${p.id}`); list.reload() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div>
      <RtHeader title={label} actions={can(`${module}:crear`) && <button className="rt-btn flex items-center gap-1" onClick={() => setForm({ ...EMPTY_P })}><Plus className="h-4 w-4" />Nuevo</button>} />
      <input className="rt-inp mb-3 max-w-sm" placeholder="Buscar por nombre…" value={q} onChange={e => setQ(e.target.value)} />
      <RtError error={err ?? list.error} />
      <RtTable head={['Nombre', 'Documento', 'Correo', 'Teléfono', 'Dirección', '']} empty={!list.data?.length}>
        {list.data?.map(p => (
          <tr key={p.id}><td className="px-3 py-2 font-medium">{p.name}</td><td className="px-3">{p.document}</td><td className="px-3">{p.email}</td><td className="px-3">{p.phone}</td><td className="px-3">{p.address}</td>
            <td className="whitespace-nowrap px-3 text-right">
              {can(`${module}:editar`) && <button aria-label="Editar" className="p-1" onClick={() => setForm({ ...EMPTY_P, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])) as typeof EMPTY_P, id: p.id })}><Pencil className="h-4 w-4" /></button>}
              {can(`${module}:eliminar`) && <button aria-label="Eliminar" className="p-1 text-red-600" onClick={() => del(p)}><Trash2 className="h-4 w-4" /></button>}
            </td></tr>
        ))}
      </RtTable>
      <RtModal open={!!form} title={form?.id ? 'Editar' : `Nuevo registro — ${label}`} onClose={() => setForm(null)}>
        {form && <div className="grid gap-3 sm:grid-cols-2">
          {(['name', 'document', 'email', 'phone', 'address'] as const).map(k => (
            <RtField key={k} label={{ name: 'Nombre *', document: 'Documento / NIT', email: 'Correo', phone: 'Teléfono', address: 'Dirección' }[k]}>
              <input className="rt-inp" name={k} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} /></RtField>
          ))}
        </div>}
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={(form?.name.length ?? 0) < 2} onClick={save}>Guardar</button></div>
      </RtModal>
    </div>
  )
}

export type Product = { id: number; sku: string; name: string; kind: string; price: string; cost: string; tax_rate: string; stock: string; min_stock: string; active: boolean; margin_pct: string; low_stock: boolean }
const EMPTY_PR = { sku: '', name: '', kind: 'producto', price: '', cost: '0', tax_rate: '0', min_stock: '0', initial_stock: '0', active: true }

export function Products() {
  const { api, can, me } = useRt()
  const [q, setQ] = useState('')
  const list = useLoad(() => api.get<Product[]>(`/products?q=${encodeURIComponent(q)}`), [api, q])
  const [form, setForm] = useState<null | (typeof EMPTY_PR & { id?: number })>(null)
  const [err, setErr] = useState<string | null>(null)
  const cur = me.company.currency
  const label = me.modules.find(m => m.key === 'productos')?.label ?? 'Productos'
  const save = async () => {
    setErr(null)
    const { id, ...body } = form!
    try { if (id) await api.put(`/products/${id}`, body); else await api.post('/products', body); setForm(null); list.reload() }
    catch (e) { setErr((e as Error).message) }
  }
  return (
    <div>
      <RtHeader title={label} actions={can('productos:crear') && <button className="rt-btn flex items-center gap-1" onClick={() => setForm({ ...EMPTY_PR })}><Plus className="h-4 w-4" />Nuevo</button>} />
      <input className="rt-inp mb-3 max-w-sm" placeholder="Buscar por nombre o código…" value={q} onChange={e => setQ(e.target.value)} />
      <RtError error={err ?? list.error} />
      <RtTable head={['Código', 'Nombre', 'Tipo', 'Precio', 'Costo', 'Margen', 'IVA %', 'Existencia', '']} empty={!list.data?.length}>
        {list.data?.map(p => (
          <tr key={p.id} className={p.active ? '' : 'opacity-50'}>
            <td className="px-3 py-2 font-mono text-xs">{p.sku}</td><td className="px-3 font-medium">{p.name}</td><td className="px-3">{p.kind}</td>
            <td className="px-3">{money(p.price, cur)}</td><td className="px-3">{money(p.cost, cur)}</td><td className="px-3">{num(p.margin_pct)}%</td><td className="px-3">{num(p.tax_rate)}</td>
            <td className="px-3">{p.kind === 'servicio' ? '—' : <span className={p.low_stock ? 'font-semibold text-red-600' : ''}>{num(p.stock)}</span>}</td>
            <td className="whitespace-nowrap px-3 text-right">
              {can('productos:editar') && <button aria-label="Editar" className="p-1" onClick={() => setForm({ ...EMPTY_PR, ...p, initial_stock: '0', id: p.id })}><Pencil className="h-4 w-4" /></button>}
              {can('productos:eliminar') && <button aria-label="Eliminar" className="p-1 text-red-600" onClick={async () => { if (!confirm(`¿Eliminar ${p.name}?`)) return; try { await api.del(`/products/${p.id}`); list.reload() } catch (e) { setErr((e as Error).message) } }}><Trash2 className="h-4 w-4" /></button>}
            </td></tr>
        ))}
      </RtTable>
      <RtModal open={!!form} title={form?.id ? 'Editar producto' : 'Nuevo producto o servicio'} onClose={() => setForm(null)}>
        {form && <div className="grid gap-3 sm:grid-cols-2">
          <RtField label="Código (SKU) *"><input className="rt-inp" name="sku" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></RtField>
          <RtField label="Nombre *"><input className="rt-inp" name="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></RtField>
          <RtField label="Tipo"><select className="rt-inp" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="producto">Producto (con inventario)</option><option value="servicio">Servicio</option></select></RtField>
          <RtField label="Precio de venta *"><input className="rt-inp" name="price" type="number" min={0} step="any" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></RtField>
          <RtField label="Costo"><input className="rt-inp" type="number" min={0} step="any" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></RtField>
          <RtField label="Impuesto %"><input className="rt-inp" type="number" min={0} max={100} step="any" value={form.tax_rate} onChange={e => setForm({ ...form, tax_rate: e.target.value })} /></RtField>
          {form.kind === 'producto' && <RtField label="Existencia mínima"><input className="rt-inp" type="number" min={0} step="any" value={form.min_stock} onChange={e => setForm({ ...form, min_stock: e.target.value })} /></RtField>}
          {form.kind === 'producto' && !form.id && <RtField label="Existencia inicial"><input className="rt-inp" name="initial_stock" type="number" min={0} step="any" value={form.initial_stock} onChange={e => setForm({ ...form, initial_stock: e.target.value })} /></RtField>}
          {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} />Activo</label>}
        </div>}
        {form?.id && <p className="rt-muted mt-2 text-xs">La existencia se modifica desde Inventario (entradas, salidas y ajustes) para conservar el historial.</p>}
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={!form?.sku || !form?.name || form?.price === ''} onClick={save}>Guardar</button></div>
      </RtModal>
    </div>
  )
}

type Mov = { id: number; product: string; kind: string; qty: string; reference: string | null; created_by: string; created_at: string }

export function Inventory() {
  const { api, can } = useRt()
  const movs = useLoad(() => api.get<Mov[]>('/inventory/movements'), [api])
  const prods = useLoad(() => api.get<Product[]>('/products'), [api])
  const [form, setForm] = useState<null | { product_id: string; kind: string; qty: string; reference: string }>(null)
  const [err, setErr] = useState<string | null>(null)
  const items = prods.data?.filter(p => p.kind === 'producto') ?? []
  const save = async () => {
    setErr(null)
    try { await api.post('/inventory/movements', { ...form, product_id: Number(form!.product_id) }); setForm(null); movs.reload(); prods.reload() }
    catch (e) { setErr((e as Error).message) }
  }
  return (
    <div>
      <RtHeader title="Inventario" subtitle="Cada cambio de existencias queda registrado." actions={can('inventario:crear') &&
        <button className="rt-btn flex items-center gap-1" disabled={!items.length} onClick={() => setForm({ product_id: String(items[0].id), kind: 'entrada', qty: '', reference: '' })}><Plus className="h-4 w-4" />Movimiento</button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.slice(0, 8).map(p => <div key={p.id} className="rt-card p-3"><div className="rt-muted truncate text-xs">{p.name}</div><div className={`text-xl font-bold ${p.low_stock ? 'text-red-600' : ''}`}>{num(p.stock)}</div></div>)}
      </div>
      <RtError error={err ?? movs.error} />
      <RtTable head={['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Referencia', 'Usuario']} empty={!movs.data?.length}>
        {movs.data?.map(m => <tr key={m.id}><td className="px-3 py-2">{dt(m.created_at)}</td><td className="px-3">{m.product}</td>
          <td className="px-3"><Pill tone={m.kind === 'entrada' ? 'green' : m.kind === 'salida' ? 'red' : 'amber'}>{m.kind}</Pill></td><td className="px-3">{num(m.qty)}</td><td className="px-3">{m.reference}</td><td className="px-3">{m.created_by}</td></tr>)}
      </RtTable>
      <RtModal open={!!form} title="Movimiento de inventario" onClose={() => setForm(null)}>
        {form && <div className="space-y-3">
          <RtField label="Producto"><select className="rt-inp" value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })}>{items.map(p => <option key={p.id} value={p.id}>{p.name} (hay {num(p.stock)})</option>)}</select></RtField>
          <RtField label="Tipo"><select className="rt-inp" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="entrada">Entrada</option><option value="salida">Salida</option><option value="ajuste">Ajuste (existencia final contada)</option></select></RtField>
          <RtField label={form.kind === 'ajuste' ? 'Existencia final' : 'Cantidad'}><input className="rt-inp" type="number" min={0} step="any" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></RtField>
          <RtField label="Referencia"><input className="rt-inp" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Factura proveedor 123" /></RtField>
        </div>}
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={!form?.qty} onClick={save}>Registrar</button></div>
      </RtModal>
    </div>
  )
}
