import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { money, num } from '../lib/api'
import type { EntityDef, FieldDef } from '../lib/types'
import { useLoad } from '../components/ui'
import { useRt } from './RuntimeApp'
import { RtError, RtField, RtHeader, RtModal, RtTable } from './rtui'

type Row = Record<string, unknown> & { id: number }
type Resp = { entity: EntityDef; labels: Record<string, Record<string, string>>; rows: Row[] }
type Opt = { id: number; name: string }

function useRelationOptions(fields: FieldDef[]) {
  const { api } = useRt()
  const [opts, setOpts] = useState<Record<string, Opt[]>>({})
  useEffect(() => {
    fields.filter(f => f.type === 'relation').forEach(async f => {
      const rel = f.relation!
      try {
        let list: Opt[]
        if (['customers', 'products', 'suppliers'].includes(rel)) list = await api.get<Opt[]>(`/${rel}`)
        else {
          const r = await api.get<Resp>(`/records/${rel}`)
          list = r.rows.map(x => ({ id: x.id, name: String(Object.entries(x).find(([k, v]) => k !== 'id' && typeof v === 'string' && !k.startsWith('_'))?.[1] ?? `#${x.id}`) }))
        }
        setOpts(o => ({ ...o, [f.key]: list }))
      } catch { setOpts(o => ({ ...o, [f.key]: [] })) }
    })
  }, [api, fields])
  return opts
}

export default function Records() {
  const { entity = '' } = useParams()
  const { api, can, me } = useRt()
  const r = useLoad(() => api.get<Resp>(`/records/${entity}`), [api, entity])
  const [form, setForm] = useState<null | Record<string, unknown>>(null)
  const [err, setErr] = useState<string | null>(null)
  const ent = r.data?.entity ?? me.entities.find(e => e.key === entity)
  const opts = useRelationOptions(ent?.fields ?? [])
  if (!ent) return <RtError error={r.error ?? 'Entidad no encontrada'} />
  const cur = me.company.currency
  const fmt = (f: FieldDef, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—'
    if (f.type === 'money' || (f.type === 'calculated')) return f.type === 'money' ? money(String(v), cur) : num(String(v))
    if (f.type === 'number') return num(String(v))
    if (f.type === 'checkbox') return v ? 'Sí' : 'No'
    if (f.type === 'relation') return r.data?.labels[f.key]?.[String(v)] ?? `#${v}`
    return String(v)
  }
  const save = async () => {
    setErr(null)
    const { id, ...body } = form!
    try { if (id) await api.put(`/records/${entity}/${id}`, body); else await api.post(`/records/${entity}`, body); setForm(null); r.reload() }
    catch (e) { setErr((e as Error).message) }
  }
  const input = (f: FieldDef) => {
    const v = form![f.key]
    const set = (x: unknown) => setForm({ ...form!, [f.key]: x })
    switch (f.type) {
      case 'calculated': return <input className="rt-inp opacity-70" disabled value={v ? String(v) : 'Se calcula al guardar'} />
      case 'checkbox': return <input type="checkbox" checked={!!v} onChange={e => set(e.target.checked)} />
      case 'select': return <select className="rt-inp" value={String(v ?? '')} onChange={e => set(e.target.value)}><option value="">—</option>{f.options?.map(o => <option key={o}>{o}</option>)}</select>
      case 'relation': return <select className="rt-inp" value={String(v ?? '')} onChange={e => set(e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{opts[f.key]?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      case 'date': return <input className="rt-inp" type="date" value={String(v ?? '')} onChange={e => set(e.target.value)} />
      case 'number': case 'money': return <input className="rt-inp" type="number" step="any" min={f.min ?? undefined} max={f.max ?? undefined} value={String(v ?? '')} onChange={e => set(e.target.value)} />
      default: return <input className="rt-inp" maxLength={f.max_length ?? 500} value={String(v ?? '')} onChange={e => set(e.target.value)} />
    }
  }
  return (
    <div>
      <RtHeader title={ent.label} actions={can('registros:crear') && <button className="rt-btn flex items-center gap-1" onClick={() => setForm({})}><Plus className="h-4 w-4" />Nuevo</button>} />
      <RtError error={err ?? r.error} />
      <RtTable head={[...ent.fields.map(f => f.label), '']} empty={!r.data?.rows.length}>
        {r.data?.rows.map(row => (
          <tr key={row.id}>{ent.fields.map(f => <td key={f.key} className="px-3 py-2">{fmt(f, row[f.key])}</td>)}
            <td className="whitespace-nowrap px-3 text-right">
              {can('registros:editar') && <button aria-label="Editar" className="p-1" onClick={() => setForm({ ...row })}><Pencil className="h-4 w-4" /></button>}
              {can('registros:eliminar') && <button aria-label="Eliminar" className="p-1 text-red-600" onClick={async () => { if (!confirm('¿Eliminar registro?')) return; try { await api.del(`/records/${entity}/${row.id}`); r.reload() } catch (e) { setErr((e as Error).message) } }}><Trash2 className="h-4 w-4" /></button>}
            </td></tr>
        ))}
      </RtTable>
      <RtModal open={!!form} title={form?.id ? `Editar ${ent.label}` : `Nuevo — ${ent.label}`} onClose={() => setForm(null)} wide>
        {form && <div className="grid gap-3 sm:grid-cols-2">{ent.fields.map(f => <RtField key={f.key} label={f.label + (f.required ? ' *' : '')}>{input(f)}</RtField>)}</div>}
        <RtError error={err} />
        <div className="mt-4 flex justify-end"><button className="rt-btn" onClick={save}>Guardar</button></div>
      </RtModal>
    </div>
  )
}
