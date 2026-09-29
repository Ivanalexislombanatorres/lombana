import type { Metadata } from 'next';
import { StatusBadge } from '@/components/ui';
import { inOrg } from '@/server/session';

export const metadata: Metadata = { title: 'Herramientas' };

interface Tool {
  key: string;
  name: string;
  category: string;
  description: string;
  functionality: string;
  requirements: string | null;
  limits_text: string | null;
  credit_cost: number | null;
  status: string;
  available_in: string;
}

export default async function ToolsPage() {
  const tools = await inOrg(async (tx) =>
    (
      await tx.query<Tool>(
        `select key, name, category, description, functionality, requirements, limits_text, credit_cost, status, available_in
           from public.tools order by sort_order, name`,
      )
    ).rows,
  );
  const v1 = tools.filter((t) => t.available_in === 'V1');
  const later = tools.filter((t) => t.available_in !== 'V1');

  const render = (list: Tool[]) => (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
      {list.map((t) => (
        <li key={t.key} className="card pad stack" style={{ gap: 10 }}>
          <div className="row between">
            <span className="h3">{t.name}</span>
            <StatusBadge status={t.status} />
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {t.description}
          </p>
          <dl style={{ margin: 0, display: 'grid', gap: 6, fontSize: 13.5 }}>
            <div>
              <dt className="dim" style={{ display: 'inline' }}>Qué hace: </dt>
              <dd style={{ display: 'inline', margin: 0 }}>{t.functionality}</dd>
            </div>
            {t.requirements && (
              <div>
                <dt className="dim" style={{ display: 'inline' }}>Requiere: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>{t.requirements}</dd>
              </div>
            )}
            {t.limits_text && (
              <div>
                <dt className="dim" style={{ display: 'inline' }}>Límites: </dt>
                <dd style={{ display: 'inline', margin: 0 }}>{t.limits_text}</dd>
              </div>
            )}
            <div>
              <dt className="dim" style={{ display: 'inline' }}>Costo: </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {t.credit_cost === null ? 'Por definir' : `${t.credit_cost} créditos por uso`}
              </dd>
            </div>
          </dl>
          <button className="btn btn-sm" type="button" disabled title="Se habilita cuando la herramienta pase sus pruebas">
            {t.status === 'READY' ? 'Usar' : 'Aún no disponible'}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div>
        <p className="eyebrow">Lombana Tools</p>
        <h1 className="h2" style={{ fontSize: 28 }}>
          Herramientas
        </h1>
        <p className="muted" style={{ margin: '6px 0 0', maxWidth: 720 }}>
          Cada herramienta muestra su estado real. Se activan una a una cuando pasan sus pruebas; ninguna simula un
          resultado.
        </p>
      </div>
      <section className="stack">
        <h2 className="h3">Primera versión</h2>
        {render(v1)}
      </section>
      {later.length > 0 && (
        <section className="stack">
          <h2 className="h3">Próximas versiones</h2>
          {render(later)}
        </section>
      )}
    </div>
  );
}
