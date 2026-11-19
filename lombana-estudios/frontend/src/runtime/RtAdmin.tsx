import { useState } from 'react'
import { Download, Plus } from 'lucide-react'
import { dt, money } from '../lib/api'
import { useLoad } from '../components/ui'
import { useRt } from './RuntimeApp'
import { Pill, RtError, RtField, RtHeader, RtModal, RtTable } from './rtui'

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function Reports() {
  const { api, me } = useRt()
  const cur = me.company.currency
  const today = new Date()
  const [range, setRange] = useState({ start: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), end: isoDay(today) })
  const r = useLoad(() => api.get<{ summary: Record<string, string | number>; rows: { id: number; number: string; customer: string; total: string; status: string; created_at: string }[] }>(
    `/reports/sales?start=${range.start}&end=${range.end}`), [api, range.start, range.end])
  const [err, setErr] = useState<string | null>(null)
  const s = r.data?.summary
  return (
    <div>
      <RtHeader title="Reportes" subtitle="Ventas por rango de fechas (hora local de la empresa)" actions={
        <button className="rt-btn flex items-center gap-1" onClick={() => api.download(`/reports/sales?start=${range.start}&end=${range.end}&fmt=csv`, `ventas_${range.start}_${range.end}.csv`).catch(e => setErr(e.message))}><Download className="h-4 w-4" />Exportar a Excel (CSV)</button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <RtField label="Desde"><input className="rt-inp" type="date" value={range.start} onChange={e => setRange({ ...range, start: e.target.value })} /></RtField>
        <RtField label="Hasta"><input className="rt-inp" type="date" value={range.end} onChange={e => setRange({ ...range, end: e.target.value })} /></RtField>
      </div>
      <RtError error={err ?? r.error} />
      {s && <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Ventas', s.ventas], ['Anuladas', s.anuladas], ['Subtotal', money(String(s.subtotal), cur)], ['Impuestos', money(String(s.impuestos), cur)], ['Total', money(String(s.total), cur)]]
          .map(([k, v]) => <div key={k} className="rt-card p-3"><div className="rt-muted text-xs">{k}</div><div className="text-xl font-bold">{v}</div></div>)}
      </div>}
      <RtTable head={['Número', 'Fecha', 'Cliente', 'Total', 'Estado']} empty={!r.data?.rows.length}>
        {r.data?.rows.map(x => <tr key={x.id}><td className="px-3 py-2 font-mono text-xs">{x.number}</td><td className="px-3">{dt(x.created_at)}</td><td className="px-3">{x.customer}</td><td className="px-3">{money(x.total, cur)}</td><td className="px-3"><Pill tone={x.status === 'confirmada' ? 'green' : 'red'}>{x.status}</Pill></td></tr>)}
      </RtTable>
    </div>
  )
}

type U = { id: number; username: string; name: string; role_id: number; role: string; is_active: boolean }
type R = { id: number; name: string; permissions: string[] }

