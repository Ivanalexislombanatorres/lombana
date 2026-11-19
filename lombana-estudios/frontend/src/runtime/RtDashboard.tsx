import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, Lock, Receipt, ShoppingBag, TrendingUp, Unlock, Users, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import { money } from '../lib/api'
import { useLoad } from '../components/ui'
import { Chart } from '../components/Chart'
import { useRt } from './RuntimeApp'
import { AlertList, type AlertT } from './RtPro'
import { RtHeader } from './rtui'

type D = {
  ventas_mes: string; ventas_hoy: string; num_ventas_mes: number; ticket_promedio: string; clientes: number; productos: number
  stock_bajo: { id: number; name: string; stock: string; min_stock: string }[]; ventas_por_dia: { dia: string; total: string }[]
  top_productos: { name: string; total: string }[]; registros: Record<string, number>; currency: string
  ventas_netas_mes?: string; costo_ventas_mes?: string; gastos_mes?: string; compras_mes?: string; utilidad_mes?: string; margen_mes?: string
  ventas_mes_anterior?: string; ventas_por_metodo?: { metodo: string; total: string }[]; caja?: 'abierta' | 'cerrada' | null; alertas?: AlertT[]
}

/** Número que sube suavemente hasta su valor (respeta "reducir movimiento"). */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(value); return }
    let raf = 0; const t0 = performance.now()
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 700); setN(value * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(n)}</>
}

