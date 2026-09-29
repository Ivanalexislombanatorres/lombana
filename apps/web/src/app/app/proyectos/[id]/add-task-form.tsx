'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addTask, type FormState } from '@/server/actions/projects';
import styles from '../projects.module.css';

export function AddTaskForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addTask, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!pending && !state.error) ref.current?.reset();
  }, [pending, state]);

  return (
    <form ref={ref} action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="projectId" value={projectId} />
      <div className={styles.addRow}>
        <label htmlFor="title" className="sr-only">
          Nuevo paso
        </label>
        <input id="title" name="title" className="input" placeholder="Agregar un paso…" maxLength={200} required />
        <button className="btn" type="submit" disabled={pending}>
          Agregar
        </button>
      </div>
      {state.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
