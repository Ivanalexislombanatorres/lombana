import { useState } from 'react'
import { api } from '../lib/api'
import { Badge, Button, ErrorBox, Field, PageHeader, useLoad, useToast } from '../components/ui'

type Health = { status: string; db_engine: string; factory_revision: string; factory_head: string; tenant_head: string }

export default function SettingsPage() {
  const toast = useToast()
  const h = useLoad(() => api.get<Health>('/api/health'))
  const [pw, setPw] = useState({ current: '', new: '', new2: '' })
  const [err, setErr] = useState<string | null>(null)
  const change = async () => {
    setErr(null)
    if (pw.new !== pw.new2) return setErr('Las contraseñas nuevas no coinciden')
    try { await api.post('/api/auth/password', { current: pw.current, new: pw.new }); setPw({ current: '', new: '', new2: '' }); toast('Contraseña actualizada') }
    catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="fade-in grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2"><PageHeader title="Configuración" subtitle="Estado del sistema y seguridad de tu cuenta." /></div>
      <div className="panel p-5 text-sm">
        <h3 className="mb-3 font-semibold text-white">Sistema</h3>
        {h.data && <ul className="space-y-2 text-slate-300">
          <li>Estado del servidor: <Badge tone="green">{h.data.status}</Badge></li>
          <li>Motor de base de datos: <b>{h.data.db_engine}</b></li>
          <li>Esquema base central: <code>{h.data.factory_revision}</code> {h.data.factory_revision === h.data.factory_head ? <Badge tone="green">al día</Badge> : <Badge tone="red">pendiente</Badge>}</li>
          <li>Esquema vigente de los ERP: <code>{h.data.tenant_head}</code></li>
          <li>Funcionamiento local: los ERP operan sin internet; la IA en la nube solo se usa si la configuras.</li>
        </ul>}
        <ErrorBox error={h.error} />
      </div>
      <div className="panel space-y-3 p-5">
        <h3 className="font-semibold text-white">Cambiar contraseña</h3>
        <Field label="Contraseña actual"><input className="inp" type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="Nueva contraseña"><input className="inp" type="password" autoComplete="new-password" value={pw.new} onChange={e => setPw({ ...pw, new: e.target.value })} /></Field>
        <Field label="Repetir nueva contraseña"><input className="inp" type="password" autoComplete="new-password" value={pw.new2} onChange={e => setPw({ ...pw, new2: e.target.value })} /></Field>
        <ErrorBox error={err} />
        <Button disabled={!pw.current || pw.new.length < 8} onClick={change}>Actualizar</Button>
      </div>
    </div>
  )
}