export function Users() {
  const { api, can } = useRt()
  const users = useLoad(() => api.get<U[]>('/users'), [api])
  const roles = useLoad(() => api.get<{ roles: R[]; available: string[] }>('/roles'), [api])
  const [uf, setUf] = useState<null | { id?: number; username: string; name: string; role_id: string; password: string; is_active: boolean }>(null)
  const [rf, setRf] = useState<null | { id?: number; name: string; permissions: string[] }>(null)
  const [err, setErr] = useState<string | null>(null)
  const act = async (fn: () => Promise<void>) => { setErr(null); try { await fn(); users.reload(); roles.reload() } catch (e) { setErr((e as Error).message) } }
  const avail = roles.data?.available ?? []
  const mods = [...new Set(avail.map(p => p.split(':')[0]))]
  return (
    <div className="space-y-6">
      <RtHeader title="Usuarios y roles" actions={can('usuarios:crear') && <>
        <button className="rt-btn flex items-center gap-1" onClick={() => setUf({ username: '', name: '', role_id: String(roles.data?.roles[0]?.id ?? ''), password: '', is_active: true })}><Plus className="h-4 w-4" />Usuario</button>
        <button className="rt-btn-ghost" onClick={() => setRf({ name: '', permissions: [] })}>Nuevo rol</button></>} />
      <RtError error={err} />
      <RtTable head={['Usuario', 'Nombre', 'Rol', 'Estado', '']}>
        {users.data?.map(u => <tr key={u.id}><td className="px-3 py-2 font-mono text-xs">{u.username}</td><td className="px-3">{u.name}</td><td className="px-3">{u.role}</td>
          <td className="px-3"><Pill tone={u.is_active ? 'green' : 'red'}>{u.is_active ? 'activo' : 'inactivo'}</Pill></td>
          <td className="px-3 text-right">{can('usuarios:editar') && <button className="rt-btn-ghost" onClick={() => setUf({ ...u, role_id: String(u.role_id), password: '' })}>Editar</button>}</td></tr>)}
      </RtTable>
      <div>
        <h2 className="mb-2 font-semibold">Roles y permisos</h2>
        <RtTable head={['Rol', 'Permisos', '']}>
          {roles.data?.roles.map(r => <tr key={r.id}><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 text-xs">{r.permissions.includes('*') ? 'Todos' : r.permissions.join(', ')}</td>
            <td className="px-3 text-right">{can('usuarios:editar') && !r.permissions.includes('*') && <button className="rt-btn-ghost" onClick={() => setRf({ ...r })}>Editar</button>}</td></tr>)}
        </RtTable>
      </div>
      <RtModal open={!!uf} title={uf?.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={() => setUf(null)}>
        {uf && <div className="space-y-3">
          <RtField label="Usuario"><input className="rt-inp" disabled={!!uf.id} value={uf.username} onChange={e => setUf({ ...uf, username: e.target.value })} /></RtField>
          <RtField label="Nombre"><input className="rt-inp" value={uf.name} onChange={e => setUf({ ...uf, name: e.target.value })} /></RtField>
          <RtField label="Rol"><select className="rt-inp" value={uf.role_id} onChange={e => setUf({ ...uf, role_id: e.target.value })}>{roles.data?.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></RtField>
          <RtField label={uf.id ? 'Nueva contraseña (opcional)' : 'Contraseña (mín. 8)'}><input className="rt-inp" type="password" autoComplete="new-password" value={uf.password} onChange={e => setUf({ ...uf, password: e.target.value })} /></RtField>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={uf.is_active} onChange={e => setUf({ ...uf, is_active: e.target.checked })} />Activo</label>
        </div>}
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" onClick={() => act(async () => {
          const body = { username: uf!.username, name: uf!.name, role_id: Number(uf!.role_id), is_active: uf!.is_active, password: uf!.password || null }
          if (uf!.id) await api.put(`/users/${uf!.id}`, body); else await api.post('/users', body); setUf(null)
        })}>Guardar</button></div>
      </RtModal>
      <RtModal open={!!rf} title={rf?.id ? 'Editar rol' : 'Nuevo rol'} onClose={() => setRf(null)} wide>
        {rf && <div className="space-y-3">
          <RtField label="Nombre del rol"><input className="rt-inp" value={rf.name} onChange={e => setRf({ ...rf, name: e.target.value })} /></RtField>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs"><th>Módulo</th>{['ver', 'crear', 'editar', 'eliminar'].map(a => <th key={a}>{a}</th>)}</tr></thead>
            <tbody>{mods.map(m => <tr key={m}><td className="py-1">{m}</td>{['ver', 'crear', 'editar', 'eliminar'].map(a => {
              const p = `${m}:${a}`
              return <td key={a}><input type="checkbox" aria-label={p} checked={rf.permissions.includes(p)} onChange={e => setRf({ ...rf, permissions: e.target.checked ? [...rf.permissions, p] : rf.permissions.filter(x => x !== p) })} /></td>
            })}</tr>)}</tbody></table>
        </div>}
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" disabled={(rf?.name.length ?? 0) < 2} onClick={() => act(async () => {
          if (rf!.id) await api.put(`/roles/${rf!.id}`, { name: rf!.name, permissions: rf!.permissions }); else await api.post('/roles', rf); setRf(null)
        })}>Guardar</button></div>
      </RtModal>
    </div>
  )
}

export function RtAudit() {
  const { api } = useRt()
  const a = useLoad(() => api.get<{ id: number; actor: string; action: string; entity: string; entity_id: string | null; detail: object; created_at: string }[]>('/audit'), [api])
  return (
    <div>
      <RtHeader title="Auditoría" subtitle="Quién hizo qué y cuándo dentro de este ERP." />
      <RtTable head={['Fecha', 'Usuario', 'Acción', 'Entidad', 'Detalle']} empty={!a.data?.length}>
        {a.data?.map(x => <tr key={x.id}><td className="whitespace-nowrap px-3 py-2">{dt(x.created_at)}</td><td className="px-3">{x.actor}</td><td className="px-3"><Pill>{x.action}</Pill></td><td className="px-3">{x.entity}{x.entity_id ? ` #${x.entity_id}` : ''}</td><td className="px-3 font-mono text-xs">{JSON.stringify(x.detail)}</td></tr>)}
      </RtTable>
    </div>
  )
}
