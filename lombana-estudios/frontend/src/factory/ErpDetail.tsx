import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Copy, DatabaseBackup, ExternalLink, History, Palette, PlayCircle, RotateCcw, Save, Send, Upload } from 'lucide-react'
import { IS_ARTIFACT, api, dt } from '../lib/api'
import type { EntityDef, Erp, ModuleCfg, ModuleDef } from '../lib/types'
import { Badge, Button, ErrorBox, Field, Modal, PageHeader, Spinner, Table, cx, statusTone, useLoad, useToast } from '../components/ui'
import EntityDesigner from './EntityDesigner'

type Health = { ok: boolean; error: string | null; revision: string | null; head: string; pending_migrations: boolean; counts: Record<string, number> }
type Version = { version: number; note: string; created_by: string; created_at: string; published: boolean }
type Backup = { file: string; size: number; created_at: string }
const TABS = ['Resumen', 'Módulos', 'Formularios', 'Versiones', 'Base de datos']

export default function ErpDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState(0)
  const { data: erp, error, loading, setData } = useLoad(() => api.get<Erp>(`/api/erps/${id}`), [id])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const run = async (key: string, fn: () => Promise<void>) => {
    setErr(null); setBusy(key)
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  if (loading) return <Spinner />
  if (!erp) return <ErrorBox error={error} />
  const update = (e: Erp) => setData(e)

  return (
    <div className="fade-in">
      <PageHeader title={erp.name}
        subtitle={`${erp.sector} · ${erp.db_name} (${erp.db_engine}) · v${erp.current_version} — publicada ${erp.published_version ? 'v' + erp.published_version : 'ninguna'}`}
        actions={<>
          <Badge tone={statusTone(erp.status)}>{erp.status}</Badge>
          {erp.current_version !== erp.published_version &&
            <Button icon={<Send className="h-4 w-4" />} loading={busy === 'pub'} onClick={() => run('pub', async () => { update(await api.post<Erp>(`/api/erps/${erp.id}/publish`, {})); toast('Versión publicada en el ERP') })}>Publicar v{erp.current_version}</Button>}
          {erp.status === 'activo' && (IS_ARTIFACT
            ? <Link to={`/erp/${erp.slug}/login`}><Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>Abrir ERP</Button></Link>
            : <a href={`/erp/${erp.slug}/login`} target="_blank" rel="noreferrer"><Button variant="ghost" icon={<ExternalLink className="h-4 w-4" />}>Abrir ERP</Button></a>)}
        </>} />
      <div className="mb-4 flex gap-1 border-b border-white/10">
        {TABS.map((t, i) => <button key={t} onClick={() => setTab(i)} className={cx('-mb-px border-b-2 px-4 py-2 text-sm', i === tab ? 'border-gold-400 text-gold-200' : 'border-transparent text-slate-400 hover:text-white')}>{t}</button>)}
      </div>
      <ErrorBox error={err} />
      <div className="mt-4">
        {tab === 0 && <Summary erp={erp} update={update} run={run} busy={busy} nav={nav} toast={toast} />}
        {tab === 1 && <ModulesTab erp={erp} update={update} run={run} busy={busy} toast={toast} />}
        {tab === 2 && <FormsTab erp={erp} update={update} run={run} busy={busy} toast={toast} />}
        {tab === 3 && <VersionsTab erp={erp} update={update} run={run} toast={toast} />}
        {tab === 4 && <DbTab erp={erp} run={run} busy={busy} toast={toast} />}
      </div>
    </div>
  )
}

type P = { erp: Erp; update: (e: Erp) => void; run: (k: string, f: () => Promise<void>) => Promise<void>; busy: string; toast: (t: string) => void }

