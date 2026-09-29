import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMinor, PRODUCT_STATUS_LABEL, PRODUCT_TYPES } from '@/lib/products/catalog';
import { inOrg } from '@/server/session';
import styles from '../proyectos/projects.module.css';

export const metadata: Metadata = { title: 'Productos' };

interface Row {
  id: string;
  title: string;
  status: string;
  product_type: keyof typeof PRODUCT_TYPES;
  amount_minor: string | null;
  currency: string | null;
}

export default async function ProductsPage() {
  const products = await inOrg(async (tx) =>
    (
      await tx.query<Row>(
        `select p.id, p.title, p.status, p.product_type, cp.amount_minor, cp.currency
           from public.products p
           left join lateral app.current_price(p.id) cp on true
          where p.deleted_at is null and p.status <> 'archived'
          order by p.updated_at desc`,
      )
    ).rows,
  );

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Product Lab</p>
          <h1 className="h2" style={{ fontSize: 28 }}>
            Productos
          </h1>
        </div>
        <Link href="/app/productos/nuevo" className="btn btn-primary">
          Nuevo producto
        </Link>
      </div>

      {products.length === 0 ? (
        <div className="panel pad-lg stack">
          <p className="h3">Aún no tienes productos</p>
          <p className="muted" style={{ margin: 0 }}>
            Crea un ebook, una plantilla o un pack. Puede ser gratis (se descarga dejando el correo) o de pago con
            precio mínimo de US$5.
          </p>
        </div>
      ) : (
        <ul className={styles.grid}>
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`/app/productos/${p.id}`} className={`card pad ${styles.card}`}>
                <div className="row between">
                  <span className="badge">{PRODUCT_STATUS_LABEL[p.status] ?? p.status}</span>
                  <span className="dim">{formatMinor(p.amount_minor, p.currency ?? 'USD')}</span>
                </div>
                <span className="h3">{p.title}</span>
                <span className="dim" style={{ fontSize: 13.5 }}>
                  {PRODUCT_TYPES[p.product_type] ?? p.product_type}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
