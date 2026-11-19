import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { LogOut, Menu } from 'lucide-react'
import { IS_ARTIFACT, rtApi, tokens } from '../lib/api'
import type { Branding, Company, EntityDef, ModuleCfg } from '../lib/types'
import { cx } from '../components/ui'
import { Icon } from '../components/icons'
import { brandVars, loadFont } from '../factory/BrandEditor'
import RtLogin from './RtLogin'
import RtDashboard from './RtDashboard'
import { Parties, Products, Inventory } from './RtCatalog'
import Sales from './RtSales'
import Records from './RtRecords'
import { Reports, Users, RtAudit } from './RtAdmin'
import { AlertsBell, Assistant, Automations, Cash, Purchases } from './RtPro'

export type Me = {
  user: { id: number; username: string; name: string; role: string }; permissions: string[]; modules: ModuleCfg[]; entities: EntityDef[]
  company: Company; branding: Branding; erp: { name: string; slug: string }
}
type Ctx = { me: Me; api: ReturnType<typeof rtApi>; can: (p: string) => boolean; slug: string }
const RtCtx = createContext<Ctx>(null as unknown as Ctx)
export const useRt = () => useContext(RtCtx)

const ICONS: Record<string, string> = { dashboard: 'gauge', clientes: 'users', proveedores: 'truck', productos: 'package', ventas: 'receipt', inventario: 'boxes', registros: 'table', reportes: 'chart', usuarios: 'shield', auditoria: 'history', caja: 'wallet', compras: 'cart', automatizaciones: 'zap' }
const PATHS: Record<string, string> = { dashboard: '', clientes: 'clientes', proveedores: 'proveedores', productos: 'productos', ventas: 'ventas', inventario: 'inventario', reportes: 'reportes', usuarios: 'usuarios', auditoria: 'auditoria', caja: 'caja', compras: 'compras', automatizaciones: 'automatizaciones' }

export function applyHeadBranding(b: Branding | undefined, fallbackTitle: string) {
  document.title = b?.software_name || fallbackTitle
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) link.href = b?.favicon || b?.logo || '/favicon.svg'
  if (b) loadFont(b.font)
}

function Shell() {
  const { slug = '' } = useParams()
  const nav = useNavigate()
  const [me, setMe] = useState<Me | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const api = useMemo(() => rtApi(slug), [slug])
  useEffect(() => {
    if (!tokens.rt(slug)) { nav(`/erp/${slug}/login`, { replace: true }); return }
    api.get<Me>('/me').then(m => { setMe(m); applyHeadBranding(m.branding, m.erp.name) }).catch(e => setErr(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, slug])
  if (err) return <div className="grid min-h-full place-items-center bg-white p-6 text-center text-slate-700"><div><p>{err}</p>
    {IS_ARTIFACT && <button className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => nav('/erps')}>Volver a la fábrica</button>}</div></div>
  if (!me) return <div className="grid min-h-full place-items-center bg-white text-slate-500">Cargando…</div>
  const can = (perm: string) => {
    const [mod, act] = perm.split(':')
    if (!me.modules.some(m => m.key === mod)) return false
    const p = me.permissions
    return p.includes('*') || p.includes(perm) || p.includes(`*:${act}`) || p.includes(`${mod}:*`)
  }
  const b = me.branding
  const links: { to: string; label: string; icon: string }[] = []
  const root = `/erp/${slug}`
  me.modules.forEach(m => {
    if (m.key === 'asistente') return
    if (m.key === 'registros') me.entities.forEach(e => links.push({ to: `${root}/registros/${e.key}`, label: e.label, icon: 'table' }))
    else links.push({ to: PATHS[m.key] ? `${root}/${PATHS[m.key]}` : root, label: m.label, icon: ICONS[m.key] })
  })
  const logout = () => { tokens.setRt(slug, null); nav(IS_ARTIFACT ? '/erps' : `/erp/${slug}/login`) }

  return (
    <RtCtx.Provider value={{ me, api, can, slug }}>
      <div className="rt flex min-h-full" style={brandVars(b)}>
        <aside className={cx('rt-side fixed inset-y-0 left-0 z-40 w-60 shrink-0 p-4 text-white transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
          <div className="mb-6 flex items-center gap-2">
            {b.logo ? <img src={b.logo} alt="" className="h-10 w-10 rounded object-contain" /> : <div className="grid h-10 w-10 place-items-center rounded-lg text-lg font-bold" style={{ background: b.primary }}>{b.software_name.slice(0, 1)}</div>}
            <div className="min-w-0"><div className="truncate font-bold">{b.software_name}</div><div className="truncate text-xs opacity-70">{b.company_name}</div></div>
          </div>
          <nav className="space-y-1" onClick={() => setOpen(false)}>
            {links.map(l => (
              <NavLink key={l.to} to={l.to} end={l.to === root} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition', isActive ? 'font-semibold' : 'opacity-80 hover:bg-white/10 hover:opacity-100')}
                style={({ isActive }) => (isActive ? { background: b.primary } : undefined)}>
                <Icon name={l.icon} className="h-4 w-4" />{l.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="rt-card m-3 mb-0 flex items-center gap-3 px-4 py-2" style={{ borderRadius: 12 }}>
            <button aria-label="Menú" className="lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
            <div className="text-sm font-semibold">{me.company.name}</div>
            <div className="ml-auto flex items-center gap-3 text-sm"><AlertsBell /><span className="rt-muted hidden sm:inline">{me.user.name} · {me.user.role}</span>
              <button onClick={logout} className="rt-btn-ghost flex items-center gap-1"><LogOut className="h-4 w-4" />{IS_ARTIFACT ? 'Volver a la fábrica' : 'Salir'}</button></div>
          </header>
          <main className="flex-1 p-3 lg:p-6">
            <Routes>
              <Route index element={can('dashboard:ver') ? <RtDashboard /> : <Navigate to={links[0]?.to ?? `${root}/login`} replace />} />
              <Route path="clientes" element={<Parties kind="customers" module="clientes" />} />
              <Route path="proveedores" element={<Parties kind="suppliers" module="proveedores" />} />
              <Route path="productos" element={<Products />} />
              <Route path="ventas" element={<Sales />} />
              <Route path="inventario" element={<Inventory />} />
              <Route path="registros/:entity" element={<Records />} />
              <Route path="reportes" element={<Reports />} />
              <Route path="usuarios" element={<Users />} />
              <Route path="auditoria" element={<RtAudit />} />
              <Route path="caja" element={<Cash />} />
              <Route path="compras" element={<Purchases />} />
              <Route path="automatizaciones" element={<Automations />} />
              <Route path="*" element={<Navigate to={root} replace />} />
            </Routes>
          </main>
          <Assistant />
          {(b.contact_email || b.contact_phone) && <footer className="rt-muted px-6 pb-3 text-xs">{b.company_name} · {b.contact_email} {b.contact_phone}</footer>}
        </div>
      </div>
    </RtCtx.Provider>
  )
}

export default function RuntimeApp() {
  return (
    <Routes>
      <Route path="login" element={<RtLogin />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  )
}
