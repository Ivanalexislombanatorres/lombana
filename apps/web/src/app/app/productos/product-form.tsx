'use client';

import { useActionState, useState } from 'react';
import { PRODUCT_CATEGORIES, PRODUCT_TYPES } from '@/lib/products/catalog';
import { createProduct, updateProduct, type ProductFormState } from '@/server/actions/products';

export interface ProductFormValues {
  id?: string;
  title: string;
  description: string;
  productType: string;
  category: string;
  priceMinor: number | null;
}

export function ProductForm({ initial, minLabel }: { initial?: ProductFormValues; minLabel: string }) {
  const editing = Boolean(initial?.id);
  const [state, action, pending] = useActionState<ProductFormState, FormData>(
    editing ? updateProduct : createProduct,
    {},
  );
  // Tras un error se muestran los valores enviados; si no, los guardados.
  const v = state.values;
  const savedPricing = initial && initial.priceMinor !== null && initial.priceMinor > 0 ? 'paid' : 'free';
  const defaultPricing = v?.pricing === 'paid' || v?.pricing === 'free' ? v.pricing : savedPricing;
  // Las opciones de precio NO son controladas: React reinicia el formulario tras cada envío
  // y una opción controlada quedaría desincronizada (se veía "De pago" pero se enviaba "Gratis").
  const [pricing, setPricing] = useState<'free' | 'paid'>(defaultPricing);
  const initialPrice = initial?.priceMinor ? (initial.priceMinor / 100).toFixed(2) : '';

  return (
    <form action={action} className="stack" style={{ gap: 16 }}>
      {initial?.id && <input type="hidden" name="productId" value={initial.id} />}
      <div className="field">
        <label className="label" htmlFor="title">
          Título
        </label>
        <input id="title" name="title" className="input" required minLength={3} maxLength={200} defaultValue={v?.title ?? initial?.title} />
      </div>
      <div className="field">
        <label className="label" htmlFor="description">
          Descripción
        </label>
        <textarea
          id="description"
          name="description"
          className="textarea"
          rows={4}
          maxLength={4000}
          defaultValue={v?.description ?? initial?.description}
          placeholder="Qué recibe quien lo descargue y para qué le sirve"
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="productType">
            Tipo
          </label>
          <select id="productType" name="productType" className="select" defaultValue={v?.productType ?? initial?.productType ?? 'ebook'}>
            {Object.entries(PRODUCT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="category">
            Categoría
          </label>
          <select id="category" name="category" className="select" defaultValue={v?.category ?? initial?.category ?? 'negocios'}>
            {Object.entries(PRODUCT_CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>
          Precio
        </legend>
        <div className="row wrap" style={{ gap: 18 }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="pricing" value="free" defaultChecked={defaultPricing === 'free'} onChange={() => setPricing('free')} />
            Gratis (se descarga dejando correo y autorización)
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="radio" name="pricing" value="paid" defaultChecked={defaultPricing === 'paid'} onChange={() => setPricing('paid')} />
            De pago
          </label>
        </div>
        {pricing === 'paid' && (
          <div className="field" style={{ marginTop: 10, maxWidth: 260 }}>
            <label className="label" htmlFor="price">
              Precio en dólares (mínimo {minLabel})
            </label>
            <input
              id="price"
              name="price"
              className="input"
              inputMode="decimal"
              placeholder="5.00"
              required
              defaultValue={v?.price ?? initialPrice}
            />
          </div>
        )}
      </fieldset>

      {state.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && !pending && (
        <p className="notice notice-info" role="status">
          Cambios guardados.
        </p>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {editing ? 'Guardar cambios' : 'Crear producto'}
        </button>
      </div>
    </form>
  );
}
