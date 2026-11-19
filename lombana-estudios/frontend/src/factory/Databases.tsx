import { Link } from 'react-router-dom'
import { DatabaseBackup } from 'lucide-react'
import { api, dt } from '../lib/api'
import { Badge, Button, ErrorBox, PageHeader, Spinner, Table, useLoad, useToast } from '../components/ui'

type Db = { name: string; kind: string; erp_id: number | null; erp_name: string; revision: string | null; head: string; backups: number }
type Inst = { id: number; erp_id: number | null; action: string; detail: string; created_at: string }

export default function Databases() {
  const toast = useToast()
  const d = useLoad(() => api.get<{ engine: string; databases: Db[] }>('/api/databases'))
  const inst = useLoad(() => api.get<Inst[]>('/api/installations'))
  if (d.loading) return <Spinner />
  if (!d.data) return <ErrorBox error={d.error} />
  return (
    <div className="fade-in space-y-6">
      <PageHeader title="Bases de Datos" subtitle={`Motor: ${d.data.engine === 'sqlite' ? 'SQLite (local, un usuario)' : 'PostgreSQL'}. Una base central para la fábrica y una independiente por cada ERP.`}
        actions={<Button icon={<DatabaseBackup className="h-4 w-4" />} onClick={async () => { const r = await api.post<{ file: string }>('/api/databases/factory/backup'); toast(`Respaldo de la fábrica: ${r.file}`); d.reload() }}>Respaldar base central</Button>} />
      <div className="panel p-5">
        <Table head={['Base de datos', 'Tipo', 'Pertenece a', 'Esquema', 'Respaldos', '']}>
          {d.data.databases.map(x => (
            <tr key={x.name}>
              <td className="px-3 py-2 font-mono text-xs text-gold-200">{x.name}</td>
              <td className="px-3"><Badge tone={x.kind === 'factory' ? 'gold' : 'blue'}>{x.kind === 'factory' ? 'central' : 'operacional'}</Badge></td>
              <td className="px-3">{x.erp_name}</td>
              <td className="px-3">{x.revision === x.head ? <Badge tone="green">{x.revision}</Badge> : <Badge tone="red">{x.revision ?? 'sin acceso'} → {x.head}</Badge>}</td>
              <td className="px-3">{x.backups}</td>
              <td className="px-3 text-right">{x.erp_id && <Link className="text-xs text-gold-300 hover:underline" to={`/erps/${x.erp_id}`}>Gestionar</Link>}</td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="panel p-5">
        <h3 className="mb-3 font-semibold text-white">Registro de instalaciones</h3>
        <Table head={['Fecha', 'ERP', 'Acción', 'Detalle']} empty={!inst.data?.length}>
          {inst.data?.map(i => <tr key={i.id}><td className="px-3 py-2 text-slate-400">{dt(i.created_at)}</td><td className="px-3">#{i.erp_id}</td><td className="px-3"><Badge>{i.action}</Badge></td><td className="px-3 text-xs text-slate-400">{i.detail}</td></tr>)}
        </Table>
      </div>
    </div>
  )
}
