'use client';

import { useActionState } from 'react';
import { moderate, type ModerationState } from '@/server/actions/moderation';

export function ModerationForm({ kind, id }: { kind: 'contribution' | 'product'; id: string }) {
  const [state, action, pending] = useActionState<ModerationState, FormData>(moderate, {});
  if (state.done) {
    return (
      <p className="notice notice-info" role="status">
        {state.done}
      </p>
    );
  }
  const [yes, no] = kind === 'contribution' ? ['approved', 'rejected'] : ['publish', 'return'];
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <label className="label" htmlFor={`note-${id}`}>
        Nota para el autor (obligatoria si rechazas)
      </label>
      <textarea id={`note-${id}`} name="note" className="textarea" rows={2} maxLength={1000} />
      {state.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn btn-primary btn-sm" type="submit" name="decision" value={yes} disabled={pending}>
          {kind === 'contribution' ? 'Aprobar y publicar' : 'Publicar'}
        </button>
        <button className="btn btn-sm" type="submit" name="decision" value={no} disabled={pending}>
          {kind === 'contribution' ? 'Rechazar' : 'Devolver a borrador'}
        </button>
      </div>
    </form>
  );
}
