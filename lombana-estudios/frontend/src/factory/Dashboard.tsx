import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, CalendarClock, KeyRound, Layers, LayoutGrid, Plus, Server, Users, Wallet } from 'lucide-react'
import { api, money, relTime } from '../lib/api'
import type { Erp } from '../lib/types'
import { Badge, Button, ErrorBox, Spinner, cx, statusTone, useLoad } from '../components/ui'
import { Icon } from '../components/icons'
import { Chart } from '../components/Chart'

type Dash = {
  erps_total: number; erps_activos: number; clientes: number; plantillas: number; proveedores_ia_activos: number
  licencias_activas: number; pagos_al_dia: number; renovaciones_30_dias: number; ingresos_recurrentes_mes: string
  por_sector: { code: string; name: string; short: string; icon: string; count: number }[]
  creados_por_mes: { mes: string; cantidad: number }[]; recientes: Erp[]
}

const STAT = [
  { k: 'erps_activos', label: 'ERP Activos', icon: Layers, tone: 'from-blue-600/40 to-blue-900/30 ring-blue-400/40' },
  { k: 'clientes', label: 'Clientes', icon: Users, tone: 'from-emerald-600/40 to-emerald-900/30 ring-emerald-400/40' },
  { k: 'plantillas', label: 'Plantillas', icon: LayoutGrid, tone: 'from-violet-600/40 to-violet-900/30 ring-violet-400/40' },
  { k: 'proveedores_ia_activos', label: 'Proveedores IA activos', icon: Bot, tone: 'from-amber-600/40 to-amber-900/30 ring-amber-400/40' },
] as const

function HeroArt() {
  return (
    <svg viewBox="0 0 320 180" className="h-40 w-full max-w-sm" aria-hidden>
      <defs>
        <linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#12203d" /><stop offset="1" stopColor="#050a14" /></linearGradient>
        <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F7E08A" /><stop offset="1" stopColor="#B88A22" /></linearGradient>
      </defs>
      <rect x="60" y="14" width="200" height="128" rx="8" fill="url(#scr)" stroke="#d4a93a" strokeOpacity=".5" />
      {[0, 1, 2, 3, 4, 5].map(i => <rect key={i} x={84 + i * 26} y={110 - (i + 2) * 11} width="14" height={(i + 2) * 11} rx="2" fill="url(#gd)" opacity={0.55 + i * 0.08} />)}
      <polyline points="84,96 110,88 136,80 162,70 188,52 214,40" fill="none" stroke="#60a5fa" strokeWidth="2" />
      <circle cx="232" cy="38" r="16" fill="none" stroke="url(#gd)" strokeWidth="5" strokeDasharray="6 4" />
      <circle cx="232" cy="38" r="6" fill="url(#gd)" />
      <path d="M40 142h240l-16 18H56z" fill="#1b2c50" stroke="#d4a93a" strokeOpacity=".35" />
    </svg>
  )
}

export default function Dashboard() {
  const nav = useNavigate()
  const { data: d, error, loading } = useLoad(() => api.get<Dash>('/api/dashboard'))
  const chart = useMemo(() => d && ({
    grid: { left: 30, right: 10, top: 20, bottom: 25 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: d.creados_por_mes.map(m => m.mes), axisLabel: { color: '#94a3b8' }, axisLine: { lineStyle: { color: '#1b2c50' } } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#94a3b8' }, splitLine: { lineStyle: { color: '#12203d' } } },
    series: [{ type: 'bar', name: 'ERP creados', data: d.creados_por_mes.map(m => m.cantidad), barWidth: 22,
      itemStyle: { borderRadius: [6, 6, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#F7E08A' }, { offset: 1, color: '#8E6A17' }] } } }],
  }), [d])

  if (loading) return <Spinner />
  if (error || !d) return <ErrorBox error={error} />

  return (
    <div className="fade-in space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {STAT.map(s => (
              <div key={s.k} className={cx('rounded-2xl bg-gradient-to-br p-4 ring-1', s.tone)}>
                <div className="flex items-center gap-3">
                  <s.icon className="h-7 w-7 text-white/80" />
                  <div><div className="text-xs text-slate-200/80">{s.label}</div><div className="text-3xl font-bold text-white" data-testid={`stat-${s.k}`}>{d[s.k]}</div></div>
                </div>
              </div>
            ))}
          </div>

          <div className="panel-gold relative flex flex-col items-center gap-4 overflow-hidden p-6 md:flex-row">
            <div className="flex-1">
              <h2 className="text-3xl font-bold text-white">Constructor de ERP</h2>
              <p className="mt-2 max-w-md text-slate-300">Diseña, configura y genera sistemas empresariales a la medida de cualquier negocio, cada uno con su propia base de datos y su propia marca.</p>
              <Button className="mt-5" icon={<Plus className="h-4 w-4" />} onClick={() => nav('/constructor')}>Crear Nuevo ERP</Button>
            </div>
            <HeroArt />
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-white"><LayoutGrid className="h-4 w-4 text-gold-300" />ERP por Sector</h3>
          <div className="grid grid-cols-4 gap-2">
            {d.por_sector.map(s => (
              <button key={s.code} title={`${s.name}: ${s.count} ERP`} onClick={() => nav(`/constructor?sector=${s.code}`)}
                className="group relative flex flex-col items-center gap-1 rounded-xl border border-white/8 bg-ink-850 p-2 text-[11px] text-slate-300 transition hover:border-gold-400/50 hover:text-gold-200">
                <Icon name={s.icon} className="h-5 w-5 text-gold-300" />
                <span className="line-clamp-1">{s.short}</span>
                {s.count > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-ink-950">{s.count}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-white">ERP Recientes</h3>
            <Link to="/erps" className="flex items-center gap-1 text-xs text-gold-300 hover:underline">Ver todos <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {d.recientes.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Aún no has creado ERP. Empieza con el constructor.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-2">Nombre del ERP</th><th>Sector</th><th>Estado</th><th>Última actualización</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.recientes.map(e => (
                  <tr key={e.id} className="cursor-pointer hover:bg-white/[.02]" onClick={() => nav(`/erps/${e.id}`)}>
                    <td className="py-2 font-medium text-slate-100">{e.name}</td>
                    <td className="capitalize text-slate-400">{e.sector}</td>
                    <td><Badge tone={statusTone(e.status)}>{e.status}</Badge></td>
                    <td className="text-slate-400">{relTime(e.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel p-4">
          <h3 className="mb-3 font-semibold text-white">Analítica de la Fábrica</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: 'ERP generados', v: d.erps_total, i: Server, c: 'ring-blue-400/40 bg-blue-500/10' },
              { l: 'Licencias activas', v: d.licencias_activas, i: KeyRound, c: 'ring-emerald-400/40 bg-emerald-500/10' },
              { l: 'Renuevan en 30 días', v: d.renovaciones_30_dias, i: CalendarClock, c: 'ring-violet-400/40 bg-violet-500/10' },
              { l: 'Ingreso recurrente/mes', v: money(d.ingresos_recurrentes_mes, 'USD'), i: Wallet, c: 'ring-gold-400/50 bg-gold-400/10' },
            ].map(x => (
              <div key={x.l} className={cx('rounded-xl p-3 text-center ring-1', x.c)}>
                <x.i className="mx-auto mb-1 h-5 w-5 text-slate-200" />
                <div className="text-xs text-slate-400">{x.l}</div>
                <div className="text-xl font-bold text-white">{x.v}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Ingresos calculados desde las licencias registradas (no hay pasarela de pagos conectada).</p>
          {chart && <Chart option={chart} height={180} />}
        </div>
      </div>
    </div>
  )
}
