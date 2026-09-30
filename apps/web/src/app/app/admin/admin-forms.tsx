'use client';

import { useActionState } from 'react';
import { setMinPrice, setPlatformRole, setUserStatus, type AdminState } from '@/server/actions/admin';

function Feedback({ state }: { state: AdminState }) {
  if (state.error)
    return (
      <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
        {state.error}
      </p>
    );
  if (state.done)
    return (
      <p className="notice notice-info" role="status" style={{ margin: 0 }}>
        {state.done}
      </p>
    );
  return null;
}

export function UserStatusForm({ userId, status }: { userId: string; status: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(setUserStatus, {});
  const next = status === 'active' ? 'suspended' : 'active';
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={next} />
      <div className="row wrap" style={{ gap: 6 }}>
        <label className="sr-only" htmlFor={`reason-${userId}`}>
          Motivo
        </label>
        <input id={`reason-${userId}`} name="reason" className="input" placeholder="Motivo (obligatorio)" maxLength={500} style={{ maxWidth: 260 }} />
        <button className="btn btn-sm" type="submit" disabled={pending}>
          {next === 'suspended' ? 'Suspender' : 'Reactivar'}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function RoleForm({ userId, roles }: { userId: string; roles: string[] }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(setPlatformRole, {});
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="userId" value={userId} />
      <div className="row wrap" style={{ gap: 6 }}>
        <label className="sr-only" htmlFor={`role-${userId}`}>
          Rol de plataforma
        </label>
        <select id={`role-${userId}`} name="role" className="select select-sm" defaultValue="ADMIN" style={{ width: 'auto' }}>
          {['ADMIN', 'SUPER_ADMIN', 'CREATOR', 'PARTNER', 'BUSINESS'].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" type="submit" name="grant" value="true" disabled={pending}>
          Asignar
        </button>
        <button className="btn btn-sm" type="submit" name="grant" value="false" disabled={pending || roles.length === 0}>
          Retirar
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function MinPriceForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(setMinPrice, {});
  return (
    <form action={action} className="stack" style={{ gap: 8, maxWidth: 360 }}>
      <label className="label" htmlFor="amount">
        Precio mínimo de productos de pago (USD)
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input id="amount" name="amount" className="input" inputMode="decimal" defaultValue={current} required />
        <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
          Guardar
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
