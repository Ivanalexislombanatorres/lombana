'use client';

import { useActionState } from 'react';
import { requestClauPlan, type ClauState } from '@/server/actions/clau';

export function ClauRequest({ projectId, hasProposal }: { projectId: string; hasProposal: boolean }) {
  const [state, action, pending] = useActionState<ClauState, FormData>(requestClauPlan, {});
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="projectId" value={projectId} />
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
          {pending ? 'CLAU está pensando…' : hasProposal ? 'Pedir otro plan a CLAU' : 'Pedir plan a CLAU'}
        </button>
        <span className="dim" style={{ fontSize: 12.5 }}>
          Tu objetivo se envía a la IA (Google Gemini) para proponer el plan. No incluyas datos personales.
        </span>
      </div>
      {state.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