function Summary({ erp, update, run, busy, nav, toast }: P & { nav: (p: string) => void }) {
  const health = useLoad(() => api.get<Health>(`/api/erps/${erp.id}/health`), [erp.id])
  const [dup, setDup] = useState(false)
  const [d, setD] = useState({ name: `${erp.name} (copia)`, admin_password: '' })
  const setStatus = (status: string) => run('st', async () => { await api.patch(`/api/erps/${erp.id}/status`, { status }); update({ ...erp, status }); toast(`ERP ${status}`) })
  const c = erp.config!.company
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="panel p-5 text-sm">
        <h3 className="mb-3 font-semibold text-white">Empresa</h3>
        <dl className="grid grid-cols-2 gap-2 text-slate-300">
          {[['Nombre', c.name], ['Actividad', c.activity || '—'], ['Tamaño', c.size], ['País', c.country], ['Moneda', c.currency], ['Zona horaria', c.timezone], ['Cliente', erp.client_name ?? '—'], ['Creado', dt(erp.created_at)]]
            .map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          {erp.status !== 'activo' && <Button variant="ghost" loading={busy === 'st'} icon={<PlayCircle className="h-4 w-4" />} onClick={() => setStatus('activo')}>Activar</Button>}
          {erp.status === 'activo' && <Button variant="danger" loading={busy === 'st'} onClick={() => setStatus('suspendido')}>Suspender</Button>}
          {erp.status !== 'archivado' && <Button variant="subtle" onClick={() => setStatus('archivado')}>Archivar</Button>}
          <Button variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => setDup(true)}>Duplicar</Button>
          <Link to={`/marca?erp=${erp.id}`}><Button variant="ghost" icon={<Palette className="h-4 w-4" />}>Editar marca</Button></Link>
        </div>
      </div>
      <div className="panel p-5 text-sm">
        <h3 className="mb-3 font-semibold text-white">Salud de la base de datos</h3>
        {health.loading ? <Spinner /> : health.data && (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone={health.data.ok ? 'green' : 'red'}>{health.data.ok ? 'Conectada' : 'Sin acceso'}</Badge>
              <Badge tone={health.data.pending_migrations ? 'gold' : 'green'}>{health.data.pending_migrations ? 'Migraciones pendientes' : `Esquema al día (${health.data.revision})`}</Badge>
            </div>
            <ErrorBox error={health.data.error} />
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(health.data.counts).map(([t, n]) => <div key={t} className="rounded-lg bg-white/[.03] p-2"><div className="text-[11px] text-slate-500">{t}</div><div className="font-semibold text-white">{n}</div></div>)}
            </div>
            {health.data.pending_migrations && <Button className="mt-3" loading={busy === 'mig'} onClick={() => run('mig', async () => { await api.post(`/api/erps/${erp.id}/migrate`); toast('Migrado (con respaldo previo)'); health.reload() })}>Migrar ahora</Button>}
          </>
        )}
      </div>
      <Modal open={dup} title="Duplicar ERP" onClose={() => setDup(false)}>
        <p className="mb-3 text-sm text-slate-400">Se copia la configuración y la marca a un ERP nuevo, con base de datos nueva y vacía. Los datos del cliente original no se copian.</p>
        <div className="space-y-3">
          <Field label="Nombre"><input className="inp" value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Contraseña del usuario admin" hint="Mínimo 8 caracteres"><input className="inp" type="password" autoComplete="new-password" value={d.admin_password} onChange={e => setD({ ...d, admin_password: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end"><Button disabled={d.admin_password.length < 8} loading={busy === 'dup'}
          onClick={() => run('dup', async () => { const n = await api.post<Erp>(`/api/erps/${erp.id}/duplicate`, d); setDup(false); toast('ERP duplicado'); nav(`/erps/${n.id}`) })}>Duplicar</Button></div>
      </Modal>
    </div>
  )
}

