import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { ModuleDef, Sector } from '../lib/types'
import { Badge, Button, ErrorBox, PageHeader, Spinner, useLoad } from '../components/ui'
import { Icon } from '../components/icons'

export default function Sectors() {
  const nav = useNavigate()
  const s = useLoad(() => Promise.all([api.get<Sector[]>('/api/catalog/sectors'), api.get<ModuleDef[]>('/api/catalog/modules')]))
  if (s.loading) return <Spinner />
  if (!s.data) return <ErrorBox error={s.error} />
  const [sectors, mods] = s.data
  const name = (k: string) => mods.find(m => m.key === k)?.name ?? k
  return (
    <div className="fade-in">
      <PageHeader title="Plantillas por Sector" subtitle="Punto de partida de cada ERP. Se guardan en templates/sectores/*.json y se pueden ampliar." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sectors.map(t => (
          <div key={t.code} className="panel flex flex-col p-5">
            <div className="mb-2 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg" style={{ background: t.branding.primary + '33', color: t.branding.primary }}><Icon name={t.icon} /></div>
              <div><div className="font-semibold text-white">{t.name}</div><div className="text-xs text-slate-500">{t.code}</div></div>
            </div>
            <p className="mb-3 text-sm text-slate-400">{t.description}</p>
            <div className="mb-2 flex flex-wrap gap-1">{t.modules.map(m => <Badge key={m}>{t.labels[m] ?? name(m)}</Badge>)}</div>
            {t.entities.length > 0 && <div className="mb-3 text-xs text-slate-400">Formularios: {t.entities.map(e => `${e.label} (${e.fields.length} campos)`).join(', ')}</div>}
            <Button variant="ghost" className="mt-auto" onClick={() => nav(`/constructor?sector=${t.code}`)}>Usar plantilla</Button>
          </div>
        ))}
      </div>
    </div>
  )
}
