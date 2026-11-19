import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react'

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' ') }

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'gold' | 'ghost' | 'danger' | 'subtle'; loading?: boolean; icon?: ReactNode }
export function Button({ variant = 'gold', loading, icon, className, children, disabled, ...p }: BtnProps) {
  const v = {
    gold: 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 hover:from-gold-200 hover:to-gold-400 shadow-[0_6px_20px_-8px_rgba(212,169,58,.7)]',
    ghost: 'border border-white/12 text-slate-200 hover:border-gold-400/60 hover:text-gold-200',
    subtle: 'bg-white/5 text-slate-200 hover:bg-white/10',
    danger: 'border border-red-500/40 text-red-300 hover:bg-red-500/10',
  }[variant]
  return (
    <button {...p} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', v, className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{children}
    </button>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div><label className="block"><span className="lbl">{label}</span>{children}</label>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'green' | 'gold' | 'red' | 'slate' | 'blue' | 'violet' }) {
  const t = {
    green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', gold: 'bg-gold-400/15 text-gold-200 ring-gold-400/30',
    red: 'bg-red-500/15 text-red-300 ring-red-500/30', slate: 'bg-white/5 text-slate-300 ring-white/10',
    blue: 'bg-blue-500/15 text-blue-300 ring-blue-500/30', violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  }[tone]
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1', t)}>{children}</span>
}

export const statusTone = (s: string) =>
  (({ activo: 'green', activa: 'green', conectado: 'green', al_dia: 'green', borrador: 'gold', sin_probar: 'gold', pendiente: 'gold',
    suspendido: 'red', suspendida: 'red', error: 'red', vencida: 'red', vencido: 'red', archivado: 'slate' } as const)[s] ?? 'slate')

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()}
        className={cx('panel fade-in w-full p-6', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button aria-label="Cerrar" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="text-gold-400/70">{icon}</div>
      <p className="font-medium text-slate-200">{title}</p>
      {text && <p className="max-w-md text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return <div className="flex items-center gap-2 p-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null
  return <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-white/8 text-left text-xs uppercase tracking-wide text-slate-500">
          {head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-white/5">{children}</tbody>
      </table>
      {empty && <p className="py-8 text-center text-sm text-slate-500">Sin registros todavía.</p>}
    </div>
  )
}

// ---------------- toasts
type Toast = { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems(x => [...x, { id, text, kind }])
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {items.map(t => (
          <div key={t.id} role="status" className={cx('fade-in flex items-start gap-2 rounded-xl border p-3 text-sm shadow-xl backdrop-blur',
            t.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-100' : 'border-red-500/30 bg-red-950/90 text-red-100')}>
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------------- hook de carga
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    fn().then(d => { setData(d); setError(null) }).catch(e => setError(e.message)).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload, setData }
}
