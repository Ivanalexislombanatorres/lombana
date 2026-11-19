import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IS_ARTIFACT, api, tokens } from '../lib/api'
import type { Branding } from '../lib/types'
import { brandVars } from '../factory/BrandEditor'
import { applyHeadBranding } from './RuntimeApp'

export default function RtLogin() {
  const { slug = '' } = useParams()
  const nav = useNavigate()
  const [pub, setPub] = useState<{ name: string; branding: Branding } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ username: '', password: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.public<{ name: string; branding: Branding }>(`/api/rt/${slug}/public`).then(p => { setPub(p); applyHeadBranding(p.branding, p.name) }).catch(e => setErr(e.message))
  }, [slug])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await api.public<{ token: string }>(`/api/rt/${slug}/login`, f)
      tokens.setRt(slug, r.token); nav(`/erp/${slug}`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const ownerEnter = async () => {
    setErr(null); setBusy(true)
    try { const r = await api.post<{ token: string }>(`/api/rt/${slug}/owner-session`); tokens.setRt(slug, r.token); nav(`/erp/${slug}`) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (!pub) return (
    <div className="grid min-h-full place-items-center bg-slate-50 p-6 text-center text-slate-600">
      <div>
        <p>{err ?? 'Cargando…'}</p>
        {err && IS_ARTIFACT && <button className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white" onClick={() => nav('/erps')}>Volver a la fábrica</button>}
      </div>
    </div>
  )
  const b = pub.branding
  return (
    <div className="rt grid min-h-full lg:grid-cols-2" style={brandVars(b)}>
      <div className="relative hidden flex-col justify-end p-10 text-white lg:flex" style={{ background: b.login_image ? `center/cover url(${b.login_image})` : `linear-gradient(135deg, ${b.secondary}, ${b.primary})` }}>
        <div className="rounded-xl bg-black/30 p-6 backdrop-blur-sm">
          <h2 className="text-3xl font-bold">{b.welcome_title || 'Bienvenido'}</h2>
          {b.welcome_text && <p className="mt-2 opacity-90">{b.welcome_text}</p>}
          {b.slogan && <p className="mt-4 text-sm italic opacity-80">{b.slogan}</p>}
        </div>
      </div>
      <div className="grid place-items-center p-6">
        <form onSubmit={submit} className="rt-card w-full max-w-sm space-y-4 p-8">
          <div className="mb-2 flex flex-col items-center gap-2 text-center">
            {b.logo ? <img src={b.logo} alt="" className="h-16 w-16 object-contain" /> : <div className="grid h-14 w-14 place-items-center rounded-xl text-2xl font-bold text-white" style={{ background: b.primary }}>{b.software_name.slice(0, 1)}</div>}
            <h1 className="text-xl font-bold">{b.software_name}</h1>
            <p className="rt-muted text-sm">{b.company_name}</p>
          </div>
          <label className="block text-sm"><span className="rt-muted mb-1 block text-xs">Usuario</span><input className="rt-inp" autoComplete="username" required value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></label>
          <label className="block text-sm"><span className="rt-muted mb-1 block text-xs">Contraseña</span><input className="rt-inp" type="password" autoComplete="current-password" required value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></label>
          {err && <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
          <button className="rt-btn w-full" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
          {IS_ARTIFACT && <>
            <button type="button" className="rt-btn-ghost w-full" disabled={busy} onClick={ownerEnter}>Entrar como propietario (sin contraseña)</button>
            <button type="button" className="rt-muted w-full text-center text-xs underline" onClick={() => nav('/erps')}>← Volver a la fábrica</button>
          </>}
          {(b.contact_email || b.contact_phone) && <p className="rt-muted text-center text-xs">Soporte: {b.contact_email} {b.contact_phone}</p>}
        </form>
      </div>
    </div>
  )
}
