import type { Metadata } from 'next';
import Link from 'next/link';
import { withAnonymous } from '@lombana/db';
import { Brand } from '@/components/ui';
import { NEWS_TOPICS } from '@/lib/news/input';
import { db } from '@/server/db';

export const metadata: Metadata = {
  title: 'LOMBANA NEWS',
  description: 'Noticias y aportes de tecnología, con fuente y moderación.',
};
export const dynamic = 'force-dynamic';

interface Item {
  id: string;
  headline: string;
  original_url: string;
  summary: string | null;
  published_at: Date | null;
  source_name: string;
}
interface Contribution {
  id: string;
  title: string;
  body: string;
  reference_urls: string[];
  topics: string[];
  published_at: Date;
}

// Defensa en profundidad: solo se enlazan URLs http(s) válidas, aunque la base contenga otra cosa.
function safeLink(u: string): { href: string; host: string } | null {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? { href: url.toString(), host: url.hostname } : null;
  } catch {
    return null;
  }
}

const fmt = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' });

async function load() {
  try {
    return await withAnonymous(db(), async (tx) => {
      const items = await tx.query<Item>(
        `select i.id, i.headline, i.original_url, case when i.summary_status = 'approved' then i.summary end as summary,
                i.published_at, s.name as source_name
           from public.news_items i join public.news_sources s on s.id = i.source_id
          order by i.published_at desc nulls last limit 30`,
      );
      const contributions = await tx.query<Contribution>(
        `select id, title, body, reference_urls, topics, published_at
           from public.news_published_contributions order by published_at desc limit 30`,
      );
      return { items: items.rows, contributions: contributions.rows };
    });
  } catch (err) {
    console.error('[noticias] no disponible:', (err as Error).message);
    return null;
  }
}

export default async function NewsPage() {
  const data = await load();

  return (
    <div className="container stack" style={{ gap: 28, padding: '24px 0 48px' }}>
      <header className="row between wrap">
        <Link href="/">
          <Brand />
        </Link>
        <Link href="/app/noticias" className="btn btn-primary btn-sm">
          Enviar un aporte
        </Link>
      </header>
      <div className="stack" style={{ gap: 6 }}>
        <p className="eyebrow">Periódico digital</p>
        <h1 className="h1" style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>
          LOMBANA NEWS
        </h1>
        <p className="muted" style={{ margin: 0, maxWidth: 720 }}>
          Tecnología explicada con fuentes. Las noticias enlazan siempre al artículo original; los aportes de la
          comunidad se publican solo después de moderación.
        </p>
      </div>

      {data === null ? (
        <p className="notice notice-warn">El periódico no está disponible en este momento. Inténtalo más tarde.</p>
      ) : (
        <>
          <section className="stack" aria-labelledby="titulares">
            <h2 id="titulares" className="h2">
              Titulares
            </h2>
            {data.items.length === 0 ? (
              <p className="panel pad muted" style={{ margin: 0 }}>
                Todavía no hay titulares. La lectura automática de fuentes se activa fuente por fuente, después de
                revisar sus términos de uso.
              </p>
            ) : (
              <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10 }}>
                {data.items.map((i) => (
                  <li key={i.id} className="card pad stack" style={{ gap: 6 }}>
                    {safeLink(i.original_url) ? (
                      <a href={safeLink(i.original_url)!.href} target="_blank" rel="noopener noreferrer nofollow" className="h3">
                        {i.headline}
                      </a>
                    ) : (
                      <span className="h3">{i.headline}</span>
                    )}
                    <span className="dim" style={{ fontSize: 13 }}>
                      {i.source_name}
                      {i.published_at ? ` · ${fmt.format(i.published_at)}` : ''}
                    </span>
                    {i.summary && <p className="muted" style={{ margin: 0 }}>{i.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="stack" aria-labelledby="aportes">
            <h2 id="aportes" className="h2">
              Aportes de la comunidad
            </h2>
            {data.contributions.length === 0 ? (
              <p className="panel pad muted" style={{ margin: 0 }}>
                Aún no hay aportes publicados. ¿Tienes algo que contar sobre tecnología?{' '}
                <Link href="/app/noticias">Envía el primero</Link>.
              </p>
            ) : (
              <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 12 }}>
                {data.contributions.map((c) => (
                  <li key={c.id} className="card pad-lg stack" style={{ gap: 8 }}>
                    <h3 className="h3">{c.title}</h3>
                    <span className="dim" style={{ fontSize: 13 }}>
                      {c.topics.map((t) => NEWS_TOPICS[t as keyof typeof NEWS_TOPICS] ?? t).join(', ')} ·{' '}
                      {fmt.format(c.published_at)}
                    </span>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.body}</p>
                    {c.reference_urls.length > 0 && (
                      <ul className="dim" style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>
                        {c.reference_urls.map((u) => {
                          const link = safeLink(u);
                          return link ? (
                            <li key={u}>
                              <a href={link.href} target="_blank" rel="noopener noreferrer nofollow ugc">
                                {link.host}
                              </a>
                            </li>
                          ) : null;
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
