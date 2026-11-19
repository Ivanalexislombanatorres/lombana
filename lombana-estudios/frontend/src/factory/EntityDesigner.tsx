import { Plus, Trash2 } from 'lucide-react'
import type { EntityDef, FieldDef } from '../lib/types'
import { Button } from '../components/ui'

export const keyOf = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 40) || 'campo'

const TYPES: [FieldDef['type'], string][] = [
  ['text', 'Texto'], ['number', 'Número'], ['money', 'Dinero'], ['date', 'Fecha'], ['select', 'Lista'],
  ['checkbox', 'Casilla'], ['relation', 'Relación'], ['calculated', 'Calculado'],
]

export default function EntityDesigner({ value, onChange }: { value: EntityDef[]; onChange: (v: EntityDef[]) => void }) {
  const upd = (i: number, e: EntityDef) => onChange(value.map((x, j) => (j === i ? e : x)))
  const updField = (i: number, k: number, f: Partial<FieldDef>) =>
    upd(i, { ...value[i], fields: value[i].fields.map((x, j) => (j === k ? { ...x, ...f } : x)) })
  const relTargets = [['customers', 'Clientes'], ['products', 'Productos'], ['suppliers', 'Proveedores'], ...value.map(e => [e.key, e.label])]

  return (
    <div className="space-y-4">
      {value.length === 0 && <p className="text-sm text-slate-500">No hay entidades personalizadas. Agrega una para crear formularios propios (citas, reservas, órdenes…).</p>}
      {value.map((e, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-ink-950/40 p-4" data-testid={`entity-${e.key}`}>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="flex-1"><span className="lbl">Nombre de la entidad</span>
              <input className="inp" value={e.label} onChange={ev => upd(i, { ...e, label: ev.target.value, key: e.key || keyOf(ev.target.value) })} /></label>
            <label className="w-48"><span className="lbl">Clave interna</span>
              <input className="inp font-mono" value={e.key} onChange={ev => upd(i, { ...e, key: keyOf(ev.target.value) })} /></label>
            <Button variant="danger" type="button" icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(value.filter((_, j) => j !== i))}>Quitar</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead><tr className="text-left text-slate-500"><th className="p-1">Etiqueta</th><th>Clave</th><th>Tipo</th><th>Oblig.</th><th>Opciones / relación / fórmula</th><th>Mín</th><th>Máx</th><th /></tr></thead>
              <tbody>
                {e.fields.map((f, k) => (
                  <tr key={k} className="align-top">
                    <td className="p-1"><input className="inp py-1" value={f.label} onChange={ev => updField(i, k, { label: ev.target.value, ...(f.key ? {} : { key: keyOf(ev.target.value) }) })} /></td>
                    <td className="p-1"><input className="inp py-1 font-mono" value={f.key} onChange={ev => updField(i, k, { key: keyOf(ev.target.value) })} /></td>
                    <td className="p-1"><select className="inp py-1" value={f.type} onChange={ev => updField(i, k, { type: ev.target.value as FieldDef['type'] })}>
                      {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                    <td className="p-1 text-center"><input type="checkbox" checked={!!f.required} onChange={ev => updField(i, k, { required: ev.target.checked })} /></td>
                    <td className="p-1">
                      {f.type === 'select' && <input className="inp py-1" placeholder="Opción 1, Opción 2" value={(f.options ?? []).join(', ')}
                        onChange={ev => updField(i, k, { options: ev.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />}
                      {f.type === 'relation' && <select className="inp py-1" value={f.relation ?? ''} onChange={ev => updField(i, k, { relation: ev.target.value })}>
                        <option value="">Elegir…</option>{relTargets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
                      {f.type === 'calculated' && <input className="inp py-1 font-mono" placeholder="cantidad * precio" value={f.formula ?? ''} onChange={ev => updField(i, k, { formula: ev.target.value })} />}
                    </td>
                    <td className="p-1"><input className="inp w-16 py-1" type="number" value={f.min ?? ''} onChange={ev => updField(i, k, { min: ev.target.value === '' ? null : Number(ev.target.value) })} /></td>
                    <td className="p-1"><input className="inp w-16 py-1" type="number" value={f.max ?? ''} onChange={ev => updField(i, k, { max: ev.target.value === '' ? null : Number(ev.target.value) })} /></td>
                    <td className="p-1"><button type="button" aria-label="Quitar campo" className="rounded p-1 text-slate-500 hover:text-red-300" onClick={() => upd(i, { ...e, fields: e.fields.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="subtle" className="mt-2" icon={<Plus className="h-4 w-4" />}
            onClick={() => upd(i, { ...e, fields: [...e.fields, { key: '', label: '', type: 'text', required: false }] })}>Agregar campo</Button>
        </div>
      ))}
      <Button type="button" variant="ghost" icon={<Plus className="h-4 w-4" />}
        onClick={() => onChange([...value, { key: '', label: 'Nueva entidad', fields: [{ key: 'nombre', label: 'Nombre', type: 'text', required: true }] }])}>
        Agregar entidad
      </Button>
      <p className="text-xs text-slate-500">Los campos calculados usan el motor de fórmulas seguro (ej. <code className="text-gold-200">horas * tarifa</code>, <code className="text-gold-200">COMISION(valor, pct)</code>) y solo pueden usar campos numéricos o de dinero.</p>
    </div>
  )
}
