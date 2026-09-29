import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTRIBUTION_STATUS_LABEL, NEWS_TOPICS } from '@/lib/news/input';
import { changeContributionStatus } from '@/server/actions/news';
import { inOrg } from '@/server/session';
import { ContributionForm } from './contribution-form';

export const metadata: Metadata = { title: 'Mis aportes' };

interface Row {
  id: string;
  title: string;
  status: string;
  topics: string[];
  moderation_note: string | null;
  updated_at: Date;
}

function Action({ id, transition, label }: { id: string; transition: string; label: string }) {
  return (
    <form action={changeContributionStatus}>
      <input type="hidden" name="contributionId" value={id} />
      <input type="hidden" name="transition" value={transition} />
      <button className="btn btn-sm" type="submit">
        {label}
      </button>
    </form>
  );
}

export default async function MyContributionsPage() {
  const rows = await inOrg(async (tx) =>
    (
      await tx.query<Row>(
        `select id, title, status, topics, moderation_note, updated_at
           from public.news_contributions order by updated_at desc limit 50`,
      )
    ).rows,
  );

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 860 }}>
      <div className="row between wrap">
        <div>
          <p className="eyebrow">LOMBANA NEWS</p>
          <h1 className="h2" style={{ fontSize: 28 }}>
            Mis aportes
          </h1>
        </div>
        <Link href="/noticias" className="btn btn-sm">
          Ver el periódico
        </Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Escribe noticias o análisis de tecnología. Cada aporte pasa por moderación antes de publicarse en el periódico;
        nadie puede aprobar su propio aporte.
      </p>

      <section className="panel pad-lg stack">
        <h2 className="h3">Nuevo aporte</h2>
        <ContributionForm />
      </section>

      <section className="stack">
        <h2 className="h3">Enviados y borradores</h2>
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Aún no tienes aportes.
          </p>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
            {rows.map((r) => (
              <li key={r.id} className="card pad stack" style={{ gap: 8 }}>
                <div className="row between wrap">
                  <span className="h3">{r.title}</span>
                  <span className="badge" data-testid="contribution-status">
                    {CONTRIBUTION_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
                <span className="dim" style={{ fontSize: 13.5 }}>
                  {r.topics.map((t) => NEWS_TOPICS[t as keyof typeof NEWS_TOPICS] ?? t).join(', ')}
                </span>
                {r.moderation_note && (
                  <p className="notice notice-info" style={{ margin: 0 }}>
                    Nota de moderación: {r.moderation_note}
                  </p>
                )}
                <div className="row wrap" style={{ gap: 8 }}>
                  {(r.status === 'draft' || r.status === 'withdrawn') && (
                    <Action id={r.id} transition="submit" label="Enviar a moderación" />
                  )}
                  {(r.status === 'draft' || r.status === 'submitted') && <Action id={r.id} transition="withdraw" label="Retirar" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
