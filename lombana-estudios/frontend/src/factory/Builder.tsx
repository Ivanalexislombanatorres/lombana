import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, Rocket } from 'lucide-react'
import { api } from '../lib/api'
import type { Branding, EntityDef, Erp, ModuleDef, Sector } from '../lib/types'
import { Badge, Button, ErrorBox, Field, PageHeader, Spinner, cx, useToast } from '../components/ui'
import { Icon } from '../components/icons'
import EntityDesigner from './EntityDesigner'
import { BrandPreview } from './BrandEditor'

const STEPS = ['Sector', 'Empresa', 'Módulos', 'Formularios', 'Marca', 'Administrador']
const CURRENCIES = ['COP', 'USD', 'MXN', 'PEN', 'CLP', 'ARS', 'EUR', 'DOP', 'GTQ', 'CRC', 'BOB', 'PYG', 'UYU']
const ZONES = ['America/Bogota', 'America/Mexico_City', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/Caracas', 'America/Guayaquil', 'America/Panama', 'America/Santo_Domingo', 'America/New_York', 'Europe/Madrid', 'UTC']

export const DEFAULT_BRAND: Branding = {
  software_name: 'Mi ERP', company_name: '', slogan: '', logo: null, favicon: null, login_image: null, primary: '#2563EB', secondary: '#0F172A',
  button: '#2563EB', background: '#F8FAFC', surface: '#FFFFFF', text: '#0F172A', font: 'Inter', theme: 'claro', welcome_title: 'Bienvenido',
  welcome_text: '', contact_email: '', contact_phone: '', contact_address: '', document_footer: '', invoice_template: 'moderna',
}

export default function Builder() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [sectors, setSectors] = useState<Sector[]>([])
  const [mods, setMods] = useState<ModuleDef[]>([])
  const [clients, setClients] = useState<{ id: number; name: string }[]>([])
  const [sector, setSector] = useState<string>(params.get('sector') ?? '')
  const [company, setCompany] = useState({ name: '', activity: '', size: 'micro', country: 'Colombia', currency: 'COP', language: 'es', timezone: 'America/Bogota' })
  const [erpName, setErpName] = useState('')
  const [clientId, setClientId] = useState<string>('')
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [entities, setEntities] = useState<EntityDef[]>([])
  const [brand, setBrand] = useState<Branding>(DEFAULT_BRAND)
  const [admin, setAdmin] = useState({ user: 'admin', name: 'Administrador', password: '', password2: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([api.get<Sector[]>('/api/catalog/sectors'), api.get<ModuleDef[]>('/api/catalog/modules'), api.get<{ id: number; name: string }[]>('/api/clients')])
      .then(([s, m, c]) => { setSectors(s); setMods(m); setClients(c) }).catch(e => setErr(e.message))
  }, [])

  const tpl = useMemo(() => sectors.find(s => s.code === sector), [sectors, sector])
  useEffect(() => { // al elegir sector, cargar sus valores sugeridos
    if (!tpl || !mods.length) return
    const en: Record<string, boolean> = {}
    mods.forEach(m => { en[m.key] = !!m.core || tpl.modules.includes(m.key) })
    setEnabled(en)
    setLabels(Object.fromEntries(mods.map(m => [m.key, tpl.labels[m.key] ?? m.name])))
    setEntities(structuredClone(tpl.entities))
    setBrand(b => ({ ...b, ...tpl.branding }))
  }, [tpl, mods])

  const toggle = (k: string, on: boolean) => {
    const next = { ...enabled, [k]: on }
    const byKey = Object.fromEntries(mods.map(m => [m.key, m]))
    if (on) (byKey[k].depends ?? []).forEach(d => (next[d] = true))
    else mods.forEach(m => { if (m.depends?.includes(k)) next[m.key] = false })
    setEnabled(next)
  }

  const valid = [
    !!sector,
    company.name.trim().length >= 2 && erpName.trim().length >= 2,
    true, true, brand.software_name.trim().length > 0,
    /^[a-zA-Z0-9_.-]{3,40}$/.test(admin.user) && admin.password.length >= 8 && admin.password === admin.password2,
  ]

  const create = async () => {
    setErr(null); setBusy(true)
    const modules = mods.filter(m => m.operational).map((m, i) => ({ key: m.key, enabled: !!enabled[m.key], label: labels[m.key] || m.name, order: i }))
    const body = {
      name: erpName, sector, company: { ...company, sector }, client_id: clientId ? Number(clientId) : null,
      config: { company: { ...company, sector }, modules, entities, kpis: [] },
      branding: { ...brand, company_name: brand.company_name || company.name },
      admin_user: admin.user, admin_name: admin.name, admin_password: admin.password, publish: true,
    }
    try {
      const erp = await api.post<Erp>('/api/erps', body)
      toast(`ERP "${erp.name}" creado con su base ${erp.db_name}`)
      nav(`/erps/${erp.id}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!sectors.length && !err) return <Spinner />
  return (
    <div className="fade-in">
      <PageHeader title="Constructor de ERP" subtitle="Configura un ERP nuevo paso a paso. Al finalizar se crea su base de datos independiente y queda publicado." />
      <ol className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s}><button type="button" disabled={i > step && !valid.slice(0, i).every(Boolean)} onClick={() => setStep(i)}
            className={cx('flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1 transition', i === step ? 'bg-gold-400/20 text-gold-200 ring-gold-400/50' : i < step ? 'text-emerald-300 ring-emerald-500/30' : 'text-slate-500 ring-white/10')}>
            {i < step ? <Check className="h-4 w-4" /> : <span className="text-xs">{i + 1}</span>}{s}</button></li>
        ))}
      </ol>

      <div className="panel p-6">
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sectors.map(s => (
              <button key={s.code} type="button" onClick={() => setSector(s.code)} data-testid={`sector-${s.code}`}
                className={cx('flex items-start gap-3 rounded-xl border p-4 text-left transition', sector === s.code ? 'border-gold-400/70 bg-gold-400/10' : 'border-white/10 hover:border-gold-400/40')}>
                <Icon name={s.icon} className="mt-0.5 h-6 w-6 shrink-0 text-gold-300" />
                <div><div className="font-semibold text-white">{s.name}</div><div className="text-xs text-slate-400">{s.description}</div></div>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nombre del ERP (producto)"><input className="inp" value={erpName} onChange={e => { setErpName(e.target.value); setBrand(b => ({ ...b, software_name: e.target.value })) }} placeholder="Barbería Pro" /></Field>
            <Field label="Nombre de la empresa"><input className="inp" value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} placeholder="Barbería El Rey S.A.S." /></Field>
            <Field label="Actividad económica"><input className="inp" value={company.activity} onChange={e => setCompany({ ...company, activity: e.target.value })} /></Field>
            <Field label="Tamaño"><select className="inp" value={company.size} onChange={e => setCompany({ ...company, size: e.target.value })}>{['micro', 'pequeña', 'mediana', 'grande'].map(x => <option key={x}>{x}</option>)}</select></Field>
            <Field label="País"><input className="inp" value={company.country} onChange={e => setCompany({ ...company, country: e.target.value })} /></Field>
            <Field label="Moneda"><select className="inp" value={company.currency} onChange={e => setCompany({ ...company, currency: e.target.value })}>{CURRENCIES.map(x => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Zona horaria"><select className="inp" value={company.timezone} onChange={e => setCompany({ ...company, timezone: e.target.value })}>{ZONES.map(x => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Idioma"><select className="inp" value={company.language} onChange={e => setCompany({ ...company, language: e.target.value })}><option value="es">Español</option><option value="en">Inglés</option><option value="pt">Portugués</option></select></Field>
            <Field label="Cliente de la fábrica (opcional)" hint="Para asociar licencias y suscripciones.">
              <select className="inp" value={clientId} onChange={e => setClientId(e.target.value)}><option value="">— Sin cliente —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-2 md:grid-cols-2">
            {mods.map(m => (
              <div key={m.key} className={cx('flex items-center gap-3 rounded-lg border p-3', m.operational ? 'border-white/10' : 'border-white/5 opacity-50')}>
                <input type="checkbox" aria-label={m.name} disabled={!m.operational || m.core} checked={!!enabled[m.key]} onChange={e => toggle(m.key, e.target.checked)} />
                <Icon name={m.icon} className="h-4 w-4 text-gold-300" />
                {m.operational ? <input className="inp py-1" value={labels[m.key] ?? ''} onChange={e => setLabels({ ...labels, [m.key]: e.target.value })} title="Nombre visible en el menú" />
                  : <span className="flex-1 text-sm">{m.name}</span>}
                {m.core && <Badge>base</Badge>}{!m.operational && <Badge tone="violet">próxima fase</Badge>}
                {m.depends && <span className="text-[10px] text-slate-500">requiere {m.depends.join(', ')}</span>}
              </div>
            ))}
          </div>
        )}

        {step === 3 && (enabled.registros ? <EntityDesigner value={entities} onChange={setEntities} />
          : <p className="text-sm text-slate-400">Activa el módulo <b>Registros personalizados</b> en el paso anterior para diseñar formularios propios.</p>)}

        {step === 4 && (
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <div className="space-y-3">
              <Field label="Nombre del software"><input className="inp" value={brand.software_name} onChange={e => setBrand({ ...brand, software_name: e.target.value })} /></Field>
              <Field label="Eslogan"><input className="inp" value={brand.slogan} onChange={e => setBrand({ ...brand, slogan: e.target.value })} /></Field>
              {(['primary', 'secondary', 'button'] as const).map(k => (
                <Field key={k} label={{ primary: 'Color principal', secondary: 'Color del menú', button: 'Color de botones' }[k]}>
                  <div className="flex gap-2"><input type="color" value={brand[k]} onChange={e => setBrand({ ...brand, [k]: e.target.value.toUpperCase() })} className="h-9 w-12 rounded" />
                    <input className="inp font-mono" value={brand[k]} onChange={e => setBrand({ ...brand, [k]: e.target.value })} /></div>
                </Field>
              ))}
              <p className="text-xs text-slate-500">El logotipo, tipografía, documentos y más se ajustan luego en <b>Identidad de Marca</b>.</p>
            </div>
            <BrandPreview b={{ ...brand, company_name: brand.company_name || company.name }} modules={mods.filter(m => enabled[m.key]).map(m => labels[m.key] || m.name)} />
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm text-slate-400">Usuario administrador del ERP del cliente (independiente de tu cuenta de la fábrica).</p>
              <Field label="Usuario"><input className="inp" value={admin.user} onChange={e => setAdmin({ ...admin, user: e.target.value })} /></Field>
              <Field label="Nombre"><input className="inp" value={admin.name} onChange={e => setAdmin({ ...admin, name: e.target.value })} /></Field>
              <Field label="Contraseña" hint="Mínimo 8 caracteres."><input className="inp" type="password" autoComplete="new-password" value={admin.password} onChange={e => setAdmin({ ...admin, password: e.target.value })} /></Field>
              <Field label="Repetir contraseña"><input className="inp" type="password" autoComplete="new-password" value={admin.password2} onChange={e => setAdmin({ ...admin, password2: e.target.value })} /></Field>
              {admin.password2 && admin.password !== admin.password2 && <p className="text-xs text-red-300">Las contraseñas no coinciden.</p>}
            </div>
            <div className="rounded-xl border border-gold-400/30 bg-gold-400/5 p-4 text-sm">
              <h3 className="mb-2 font-semibold text-gold-200">Resumen</h3>
              <ul className="space-y-1 text-slate-300">
                <li><b>ERP:</b> {erpName}</li><li><b>Empresa:</b> {company.name} · {company.currency} · {company.timezone}</li>
                <li><b>Sector:</b> {tpl?.name}</li>
                <li><b>Módulos:</b> {mods.filter(m => enabled[m.key]).map(m => labels[m.key] || m.name).join(', ')}</li>
                <li><b>Entidades:</b> {entities.map(e => e.label).join(', ') || 'ninguna'}</li>
                <li><b>Base de datos:</b> se creará una base nueva e independiente (erp_{sector}_NNN)</li>
              </ul>
            </div>
          </div>
        )}

        <div className="mt-6"><ErrorBox error={err} /></div>
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" type="button" disabled={step === 0} icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setStep(step - 1)}>Atrás</Button>
          {step < STEPS.length - 1
            ? <Button type="button" disabled={!valid[step]} onClick={() => setStep(step + 1)}>Siguiente <ChevronRight className="h-4 w-4" /></Button>
            : <Button type="button" disabled={!valid.every(Boolean)} loading={busy} icon={<Rocket className="h-4 w-4" />} onClick={create}>Crear y publicar ERP</Button>}
        </div>
      </div>
    </div>
  )
}
