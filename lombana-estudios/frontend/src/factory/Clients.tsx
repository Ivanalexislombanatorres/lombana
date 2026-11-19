import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { api, money } from '../lib/api'
import type { Erp } from '../lib/types'
import { Badge, Button, ErrorBox, Field, Modal, PageHeader, Spinner, Table, cx, statusTone, useLoad, useToast } from '../components/ui'

type Client = { id: number; name: string; document: string | null; email: string | null; phone: string | null; country: string | null; notes: string | null; erps: number }
type Plan = { id: number; code: string; name: string; price_monthly: string; currency: string; max_users: number; max_storage_mb: number; max_modules: number }
type Lic = { id: number; license_key: string; client_name: string; plan_name: string; erp_name: string | null; status: string; billing_cycle: string; renewal_date: string; payment_status: string; amount: string; currency: string }
const EMPTY = { name: '', document: '', email: '', phone: '', country: 'Colombia', notes: '' }

export default function Clients() {
  const toast = useToast()
  const [tab, setTab] = useState(0)
  const all = useLoad(() => Promise.all([api.get<Client[]>('/api/clients'), api.get<Plan[]>('/api/plans'), api.get<Lic[]>('/api/licenses'), api.get<Erp[]>('/api/erps')]))
  const [cm, setCm] = useState<null | (typeof EMPTY & { id?: number })>(null)
  const [lm, setLm] = useState<null | { client_id: string; plan_id: string; erp_id: string; billing_cycle: string }>(null)
  const [pm, setPm] = useState<null | { id?: number; code: string; name: string; price_monthly: string; currency: string; max_users: number; max_storage_mb: number; max_modules: number }>(null)
  const [err, setErr] = useState<string | null>(null)
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); all.reload() } catch (e) { setErr((e as Error).message) } }
  if (all.loading) return <Spinner />
  if (!all.data) return <ErrorBox error={all.error} />
  const [clients, plans, lics, erps] = all.data
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]))

  return (
    <div className="fade-in">
      <PageHeader title="Clientes y Licencias" subtitle="Administración comercial de la fábrica. Los cobros reales requieren integrar una pasarela de pagos (pendiente)."
        actions={tab === 0 ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCm({ ...EMPTY })}>Nuevo cliente</Button>
          : tab === 1 ? <Button icon={<Plus className="h-4 w-4" />} disabled={!clients.length} onClick={() => setLm({ client_id: String(clients[0].id), plan_id: String(plans[0]?.id ?? ''), erp_id: '', billing_cycle: 'mensual' })}>Nueva licencia</Button>
            : <Button icon={<Plus className="h-4 w-4" />} onClick={() => setPm({ code: '', name: '', price_monthly: '0', currency: 'USD', max_users: 3, max_storage_mb: 500, max_modules: 8 })}>Nuevo plan</Button>} />
      <div className="mb-4 flex gap-1 border-b border-white/10">
        {['Clientes', 'Licencias y suscripciones', 'Planes'].map((t, i) => <button key={t} onClick={() => setTab(i)} className={cx('-mb-px border-b-2 px-4 py-2 text-sm', i === tab ? 'border-gold-400 text-gold-200' : 'border-transparent text-slate-400')}>{t}</button>)}
      </div>
      <ErrorBox error={err} />
      <div className="panel mt-4 p-5">
        {tab === 0 && <Table head={['Cliente', 'Documento', 'Correo', 'Teléfono', 'País', 'ERP', '']} empty={!clients.length}>
          {clients.map(c => <tr key={c.id}><td className="px-3 py-2 font-medium">{c.name}</td><td className="px-3">{c.document}</td><td className="px-3">{c.email}</td><td className="px-3">{c.phone}</td><td className="px-3">{c.country}</td><td className="px-3">{c.erps}</td>
            <td className="px-3 text-right"><Button variant="subtle" className="px-2 py-1 text-xs" onClick={() => setCm({ ...EMPTY, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])) as typeof EMPTY, id: c.id })}>Editar</Button>
              <Button variant="danger" className="ml-1 px-2 py-1 text-xs" onClick={() => act(async () => { await api.del(`/api/clients/${c.id}`); toast('Cliente eliminado') })}>Eliminar</Button></td></tr>)}
        </Table>}
        {tab === 1 && <Table head={['Licencia', 'Cliente', 'ERP', 'Plan', 'Ciclo', 'Valor', 'Renovación', 'Estado', 'Pago', '']} empty={!lics.length}>
          {lics.map(l => <tr key={l.id}><td className="px-3 py-2 font-mono text-xs">{l.license_key}</td><td className="px-3">{l.client_name}</td><td className="px-3">{l.erp_name ?? '—'}</td><td className="px-3">{l.plan_name}</td><td className="px-3">{l.billing_cycle}</td>
            <td className="px-3">{money(l.amount, l.currency)}</td><td className="px-3">{l.renewal_date}</td><td className="px-3"><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
            <td className="px-3"><select aria-label="Estado de pago" className="inp py-1 text-xs" value={l.payment_status} onChange={e => act(async () => { await api.patch(`/api/licenses/${l.id}`, { payment_status: e.target.value }) })}>{['pendiente', 'al_dia', 'vencido'].map(s => <option key={s}>{s}</option>)}</select></td>
            <td className="whitespace-nowrap px-3 text-right"><Button variant="subtle" className="px-2 py-1 text-xs" icon={<RefreshCw className="h-3 w-3" />} onClick={() => act(async () => { await api.patch(`/api/licenses/${l.id}`, { renew: true }); toast('Licencia renovada un ciclo') })}>Renovar</Button>
              <Button variant={l.status === 'activa' ? 'danger' : 'ghost'} className="ml-1 px-2 py-1 text-xs" onClick={() => act(async () => { await api.patch(`/api/licenses/${l.id}`, { status: l.status === 'activa' ? 'suspendida' : 'activa' }) })}>{l.status === 'activa' ? 'Suspender' : 'Activar'}</Button></td></tr>)}
        </Table>}
        {tab === 2 && <Table head={['Código', 'Plan', 'Precio mensual', 'Usuarios', 'Almacenamiento', 'Módulos', '']}>
          {plans.map(p => <tr key={p.id}><td className="px-3 py-2 font-mono text-xs">{p.code}</td><td className="px-3">{p.name}</td><td className="px-3">{money(p.price_monthly, p.currency)}</td><td className="px-3">{p.max_users}</td><td className="px-3">{p.max_storage_mb} MB</td><td className="px-3">{p.max_modules}</td>
            <td className="px-3 text-right"><Button variant="subtle" className="px-2 py-1 text-xs" onClick={() => setPm({ ...p })}>Editar</Button></td></tr>)}
        </Table>}
      </div>

      <Modal open={!!cm} title={cm?.id ? 'Editar cliente' : 'Nuevo cliente'} onClose={() => setCm(null)}>
        {cm && <div className="grid gap-3 sm:grid-cols-2">
          {(['name', 'document', 'email', 'phone', 'country'] as const).map(k => <Field key={k} label={{ name: 'Nombre', document: 'Documento / NIT', email: 'Correo', phone: 'Teléfono', country: 'País' }[k]}><input className="inp" value={cm[k]} onChange={e => setCm({ ...cm, [k]: e.target.value })} /></Field>)}
          <div className="sm:col-span-2"><Field label="Notas / soporte"><textarea className="inp" rows={2} value={cm.notes} onChange={e => setCm({ ...cm, notes: e.target.value })} /></Field></div>
        </div>}
        <div className="mt-4 flex justify-end"><Button disabled={(cm?.name.length ?? 0) < 2} onClick={() => act(async () => {
          const { id, ...body } = cm!; if (id) await api.put(`/api/clients/${id}`, clean(body)); else await api.post('/api/clients', clean(body)); setCm(null); toast('Cliente guardado')
        })}>Guardar</Button></div>
      </Modal>
      <Modal open={!!lm} title="Nueva licencia" onClose={() => setLm(null)}>
        {lm && <div className="space-y-3">
          <Field label="Cliente"><select className="inp" value={lm.client_id} onChange={e => setLm({ ...lm, client_id: e.target.value })}>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Plan"><select className="inp" value={lm.plan_id} onChange={e => setLm({ ...lm, plan_id: e.target.value })}>{plans.map(p => <option key={p.id} value={p.id}>{p.name} — {money(p.price_monthly, p.currency)}/mes</option>)}</select></Field>
          <Field label="ERP (opcional)"><select className="inp" value={lm.erp_id} onChange={e => setLm({ ...lm, erp_id: e.target.value })}><option value="">—</option>{erps.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
          <Field label="Ciclo"><select className="inp" value={lm.billing_cycle} onChange={e => setLm({ ...lm, billing_cycle: e.target.value })}><option value="mensual">Mensual</option><option value="anual">Anual</option></select></Field>
        </div>}
        <div className="mt-4 flex justify-end"><Button onClick={() => act(async () => {
          await api.post('/api/licenses', { client_id: Number(lm!.client_id), plan_id: Number(lm!.plan_id), erp_id: lm!.erp_id ? Number(lm!.erp_id) : null, billing_cycle: lm!.billing_cycle }); setLm(null); toast('Licencia emitida')
        })}>Emitir licencia</Button></div>
      </Modal>
      <Modal open={!!pm} title={pm?.id ? 'Editar plan' : 'Nuevo plan'} onClose={() => setPm(null)}>
        {pm && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código"><input className="inp font-mono" value={pm.code} onChange={e => setPm({ ...pm, code: e.target.value.toLowerCase() })} /></Field>
          <Field label="Nombre"><input className="inp" value={pm.name} onChange={e => setPm({ ...pm, name: e.target.value })} /></Field>
          <Field label="Precio mensual"><input className="inp" type="number" min={0} step="0.01" value={pm.price_monthly} onChange={e => setPm({ ...pm, price_monthly: e.target.value })} /></Field>
          <Field label="Moneda"><input className="inp" value={pm.currency} onChange={e => setPm({ ...pm, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Máx. usuarios"><input className="inp" type="number" value={pm.max_users} onChange={e => setPm({ ...pm, max_users: Number(e.target.value) })} /></Field>
          <Field label="Almacenamiento (MB)"><input className="inp" type="number" value={pm.max_storage_mb} onChange={e => setPm({ ...pm, max_storage_mb: Number(e.target.value) })} /></Field>
          <Field label="Máx. módulos"><input className="inp" type="number" value={pm.max_modules} onChange={e => setPm({ ...pm, max_modules: Number(e.target.value) })} /></Field>
        </div>}
        <div className="mt-4 flex justify-end"><Button onClick={() => act(async () => {
          const { id, ...body } = pm!; if (id) await api.put(`/api/plans/${id}`, body); else await api.post('/api/plans', body); setPm(null); toast('Plan guardado')
        })}>Guardar</Button></div>
      </Modal>
    </div>
  )
}
