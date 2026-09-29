import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { formatMinor, PRODUCT_CATEGORIES, PRODUCT_STATUS_LABEL, PRODUCT_TYPES } from '@/lib/products/catalog';
import { changeProductStatus } from '@/server/actions/products';
import { inOrg } from '@/server/session';
import { ProductForm } from '../product-form';

export const metadata: Metadata = { title: 'Producto' };

interface Product {
  id: string;
  title: string;
  description: string | null;
  status: string;
  product_type: keyof typeof PRODUCT_TYPES;
  category: string;
  slug: string;
  created_at: Date;
  amount_minor: string | null;
  currency: string | null;
}

function Transition({ id, transition, label, primary }: { id: string; transition: string; label: string; primary?: boolean }) {
  return (
    <form action={changeProductStatus}>
      <input type="hidden" name="productId" value={id} />
      <input type="hidden" name="transition" value={transition} />
      <button className={`btn btn-sm ${primary ? 'btn-primary' : ''}`} type="submit">
        {label}
      </button>
    </form>
  );
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const data = await inOrg(async (tx) => {
    const p = await tx.query<Product>(
      `select p.id, p.title, p.description, p.status, p.product_type, p.category, p.slug, p.created_at,
              cp.amount_minor, cp.currency
         from public.products p
         left join lateral app.current_price(p.id) cp on true
        where p.id = $1 and p.deleted_at is null`,
      [id],
    );
    if (!p.rows[0]) return null;
    const s = await tx.query<{ min: string | null; payments: boolean }>(
      `select app.min_price_for('USD', null, $1) as min,
              coalesce((select (value #>> '{}')::boolean from public.settings where key = 'payments.enabled'), false) as payments`,
      [p.rows[0].category],
    );
    const n = await tx.query<{ n: string | null }>('select app.product_review_note($1) as n', [id]);
    return {
      product: p.rows[0],
      min: s.rows[0]?.min ?? null,
      payments: s.rows[0]?.payments ?? false,
      reviewNote: n.rows[0]?.n ?? null,
    };
  });
  if (!data) notFound();
  const { product, min, payments, reviewNote } = data;
  const paid = Number(product.amount_minor ?? 0) > 0;
  const isDraft = product.status === 'draft';

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 860 }}>
      <Link href="/app/productos" className="dim" style={{ fontSize: 13.5 }}>
        ← Productos
      </Link>
      <div className="row between wrap">
        <div className="stack" style={{ gap: 6 }}>
          <h1 className="h2" style={{ fontSize: 28 }}>
            {product.title}
          </h1>
          <span className="dim" style={{ fontSize: 13.5 }}>
            {PRODUCT_TYPES[product.product_type]} · {PRODUCT_CATEGORIES[product.category as keyof typeof PRODUCT_CATEGORIES] ?? product.category} ·{' '}
            {formatMinor(product.amount_minor, product.currency ?? 'USD')}
          </span>
        </div>
        <span className="badge" data-testid="product-status">
          {PRODUCT_STATUS_LABEL[product.status] ?? product.status}
        </span>
      </div>

      {isDraft && reviewNote && (
        <p className="notice notice-warn" data-testid="review-note">
          Revisión: {reviewNote}
        </p>
      )}
      {product.status === 'in_review' && (
        <p className="notice notice-info">
          Enviado a revisión. Administración de LOMBANA lo revisa; para publicarse necesita al menos un archivo
          entregable, y ningún producto se publica automáticamente.
        </p>
      )}
      {paid && !payments && (
        <p className="notice notice-warn">
          Los pagos aún no están habilitados en la plataforma: un producto de pago puede prepararse y enviarse a revisión,
          pero no se publicará hasta que se activen los cobros.
        </p>
      )}

      <div className="row wrap" style={{ gap: 8 }}>
        {isDraft && <Transition id={product.id} transition="submit" label="Enviar a revisión" primary />}
        {(product.status === 'in_review' || product.status === 'paused') && (
          <Transition id={product.id} transition="withdraw" label="Volver a borrador" />
        )}
        {(isDraft || product.status === 'paused') && <Transition id={product.id} transition="archive" label="Archivar" />}
      </div>

      {isDraft ? (
        <section className="panel pad-lg stack">
          <h2 className="h3">Editar</h2>
          <ProductForm
            minLabel={min === null ? 'sin configurar' : formatMinor(min)}
            initial={{
              id: product.id,
              title: product.title,
              description: product.description ?? '',
              productType: product.product_type,
              category: product.category,
              priceMinor: product.amount_minor === null ? null : Number(product.amount_minor),
            }}
          />
        </section>
      ) : (
        product.description && (
          <section className="panel pad-lg">
            <p className="muted" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {product.description}
            </p>
          </section>
        )
      )}

      <section className="panel pad stack" style={{ gap: 8 }}>
        <h2 className="h3">Archivos del producto</h2>
        <p className="muted" style={{ margin: 0 }}>
          La subida de archivos se habilita cuando se configure el almacenamiento privado (pendiente de decisión). No
          se simula ninguna descarga.
        </p>
      </section>
    </div>
  );
}