export default function RtDashboard() {
  const { api, me, slug } = useRt()
  const { data: d, error } = useLoad(() => api.get<D>('/dashboard'), [api])
  const b = me.branding
  const has = (k: string) => me.modules.some(m => m.key === k)
  const opt = useMemo(() => d && ({
    grid: { left: 70, right: 10, top: 20, bottom: 30 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => money(v, d.currency) },
    xAxis: { type: 'category', data: d.ventas_por_dia.map(x => x.dia.slice(5)), axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => v.toLocaleString('es-CO') }, splitLine: { lineStyle: { type: 'dashed', opacity: .4 } } },
    series: [{ type: 'bar', barMaxWidth: 28, data: d.ventas_por_dia.map(x => Number(x.total)),
      itemStyle: { borderRadius: [8, 8, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: b.primary }, { offset: 1, color: b.primary + '55' }] } } }],
  }), [d, b.primary])
  const donut = useMemo(() => d?.ventas_por_metodo?.length ? ({
    tooltip: { trigger: 'item', valueFormatter: (v: number) => money(v, d.currency) },
    legend: { bottom: 0, icon: 'circle' },
    series: [{ type: 'pie', radius: ['52%', '78%'], center: ['50%', '42%'], label: { show: false }, itemStyle: { borderRadius: 6, borderWidth: 2, borderColor: b.surface },
      data: d.ventas_por_metodo.map((x, i) => ({ name: x.metodo[0].toUpperCase() + x.metodo.slice(1), value: Number(x.total), itemStyle: { color: [b.primary, b.secondary, '#10B981'][i % 3] } })) }],
  }) : null, [d, b.primary, b.secondary, b.surface])

  if (error) return <p className="text-red-600">{error}</p>
  if (!d) return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <div key={i} className="rt-card h-24 animate-pulse" />)}</div>
  const cur = d.currency
  const m = (n: number) => money(n, cur)
  const prev = Number(d.ventas_mes_anterior ?? 0), now = Number(d.ventas_mes)
  const delta = prev > 0 ? ((now - prev) / prev) * 100 : null
  const int = (n: number) => Math.round(n).toLocaleString('es-CO')
  const cards = [
    { l: 'Ventas del mes', v: now, f: m, icon: CircleDollarSign, show: has('ventas'), sub: delta === null ? 'Sin datos del mes anterior' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs mes anterior`, up: delta === null ? null : delta >= 0 },
    { l: 'Utilidad del mes', v: Number(d.utilidad_mes ?? 0), f: m, icon: TrendingUp, show: has('ventas') && d.utilidad_mes !== undefined, sub: `Margen ${d.margen_mes ?? 0}%`, up: Number(d.utilidad_mes ?? 0) >= 0 },
    { l: 'Ventas de hoy', v: Number(d.ventas_hoy), f: m, icon: Receipt, show: has('ventas'), sub: `${d.num_ventas_mes} ventas en el mes`, up: null },
    { l: 'Ticket promedio', v: Number(d.ticket_promedio), f: m, icon: ShoppingBag, show: has('ventas'), sub: 'Por venta este mes', up: null },
    { l: 'Clientes', v: d.clientes, f: int, icon: Users, show: has('clientes'), sub: 'Registrados', up: null },
    ...me.entities.map(e => ({ l: e.label, v: d.registros[e.key] ?? 0, f: int, icon: Receipt, show: true, sub: 'Registros', up: null })),
  ].filter(c => c.show)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RtHeader title={b.welcome_title || 'Inicio'} subtitle={`${me.company.name} · datos reales de tu empresa`} />
        {d.caja && <Link to={`/erp/${slug}/caja`} className="rt-card flex items-center gap-2 px-3 py-2 text-sm">
          {d.caja === 'abierta' ? <Unlock className="h-4 w-4 text-emerald-600" /> : <Lock className="h-4 w-4 text-red-600" />}Caja {d.caja}</Link>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c, i) => (
          <div key={c.l} className="rt-card relative overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
            <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10" style={{ background: b.primary }} />
            <div className="flex items-center gap-2"><c.icon className="h-4 w-4" style={{ color: b.primary }} /><span className="rt-muted text-xs">{c.l}</span></div>
            <div className="mt-1 text-2xl font-bold" style={i === 0 ? { color: b.primary } : undefined}><CountUp value={c.v} format={c.f} /></div>
            <div className={`mt-1 flex items-center gap-1 text-xs ${c.up === true ? 'text-emerald-600' : c.up === false ? 'text-red-600' : 'rt-muted'}`}>
              {c.up === true && <ArrowUpRight className="h-3 w-3" />}{c.up === false && <ArrowDownRight className="h-3 w-3" />}{c.sub}</div>
          </div>
        ))}
      </div>
      {!!d.alertas?.length && <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Alertas de hoy</h3><AlertList alerts={d.alertas} /></div>}
      {has('ventas') && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Ventas últimos 14 días</h3>{opt && <Chart option={opt} height={260} />}</div>
          <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Ventas por método de pago</h3>{donut ? <Chart option={donut} height={260} /> : <p className="rt-muted text-sm">Aún no hay ventas este mes.</p>}</div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {d.utilidad_mes !== undefined && has('ventas') && (
          <div className="rt-card p-4"><h3 className="mb-3 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4" style={{ color: b.primary }} />Estado de resultados del mes</h3>
            {[['Ventas netas (sin impuestos)', d.ventas_netas_mes], ['− Costo de lo vendido', d.costo_ventas_mes], ['− Gastos', d.gastos_mes]].map(([l, v]) =>
              <div key={l} className="flex justify-between py-1 text-sm"><span className="rt-muted">{l}</span><span>{m(Number(v))}</span></div>)}
            <div className={`mt-1 flex justify-between border-t pt-2 font-bold ${Number(d.utilidad_mes) < 0 ? 'text-red-600' : ''}`}><span>Utilidad</span><span>{m(Number(d.utilidad_mes))}</span></div>
            {Number(d.costo_ventas_mes) === 0 && Number(d.ventas_netas_mes) > 0 && has('productos') &&
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Tus productos vendidos no tienen costo registrado: la utilidad aparece más alta de lo real. Agrega el costo en Servicios y productos (o regístralo con una compra).</p>}
            {has('compras') && <p className="rt-muted mt-2 text-xs">Compras del mes a proveedores: {m(Number(d.compras_mes))} (entran al inventario, no son gasto).</p>}
          </div>
        )}
        {has('ventas') && <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Más vendidos del mes</h3>
          {d.top_productos.length === 0 ? <p className="rt-muted text-sm">Aún no hay ventas este mes.</p> :
            d.top_productos.map((t, i) => { const max = Number(d.top_productos[0].total) || 1
              return <div key={t.name} className="py-1 text-sm"><div className="flex justify-between"><span>{i + 1}. {t.name}</span><b>{m(Number(t.total))}</b></div>
                <div className="mt-1 h-1.5 rounded-full bg-black/5"><div className="h-1.5 rounded-full" style={{ width: `${(Number(t.total) / max) * 100}%`, background: b.primary }} /></div></div> })}</div>}
        {has('productos') && <div className="rt-card p-4"><h3 className="mb-2 font-semibold">Inventario bajo</h3>
          {d.stock_bajo.length === 0 ? <p className="rt-muted text-sm">Sin productos bajo el mínimo.</p> :
            d.stock_bajo.map(s => <div key={s.id} className="flex justify-between py-1 text-sm text-red-600"><span>{s.name}</span><span>{Number(s.stock)} / mín {Number(s.min_stock)}</span></div>)}</div>}
      </div>
    </div>
  )
}
