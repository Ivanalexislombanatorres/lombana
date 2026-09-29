'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { Tx } from '@lombana/db';
import {
  PRODUCT_CATEGORIES,
  PRODUCT_TYPES,
  parsePriceToMinor,
  slugify,
  formatMinor,
  type ProductCategory,
  type ProductType,
} from '@/lib/products/catalog';
import { inOrg, type Account } from '@/server/session';

export interface ProductFormState {
  error?: string;
  saved?: boolean;
  /** Lo que la persona escribió: el formulario lo recupera tras un error (React lo vacía al enviar). */
  values?: Record<string, string>;
}

function echo(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['title', 'description', 'productType', 'category', 'pricing', 'price']) {
    const v = form.get(k);
    if (typeof v === 'string') out[k] = v.slice(0, 4000);
  }
  return out;
}

const CURRENCY = 'USD';
const uuid = z.string().uuid();

const productFields = z.object({
  title: z.string().trim().min(3, 'El título debe tener al menos 3 caracteres').max(200),
  description: z.string().trim().max(4000, 'La descripción es demasiado larga').optional(),
  productType: z.enum(Object.keys(PRODUCT_TYPES) as [ProductType, ...ProductType[]], { message: 'Elige el tipo' }),
  category: z.enum(Object.keys(PRODUCT_CATEGORIES) as [ProductCategory, ...ProductCategory[]], {
    message: 'Elige la categoría',
  }),
  pricing: z.enum(['free', 'paid'], { message: 'Elige si es gratis o de pago' }),
  price: z.string().optional(),
});

type ProductInput = z.infer<typeof productFields>;

function read(form: FormData) {
  return productFields.safeParse({
    title: form.get('title'),
    description: form.get('description') || undefined,
    productType: form.get('productType'),
    category: form.get('category'),
    pricing: form.get('pricing'),
    price: form.get('price') || undefined,
  });
}

/**
 * Precio en centavos validado contra la regla de la plataforma (la misma que aplica la
 * base al publicar). Devuelve un mensaje de error o el monto.
 */
async function resolvePrice(tx: Tx, input: ProductInput): Promise<{ minor: number } | { error: string }> {
  if (input.pricing === 'free') {
    // Un precio escrito con la opción "gratis" es una contradicción: se pregunta, no se adivina.
    if (input.price && parsePriceToMinor(input.price) !== 0) {
      return { error: 'Marcaste "Gratis" pero escribiste un precio. Elige una de las dos opciones.' };
    }
    return { minor: 0 };
  }
  const minor = parsePriceToMinor(input.price ?? '');
  if (minor === null || minor === 0) return { error: 'Escribe un precio válido en dólares, por ejemplo 5 o 12.50' };
  const { rows } = await tx.query<{ min: string | null }>('select app.min_price_for($1, null, $2) as min', [
    CURRENCY,
    input.category,
  ]);
  const min = rows[0]?.min === null || rows[0]?.min === undefined ? null : Number(rows[0].min);
  if (min === null) return { error: 'Aún no hay precio mínimo configurado para esta moneda.' };
  if (minor < min) return { error: `El precio mínimo es ${formatMinor(min)}.` };
  return { minor };
}

async function audit(tx: Tx, account: Account, action: string, productId: string, metadata: object = {}) {
  await tx.query(
    `insert into public.audit_logs (org_id, actor_user_id, actor_type, action, target_type, target_id, result, metadata)
     values ($1, $2, 'user', $3, 'product', $4, 'success', $5)`,
    [account.org.id, account.userId, action, productId, JSON.stringify(metadata)],
  );
}

