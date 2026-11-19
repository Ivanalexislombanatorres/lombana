import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, tokens } from '../lib/api'
import { Logo } from '../components/icons'
import { Button, ErrorBox, Field, Spinner } from '../components/ui'

export default function Login() {
  const nav = useNavigate()
  const [setup, setSetup] = useState<boolean | null>(null)
  const [needCode, setNeedCode] = useState(false)
  const [f, setF] = useState({ name: '', email: '', password: '', password2: '', code: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.public<{ needs_setup: boolean; requires_code: boolean }>('/api/auth/setup-status').then(r => { setSetup(r.needs_setup); setNeedCode(r.requires_code) }).catch(e => setErr(e.message))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    if (setup && f.password !== f.password2) return setErr('Las contraseñas no coinciden')
    setBusy(true)
    try {
      const r = setup
        ? await api.public<{ token: string }>('/api/auth/setup', { name: f.name, email: f.email, password: f.password, setup_code: f.code || null })
        : await api.public<{ token: string }>('/api/auth/login', { email: f.email, password: f.password })
      tokens.setFactory(r.token); nav('/')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  return (
    <div className="factory-bg grid min-h-full place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size={64} />
          <div>
            <div className="gold-text text-3xl font-extrabold tracking-wide">LOMBANA</div>
            <div className="text-sm tracking-[0.5em] text-slate-300">ESTUDIOS</div>
          </div>
          <p className="text-sm text-slate-400">Fábrica Inteligente de ERP con IA</p>
        </div>
        <form onSubmit={submit} className="panel-gold space-y-4 p-6">
          {setup === null && !err ? <Spinner /> : (
            <>
              <h1 className="text-lg font-semibold text-white">{setup ? 'Configuración inicial: crea el administrador' : 'Iniciar sesión'}</h1>
              {setup && <p className="text-sm text-slate-400">Es la primera vez que se abre la fábrica. Esta cuenta controlará todos los ERP.</p>}
              {setup && needCode && <Field label="Código de instalación" hint="Es el valor de LOMBANA_SETUP_CODE que pusiste en Vercel."><input className="inp" type="password" required value={f.code} onChange={set('code')} autoComplete="off" /></Field>}
              {setup && <Field label="Nombre"><input className="inp" required value={f.name} onChange={set('name')} autoComplete="name" /></Field>}
              <Field label="Correo"><input className="inp" type="email" required value={f.email} onChange={set('email')} autoComplete="username" /></Field>
              <Field label="Contraseña" hint={setup ? 'Mínimo 8 caracteres.' : undefined}>
                <input className="inp" type="password" required minLength={setup ? 8 : 1} value={f.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} />
              </Field>
              {setup && <Field label="Repetir contraseña"><input className="inp" type="password" required value={f.password2} onChange={set('password2')} autoComplete="new-password" /></Field>}
              <ErrorBox error={err} />
              <Button type="submit" loading={busy} className="w-full">{setup ? 'Crear administrador y entrar' : 'Entrar'}</Button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
