'use client';

import { useActionState } from 'react';
import { signIn, signUp, type AuthState } from '@/server/actions/auth';

export function AuthForm({ mode, next }: { mode: 'signin' | 'signup'; next: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === 'signin' ? signIn : signUp, {});

  return (
    <form action={action} className="stack" noValidate>
      <input type="hidden" name="next" value={next} />
      {mode === 'signup' && (
        <div className="field">
          <label className="label" htmlFor="name">
            Nombre
          </label>
          <input className="input" id="name" name="name" autoComplete="name" required maxLength={120} />
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="email">
          Correo electrónico
        </label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={10}
          required
        />
        {mode === 'signup' && <span className="dim" style={{ fontSize: 12.5 }}>Mínimo 10 caracteres.</span>}
      </div>

      {state.error && (
        <p className="notice notice-error" role="alert">
          {state.error}
        </p>
      )}
      {state.info && (
        <p className="notice notice-info" role="status">
          {state.info}
        </p>
      )}

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'Un momento…' : mode === 'signin' ? 'Entrar' : 'Crear cuenta gratis'}
      </button>
    </form>
  );
}