export async function createProduct(_prev: ProductFormState, form: FormData): Promise<ProductFormState> {
  const parsed = read(form);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos', values: echo(form) };
  const input = parsed.data;

  const result = await inOrg(async (tx, account) => {
    const price = await resolvePrice(tx, input);
    if ('error' in price) return price;
    const slug = slugify(input.title, randomBytes(3).toString('hex'));
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.products (org_id, slug, title, description, category, product_type, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [account.org.id, slug, input.title, input.description ?? null, input.category, input.productType, account.userId],
    );
    const productId = rows[0]!.id;
    const v = await tx.query<{ id: string }>(
      `insert into public.product_versions (org_id, product_id, version, notes, created_by)
       values ($1, $2, 1, 'Versión inicial', $3) returning id`,
      [account.org.id, productId, account.userId],
    );
    await tx.query('update public.products set current_version_id = $2 where id = $1', [productId, v.rows[0]!.id]);
    await tx.query(
      `insert into public.product_prices (org_id, product_id, amount_minor, currency, created_by)
       values ($1, $2, $3, $4, $5)`,
      [account.org.id, productId, price.minor, CURRENCY, account.userId],
    );
    await tx.query(
      `insert into public.analytics_events (org_id, user_id, name, properties) values ($1, $2, 'product.created', $3)`,
      [account.org.id, account.userId, JSON.stringify({ tipo: input.productType, gratis: price.minor === 0 })],
    );
    await audit(tx, account, 'product.create', productId, { precio_minor: price.minor });
    return { id: productId };
  });
  if ('error' in result) return { error: result.error, values: echo(form) };
  revalidatePath('/app/productos');
  redirect(`/app/productos/${result.id}`);
}

export async function updateProduct(_prev: ProductFormState, form: FormData): Promise<ProductFormState> {
  const id = uuid.safeParse(form.get('productId'));
  const parsed = read(form);
  if (!id.success) return { error: 'Producto inválido' };
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Datos inválidos', values: echo(form) };
  const input = parsed.data;

  const result = await inOrg(async (tx, account) => {
    const p = await tx.query<{ status: string }>(
      'select status from public.products where id = $1 and deleted_at is null for update',
      [id.data],
    );
    if (!p.rows[0]) return { error: 'El producto no existe' };
    if (p.rows[0].status !== 'draft') return { error: 'Solo se edita un producto en borrador' };
    const price = await resolvePrice(tx, input);
    if ('error' in price) return price;
    await tx.query(
      `update public.products set title = $2, description = $3, category = $4, product_type = $5 where id = $1`,
      [id.data, input.title, input.description ?? null, input.category, input.productType],
    );
    // En borrador el precio se reemplaza completo: lo que se envía a revisión es un único precio vigente.
    await tx.query('delete from public.product_prices where product_id = $1', [id.data]);
    await tx.query(
      `insert into public.product_prices (org_id, product_id, amount_minor, currency, created_by)
       values ($1, $2, $3, $4, $5)`,
      [account.org.id, id.data, price.minor, CURRENCY, account.userId],
    );
    await audit(tx, account, 'product.update', id.data, { precio_minor: price.minor });
    return { ok: true as const };
  });
  if ('error' in result) return { error: result.error, values: echo(form) };
  revalidatePath(`/app/productos/${id.data}`);
  revalidatePath('/app/productos');
  return { saved: true };
}

const transitions: Record<string, { from: string[]; to: string; action: string }> = {
  submit: { from: ['draft'], to: 'in_review', action: 'product.submit_review' },
  withdraw: { from: ['in_review', 'paused'], to: 'draft', action: 'product.back_to_draft' },
  archive: { from: ['draft', 'paused'], to: 'archived', action: 'product.archive' },
};

export async function changeProductStatus(form: FormData): Promise<void> {
  const id = uuid.safeParse(form.get('productId'));
  const t = transitions[String(form.get('transition'))];
  if (!id.success || !t) return;
  await inOrg(async (tx, account) => {
    const p = await tx.query<{ status: string }>(
      'select status from public.products where id = $1 and deleted_at is null for update',
      [id.data],
    );
    if (!p.rows[0] || !t.from.includes(p.rows[0].status)) return;
    if (t.to === 'in_review') {
      const price = await tx.query('select 1 from app.current_price($1)', [id.data]);
      if (price.rowCount === 0) return;
    }
    await tx.query('update public.products set status = $2 where id = $1', [id.data, t.to]);
    await audit(tx, account, t.action, id.data, { desde: p.rows[0].status, hacia: t.to });
  });
  revalidatePath(`/app/productos/${id.data}`);
  revalidatePath('/app/productos');
}
