import { useEffect, useState } from 'react'
import { FlaskConical, Save } from 'lucide-react'
import { api, dt } from '../lib/api'
import { Badge, Button, ErrorBox, Field, Modal, PageHeader, Table, useLoad, useToast } from '../components/ui'
import { keyOf } from './EntityDesigner'

type Fn = { name: string; usage: string }
type Formula = { id: number; code: string; name: string; expression: string; variables: string[]; module: string | null; description: string | null; version: number; created_at: string }
type TestRes = { ok: boolean; variables?: string[]; result?: string | boolean; error?: string }

export default function Formulas() {
  const toast = useToast()
  const fns = useLoad(() => api.get<Fn[]>('/api/formulas/functions'))
  const list = useLoad(() => api.get<Formula[]>('/api/formulas'))
  const [expr, setExpr] = useState('SI(ventas > 1000000, COMISION(ventas, 8), COMISION(ventas, 5))')
  const [vals, setVals] = useState<Record<string, string>>({ ventas: '1500000' })
  const [res, setRes] = useState<TestRes | null>(null)
  const [meta, setMeta] = useState({ code: 'comision_vendedor', name: 'Comisión del vendedor', module: 'ventas', description: '' })
  const [err, setErr] = useState<string | null>(null)
  const [hist, setHist] = useState<Formula[] | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      api.post<TestRes>('/api/formulas/test', { expression: expr, values: vals }).then(r => {
        setRes(r)
        if (r.variables) setVals(v => Object.fromEntries(r.variables!.map(k => [k, v[k] ?? '1'])))
      }).catch(e => setErr(e.message))
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr, JSON.stringify(vals)])

  const save = async () => {
    setErr(null)
    try {
      const f = await api.post<Formula>('/api/formulas', { ...meta, expression: expr, variables: res?.variables ?? [], sample: vals })
      toast(`Fórmula "${f.code}" guardada (versión ${f.version})`); list.reload()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <div className="fade-in space-y-6">
      <PageHeader title="Fórmulas y Cálculos" subtitle="Motor de expresiones restringido con precisión decimal. No ejecuta código: solo operaciones y funciones autorizadas." />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="panel space-y-4 p-5">
          <Field label="Expresión"><textarea className="inp font-mono" rows={3} value={expr} onChange={e => setExpr(e.target.value)} aria-label="Expresión" /></Field>
          {res?.variables && res.variables.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {res.variables.map(v => <Field key={v} label={v}><input className="inp font-mono" value={vals[v] ?? ''} onChange={e => setVals({ ...vals, [v]: e.target.value })} /></Field>)}
            </div>
          )}
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-4" data-testid="formula-result">
            <FlaskConical className="h-5 w-5 text-gold-300" />
            {res?.ok ? <span className="text-lg">Resultado: <b className="font-mono text-gold-200">{String(res.result)}</b></span> : <span className="text-sm text-red-300">{res?.error ?? '…'}</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Código"><input className="inp font-mono" value={meta.code} onChange={e => setMeta({ ...meta, code: keyOf(e.target.value) })} /></Field>
            <Field label="Nombre"><input className="inp" value={meta.name} onChange={e => setMeta({ ...meta, name: e.target.value })} /></Field>
            <Field label="Módulo"><input className="inp" value={meta.module} onChange={e => setMeta({ ...meta, module: e.target.value })} /></Field>
          </div>
          <Field label="Documentación"><textarea className="inp" rows={2} value={meta.description} onChange={e => setMeta({ ...meta, description: e.target.value })} /></Field>
          <ErrorBox error={err} />
          <Button icon={<Save className="h-4 w-4" />} disabled={!res?.ok} onClick={save}>Validar, probar y guardar versión</Button>
        </div>
        <div className="panel p-4">
          <h3 className="mb-2 font-semibold text-white">Funciones autorizadas</h3>
          <ul className="space-y-1 text-xs">{fns.data?.map(f => <li key={f.name}><button className="text-left font-mono text-gold-200 hover:underline" onClick={() => setExpr(e => e + (e ? ' + ' : '') + f.usage.split(' ')[0])}>{f.usage}</button></li>)}</ul>
          <p className="mt-3 text-xs text-slate-500">Operadores: + − * / % ** (exponente entero ≤ 12), comparaciones, and/or/not.</p>
        </div>
      </div>
      <div className="panel p-5">
        <h3 className="mb-3 font-semibold text-white">Fórmulas guardadas</h3>
        <Table head={['Código', 'Nombre', 'Expresión', 'Módulo', 'Versión', 'Fecha', '']} empty={!list.data?.length}>
          {list.data?.map(f => (
            <tr key={f.id}><td className="px-3 py-2 font-mono text-xs">{f.code}</td><td className="px-3">{f.name}</td><td className="px-3 font-mono text-xs text-gold-200">{f.expression}</td>
              <td className="px-3">{f.module}</td><td className="px-3"><Badge tone="blue">v{f.version}</Badge></td><td className="px-3 text-slate-400">{dt(f.created_at)}</td>
              <td className="px-3 text-right"><Button variant="subtle" className="px-2 py-1 text-xs" onClick={async () => setHist(await api.get<Formula[]>(`/api/formulas/${f.code}/versions`))}>Historial</Button>
                <Button variant="subtle" className="ml-1 px-2 py-1 text-xs" onClick={() => { setExpr(f.expression); setMeta({ code: f.code, name: f.name, module: f.module ?? '', description: f.description ?? '' }) }}>Editar</Button></td></tr>
          ))}
        </Table>
      </div>
      <Modal open={!!hist} title="Historial de versiones" onClose={() => setHist(null)} wide>
        <Table head={['Versión', 'Expresión', 'Fecha']}>{hist?.map(h => <tr key={h.id}><td className="px-3 py-2">v{h.version}</td><td className="px-3 font-mono text-xs">{h.expression}</td><td className="px-3 text-slate-400">{dt(h.created_at)}</td></tr>)}</Table>
      </Modal>
    </div>
  )
}