function ModulesTab({ erp, update, run, busy, toast }: P) {
  const [cat, setCat] = useState<ModuleDef[]>([])
  const [mods, setMods] = useState<ModuleCfg[]>(() => structuredClone(erp.config!.modules).sort((a, b) => a.order - b.order))
  useEffect(() => { api.get<ModuleDef[]>('/api/catalog/modules').then(setCat) }, [])
  const missing = cat.filter(c => c.operational && !mods.some(m => m.key === c.key))
  const move = (i: number, d: number) => { const m = [...mods]; [m[i], m[i + d]] = [m[i + d], m[i]]; setMods(m.map((x, j) => ({ ...x, order: j }))) }
  const save = () => run('mods', async () => {
    update(await api.put<Erp>(`/api/erps/${erp.id}/config`, { config: { ...erp.config, modules: mods }, note: 'Módulos actualizados' }))
    toast('Guardado como nueva versión. Publícala para aplicarla.')
  })
  return (
    <div className="panel p-5">
      <p className="mb-3 text-sm text-slate-400">Activa, renombra y ordena los módulos del menú. Las dependencias se validan al guardar.</p>
      <div className="space-y-2">
        {mods.map((m, i) => {
          const def = cat.find(c => c.key === m.key)
          return (
            <div key={m.key} className="flex items-center gap-3 rounded-lg border border-white/10 p-2">
              <input type="checkbox" aria-label={m.label} checked={m.enabled} disabled={def?.core} onChange={e => setMods(mods.map((x, j) => j === i ? { ...x, enabled: e.target.checked } : x))} />
              <input className="inp py-1" value={m.label} onChange={e => setMods(mods.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <code className="w-28 text-xs text-slate-500">{m.key}</code>
              <button aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button aria-label="Bajar" disabled={i === mods.length - 1} onClick={() => move(i, 1)} className="p-1 disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
            </div>
          )
        })}
      </div>
      {missing.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{missing.map(c => <Button key={c.key} variant="subtle" onClick={() => setMods([...mods, { key: c.key, enabled: true, label: c.name, order: mods.length }])}>+ {c.name}</Button>)}</div>}
      <Button className="mt-4" icon={<Save className="h-4 w-4" />} loading={busy === 'mods'} onClick={save}>Guardar versión</Button>
    </div>
  )
}

function FormsTab({ erp, update, run, busy, toast }: P) {
  const [ents, setEnts] = useState<EntityDef[]>(() => structuredClone(erp.config!.entities))
  return (
    <div className="panel p-5">
      <EntityDesigner value={ents} onChange={setEnts} />
      <Button className="mt-4" icon={<Save className="h-4 w-4" />} loading={busy === 'ents'} onClick={() => run('ents', async () => {
        update(await api.put<Erp>(`/api/erps/${erp.id}/config`, { config: { ...erp.config, entities: ents }, note: 'Formularios actualizados' }))
        toast('Formularios validados y guardados como nueva versión')
      })}>Validar y guardar versión</Button>
    </div>
  )
}

function VersionsTab({ erp, update, run, toast }: Omit<P, 'busy'>) {
  const v = useLoad(() => api.get<Version[]>(`/api/erps/${erp.id}/versions`), [erp.id, erp.current_version, erp.published_version])
  return (
    <div className="panel p-5">
      <Table head={['Versión', 'Nota', 'Autor', 'Fecha', '', '']} empty={!v.data?.length}>
        {v.data?.map(x => (
          <tr key={x.version}>
            <td className="px-3 py-2 font-semibold">v{x.version} {x.version === erp.current_version && <Badge tone="blue">actual</Badge>}</td>
            <td className="px-3">{x.note}</td><td className="px-3 text-slate-400">{x.created_by}</td><td className="px-3 text-slate-400">{dt(x.created_at)}</td>
            <td className="px-3">{x.published && <Badge tone="green">publicada</Badge>}</td>
            <td className="px-3 text-right">
              {!x.published && <Button variant="subtle" className="mr-2 px-2 py-1 text-xs" icon={<Upload className="h-3 w-3" />} onClick={() => run('pv', async () => { update(await api.post<Erp>(`/api/erps/${erp.id}/publish`, { version: x.version })); toast(`v${x.version} publicada`) })}>Publicar</Button>}
              {x.version !== erp.current_version && <Button variant="subtle" className="px-2 py-1 text-xs" icon={<History className="h-3 w-3" />} onClick={() => run('rv', async () => { update(await api.post<Erp>(`/api/erps/${erp.id}/versions/${x.version}/restore`)); toast(`Restaurada como nueva versión`) })}>Restaurar</Button>}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function DbTab({ erp, run, busy, toast }: Omit<P, 'update'>) {
  const b = useLoad(() => api.get<Backup[]>(`/api/erps/${erp.id}/backups`), [erp.id])
  const [confirm, setConfirm] = useState<string | null>(null)
  return (
    <div className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">Respaldos lógicos portables (.json.gz) de <code>{erp.db_name}</code>. Al restaurar se crea antes un respaldo de seguridad automático.</p>
        <Button icon={<DatabaseBackup className="h-4 w-4" />} loading={busy === 'bk'} onClick={() => run('bk', async () => { const r = await api.post<{ file: string }>(`/api/erps/${erp.id}/backups`); toast(`Respaldo creado: ${r.file}`); b.reload() })}>Crear respaldo</Button>
      </div>
      <Table head={['Archivo', 'Tamaño', 'Fecha', '']} empty={!b.data?.length}>
        {b.data?.map(x => (
          <tr key={x.file}><td className="px-3 py-2 font-mono text-xs">{x.file}</td><td className="px-3">{(x.size / 1024).toFixed(1)} KB</td><td className="px-3 text-slate-400">{dt(x.created_at)}</td>
            <td className="px-3 text-right"><Button variant="danger" className="px-2 py-1 text-xs" icon={<RotateCcw className="h-3 w-3" />} onClick={() => setConfirm(x.file)}>Restaurar</Button></td></tr>
        ))}
      </Table>
      <Modal open={!!confirm} title="Confirmar restauración" onClose={() => setConfirm(null)}>
        <p className="text-sm text-slate-300">Los datos actuales del ERP serán reemplazados por los de <code className="text-gold-200">{confirm}</code>. Antes se guardará un respaldo de seguridad del estado actual.</p>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" loading={busy === 'rs'} onClick={() => run('rs', async () => { await api.post(`/api/erps/${erp.id}/restore`, { file: confirm }); setConfirm(null); toast('Restauración completada'); b.reload() })}>Restaurar</Button></div>
      </Modal>
    </div>
  )
}
