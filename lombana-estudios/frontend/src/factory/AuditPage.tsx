import { useState } from 'react'
import { api, dt } from '../lib/api'
import { Badge, PageHeader, Spinner, Table, useLoad } from '../components/ui'

type A = { id: number; actor: string; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; created_at: string }

export default function AuditPage() {
  const { data, loading } = useLoad(() => api.get<A[]>('/api/audit'))
  const [q, setQ] = useState('')
  if (loading) return <Spinner />
  const rows = (data ?? []).filter(a => JSON.stringify(a).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="fade-in">
      <PageHeader title="Auditoría de la fábrica" subtitle="Cada acción administrativa queda registrada. Las claves de IA nunca se guardan en este registro." />
      <input className="inp mb-4 max-w-sm" placeholder="Filtrar…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="panel p-5">
        <Table head={['Fecha', 'Usuario', 'Acción', 'Entidad', 'Detalle']} empty={!rows.length}>
          {rows.map(a => <tr key={a.id}><td className="whitespace-nowrap px-3 py-2 text-slate-400">{dt(a.created_at)}</td><td className="px-3">{a.actor}</td><td className="px-3"><Badge tone="gold">{a.action}</Badge></td>
            <td className="px-3">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td><td className="px-3 font-mono text-xs text-slate-500">{Object.keys(a.detail).length ? JSON.stringify(a.detail) : ''}</td></tr>)}
        </Table>
      </div>
    </div>
  )
}
