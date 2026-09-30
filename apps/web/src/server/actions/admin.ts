'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parsePriceToMinor } from '@/lib/products/catalog';
import { inOrg } from '@/server/session';

export interface AdminState {
  error?: string;
  done?: string;
}

// Mensajes de la base que se pueden mostrar tal cual (sin datos internos).
const KNOWN = [
  'Se requiere el permiso de plataforma',
  'Nadie cambia el estado de su propia cuenta',
  'Nadie cambia sus propios roles',
  'La plataforma debe conservar al menos un SUPER_ADMIN activo',
  'Indica el motivo del cambio',
  'El usuario no existe',
  'Rol de plataforma inválido',
  'El mínimo debe estar entre US$1 y US$100.000',
];

function friendly(err: unknown): string {
  const msg = (err as Error).message ?? '';
  const k = KNOWN.find((m) => msg.startsWith(m));
  if (!k) return 'No se pudo completar la acción.';
  return k === 'Se requiere el permiso de plataforma' ? 'No tienes el permiso de plataforma necesario.' : k;
}

const uuid = z.string().uuid();

export async function setUserStatus(_prev: AdminState, form: FormData): Promise<AdminState> {
  const user = uuid.safeParse(form.get('userId'));
  const status = z.enum(['active', 'suspended']).safeParse(form.get('status'));
  const reason = String(form.get('reason') ?? '').trim().slice(0, 500);
  if (!user.success || !status.success) return { error: 'Solicitud inválida' };
  try {
    await inOrg((tx) => tx.query('select app.admin_set_user_status($1, $2, $3)', [user.data, status.data, reason]));
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath('/app/admin');
  return { done: status.data === 'suspended' ? 'Cuenta suspendida.' : 'Cuenta reactivada.' };
}

export async function setPlatformRole(_prev: AdminState, form: FormData): Promise<AdminState> {
  const user = uuid.safeParse(form.get('userId'));
  const role = z.enum(['USER', 'CREATOR', 'PARTNER', 'BUSINESS', 'ADMIN', 'SUPER_ADMIN']).safeParse(form.get('role'));
  const grant = form.get('grant') === 'true';
  if (!user.success || !role.success) return { error: 'Solicitud inválida' };
  try {
    await inOrg((tx) => tx.query('select app.admin_set_platform_role($1, $2, $3)', [user.data, role.data, grant]));
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath('/app/admin');
  return { done: grant ? `Rol ${role.data} asignado.` : `Rol ${role.data} retirado.` };
}

export async function setMinPrice(_prev: AdminState, form: FormData): Promise<AdminState> {
  const minor = parsePriceToMinor(String(form.get('amount') ?? ''));
  if (minor === null) return { error: 'Escribe un monto válido en dólares, por ejemplo 5 o 7.50' };
  try {
    await inOrg((tx) => tx.query('select app.admin_set_min_price($1)', [minor]));
  } catch (err) {
    return { error: friendly(err) };
  }
  revalidatePath('/app/admin');
  return { done: 'Precio mínimo actualizado.' };
}
