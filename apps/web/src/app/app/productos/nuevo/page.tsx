import type { Metadata } from 'next';
import Link from 'next/link';
import { formatMinor } from '@/lib/products/catalog';
import { inOrg } from '@/server/session';
import { ProductForm } from '../product-form';

export const metadata: Metadata = { title: 'Nuevo producto' };

export default async function NewProductPage() {
  const min = await inOrg(async (tx) => {
    const { rows } = await tx.query<{ min: string | null }>("select app.min_price_for('USD', null, null) as min");
    return rows[0]?.min ?? null;
  });

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 760 }}>
      <Link href="/app/productos" className="dim" style={{ fontSize: 13.5 }}>
        ← Productos
      </Link>
      <h1 className="h2" style={{ fontSize: 28 }}>
        Nuevo producto
      </h1>
      <div className="panel pad-lg">
        <ProductForm minLabel={min === null ? 'sin configurar' : formatMinor(min)} />
      </div>
    </div>
  );
}
