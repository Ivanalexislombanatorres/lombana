import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatMinor, PRODUCT_TYPES } from '@/lib/products/catalog';
import { NEWS_TOPICS } from '@/lib/news/input';
import { inOrg, requireAccount } from '@/server/session';
import { ModerationForm } from './moderation-item';

export const metadata: Metadata = { title: 'Moderación' };

interface QueueRow {
  kind: 'contribution' | 'product';
  id: string;
  title: string;
  body: string;
  detail: Record<string, unknown>;
  author_email: string | null;
  submitted_at: Date;
}

const fmt = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

export default async function ModerationPage() {
  const account = await requireAccount();
  if (!account.isModerator) notFound();
  const queue = await inOrg(async (tx) => (await tx.query<QueueRow>('select * from app.moderation_queue()')).rows);

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 900 }}>
      <div>
        <p className="eyebrow">Administración</p>
        <h1 className="h2" style={{ fontSize: 28 }}>
          Moderación
        </h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Aportes al periódico y productos enviados a revisión. Cada decisión queda en auditoría. Nadie modera lo
          suyo.
        </p>
      </div>
      {queue.length === 0 ? (
        <p className="panel pad muted" style={{ margin: 0 }}>
          No hay nada pendiente.
        </p>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 14 }}>
          {queue.map((q) => {
            const d = q.detail;
            return (
              <li key={`${q.kind}-${q.id}`} className="card pad-lg stack" style={{ gap: 10 }}>
                <div className="row between wrap">
                  <span className="badge">{q.kind === 'contribution' ? 'Aporte' : 'Producto'}</span>
                  <span className="dim" style={{ fontSize: 13 }}>
                    {q.author_email ?? '—'} · {fmt.format(q.submitted_at)}
                  </span>
                </div>
                <h2 className="h3">{q.title}</h2>
                {q.kind === 'contribution' ? (
                  <span className="dim" style={{ fontSize: 13 }}>
                    {((d.topics as string[]) ?? []).map((t) => NEWS_TOPICS[t as keyof typeof NEWS_TOPICS] ?? t).join(', ')}
                    {((d.reference_urls as string[]) ?? []).length > 0 && ` · ${(d.reference_urls as string[]).join(' · ')}`}
                  </span>
                ) : (
                  <span className="dim" style={{ fontSize: 13 }}>
                    {PRODUCT_TYPES[d.product_type as keyof typeof PRODUCT_TYPES] ?? String(d.product_type)} ·{' '}
                    {formatMinor(d.amount_minor as number | null, (d.currency as string) ?? 'USD')} · Archivos entregables:{' '}
                    {String(d.deliverables ?? 0)}
                  </span>
                )}
                <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
                  {q.body}
                </p>
                <ModerationForm kind={q.kind} id={q.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
