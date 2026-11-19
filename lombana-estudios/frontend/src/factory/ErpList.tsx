import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Database, ExternalLink, Plus, Settings2 } from 'lucide-react'
import { api, relTime } from '../lib/api'
import type { Erp } from '../lib/types'
import { Badge, Button, Empty, ErrorBox, PageHeader, Spinner, statusTone, useLoad } from '../components/ui'

export default function ErpList() {
  const nav = useNavigate()
  const { data, error, loading } = useLoad(() => api.get<Erp[]>('/api/erps'))
  const [q, setQ] = useState('')
  const [st, setSt] = useState('')
  if (loading) return <Spinner />
  const rows = (data ?? []).filter(e => (!st || e.status === st) && (e.name + e.sector + (e.client_name ?? '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="fade-in">
      <PageHeader title="Mis ERP" subtitle="Cada ERP es un producto independiente con su propia base de datos, usuarios y marca."
        actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => nav('/constructor')}>Nuevo ERP</Button>} />
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="inp max-w-xs" placeholder="Buscar por nombre, sector o cliente…" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Estado" className="inp w-44" value={st} onChange={e => setSt(e.target.value)}>
          <option value="">Todos los estados</option>{['activo', 'borrador', 'suspendido', 'archivado'].map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      {rows.length === 0 ? <div className="panel"><Empty title="No hay ERP que coincidan" action={<Button onClick={() => nav('/constructor')}>Crear ERP</Button>} /></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(e => (
            <div key={e.id} className="panel flex flex-col p-4" data-testid={`erp-card-${e.slug}`}>
              <div className="mb-3 flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-lg font-bold text-white" style={{ background: e.primary }}>{e.software_name?.slice(0, 1)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-white">{e.name}</div>
                  <div className="text-xs capitalize text-slate-400">{e.sector}{e.client_name ? ` · ${e.client_name}` : ''}</div>
                </div>
                <Badge tone={statusTone(e.status)}>{e.status}</Badge>
              </div>
              <div className="mb-3 space-y-1 text-xs text-slate-400">
                <div className="flex items-center gap-1"><Database className="h-3 w-3" /><code>{e.db_name}</code> · {e.db_engine}</div>
                <div>Versión {e.current_version} · publicada {e.published_version ? `v${e.published_version}` : '—'} · {relTime(e.updated_at)}</div>
                <div className="line-clamp-1">{e.modules.join(' · ')}</div>
              </div>
              <div className="mt-auto flex gap-2">
                <Link to={`/erps/${e.id}`} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-white/10 py-2 text-sm hover:border-gold-400/50"><Settings2 className="h-4 w-4" />Gestionar</Link>
                {e.status === 'activo' && <a href={`/erp/${e.slug}/login`} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/5 py-2 text-sm hover:bg-white/10"><ExternalLink className="h-4 w-4" />Abrir ERP</a>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
