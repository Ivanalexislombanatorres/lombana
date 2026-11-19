import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bell, Bot, Building2, ChevronDown, Cpu, Database, FunctionSquare, Hammer, History, Home, LayoutGrid, LogOut, Menu, Palette,
  Settings, Sigma, Users, Zap,
} from 'lucide-react'
import { IS_ARTIFACT, api, tokens } from '../lib/api'
import { Logo } from '../components/icons'
import { cx } from '../components/ui'

const NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/constructor', label: 'Constructor de ERP', icon: Hammer },
  { to: '/erps', label: 'Mis ERP', icon: LayoutGrid },
  { to: '/sectores', label: 'Plantillas por Sector', icon: Building2 },
  { to: '/marca', label: 'Identidad de Marca', icon: Palette },
  { to: '/agentes', label: 'Agentes de IA', icon: Bot },
  { to: '/ia', label: 'AI Gateway', icon: Cpu },
  { to: '/formulas', label: 'Fórmulas y Cálculos', icon: Sigma },
  { to: '/bases', label: 'Bases de Datos', icon: Database },
  { to: '/clientes', label: 'Clientes y Licencias', icon: Users },
  { to: '/auditoria', label: 'Auditoría', icon: History },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
]

export default function FactoryLayout() {
  const [me, setMe] = useState<{ name: string; email: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [bell, setBell] = useState(false)
  const [alerts, setAlerts] = useState<{ level: string; title: string; detail: string; link?: string }[]>([])
  const loadAlerts = () => { if (IS_ARTIFACT) api.get<typeof alerts>('/api/alerts').then(setAlerts).catch(() => {}) }
  useEffect(loadAlerts, [])
  const nav = useNavigate()
  useEffect(() => { api.get<{ name: string; email: string }>('/api/auth/me').then(setMe).catch(() => {}) }, [])
  const logout = () => { tokens.setFactory(null); nav('/login') }

  return (
    <div className="factory-bg flex min-h-full">
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-gold-400/15 bg-ink-950/95 p-4 transition-transform lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="mb-6 flex items-center gap-3 px-2">
          <Logo size={38} />
          <div className="leading-tight">
            <div className="gold-text text-lg font-extrabold tracking-wide">LOMBANA</div>
            <div className="text-[11px] tracking-[0.35em] text-slate-400">ESTUDIOS</div>
          </div>
        </div>
        <nav className="space-y-1" onClick={() => setOpen(false)}>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                isActive ? 'bg-gradient-to-r from-gold-400/25 to-gold-400/5 text-gold-200 ring-1 ring-gold-400/40' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
              <n.icon className="h-4 w-4" />{n.label}
            </NavLink>
          ))}
          <div className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600" title="Fase 8: motor de automatizaciones (pendiente)">
            <Zap className="h-4 w-4" />Automatizaciones <span className="ml-auto rounded bg-white/5 px-1.5 text-[10px]">Próx.</span>
          </div>
        </nav>
        <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-white/5 bg-white/[.02] p-3 text-[11px] text-slate-500">
          <FunctionSquare className="mb-1 h-4 w-4 text-gold-400/60" />Fábrica Inteligente de ERP con IA · v1.1{IS_ARTIFACT ? ' · en Claude' : ''}
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-ink-950/70 px-4 py-3 backdrop-blur lg:px-8">
          <button aria-label="Menú" className="rounded p-1 lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <div className="text-sm font-semibold tracking-wide text-slate-300">ERP <span className="gold-text">FACTORY</span> <span className="text-xs text-slate-500">v1.0</span></div>
          {IS_ARTIFACT && <div className="relative ml-auto">
            <button aria-label="Alertas de la fábrica" onClick={() => { setBell(b => !b); loadAlerts() }} className="relative rounded-full p-2 text-slate-300 hover:bg-white/5">
              <Bell className="h-5 w-5" />{alerts.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{alerts.length}</span>}
            </button>
            {bell && <div className="panel absolute right-0 z-40 mt-2 w-96 p-4 text-sm" onMouseLeave={() => setBell(false)}>
              <b className="text-white">Alertas de la fábrica</b>
              {!alerts.length ? <p className="mt-2 text-slate-400">Todo en orden.</p> : <ul className="mt-2 space-y-2">{alerts.map((a, i) => (
                <li key={i}><button className="text-left" onClick={() => { setBell(false); if (a.link) nav(a.link) }}>
                  <span className={a.level === 'alta' ? 'text-red-300' : a.level === 'media' ? 'text-gold-200' : 'text-emerald-300'}>● </span>
                  <span className="text-slate-100">{a.title}</span><span className="block text-xs text-slate-500">{a.detail}</span></button></li>))}</ul>}
            </div>}
          </div>}
          <div className={IS_ARTIFACT ? 'relative' : 'ml-auto relative'}>
            <button onClick={() => setMenu(m => !m)} className="flex items-center gap-2 rounded-full border border-white/10 py-1 pl-1 pr-3 text-sm hover:border-gold-400/40">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-b from-gold-300 to-gold-500 text-xs font-bold text-ink-950">
                {(me?.name ?? 'A').slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline">{me?.name ?? 'Administrador'}</span><ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            {menu && (
              <div className="panel absolute right-0 mt-2 w-56 p-2 text-sm" onMouseLeave={() => setMenu(false)}>
                <div className="px-3 py-2 text-xs text-slate-400">{me?.email}</div>
                <button onClick={() => { setMenu(false); nav('/configuracion') }} className="flex w-full items-center gap-2 rounded px-3 py-2 hover:bg-white/5"><Settings className="h-4 w-4" />Configuración</button>
                {!IS_ARTIFACT && <button onClick={logout} className="flex w-full items-center gap-2 rounded px-3 py-2 text-red-300 hover:bg-red-500/10"><LogOut className="h-4 w-4" />Cerrar sesión</button>}
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 lg:p-8"><Outlet /></main>
      </div>
    </div>
  )
}
