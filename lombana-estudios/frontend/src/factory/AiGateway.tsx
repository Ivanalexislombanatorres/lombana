import { useState } from 'react'
import { KeyRound, Plug, Plus, Send, Trash2 } from 'lucide-react'
import { IS_ARTIFACT, api, dt } from '../lib/api'
import { Badge, Button, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Table, statusTone, useLoad, useToast } from '../components/ui'

type Provider = {
  id: number; code: string; name: string; kind: string; base_url: string; has_key: boolean; key_hint: string | null; default_model: string | null
  models: string[]; extra: Record<string, string>; enabled: boolean; status: string; last_test_at: string | null; last_error: string | null
  monthly_limit_requests: number; requests_this_month: number; tokens_in_month: number; tokens_out_month: number
}
type Preset = { code: string; name: string; kind: string; base_url: string; needs_key: boolean }
type Route = { task: string; provider_id: number | null; model: string | null }
type Req = { id: number; provider: string; model: string; task: string; ok: boolean; latency_ms: number; tokens_in: number; tokens_out: number; error: string | null; created_at: string }

export default function AiGateway() {
  const toast = useToast()
  const prov = useLoad(() => api.get<Provider[]>('/api/ai/providers'))
  const presets = useLoad(() => api.get<Preset[]>('/api/ai/presets'))
  const routes = useLoad(() => api.get<Route[]>('/api/ai/routes'))
  const reqs = useLoad(() => api.get<Req[]>('/api/ai/requests'))
  const [edit, setEdit] = useState<Provider | null>(null)
  const [form, setForm] = useState({ api_key: '', base_url: '', default_model: '', monthly_limit_requests: 1000, deployments: '', api_version: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)

  const act = async (k: string, fn: () => Promise<void>) => { setErr(null); setBusy(k); try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy('') } }
  const open = (p: Provider) => { setEdit(p); setForm({ api_key: '', base_url: p.base_url, default_model: p.default_model ?? '', monthly_limit_requests: p.monthly_limit_requests, deployments: p.extra.deployments ?? '', api_version: p.extra.api_version ?? '' }) }
  const save = () => act('save', async () => {
    const body: Record<string, unknown> = { base_url: form.base_url, default_model: form.default_model, monthly_limit_requests: Number(form.monthly_limit_requests) }
    if (form.api_key) body.api_key = form.api_key
    if (edit!.kind === 'azure_openai') body.extra = { deployments: form.deployments, api_version: form.api_version || '2024-10-21' }
    await api.put(`/api/ai/providers/${edit!.id}`, body); setEdit(null); toast('Proveedor guardado. Prueba la conexión.'); prov.reload()
  })
  const test = (p: Provider) => act('t' + p.id, async () => {
    const r = await api.post<Provider>(`/api/ai/providers/${p.id}/test`)
    toast(r.status === 'conectado' ? `${r.name}: conectado (${r.models.length} modelos)` : `${r.name}: ${r.last_error}`, r.status === 'conectado' ? 'ok' : 'error'); prov.reload()
  })
  const available = presets.data?.filter(x => !prov.data?.some(p => p.code === x.code)) ?? []

  if (prov.loading) return <Spinner />
  return (
    <div className="fade-in space-y-6">
      <PageHeader title="LOMBANA AI Gateway" subtitle="Conecta proveedores de IA con adaptadores independientes. Un proveedor solo figura como conectado después de una prueba real exitosa." />
      <ErrorBox error={err ?? prov.error} />
      <div className="panel p-5">
        <h3 className="mb-3 font-semibold text-white">Agregar proveedor</h3>
        <div className="flex flex-wrap gap-2">
          {available.map(p => <Button key={p.code} variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => act('add', async () => { await api.post('/api/ai/providers', { code: p.code }); prov.reload() })}>{p.name}</Button>)}
          {available.length === 0 && <p className="text-sm text-slate-500">Todos los proveedores soportados están agregados.</p>}
        </div>
        <p className="mt-2 text-xs text-slate-500">{IS_ARTIFACT ? 'Dentro de Claude la IA usa Claude directamente, sin API keys. Los proveedores externos (OpenAI, Gemini, Ollama…) están en la versión de servidor.' : 'Las claves se cifran en el servidor (Fernet) y nunca se envían al navegador: solo se muestra una pista enmascarada.'}</p>
      </div>

      {!prov.data?.length ? <div className="panel"><Empty icon={<Plug className="h-8 w-8" />} title="Sin proveedores todavía" text="Agrega uno arriba, pega tu API key y pulsa Probar. Para IA local instala Ollama y agrega 'Ollama (IA local)'." /></div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {prov.data.map(p => (
            <div key={p.id} className="panel p-5" data-testid={`provider-${p.code}`}>
              <div className="mb-2 flex items-center gap-2">
                <div className="font-semibold text-white">{p.name}</div>
                <Badge tone={statusTone(p.status)}>{p.status.replace('_', ' ')}</Badge>
                {p.enabled && <Badge tone="green">activo</Badge>}
              </div>
              <div className="space-y-1 text-xs text-slate-400">
                <div>URL: <code>{p.base_url}</code></div>
                <div className="flex items-center gap-1"><KeyRound className="h-3 w-3" />{p.has_key ? p.key_hint : 'sin clave'}</div>
                <div>Modelo: {p.default_model ?? '—'} · {p.models.length} disponibles</div>
                <div>Uso del mes: {p.requests_this_month}/{p.monthly_limit_requests} solicitudes · {p.tokens_in_month + p.tokens_out_month} tokens</div>
                {p.last_test_at && <div>Última prueba: {dt(p.last_test_at)}</div>}
                {p.last_error && <div className="text-red-300">{p.last_error}</div>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {p.kind !== 'claude_integrado' && <Button variant="subtle" onClick={() => open(p)}>Configurar</Button>}
                <Button variant="ghost" loading={busy === 't' + p.id} onClick={() => test(p)}>Probar conexión</Button>
                <Button variant={p.enabled ? 'danger' : 'ghost'} disabled={!p.enabled && p.status !== 'conectado'}
                  onClick={() => act('en', async () => { await api.put(`/api/ai/providers/${p.id}`, { enabled: !p.enabled }); prov.reload() })}>{p.enabled ? 'Desactivar' : 'Activar'}</Button>
                <button aria-label="Eliminar proveedor" className="ml-auto p-2 text-slate-500 hover:text-red-300" onClick={() => act('del', async () => { await api.del(`/api/ai/providers/${p.id}`); prov.reload(); routes.reload() })}><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-5">
          <h3 className="mb-3 font-semibold text-white">IA por tarea</h3>
          <p className="mb-3 text-xs text-slate-500">Elige qué proveedor y modelo usa cada tarea. Sin asignación se usa "general" o el primer proveedor activo.</p>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {routes.data?.map(r => {
              const p = prov.data?.find(x => x.id === r.provider_id)
              return (
                <div key={r.task} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 text-sm">
                  <code className="text-xs text-slate-300">{r.task}</code>
                  <select aria-label={`Proveedor ${r.task}`} className="inp py-1" value={r.provider_id ?? ''} onChange={e => act('r', async () => { await api.put(`/api/ai/routes/${r.task}`, { provider_id: e.target.value ? Number(e.target.value) : null, model: null }); routes.reload() })}>
                    <option value="">Automático</option>{prov.data?.filter(x => x.enabled).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <select aria-label={`Modelo ${r.task}`} className="inp py-1" disabled={!p} value={r.model ?? ''} onChange={e => act('r', async () => { await api.put(`/api/ai/routes/${r.task}`, { provider_id: r.provider_id, model: e.target.value || null }); routes.reload() })}>
                    <option value="">Modelo por defecto</option>{p?.models.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </div>
        <div className="panel p-5">
          <h3 className="mb-3 font-semibold text-white">Probar una consulta</h3>
          <textarea className="inp" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ej.: Propón 5 indicadores clave para una barbería" />
          <Button className="mt-2" icon={<Send className="h-4 w-4" />} disabled={!prompt.trim()} loading={busy === 'chat'}
            onClick={() => act('chat', async () => { const r = await api.post<{ text: string; provider: string; model: string }>('/api/ai/chat', { prompt }); setAnswer(`[${r.provider} · ${r.model}]\n\n${r.text}`); reqs.reload(); prov.reload() })}>Enviar</Button>
          {answer && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950/60 p-3 text-sm text-slate-200">{answer}</pre>}
        </div>
      </div>

      <div className="panel p-5">
        <h3 className="mb-3 font-semibold text-white">Registro de solicitudes</h3>
        <Table head={['Fecha', 'Proveedor', 'Modelo', 'Tarea', 'Resultado', 'Latencia', 'Tokens']} empty={!reqs.data?.length}>
          {reqs.data?.map(r => (
            <tr key={r.id}><td className="px-3 py-2 text-slate-400">{dt(r.created_at)}</td><td className="px-3">{r.provider}</td><td className="px-3 text-xs">{r.model}</td><td className="px-3 text-xs">{r.task}</td>
              <td className="px-3">{r.ok ? <Badge tone="green">ok</Badge> : <span title={r.error ?? ''}><Badge tone="red">error</Badge></span>}</td><td className="px-3">{r.latency_ms} ms</td><td className="px-3">{r.tokens_in}/{r.tokens_out}</td></tr>
          ))}
        </Table>
      </div>

      <Modal open={!!edit} title={`Configurar ${edit?.name}`} onClose={() => setEdit(null)}>
        <div className="space-y-3">
          <Field label="API key" hint={edit?.has_key ? `Guardada: ${edit.key_hint}. Escribe otra para reemplazarla.` : edit?.code === 'ollama' ? 'Ollama local no requiere clave.' : 'Se cifrará en el servidor.'}>
            <input className="inp font-mono" type="password" autoComplete="off" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} />
          </Field>
          <Field label="URL base"><input className="inp font-mono" value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} /></Field>
          {edit?.kind === 'azure_openai' && <>
            <Field label="Deployments (separados por coma)"><input className="inp" value={form.deployments} onChange={e => setForm({ ...form, deployments: e.target.value })} /></Field>
            <Field label="API version"><input className="inp" placeholder="2024-10-21" value={form.api_version} onChange={e => setForm({ ...form, api_version: e.target.value })} /></Field>
          </>}
          <Field label="Modelo por defecto">{edit?.models.length ? <select className="inp" value={form.default_model} onChange={e => setForm({ ...form, default_model: e.target.value })}>{edit.models.map(m => <option key={m}>{m}</option>)}</select>
            : <input className="inp" value={form.default_model} placeholder="Se llena al probar la conexión" onChange={e => setForm({ ...form, default_model: e.target.value })} />}</Field>
          <Field label="Límite de solicitudes por mes"><input className="inp" type="number" min={0} value={form.monthly_limit_requests} onChange={e => setForm({ ...form, monthly_limit_requests: Number(e.target.value) })} /></Field>
          {edit?.has_key && <Button variant="danger" onClick={() => act('ck', async () => { await api.put(`/api/ai/providers/${edit.id}`, { clear_key: true }); setEdit(null); prov.reload() })}>Borrar clave guardada</Button>}
        </div>
        <div className="mt-4 flex justify-end"><Button loading={busy === 'save'} onClick={save}>Guardar</Button></div>
      </Modal>
    </div>
  )
}
