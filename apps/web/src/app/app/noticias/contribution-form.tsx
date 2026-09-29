'use client';

import { useActionState } from 'react';
import { NEWS_TOPICS } from '@/lib/news/input';
import { createContribution, type ContributionFormState } from '@/server/actions/news';

export function ContributionForm() {
  const [state, action, pending] = useActionState<ContributionFormState, FormData>(createContribution, {});
  const v = state.values;
  return (
    <form action={action} className="stack" style={{ gap: 14 }}>
      <div className="field">
        <label className="label" htmlFor="title">
          Título
        </label>
        <input id="title" name="title" className="input" required minLength={8} maxLength={200} defaultValue={v?.title} />
      </div>
      <div className="field">
        <label className="label" htmlFor="topic">
          Tema
        </label>
        <select id="topic" name="topic" className="select" defaultValue={v?.topic ?? 'ia'}>
          {Object.entries(NEWS_TOPICS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="body">
          Tu aporte
        </label>
        <textarea
          id="body"
          name="body"
          className="textarea"
          rows={8}
          required
          minLength={80}
          maxLength={20000}
          defaultValue={v?.body}
          placeholder="Explica la noticia o tu análisis con tus palabras. Cita las fuentes abajo."
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="references">
          Enlaces de referencia (uno por línea, máximo 5)
        </label>
        <textarea id="references" name="references" className="textarea" rows={3} defaultValue={v?.references} placeholder="https://" />
      </div>
      {state.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && !pending && (
        <p className="notice notice-info" role="status">
          Aporte guardado.
        </p>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn btn-primary" type="submit" name="intent" value="submit" disabled={pending}>
          Enviar a moderación
        </button>
        <button className="btn" type="submit" name="intent" value="draft" disabled={pending}>
          Guardar borrador
        </button>
      </div>
    </form>
  );
}
