import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { IS_ARTIFACT, api, tokens } from '../lib/api'
import { Button, useToast } from '../components/ui'

/** Abre el ERP de un cliente. Dentro de Claude el propietario entra directo, sin contraseña. */
export default function OpenErp({ slug, variant = 'ghost', className }: { slug: string; variant?: 'ghost' | 'subtle'; className?: string }) {
  const nav = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (!IS_ARTIFACT) {
    return <a href={`/erp/${slug}/login`} target="_blank" rel="noreferrer" className={className}><Button variant={variant} className="w-full" icon={<ExternalLink className="h-4 w-4" />}>Abrir ERP</Button></a>
  }
  const open = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ token: string }>(`/api/rt/${slug}/owner-session`)
      tokens.setRt(slug, r.token)
      nav(`/erp/${slug}`)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return <div className={className}><Button variant={variant} className="w-full" loading={busy} icon={<ExternalLink className="h-4 w-4" />} onClick={open}>Abrir ERP</Button></div>
}
