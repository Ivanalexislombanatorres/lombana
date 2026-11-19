import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Lock, Send } from 'lucide-react'
import { api } from '../lib/api'
import type { Erp } from '../lib/types'
import { Badge, Button, ErrorBox, Field, PageHeader, Spinner, cx, useLoad } from '../components/ui'

type Agent = { code: string; name: string; objective: string; tools: string[]; task: string; permissions: string; max_tokens: number }
type Run = { text: string; provider: string; model: string; tokens_in: number; tokens_out: number; latency_ms: number; context: unknown }

export default function Agents() {
  const ag = useLoad(() => Promise.all([api.get<Agent[]>('/api/ai/agents'), api.get<Erp[]>('/api/erps'), api.get<{ enabled: boolean }[]>('/api/ai/providers')]))
  const [sel, setSel] = useState('ceo')
  const [erpId, setErpId] = useState('')
  const [q, setQ] = useState('')
  const [out, setOut] = useState<Run | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showCtx, setShowCtx] = useState(false)
  if (ag.loading) return <Spinner />
  if (!ag.data) return <ErrorBox error={ag.error} />
  const [agents, erps, provs] = ag.data
  const a = agents.find(x => x.code === sel)!
  const active = provs.some(p => p.enabled)
  const run = async () => {
    setErr(null); setBusy(true); setOut(null)
    try { setOut(await api.post<Run>(`/api/ai/agents/${sel}/run`, { erp_id: Number(erpId || erps[0]?.id), question: q })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="fade-in">
      <PageHeader title="Agentes de IA" subtitle="Agentes especializados con contexto limitado a UNA empresa y herramientas de solo lectura. No pueden crear, modificar ni borrar datos." />
      {!active && <div className="mb-4 rounded-lg border border-gold-400/30 bg-gold-400/10 p-3 text-sm text-gold-100">No hay proveedores de IA activos. Configura uno en <Link className="underline" to="/ia">AI Gateway</Link> para ejecutar agentes.</div>}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="panel space-y-1 p-2">
          {agents.map(x => (
            <button key={x.code} onClick={() => setSel(x.code)} className={cx('flex w-full items-start gap-2 rounded-lg p-2 text-left text-sm', x.code === sel ? 'bg-gold-400/15 text-gold-100' : 'hover:bg-white/5')}>
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" /><span><span className="font-medium">{x.name}</span><span className="block text-xs text-slate-500">{x.objective}</span></span>
            </button>
          ))}
        </div>
        <div className="panel p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold text-white">{a.name}</h3><Badge tone="blue"><Lock className="mr-1 h-3 w-3" />{a.permissions}</Badge><Badge>tarea: {a.task}</Badge></div>
          <p className="mb-2 text-sm text-slate-400">{a.objective}</p>
          <div className="mb-4 flex flex-wrap gap-1 text-xs">Herramientas autorizadas: {a.tools.map(t => <Badge key={t} tone="violet">{t}</Badge>)}</div>
          <p className="mb-4 text-xs text-slate-500">Pagos, nómina, cierres contables y eliminaciones requieren aprobación humana: el agente solo puede recomendarlos. Cada consulta queda en la auditoría del ERP.</p>
          {erps.length === 0 ? <p className="text-sm text-slate-500">Crea un ERP para consultar a los agentes.</p> : (
            <div className="space-y-3">
              <Field label="Empresa (ERP)"><select className="inp" value={erpId || erps[0].id} onChange={e => setErpId(e.target.value)}>{erps.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
              <Field label="Pregunta"><textarea className="inp" rows={3} value={q} onChange={e => setQ(e.target.value)} placeholder="¿Qué productos debo reabastecer esta semana?" /></Field>
              <Button icon={<Send className="h-4 w-4" />} disabled={!active || q.trim().length < 3} loading={busy} onClick={run}>Consultar agente</Button>
            </div>
          )}
          <div className="mt-4"><ErrorBox error={err} /></div>
          {out && (
            <div className="mt-4 rounded-xl border border-white/10 bg-ink-950/50 p-4">
              <div className="mb-2 text-xs text-slate-500">{out.provider} · {out.model} · {out.latency_ms} ms · {out.tokens_in}/{out.tokens_out} tokens</div>
              <div className="whitespace-pre-wrap text-sm text-slate-100">{out.text}</div>
              <button className="mt-3 text-xs text-gold-300 underline" onClick={() => setShowCtx(s => !s)}>{showCtx ? 'Ocultar' : 'Ver'} datos enviados al modelo</button>
              {showCtx && <pre className="mt-2 max-h-64 overflow-auto rounded bg-black/40 p-2 text-xs text-slate-400">{JSON.stringify(out.context, null, 2)}</pre>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
