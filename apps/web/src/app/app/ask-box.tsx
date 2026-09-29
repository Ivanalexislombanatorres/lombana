'use client';

import { useActionState, useState } from 'react';
import { INTENTS, type IntentKey } from '@/components/ui';
import { createProject, type FormState } from '@/server/actions/projects';
import styles from './dashboard.module.css';

export function AskBox({ initialObjective, initialIntent }: { initialObjective: string; initialIntent: IntentKey | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProject, {});
  const [objective, setObjective] = useState(initialObjective);
  const [intent, setIntent] = useState<IntentKey | null>(initialIntent);

  return (
    <form action={action} className={`panel ${styles.ask}`}>
      <label htmlFor="objective" className="sr-only">
        Describe tu problema, idea u objetivo
      </label>
      <textarea
        id="objective"
        name="objective"
        className={styles.askInput}
        placeholder="Describe tu problema, idea u objetivo…"
        rows={3}
        maxLength={2000}
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        required
      />
      <input type="hidden" name="intent" value={intent ?? ''} />
      <div className={`row between wrap ${styles.askBar}`}>
        <div className="chips" role="group" aria-label="Tipo de objetivo">
          {INTENTS.map((i) => (
            <button
              key={i.key}
              type="button"
              className="chip"
              aria-pressed={intent === i.key}
              onClick={() => {
                setIntent(intent === i.key ? null : i.key);
                if (!objective.trim()) setObjective(i.example);
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? 'Creando…' : 'Crear proyecto'}
        </button>
      </div>
      {state.error && (
        <p className="notice notice-error" role="alert" style={{ marginTop: 12 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
