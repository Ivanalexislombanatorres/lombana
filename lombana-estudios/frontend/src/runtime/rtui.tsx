import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function RtHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="rt-muted text-sm">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function RtModal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-12" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className={`rt-card w-full p-6 shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`} onMouseDown={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button aria-label="Cerrar" onClick={onClose}><X className="h-5 w-5" /></button></div>
        {children}
      </div>
    </div>
  )
}

export function RtField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="rt-muted mb-1 block text-xs font-medium">{label}</span>{children}</label>
}

export function RtTable({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="rt-card overflow-x-auto p-2">
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase">{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-b">{children}</tbody>
      </table>
      {empty && <p className="rt-muted py-8 text-center text-sm">Sin registros todavía.</p>}
    </div>
  )
}

export function RtError({ error }: { error: string | null }) {
  return error ? <p role="alert" className="my-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p> : null
}

export function Pill({ children, tone = 'gray' }: { children: ReactNode; tone?: 'green' | 'red' | 'gray' | 'amber' }) {
  const c = { green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800', gray: 'bg-slate-100 text-slate-700', amber: 'bg-amber-100 text-amber-800' }[tone]
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>
}
