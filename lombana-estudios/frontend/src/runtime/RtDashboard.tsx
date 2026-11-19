import { useMemo } from 'react'
import { money } from '../lib/api'
import { useLoad } from '../components/ui'
import { Chart } from '../components/Chart'
import { useRt } from './RuntimeApp'
import { RtHeader } from './rtui'

type D = {
  ventas_mes: string; ventas_hoy: string; num_ventas_mes: number; ticket_promedio: string; clientes: number; productos: number
  stock_bajo: { id: number; name: string; stock: string; min_stock: string }[]; ventas_por_dia: { dia: string; total: string }[]
  top_productos: { name: string; total: string }[]; registros: Record<string, number>; currency: string
}

export default function RtDashboard() {
  const { api, me } = useRt()
  const { data: d, error } = useLoad(() => api.get<D>('/dashboard'), [api])
  const b = me.branding
  const opt = useMemo(() => d && ({
    grid: { left: 70, right: 10, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: d.ventas_por_dia.map(x => x.dia.slice(5)) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => v.toLocaleString('es-CO') } },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => money(v, d.currency) },
    series: [{ type: 'bar', barMaxWidth: 28, data: d.ventas_por_dia.map(x => Number(x.total)), itemStyle: { color: b.primary, borderRadius: [6, 6, 0, 0] } }],
  }), [d, b.primary])
  if (error) return <p className="text-red-600">{error}</p>
  if (!d) return <p className="rt-muted">Cargando…</p>
  const ent = me.entities
  const cards = [
    { l: 'Ventas del mes', v: money(d.ventas_mes, d.currency), show: me.modules.some(m => m.key === 'ventas') },
    { l: 'Ventas de hoy', v: money(d.ventas_hoy, d.currency), show: me.modules.some(m => m.key === 'ventas') },
    { l: 'Ticket promedio', v: money(d.ticket_promedio, d.currency), show: me.modules.some(m => m.key === 'ventas') },
    { l: 'Clientes', v: d.clientes, show: me.modules.some(m => m.key === 'clientes') },
    ...ent.map(e => ({ l: e.label, v: d.registros[e.key] ?? 0, show: true })),
  ].filter(c => c.show)
  return (
    <div>
      <RtHeader title={b.welcome_title || 'Inicio'} subtitle={`${me.company.name} · datos reales de tu empresa`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c, i) => <div key={c.l} className="rt-card p-4"><div className="rt-muted text-xs">{c.l}</div><div className="mt-1 text-2xl font-bold" style={i === 0 ? { color: b.primary } : undefined}>{c.v}</div></div>)}
      </div>
      {me.modules.some(m => m.key === 'ventas') && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Ventas últimos 14 días</h3>{opt && <Chart option={opt} height={260} />}</div>
          <div className="space-y-4">
            <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Más vendidos del mes</h3>
              {d.top_productos.length === 0 ? <p className="rt-muted text-sm">Aún no hay ventas este mes.</p> :
                d.top_productos.map(t => <div key={t.name} className="flex justify-between py-1 text-sm"><span>{t.name}</span><b>{money(t.total, d.currency)}</b></div>)}</div>
            <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Alertas de inventario</h3>
              {d.stock_bajo.length === 0 ? <p className="rt-muted text-sm">Sin productos bajo el mínimo.</p> :
                d.stock_bajo.map(s => <div key={s.id} className="flex justify-between py-1 text-sm text-red-600"><span>{s.name}</span><span>{Number(s.stock)} / mín {Number(s.min_stock)}</span></div>)}</div>
          </div>
        </div>
      )}
    </div>
  )
}
