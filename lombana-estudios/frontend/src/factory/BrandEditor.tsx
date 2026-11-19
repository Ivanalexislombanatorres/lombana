import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookmarkPlus, ImageUp, RotateCcw, Save, Send, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Branding, Erp } from '../lib/types'
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, useLoad, useToast } from '../components/ui'
import { DEFAULT_BRAND } from './Builder'

export const FONTS = ['Inter', 'Poppins', 'Montserrat', 'Roboto', 'Lato', 'Playfair Display', 'Source Sans 3', 'system-ui']

export function loadFont(font: string) {
  if (font === 'system-ui' || !navigator.onLine) return
  const id = 'font-' + font.replace(/\s/g, '-')
  if (document.getElementById(id)) return
  const l = document.createElement('link')
  l.id = id; l.rel = 'stylesheet'
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;600;700&display=swap`
  document.head.appendChild(l)
}

export const brandVars = (b: Branding) => ({
  '--b-primary': b.primary, '--b-secondary': b.secondary, '--b-button': b.button, '--b-bg': b.background,
  '--b-surface': b.surface, '--b-text': b.text, '--b-font': `"${b.font}"`,
}) as React.CSSProperties

export function BrandPreview({ b, modules = ['Dashboard', 'Clientes', 'Ventas', 'Inventario'] }: { b: Branding; modules?: string[] }) {
  useEffect(() => loadFont(b.font), [b.font])
  return (
    <div className="rt overflow-hidden rounded-xl ring-1 ring-white/10" style={brandVars(b)} data-testid="brand-preview">
      <div className="flex min-h-[340px]">
        <div className="rt-side w-44 p-3 text-white">
          <div className="mb-4 flex items-center gap-2">
            {b.logo ? <img src={b.logo} alt="" className="h-8 w-8 rounded object-contain" /> : <div className="grid h-8 w-8 place-items-center rounded font-bold" style={{ background: b.primary }}>{b.software_name.slice(0, 1)}</div>}
            <div className="text-sm font-bold leading-tight">{b.software_name}</div>
          </div>
          {modules.slice(0, 7).map((m, i) => (
            <div key={i} className="mb-1 rounded-md px-2 py-1.5 text-xs" style={i === 0 ? { background: b.primary } : { opacity: .8 }}>{m}</div>
          ))}
        </div>
        <div className="flex-1 p-4">
          <div className="mb-1 text-lg font-bold">{b.welcome_title || 'Bienvenido'}</div>
          <div className="rt-muted mb-4 text-xs">{b.company_name}{b.slogan ? ` · ${b.slogan}` : ''}</div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {['Ventas del mes', 'Clientes', 'Ticket promedio'].map((t, i) => (
              <div key={t} className="rt-card p-2"><div className="rt-muted text-[10px]">{t}</div><div className="text-base font-bold" style={{ color: i === 0 ? b.primary : undefined }}>{['$ 8.450.000', '128', '$ 45.000'][i]}</div></div>
            ))}
          </div>
          <div className="rt-card mb-3 p-3">
            <div className="mb-2 flex items-end gap-1">{[30, 45, 38, 60, 52, 70, 64].map((h, i) => <div key={i} style={{ height: h, background: b.primary, opacity: .35 + i * .09 }} className="w-5 rounded-t" />)}</div>
            <div className="rt-muted text-[10px]">Ejemplo de vista previa (datos ilustrativos)</div>
          </div>
          <button type="button" className="rt-btn">Botón principal</button>
        </div>
      </div>
      <div className="border-t p-3 text-[10px]" style={{ borderColor: '#0001', background: b.surface }}>
        <span className="font-semibold">Factura ({b.invoice_template})</span> · {b.document_footer || 'Pie de documento'} · {b.contact_email} {b.contact_phone}
      </div>
    </div>
  )
}

const readImage = (file: File) => new Promise<string>((res, rej) => {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return rej(new Error('Usa una imagen PNG, JPG o WEBP'))
  if (file.size > 300_000) return rej(new Error('La imagen supera 300 KB; redúcela antes de subirla'))
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('No se pudo leer la imagen')); r.readAsDataURL(file)
})

type Tpl = { id: number; name: string; branding: Branding }

export default function BrandEditor() {
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const erps = useLoad(() => api.get<Erp[]>('/api/erps'))
  const tpls = useLoad(() => api.get<Tpl[]>('/api/brand-templates'))
  const erpId = params.get('erp') ?? (erps.data?.[0]?.id ? String(erps.data[0].id) : '')
  const [erp, setErp] = useState<Erp | null>(null)
  const [b, setB] = useState<Branding>(DEFAULT_BRAND)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [tplName, setTplName] = useState('')
  const [tplOpen, setTplOpen] = useState(false)

  useEffect(() => {
    if (!erpId) return
    api.get<Erp>(`/api/erps/${erpId}`).then(e => { setErp(e); setB({ ...DEFAULT_BRAND, ...e.branding }) }).catch(e => setErr(e.message))
  }, [erpId])

  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setB(x => ({ ...x, [k]: v }))
  const save = async (publish: boolean) => {
    setErr(null); setBusy(publish ? 'pub' : 'save')
    try {
      const e = await api.put<Erp>(`/api/erps/${erpId}/branding`, { branding: b, publish, note: publish ? 'Marca publicada' : 'Borrador de marca' })
      setErp(e); toast(publish ? 'Marca guardada y publicada en el ERP' : `Borrador guardado (versión ${e.current_version})`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  const upload = (k: 'logo' | 'favicon' | 'login_image') => async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0]; if (!f) return
    try { set(k, await readImage(f)) } catch (e) { setErr((e as Error).message) }
    ev.target.value = ''
  }
  const saveTpl = async () => {
    try { await api.post('/api/brand-templates', { name: tplName, branding: b }); toast('Plantilla de marca guardada'); setTplOpen(false); setTplName(''); tpls.reload() }
    catch (e) { setErr((e as Error).message) }
  }

  if (erps.loading) return <Spinner />
  if (!erps.data?.length) return <><PageHeader title="Identidad de Marca" /><div className="panel"><Empty title="Primero crea un ERP" text="La marca se configura por cada ERP: cambiar uno nunca afecta a otro." /></div></>

  const color = (k: 'primary' | 'secondary' | 'button' | 'background' | 'surface' | 'text', label: string) => (
    <Field label={label}><div className="flex gap-2"><input type="color" aria-label={label} value={b[k]} onChange={e => set(k, e.target.value.toUpperCase())} className="h-9 w-12 shrink-0 rounded bg-transparent" />
      <input className="inp font-mono" value={b[k]} onChange={e => set(k, e.target.value)} /></div></Field>
  )
  const text = (k: keyof Branding, label: string, area = false) => (
    <Field label={label}>{area ? <textarea className="inp" rows={2} value={String(b[k] ?? '')} onChange={e => set(k, e.target.value as never)} />
      : <input className="inp" value={String(b[k] ?? '')} onChange={e => set(k, e.target.value as never)} />}</Field>
  )
  const img = (k: 'logo' | 'favicon' | 'login_image', label: string) => (
    <Field label={label}><div className="flex items-center gap-2">
      {b[k] ? <img src={b[k]!} alt="" className="h-9 w-9 rounded bg-white/5 object-contain" /> : <div className="h-9 w-9 rounded bg-white/5" />}
      <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:border-gold-400/50"><ImageUp className="h-4 w-4" />Subir<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload(k)} /></label>
      {b[k] && <button type="button" className="text-xs text-red-300" onClick={() => set(k, null)}>Quitar</button>}
    </div></Field>
  )

  return (
    <div className="fade-in">
      <PageHeader title="Identidad de Marca" subtitle="White label por ERP: cada cliente tiene su propia identidad. LOMBANA ESTUDIOS no aparece en los ERP generados."
        actions={<>
          <select aria-label="ERP" className="inp w-56" value={erpId} onChange={e => setParams({ erp: e.target.value })}>{erps.data.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          <Button variant="ghost" icon={<Save className="h-4 w-4" />} loading={busy === 'save'} onClick={() => save(false)}>Guardar borrador</Button>
          <Button icon={<Send className="h-4 w-4" />} loading={busy === 'pub'} onClick={() => save(true)}>Guardar y publicar</Button>
        </>} />
      <ErrorBox error={err} />
      <div className="mt-4 grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="panel max-h-[75vh] space-y-5 overflow-y-auto p-5">
          <section className="space-y-3"><h3 className="text-sm font-semibold text-gold-200">Identidad</h3>
            {text('software_name', 'Nombre del software')}{text('company_name', 'Nombre de la empresa')}{text('slogan', 'Eslogan')}
            <div className="grid grid-cols-1 gap-3">{img('logo', 'Logotipo')}{img('favicon', 'Favicon')}{img('login_image', 'Imagen de inicio de sesión')}</div>
          </section>
          <section className="space-y-3"><h3 className="text-sm font-semibold text-gold-200">Colores y tipografía</h3>
            <div className="grid grid-cols-2 gap-3">{color('primary', 'Principal')}{color('secondary', 'Secundario / menú')}{color('button', 'Botones')}{color('background', 'Fondo')}{color('surface', 'Tarjetas')}{color('text', 'Texto')}</div>
            <Field label="Tipografía"><select className="inp" value={b.font} onChange={e => set('font', e.target.value)}>{FONTS.map(f => <option key={f}>{f}</option>)}</select></Field>
            <div className="flex gap-2">
              <Button variant="subtle" type="button" onClick={() => setB({ ...b, theme: 'claro', background: '#F8FAFC', surface: '#FFFFFF', text: '#0F172A' })}>Tema claro</Button>
              <Button variant="subtle" type="button" onClick={() => setB({ ...b, theme: 'oscuro', background: '#0B1220', surface: '#111A2E', text: '#E2E8F0' })}>Tema oscuro</Button>
            </div>
          </section>
          <section className="space-y-3"><h3 className="text-sm font-semibold text-gold-200">Pantalla de inicio y contacto</h3>
            {text('welcome_title', 'Título de bienvenida')}{text('welcome_text', 'Texto de bienvenida', true)}
            {text('contact_email', 'Correo')}{text('contact_phone', 'Teléfono')}{text('contact_address', 'Dirección')}
          </section>
          <section className="space-y-3"><h3 className="text-sm font-semibold text-gold-200">Documentos y reportes</h3>
            <Field label="Plantilla de factura"><select className="inp" value={b.invoice_template} onChange={e => set('invoice_template', e.target.value as Branding['invoice_template'])}>
              <option value="moderna">Moderna</option><option value="clasica">Clásica</option><option value="minimal">Minimal</option></select></Field>
            {text('document_footer', 'Pie de documentos', true)}
          </section>
          <p className="text-xs text-slate-500">Los nombres de módulos y menús se editan en <b>Mis ERP → Módulos</b>.</p>
        </div>
        <div className="space-y-4">
          <BrandPreview b={b} modules={erp?.config?.modules.filter(m => m.enabled).map(m => m.label)} />
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-white">Plantillas de marca</h3>
              <div className="flex gap-2">
                <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => erp && setB({ ...DEFAULT_BRAND, ...erp.branding })}>Restaurar última guardada</Button>
                <Button variant="subtle" icon={<BookmarkPlus className="h-4 w-4" />} onClick={() => setTplOpen(true)}>Guardar como plantilla</Button>
              </div>
            </div>
            {!tpls.data?.length ? <p className="text-sm text-slate-500">Guarda combinaciones de marca para reutilizarlas o duplicarlas en otros ERP.</p> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {tpls.data.map(t => (
                  <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/10 p-2">
                    <div className="flex">{[t.branding.primary, t.branding.secondary, t.branding.button].map((c, i) => <span key={i} className="h-5 w-5 rounded-full ring-2 ring-ink-900" style={{ background: c, marginLeft: i ? -6 : 0 }} />)}</div>
                    <span className="flex-1 truncate text-sm">{t.name}</span>
                    <Button variant="subtle" className="px-2 py-1 text-xs" onClick={() => { setB({ ...t.branding, software_name: b.software_name, company_name: b.company_name, logo: b.logo }); toast(`Plantilla "${t.name}" aplicada (falta guardar)`) }}>Aplicar</Button>
                    <button aria-label="Eliminar plantilla" className="p-1 text-slate-500 hover:text-red-300" onClick={async () => { await api.del(`/api/brand-templates/${t.id}`); tpls.reload() }}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Modal open={tplOpen} title="Guardar plantilla de marca" onClose={() => setTplOpen(false)}>
        <Field label="Nombre de la plantilla"><input className="inp" value={tplName} onChange={e => setTplName(e.target.value)} placeholder="Dorado premium" /></Field>
        <div className="mt-4 flex justify-end"><Button disabled={tplName.trim().length < 2} onClick={saveTpl}>Guardar</Button></div>
      </Modal>
    </div>
  )
}
